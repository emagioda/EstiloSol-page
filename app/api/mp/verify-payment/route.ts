import { NextRequest, NextResponse } from "next/server";
import { env } from "@/src/config/env";
import { formatDateTime24h } from "@/src/server/notifications/orderReceipt";
import { logEvent } from "@/src/server/observability/log";
import { trackBusinessEvent } from "@/src/server/observability/metrics";
import { resolveOrderInventoryStatus } from "@/src/server/orders/inventory";
import { getOrder } from "@/src/server/orders/store";
import type { Order } from "@/src/server/orders/types";
import {
  fetchPaymentByIdFromMp,
  iteratePaymentSearchPagesByExternalReference,
  MercadoPagoPaymentSearchPaginationError,
} from "@/src/server/payments/mpClient";
import {
  reconcileMercadoPagoPayment,
  reconcileMercadoPagoPaymentObservations,
} from "@/src/server/payments/reconciliation";
import type { MpPaymentResponse, MpSearchPayment } from "@/src/server/payments/shared";
import { checkRateLimit, checkRateLimitByKey } from "@/src/server/security/rateLimit";
import { parseExternalReference } from "@/src/server/validation/payments";
import { getRecoverySnapshot } from "@/src/server/recovery/repository";
import {
  parseStoredRecoverySnapshot,
  recoverySnapshotToOrder,
} from "@/src/server/recovery/snapshot";

export const runtime = "nodejs";

const parsePaymentId = (value: string | null): string | null => {
  if (!value) return null;
  const trimmed = value.trim();
  return /^\d{5,30}$/.test(trimmed) ? trimmed : null;
};

const buildPendingResponse = () =>
  NextResponse.json({ approved: false, message: "Pago pendiente / procesando" }, { status: 200 });

const buildApprovedResponse = (order: Order) => {
  const timestamp = order.approvedAt ?? order.updatedAt;
  const inventoryStatus = resolveOrderInventoryStatus(order);
  return NextResponse.json(
    {
      approved: true,
      message:
        inventoryStatus === "conflict" || inventoryStatus === "error"
          ? "Pago confirmado. Recibimos correctamente tu pago y estamos procesando tu pedido. Si necesitamos coordinar algún detalle, nos comunicaremos con vos."
          : "Pago confirmado",
      paymentId: order.mpPaymentId,
      externalReference: order.externalReference,
      timestamp,
      date: formatDateTime24h(timestamp),
    },
    { status: 200 }
  );
};

const terminalPaymentMessage = (status: string) => {
  if (status === "refunded") return "Pago reintegrado";
  if (status === "charged_back") return "Pago con contracargo";
  if (status === "cancelled") return "Pago cancelado";
  return "Pago rechazado";
};

const buildOrderResponse = async (order: Order) => {
  if (order.paymentStatus === "confirmed") {
    await trackBusinessEvent("payment.verify.cached_approved", {
      externalReference: order.externalReference,
    });
    return buildApprovedResponse(order);
  }
  if (
    order.status === "rejected" ||
    order.status === "cancelled" ||
    order.status === "refunded" ||
    order.status === "charged_back"
  ) {
    return NextResponse.json(
      {
        approved: false,
        message: terminalPaymentMessage(order.status),
        externalReference: order.externalReference,
        status: order.status,
      },
      { status: 200 }
    );
  }
  await trackBusinessEvent("payment.verify.pending", { externalReference: order.externalReference });
  return buildPendingResponse();
};

const checkVerifyPaymentRateLimit = async (request: NextRequest) => {
  const allowed = await checkRateLimit(request, {
    keyPrefix: "es:rl:verifypayment",
    max: 40,
    windowSeconds: 60,
  });
  if (allowed) return null;
  logEvent("warn", "payments.rate_limited", { route: "verify-payment" });
  await trackBusinessEvent("payment.verify.rate_limited", { route: "verify-payment" });
  return NextResponse.json({ error: "Demasiadas solicitudes. Intenta nuevamente en un minuto." }, { status: 429 });
};

const parseVerifyPaymentBody = async (request: NextRequest) => {
  const body = await request.json().catch(() => null);
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return { ref: null, paymentId: null };
  }
  const data = body as Record<string, unknown>;
  return {
    ref: typeof data.ref === "string" ? data.ref : null,
    paymentId:
      typeof data.paymentId === "string"
        ? data.paymentId
        : typeof data.payment_id === "string"
          ? data.payment_id
          : null,
  };
};

const PROTECTED_MP_PAYMENT_STATUSES = new Set(["approved", "refunded", "charged_back"]);

const normalizedPaymentStatus = (payment: MpPaymentResponse | MpSearchPayment) =>
  String(payment.status ?? "").trim().toLowerCase();

const paymentIdentity = (
  payment: MpPaymentResponse | MpSearchPayment,
  fallbackPaymentId?: string
) => String(payment.id ?? fallbackPaymentId ?? "").trim();

