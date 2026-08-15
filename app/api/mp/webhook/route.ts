import { NextRequest, NextResponse } from "next/server";
import { env } from "@/src/config/env";
import { setJson } from "@/src/server/kv";
import { logEvent } from "@/src/server/observability/log";
import { trackBusinessEvent } from "@/src/server/observability/metrics";
import { WEBHOOK_DEDUPE_TTL_SECONDS, webhookDedupeKey } from "@/src/server/orders/store";
import { fetchPaymentByIdFromMp } from "@/src/server/payments/mpClient";
import { reconcileMercadoPagoPayment } from "@/src/server/payments/reconciliation";
import { terminalOrderStatusFromMpStatus } from "@/src/server/payments/shared";
import { extractWebhookDataId, isValidWebhookSignature } from "@/src/server/payments/webhookSignature";
import { checkRateLimit } from "@/src/server/security/rateLimit";

export const runtime = "nodejs";

type MpWebhookPayload = { data?: { id?: string | number } };

export async function POST(request: NextRequest) {
  const envStatus = env.validatePaymentsServerEnv();
  if (!envStatus.ok) {
    logEvent("error", "payments.env_missing", { route: "webhook", missing: envStatus.missing });
    return NextResponse.json({ error: "Server misconfigured" }, { status: 500 });
  }
  const accessToken = env.getRequiredServer("MP_ACCESS_TOKEN");

  const allowed = await checkRateLimit(request, {
    keyPrefix: "es:rl:webhook",
    max: 120,
    windowSeconds: 60,
  });
  if (!allowed) {
    logEvent("warn", "payments.rate_limited", { route: "webhook" });
    await trackBusinessEvent("payment.webhook.rate_limited", { route: "webhook" });
    return NextResponse.json({ error: "Too many webhook requests" }, { status: 429 });
  }

  const webhookSecret = env.getOptionalServer("MP_WEBHOOK_SECRET");
  const body = (await request.json().catch(() => null)) as MpWebhookPayload | null;
  if (!body || typeof body !== "object") {
    await trackBusinessEvent("payment.webhook.invalid_payload", { route: "webhook" });
    return NextResponse.json({ error: "Invalid webhook payload" }, { status: 400 });
  }
  if (!webhookSecret && process.env.NODE_ENV === "production") {
    return NextResponse.json({ error: "MP_WEBHOOK_SECRET missing" }, { status: 500 });
  }

  const dataIdLower = extractWebhookDataId(request, body);
  if (!dataIdLower) {
    await trackBusinessEvent("payment.webhook.no_data_id", { route: "webhook" });
    return NextResponse.json({ received: true }, { status: 200 });
  }
  if (webhookSecret) {
    const signatureCheck = isValidWebhookSignature({
      secret: webhookSecret,
      dataIdLower,
      xRequestId: request.headers.get("x-request-id"),
      xSignatureHeader: request.headers.get("x-signature"),
    });
    if (!signatureCheck.ok && signatureCheck.reason === "missing_headers") {
      await trackBusinessEvent("payment.webhook.missing_signature_headers", { eventId: dataIdLower });
      return NextResponse.json({ error: "Missing webhook signature headers" }, { status: 401 });
    }
    if (!signatureCheck.ok) {
      await trackBusinessEvent("payment.webhook.invalid_signature", { eventId: dataIdLower });
      return NextResponse.json({ error: "Invalid webhook signature" }, { status: 401 });
    }
  }

  const bodyPaymentId =
    body.data?.id === undefined ? null : String(body.data.id).trim().toLowerCase();
  if (bodyPaymentId !== null && bodyPaymentId !== dataIdLower) {
    logEvent("warn", "payments.webhook_data_id_mismatch", {
      signedPaymentId: dataIdLower,
      bodyPaymentId,
    });
    await trackBusinessEvent("payment.webhook.data_id_mismatch", {
      signedPaymentId: dataIdLower,
    });
    return NextResponse.json({ error: "Webhook payment ID mismatch" }, { status: 400 });
  }

  const requestedPaymentId = dataIdLower;
  let paymentResult: Awaited<ReturnType<typeof fetchPaymentByIdFromMp>>;
  try {
    paymentResult = await fetchPaymentByIdFromMp(requestedPaymentId, accessToken);
  } catch (error) {
    logEvent("error", "payments.webhook_payment_network_error", {
      paymentId: requestedPaymentId,
      errorName: error instanceof Error ? error.name : "unknown",
    });
    await trackBusinessEvent("payment.webhook.payment_lookup_failed", { paymentId: requestedPaymentId });
    return NextResponse.json({ error: "Payment lookup failed" }, { status: 503 });
  }
  if (!paymentResult.response.ok || !paymentResult.data) {
    logEvent("error", "payments.webhook_payment_fetch_failed", {
      paymentId: requestedPaymentId,
      status: paymentResult.response.status,
    });
    await trackBusinessEvent("payment.webhook.payment_lookup_failed", { paymentId: requestedPaymentId });
    return NextResponse.json({ error: "Payment lookup failed" }, { status: 503 });
  }

  const fetchedPaymentId =
    paymentResult.data.id === undefined
      ? null
      : String(paymentResult.data.id).trim().toLowerCase();
  if (fetchedPaymentId !== null && fetchedPaymentId !== requestedPaymentId) {
    logEvent("error", "payments.webhook_fetched_payment_id_mismatch", {
      signedPaymentId: requestedPaymentId,
    });
    await trackBusinessEvent("payment.webhook.payment_lookup_failed", {
      paymentId: requestedPaymentId,
      reason: "fetched_id_mismatch",
    });
    return NextResponse.json({ error: "Payment lookup failed" }, { status: 503 });
  }

  const externalReference = String(paymentResult.data.external_reference ?? "");
  if (!externalReference) {
    await trackBusinessEvent("payment.webhook.no_external_reference", { paymentId: requestedPaymentId });
  }

  try {
    const reconciliation = await reconcileMercadoPagoPayment({
      externalReference,
      payment: paymentResult.data,
      fallbackPaymentId: requestedPaymentId,
      source: "webhook",
    });
    if (reconciliation.outcome === "reconciled") {
      await setJson(
        webhookDedupeKey(`${reconciliation.paymentId}:${reconciliation.status}`),
        "1",
        WEBHOOK_DEDUPE_TTL_SECONDS
      );
      if (reconciliation.status === "approved") {
        await trackBusinessEvent("payment.webhook.approved", {
          externalReference,
          paymentId: reconciliation.paymentId,
          mpStatus: reconciliation.status,
        });
      } else {
        const terminalStatus = terminalOrderStatusFromMpStatus(reconciliation.status);
        if (terminalStatus) {
          await trackBusinessEvent("payment.webhook.terminal_status", {
            externalReference,
            paymentId: reconciliation.paymentId,
            mpStatus: reconciliation.status,
            orderStatus: terminalStatus,
          });
        }
      }
    } else if (reconciliation.outcome === "recovery_attention") {
      await trackBusinessEvent("payment.webhook.order_not_found", {
        externalReference,
        paymentId: reconciliation.paymentId,
        recoveryDurable: true,
      });
    } else if (reconciliation.outcome === "order_not_found") {
      await trackBusinessEvent("payment.webhook.order_not_found", { externalReference });
    }
    return NextResponse.json({ received: true }, { status: 200 });
  } catch (error) {
    logEvent("error", "payments.webhook_reconciliation_failed", {
      paymentId: requestedPaymentId,
      externalReference,
      errorName: error instanceof Error ? error.name : "unknown",
    });
    return NextResponse.json({ error: "Payment reconciliation failed" }, { status: 503 });
  }
}

export function GET() {
  return NextResponse.json({ error: "Method not allowed" }, { status: 405 });
}
