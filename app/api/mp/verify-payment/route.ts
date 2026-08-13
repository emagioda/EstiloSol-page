import { NextRequest, NextResponse } from "next/server";
import { env } from "@/src/config/env";
import { formatDateTime24h } from "@/src/server/notifications/orderReceipt";
import { logEvent } from "@/src/server/observability/log";
import { trackBusinessEvent } from "@/src/server/observability/metrics";
import { resolveOrderInventoryStatus } from "@/src/server/orders/inventory";
import { getOrder } from "@/src/server/orders/store";
import type { Order } from "@/src/server/orders/types";
import { fetchPaymentByIdFromMp, searchPaymentsByExternalReference } from "@/src/server/payments/mpClient";
import { reconcileMercadoPagoPayment } from "@/src/server/payments/reconciliation";
import { checkRateLimit, checkRateLimitByKey } from "@/src/server/security/rateLimit";
import { parseExternalReference } from "@/src/server/validation/payments";

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

const confirmPayment = async (ref: string, paymentId: string | null, accessToken: string) => {
  let order = await getOrder(ref);
  if (!order) {
    await trackBusinessEvent("payment.verify.not_found", { externalReference: ref });
    return NextResponse.json({ approved: false, message: "Pago no encontrado" }, { status: 200 });
  }

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
      const reconciliation = await reconcileMercadoPagoPayment({
        externalReference: ref,
        payment: paymentById.data,
        fallbackPaymentId: paymentId,
        source: "verify_payment_id",
      });
      if (reconciliation.outcome === "reconciled") order = reconciliation.order;
    }
  }

  let search: Awaited<ReturnType<typeof searchPaymentsByExternalReference>> | null = null;
  try {
    search = await searchPaymentsByExternalReference(ref, accessToken);
  } catch (error) {
    logEvent("error", "payments.verify_search_network_error", {
      externalReference: ref,
      errorName: error instanceof Error ? error.name : "unknown",
    });
    await trackBusinessEvent("payment.verify.network_error", { externalReference: ref });
  }

  if (!search) return buildOrderResponse(order);
  if (!search.response.ok) {
    logEvent("warn", "payments.search_non_ok", {
      externalReference: ref,
      status: search.response.status,
    });
    return buildOrderResponse(order);
  }

  const seenPaymentIds = new Set<string>();
  for (const payment of search.data?.results ?? []) {
    const candidateId = String(payment.id ?? "");
    if (!candidateId || seenPaymentIds.has(candidateId)) continue;
    seenPaymentIds.add(candidateId);
    const reconciliation = await reconcileMercadoPagoPayment({
      externalReference: ref,
      payment,
      source: "verify_search",
    });
    if (reconciliation.outcome === "reconciled") order = reconciliation.order;
  }

  return buildOrderResponse(order);
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
