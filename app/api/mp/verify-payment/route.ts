import { NextRequest, NextResponse } from "next/server";
import { env } from "@/src/config/env";
import { logEvent } from "@/src/server/observability/log";
import { trackBusinessEvent } from "@/src/server/observability/metrics";
import { getOrder, markApproved, markRejected, updateOrder } from "@/src/server/orders/store";
import { fetchPaymentByIdFromMp, searchPaymentsByExternalReference } from "@/src/server/payments/mpClient";
import { REJECTED_PAYMENT_STATUSES, amountMatches } from "@/src/server/payments/shared";
import type { MpPaymentResponse, MpSearchResponse } from "@/src/server/payments/shared";
import { checkRateLimit } from "@/src/server/security/rateLimit";
import { parseExternalReference } from "@/src/server/validation/payments";

export const runtime = "nodejs";

const parsePaymentId = (value: string | null): string | null => {
  if (!value) return null;
  const trimmed = value.trim();
  if (!/^\d{5,30}$/.test(trimmed)) return null;
  return trimmed;
};

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
      date: new Date(timestamp).toLocaleString("es-AR"),
    },
    { status: 200 }
  );

const isApprovedPaymentMatch = (
  payment: MpPaymentResponse | undefined,
  externalReference: string,
  expectedTotal?: number
) => {
  if (!payment) return false;

  const status = String(payment.status || "");
  const ref = String(payment.external_reference || "");
  const amount = Number(payment.transaction_amount);
  const currency = String(payment.currency_id || "").toUpperCase();

  if (status !== "approved" || ref !== externalReference || currency !== "ARS" || !Number.isFinite(amount)) {
    return false;
  }

  if (typeof expectedTotal === "number") {
    return amountMatches(amount, expectedTotal);
  }

  return true;
};

export async function GET(request: NextRequest) {
  const envStatus = env.validatePaymentsServerEnv();
  if (!envStatus.ok) {
    logEvent("error", "payments.env_missing", { route: "verify-payment", missing: envStatus.missing });
    return NextResponse.json({ error: "Server misconfigured" }, { status: 500 });
  }
  const accessToken = env.getRequiredServer("MP_ACCESS_TOKEN");

  const allowed = await checkRateLimit(request, {
    keyPrefix: "es:rl:verifypayment",
    max: 40,
    windowSeconds: 60,
  });
  if (!allowed) {
    logEvent("warn", "payments.rate_limited", { route: "verify-payment" });
    await trackBusinessEvent("payment.verify.rate_limited", { route: "verify-payment" });
    return NextResponse.json({ error: "Demasiadas solicitudes. Intentá nuevamente en un minuto." }, { status: 429 });
  }

  const parsedRef = parseExternalReference(request.nextUrl.searchParams.get("ref"));
  if (!parsedRef.ok) {
    await trackBusinessEvent("payment.verify.invalid_ref", { route: "verify-payment" });
    return NextResponse.json({ error: parsedRef.message }, { status: 400 });
  }
  const ref = parsedRef.value;
  const paymentId = parsePaymentId(
    request.nextUrl.searchParams.get("payment_id") ||
      request.nextUrl.searchParams.get("paymentId") ||
      request.nextUrl.searchParams.get("collection_id")
  );

  const order = await getOrder(ref);

  if (!order) {
    if (paymentId) {
      try {
        const paymentById = await fetchPaymentByIdFromMp(paymentId, accessToken);
        if (paymentById.response.ok && isApprovedPaymentMatch(paymentById.data || undefined, ref)) {
          const approvedAt = Date.now();
          await trackBusinessEvent("payment.verify.approved", { externalReference: ref, paymentId });
          logEvent("info", "payments.approved_from_verify_without_order", {
            externalReference: ref,
            paymentId,
          });
          return buildApprovedResponse(ref, paymentId, approvedAt);
        }
      } catch (error) {
        logEvent("warn", "payments.verify_payment_id_lookup_failed", {
          externalReference: ref,
          paymentId,
          error,
        });
      }
    }

    await trackBusinessEvent("payment.verify.not_found", { externalReference: ref });
    return NextResponse.json({ approved: false, message: "Pago no encontrado" }, { status: 200 });
  }

  if (order.status === "approved") {
    await trackBusinessEvent("payment.verify.cached_approved", { externalReference: order.externalReference });
    const timestamp = order.approvedAt || order.updatedAt;
    return buildApprovedResponse(order.externalReference, order.mpPaymentId, timestamp);
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
    await updateOrder(ref, { status: "pending" });
    return NextResponse.json({ approved: false, message: "Pago pendiente / procesando" }, { status: 200 });
  }

  if (!response.ok) {
    logEvent("warn", "payments.search_non_ok", { externalReference: ref, status: response.status });
    await trackBusinessEvent("payment.verify.search_non_ok", { externalReference: ref, status: response.status });
    await updateOrder(ref, { status: "pending" });
    return NextResponse.json({ approved: false, message: "Pago pendiente / procesando" }, { status: 200 });
  }

  const approvedPayment = data?.results?.find((payment) => {
    const status = String(payment.status || "");
    const externalReference = String(payment.external_reference || "");
    const amount = Number(payment.transaction_amount);
    const currency = String(payment.currency_id || "").toUpperCase();

    return (
      status === "approved" &&
      externalReference === order.externalReference &&
      currency === "ARS" &&
      Number.isFinite(amount) &&
      amountMatches(amount, order.total)
    );
  });

  const rejectedPayment = data?.results?.find((payment) => {
    const status = String(payment.status || "");
    const externalReference = String(payment.external_reference || "");
    return REJECTED_PAYMENT_STATUSES.has(status) && externalReference === order.externalReference;
  });

  if (approvedPayment) {
    const approvedAt = Date.now();
    await markApproved(order.externalReference, {
      paymentId: String(approvedPayment.id || ""),
      mpStatus: String(approvedPayment.status || "approved"),
      approvedAt,
    });

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

  if (rejectedPayment) {
    await markRejected(order.externalReference, {
      paymentId: String(rejectedPayment.id || ""),
      mpStatus: String(rejectedPayment.status || "rejected"),
    });
    await trackBusinessEvent("payment.verify.rejected", {
      externalReference: order.externalReference,
      mpStatus: String(rejectedPayment.status || "rejected"),
    });

    return NextResponse.json(
      {
        approved: false,
        message: "Pago rechazado",
        externalReference: order.externalReference,
      },
      { status: 200 }
    );
  }

  await updateOrder(ref, { status: "pending" });
  await trackBusinessEvent("payment.verify.pending", { externalReference: ref });
  return NextResponse.json({ approved: false, message: "Pago pendiente / procesando" }, { status: 200 });
}