const isProtectedDirectPaymentObservation = (
  order: Order,
  payment: MpPaymentResponse,
  fallbackPaymentId: string
) => {
  const paymentId = paymentIdentity(payment, fallbackPaymentId);
  const existingEntry = order.mpPaymentLedger?.[paymentId];
  return Boolean(
    PROTECTED_MP_PAYMENT_STATUSES.has(normalizedPaymentStatus(payment)) ||
      existingEntry?.approvedAt !== undefined ||
      (existingEntry && PROTECTED_MP_PAYMENT_STATUSES.has(existingEntry.status)) ||
      (order.paymentStatus === "confirmed" && order.mpPaymentId === paymentId)
  );
};

const buildIncompleteSearchResponse = async (ref: string, fallbackOrder: Order) => {
  const latestOrder = (await getOrder(ref)) ?? fallbackOrder;
  if (latestOrder.paymentStatus === "confirmed") {
    return buildOrderResponse(latestOrder);
  }
  return NextResponse.json(
    {
      error: "No se pudo completar la busqueda de pagos",
      code: "MP_PAYMENT_SEARCH_INCOMPLETE",
    },
    { status: 503 }
  );
};

type StagedPaymentObservation = {
  payment: MpPaymentResponse | MpSearchPayment;
  fallbackPaymentId?: string;
  source: "verify_payment_id" | "verify_search";
};

const confirmPayment = async (ref: string, paymentId: string | null, accessToken: string) => {
  let order = await getOrder(ref);
  let validationOrder = order;
  if (!validationOrder) {
    const storedSnapshot = await getRecoverySnapshot(ref);
    if (storedSnapshot?.snapshotJson) {
      validationOrder = recoverySnapshotToOrder(parseStoredRecoverySnapshot(storedSnapshot));
    }
    if (!storedSnapshot) {
      await trackBusinessEvent("payment.verify.not_found", { externalReference: ref });
      return NextResponse.json({ approved: false, message: "Pago no encontrado" }, { status: 200 });
    }
  }
  let stagedDirectPayment: StagedPaymentObservation | null = null;
  if (paymentId) {
    let paymentById: Awaited<ReturnType<typeof fetchPaymentByIdFromMp>> | null = null;
    try {
      paymentById = await fetchPaymentByIdFromMp(paymentId, accessToken);
    } catch (error) {
      logEvent("warn", "payments.verify_payment_id_lookup_failed", {
        externalReference: ref,
        paymentId,
        errorName: error instanceof Error ? error.name : "unknown",
      });
    }
    if (paymentById?.response.ok && paymentById.data) {
      if (
        !validationOrder ||
        isProtectedDirectPaymentObservation(validationOrder, paymentById.data, paymentId)
      ) {
        const reconciliation = await reconcileMercadoPagoPayment({
          externalReference: ref,
          payment: paymentById.data,
          fallbackPaymentId: paymentId,
          source: "verify_payment_id",
        });
        if (reconciliation.outcome === "reconciled") {
          order = reconciliation.order;
          validationOrder = reconciliation.order;
        } else if (reconciliation.outcome === "recovery_attention" && reconciliation.order) {
          order = reconciliation.order;
          validationOrder = reconciliation.order;
        }
      } else {
        stagedDirectPayment = {
          payment: paymentById.data,
          fallbackPaymentId: paymentId,
          source: "verify_payment_id",
        };
      }
    }
  }

  const stagedPayments = new Map<string, StagedPaymentObservation>();
  const searchPages = iteratePaymentSearchPagesByExternalReference(ref, accessToken);
  while (true) {
    let nextPage: Awaited<ReturnType<typeof searchPages.next>>;
    try {
      nextPage = await searchPages.next();
    } catch (error) {
      const latestOrder = (await getOrder(ref)) ?? order;
      if (error instanceof MercadoPagoPaymentSearchPaginationError) {
        logEvent("error", "payments.verify_search_incomplete", {
          externalReference: ref,
          reason: error.reason,
          reportedTotal: error.reportedTotal,
        });
        await trackBusinessEvent("payment.verify.search_incomplete", {
          externalReference: ref,
          reason: error.reason,
        });
        if (latestOrder?.paymentStatus === "confirmed") {
          return buildOrderResponse(latestOrder);
        }
        return NextResponse.json(
          {
            error: "No se pudo completar la búsqueda de pagos",
            code: "MP_PAYMENT_SEARCH_INCOMPLETE",
          },
          { status: 503 }
        );
      }

      logEvent("error", "payments.verify_search_network_error", {
        externalReference: ref,
        errorName: error instanceof Error ? error.name : "unknown",
      });
      await trackBusinessEvent("payment.verify.network_error", { externalReference: ref });
      await trackBusinessEvent("payment.verify.search_incomplete", {
        externalReference: ref,
        reason: "network_error",
      });
      if (order) return buildIncompleteSearchResponse(ref, order);
      return NextResponse.json(
        { error: "No se pudo completar la busqueda de pagos", code: "MP_PAYMENT_SEARCH_INCOMPLETE" },
        { status: 503 },
      );
    }

    if (nextPage.done) break;
    const search = nextPage.value;
    if (!search.response.ok) {
      logEvent("warn", "payments.search_non_ok", {
        externalReference: ref,
        status: search.response.status,
      });
      await trackBusinessEvent("payment.verify.search_non_ok", {
        externalReference: ref,
        status: search.response.status,
      });
      await trackBusinessEvent("payment.verify.search_incomplete", {
        externalReference: ref,
        reason: "non_ok",
        status: search.response.status,
      });
      if (order) return buildIncompleteSearchResponse(ref, order);
      return NextResponse.json(
        { error: "No se pudo completar la busqueda de pagos", code: "MP_PAYMENT_SEARCH_INCOMPLETE" },
        { status: 503 },
      );
    }

    for (const payment of search.data?.results ?? []) {
      const candidateId = paymentIdentity(payment);
      if (!candidateId || stagedPayments.has(candidateId)) {
        continue;
      }
      stagedPayments.set(candidateId, { payment, source: "verify_search" });
    }
  }

  if (stagedDirectPayment) {
    const directPaymentId = paymentIdentity(
      stagedDirectPayment.payment,
      stagedDirectPayment.fallbackPaymentId
    );
    if (directPaymentId && !stagedPayments.has(directPaymentId)) {
      stagedPayments.set(directPaymentId, stagedDirectPayment);
    }
  }

  const reconciliation = await reconcileMercadoPagoPaymentObservations({
    externalReference: ref,
    ...(validationOrder ? { validationOrder } : {}),
    observations: Array.from(stagedPayments.values()),
  });
  if (reconciliation.outcome === "reconciled") {
    order = reconciliation.order;
  } else if (reconciliation.outcome === "recovery_attention" && reconciliation.order) {
    order = reconciliation.order;
  }

  return order ? buildOrderResponse(order) : buildPendingResponse();
};

