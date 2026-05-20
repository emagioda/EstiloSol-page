import { NextRequest, NextResponse } from "next/server";
import { env } from "@/src/config/env";
import { scheduleAfterResponse } from "@/src/server/http/afterResponse";
import { logEvent } from "@/src/server/observability/log";
import { trackBusinessEvent } from "@/src/server/observability/metrics";
import { getOrder, markApproved, markTerminalPaymentState, updateOrder } from "@/src/server/orders/store";
import type { Order } from "@/src/server/orders/types";
import { formatDateTime24h, sendOrderReceiptEmail } from "@/src/server/notifications/orderReceipt";
import { fetchPaymentByIdFromMp, searchPaymentsByExternalReference } from "@/src/server/payments/mpClient";
import { amountMatches, terminalOrderStatusFromMpStatus } from "@/src/server/payments/shared";
import type { MpPaymentResponse, MpSearchPayment, MpSearchResponse } from "@/src/server/payments/shared";
import { checkRateLimit, checkRateLimitByKey } from "@/src/server/security/rateLimit";
import { parseExternalReference } from "@/src/server/validation/payments";

export const runtime = "nodejs";

const parsePaymentId = (value: string | null): string | null => {
  if (!value) return null;
  const trimmed = value.trim();
  if (!/^\d{5,30}$/.test(trimmed)) return null;
  return trimmed;
};

const buildPendingResponse = () =>
  NextResponse.json({ approved: false, message: "Pago pendiente / procesando" }, { status: 200 });

const buildApprovedResponse = (
  externalReference: string,
  paymentId: string | number | undefined,
  timestamp: number
) =>
  NextResponse.json(
    {
      approved: true,
      message: "Pago confirmado",
      paymentId,
      externalReference,
      timestamp,
      date: formatDateTime24h(timestamp),
    },
    { status: 200 }
  );

const buildCachedApprovedResponse = async (order: Order) => {
  await trackBusinessEvent("payment.verify.cached_approved", { externalReference: order.externalReference });
  const timestamp = order.approvedAt || order.updatedAt;
  return buildApprovedResponse(order.externalReference, order.mpPaymentId, timestamp);
};

const terminalPaymentMessage = (status: string) => {
  if (status === "refunded") return "Pago reintegrado";
  if (status === "charged_back") return "Pago con contracargo";
  if (status === "cancelled") return "Pago cancelado";
  return "Pago rechazado";
};

const buildTerminalResponse = (externalReference: string, status: string) =>
  NextResponse.json(
    {
      approved: false,
      message: terminalPaymentMessage(status),
      externalReference,
      status,
    },
    { status: 200 }
  );

const trySendReceiptEmail = async (
  order: Order,
  paymentId: string | number | undefined,
  approvedAt: number
) => {
  if (order.receiptEmailSentAt) return;

  const result = await sendOrderReceiptEmail({
    order,
    paymentId,
    approvedAt,
  });

  if (result.sent) {
    await updateOrder(order.externalReference, { receiptEmailSentAt: Date.now() });
    await trackBusinessEvent("payment.receipt_email.sent", { externalReference: order.externalReference });
    return;
  }

  if (result.reason === "missing_customer_email") {
    return;
  }

  logEvent("warn", "payments.receipt_email_failed", {
    externalReference: order.externalReference,
    reason: result.reason,
    detail: result.detail,
  });
  await trackBusinessEvent("payment.receipt_email.failed", {
    externalReference: order.externalReference,
    reason: result.reason,
  });
};

type MpPaymentLike = MpPaymentResponse | MpSearchPayment | undefined;

const isPaymentForOrder = (
  payment: MpPaymentLike,
  externalReference: string,
  expectedTotal: number
) => {
  if (!payment) return false;

  const ref = String(payment.external_reference || "");
  const amount = Number(payment.transaction_amount);
  const currency = String(payment.currency_id || "").toUpperCase();

  if (ref !== externalReference || currency !== "ARS" || !Number.isFinite(amount)) {
    return false;
  }

  return amountMatches(amount, expectedTotal);
};

const isApprovedPaymentMatch = (payment: MpPaymentLike, externalReference: string, expectedTotal: number) =>
  String(payment?.status || "") === "approved" && isPaymentForOrder(payment, externalReference, expectedTotal);