export async function GET(request: NextRequest) {
  const rateLimitedResponse = await checkVerifyPaymentRateLimit(request);
  if (rateLimitedResponse) return rateLimitedResponse;
  const parsedRef = parseExternalReference(request.nextUrl.searchParams.get("ref"));
  if (!parsedRef.ok) {
    await trackBusinessEvent("payment.verify.invalid_ref", { route: "verify-payment" });
    return NextResponse.json({ error: parsedRef.message }, { status: 400 });
  }
  const order = await getOrder(parsedRef.value);
  if (!order) {
    const snapshot = await getRecoverySnapshot(parsedRef.value);
    if (snapshot) return buildPendingResponse();
    await trackBusinessEvent("payment.verify.not_found", { externalReference: parsedRef.value });
    return NextResponse.json({ approved: false, message: "Pago no encontrado" }, { status: 200 });
  }
  return buildOrderResponse(order);
}

export async function POST(request: NextRequest) {
  const envStatus = env.validatePaymentsServerEnv();
  if (!envStatus.ok) {
    logEvent("error", "payments.env_missing", { route: "verify-payment", missing: envStatus.missing });
    return NextResponse.json({ error: "Server misconfigured" }, { status: 500 });
  }
  const rateLimitedResponse = await checkVerifyPaymentRateLimit(request);
  if (rateLimitedResponse) return rateLimitedResponse;

  const body = await parseVerifyPaymentBody(request);
  const parsedRef = parseExternalReference(body.ref);
  if (!parsedRef.ok) {
    await trackBusinessEvent("payment.verify.invalid_ref", { route: "verify-payment" });
    return NextResponse.json({ error: parsedRef.message }, { status: 400 });
  }
  const refAllowed = await checkRateLimitByKey({
    keyPrefix: "es:rl:verifypayment-ref",
    key: parsedRef.value,
    max: 20,
    windowSeconds: 60,
  });
  if (!refAllowed) {
    logEvent("warn", "payments.ref_rate_limited", {
      route: "verify-payment",
      externalReference: parsedRef.value,
    });
    await trackBusinessEvent("payment.verify.rate_limited", {
      externalReference: parsedRef.value,
      scope: "externalReference",
    });
    return NextResponse.json({ error: "Demasiadas solicitudes. Intenta nuevamente en un minuto." }, { status: 429 });
  }

  try {
    return await confirmPayment(
      parsedRef.value,
      parsePaymentId(body.paymentId),
      env.getRequiredServer("MP_ACCESS_TOKEN")
    );
  } catch (error) {
    logEvent("error", "payments.verify_reconciliation_failed", {
      externalReference: parsedRef.value,
      errorName: error instanceof Error ? error.name : "unknown",
    });
    return NextResponse.json({ error: "No se pudo persistir la reconciliación del pago" }, { status: 503 });
  }
}