const getTerminalPaymentOrderStatus = (payment: MpPaymentLike, externalReference: string, expectedTotal: number) => {
  const orderStatus = terminalOrderStatusFromMpStatus(String(payment?.status || ""));
  if (!orderStatus || !isPaymentForOrder(payment, externalReference, expectedTotal)) return null;
  return orderStatus;
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
  const ref = typeof data.ref === "string" ? data.ref : null;
  const paymentId =
    typeof data.paymentId === "string"
      ? data.paymentId
      : typeof data.payment_id === "string"
        ? data.payment_id
        : null;

  return { ref, paymentId };
};

const confirmPayment = async (ref: string, paymentId: string | null, accessToken: string) => {
  const order = await getOrder(ref);

  if (!order) {
    await trackBusinessEvent("payment.verify.not_found", { externalReference: ref });
    return NextResponse.json({ approved: false, message: "Pago no encontrado" }, { status: 200 });
  }

  if (paymentId) {
    try {
      const paymentById = await fetchPaymentByIdFromMp(paymentId, accessToken);
      if (paymentById.response.ok && isApprovedPaymentMatch(paymentById.data || undefined, ref, order.total)) {
        const approvedAt = Date.now();
        await markApproved(order.externalReference, {
          paymentId,
          mpStatus: String(paymentById.data?.status || "approved"),
          approvedAt,
        });
        scheduleAfterResponse(() => trySendReceiptEmail(order, paymentId, approvedAt));
        logEvent("info", "payments.approved_from_verify_payment_id", {
          externalReference: order.externalReference,
          paymentId,
        });
        await trackBusinessEvent("payment.verify.approved", {
          externalReference: order.externalReference,
          paymentId,
        });
        return buildApprovedResponse(order.externalReference, paymentId, approvedAt);
      }

      const terminalOrderStatus = getTerminalPaymentOrderStatus(paymentById.data || undefined, ref, order.total);
      if (paymentById.response.ok && terminalOrderStatus) {
        await markTerminalPaymentState(order.externalReference, {
          status: terminalOrderStatus,
          paymentId,
          mpStatus: String(paymentById.data?.status || terminalOrderStatus),
        });
        await trackBusinessEvent("payment.verify.rejected", {
          externalReference: order.externalReference,
          mpStatus: String(paymentById.data?.status || terminalOrderStatus),
        });
        return buildTerminalResponse(order.externalReference, terminalOrderStatus);
      }
    } catch (error) {
      logEvent("warn", "payments.verify_payment_id_lookup_failed", {
        externalReference: ref,
        paymentId,
        error,
      });
    }
  }

  let response: Response;
  let data: MpSearchResponse | null;
  try {
    const result = await searchPaymentsByExternalReference(ref, accessToken);
    response = result.response;
    data = result.data;
  } catch (error) {
    logEvent("error", "payments.verify_search_network_error", { externalReference: ref, error });
    await trackBusinessEvent("payment.verify.network_error", { externalReference: ref });
    if (order.status === "approved") {
      return buildCachedApprovedResponse(order);
    }
    await updateOrder(ref, { status: "pending" });
    return buildPendingResponse();
  }

  if (!response.ok) {
    logEvent("warn", "payments.search_non_ok", { externalReference: ref, status: response.status });
    await trackBusinessEvent("payment.verify.search_non_ok", { externalReference: ref, status: response.status });
    if (order.status === "approved") {
      return buildCachedApprovedResponse(order);
    }
    await updateOrder(ref, { status: "pending" });
    return buildPendingResponse();
  }

  const approvedPayment = data?.results?.find((payment) =>
    isApprovedPaymentMatch(payment, order.externalReference, order.total)
  );

  const terminalPayment = data?.results?.find((payment) =>
    Boolean(getTerminalPaymentOrderStatus(payment, order.externalReference, order.total))
  );

  if (approvedPayment) {
    const approvedAt = Date.now();
    await markApproved(order.externalReference, {
      paymentId: String(approvedPayment.id || ""),
      mpStatus: String(approvedPayment.status || "approved"),
      approvedAt,
    });
    scheduleAfterResponse(() => trySendReceiptEmail(order, approvedPayment.id, approvedAt));

    logEvent("info", "payments.approved_from_verify", {
      externalReference: order.externalReference,
      paymentId: String(approvedPayment.id || ""),
      amount: approvedPayment.transaction_amount,
    });
    await trackBusinessEvent("payment.verify.approved", {
      externalReference: order.externalReference,
      paymentId: String(approvedPayment.id || ""),
    });

    return buildApprovedResponse(order.externalReference, approvedPayment.id, approvedAt);
  }

  if (terminalPayment) {
    const terminalOrderStatus = getTerminalPaymentOrderStatus(terminalPayment, order.externalReference, order.total);
    if (!terminalOrderStatus) {
      await updateOrder(ref, { status: "pending" });
      return buildPendingResponse();
    }

    await markTerminalPaymentState(order.externalReference, {
      status: terminalOrderStatus,
      paymentId: String(terminalPayment.id || ""),
      mpStatus: String(terminalPayment.status || terminalOrderStatus),
    });
    await trackBusinessEvent("payment.verify.rejected", {
      externalReference: order.externalReference,
      mpStatus: String(terminalPayment.status || terminalOrderStatus),
    });

    return buildTerminalResponse(order.externalReference, terminalOrderStatus);
  }

  if (order.status === "approved") {
    return buildCachedApprovedResponse(order);
  }

  await updateOrder(ref, { status: "pending" });
  await trackBusinessEvent("payment.verify.pending", { externalReference: ref });
  return buildPendingResponse();
};

export async function GET(request: NextRequest) {
  const rateLimitedResponse = await checkVerifyPaymentRateLimit(request);
  if (rateLimitedResponse) return rateLimitedResponse;

  const parsedRef = parseExternalReference(request.nextUrl.searchParams.get("ref"));
  if (!parsedRef.ok) {
    await trackBusinessEvent("payment.verify.invalid_ref", { route: "verify-payment" });
    return NextResponse.json({ error: parsedRef.message }, { status: 400 });
  }

  const ref = parsedRef.value;
  const order = await getOrder(ref);

  if (!order) {
    await trackBusinessEvent("payment.verify.not_found", { externalReference: ref });
    return NextResponse.json({ approved: false, message: "Pago no encontrado" }, { status: 200 });
  }

  if (order.status === "approved") {
    return buildCachedApprovedResponse(order);
  }

  const terminalStatus =
    terminalOrderStatusFromMpStatus(order.status) || terminalOrderStatusFromMpStatus(order.mpStatus || "");
  if (terminalStatus) {
    return buildTerminalResponse(order.externalReference, terminalStatus);
  }

  await trackBusinessEvent("payment.verify.pending", { externalReference: ref, mode: "read_only" });
  return buildPendingResponse();
}

export async function POST(request: NextRequest) {
  const envStatus = env.validatePaymentsServerEnv();
  if (!envStatus.ok) {
    logEvent("error", "payments.env_missing", { route: "verify-payment", missing: envStatus.missing });
    return NextResponse.json({ error: "Server misconfigured" }, { status: 500 });
  }
  const accessToken = env.getRequiredServer("MP_ACCESS_TOKEN");

  const rateLimitedResponse = await checkVerifyPaymentRateLimit(request);
  if (rateLimitedResponse) return rateLimitedResponse;

  const body = await parseVerifyPaymentBody(request);
  const parsedRef = parseExternalReference(body.ref);
  if (!parsedRef.ok) {
    await trackBusinessEvent("payment.verify.invalid_ref", { route: "verify-payment" });
    return NextResponse.json({ error: parsedRef.message }, { status: 400 });
  }

  const ref = parsedRef.value;
  const refAllowed = await checkRateLimitByKey({
    keyPrefix: "es:rl:verifypayment-ref",
    key: ref,
    max: 20,
    windowSeconds: 60,
  });
  if (!refAllowed) {
    logEvent("warn", "payments.ref_rate_limited", { route: "verify-payment", externalReference: ref });
    await trackBusinessEvent("payment.verify.rate_limited", { externalReference: ref, scope: "externalReference" });
    return NextResponse.json({ error: "Demasiadas solicitudes. Intenta nuevamente en un minuto." }, { status: 429 });
  }

  return confirmPayment(ref, parsePaymentId(body.paymentId), accessToken);
}
