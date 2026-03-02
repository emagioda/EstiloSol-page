import { NextRequest, NextResponse } from "next/server";
import { env } from "@/src/config/env";
import { getJson, setJson } from "@/src/server/kv";
import { logEvent } from "@/src/server/observability/log";
import { trackBusinessEvent } from "@/src/server/observability/metrics";
import {
  fetchPaymentByIdFromMp,
} from "@/src/server/payments/mpClient";
import { REJECTED_PAYMENT_STATUSES, amountMatches } from "@/src/server/payments/shared";
import type { MpPaymentResponse } from "@/src/server/payments/shared";
import {
  extractWebhookDataId,
  isValidWebhookSignature,
} from "@/src/server/payments/webhookSignature";
import {
  WEBHOOK_DEDUPE_TTL_SECONDS,
  getOrder,
  markApproved,
  markRejected,
  paymentDedupeKey,
  webhookDedupeKey,
} from "@/src/server/orders/store";
import { checkRateLimit } from "@/src/server/security/rateLimit";

export const runtime = "nodejs";

type MpWebhookPayload = {
  data?: {
    id?: string | number;
  };
};

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

    if (!signatureCheck.ok && signatureCheck.reason === "invalid_signature") {
      await trackBusinessEvent("payment.webhook.invalid_signature", { eventId: dataIdLower });
      return NextResponse.json({ error: "Invalid webhook signature" }, { status: 401 });
    }
  }

  const dedupeKey = webhookDedupeKey(dataIdLower);
  const alreadyProcessed = await getJson<string>(dedupeKey);
  if (alreadyProcessed) {
    logEvent("info", "payments.webhook_deduped", { eventId: dataIdLower });
    await trackBusinessEvent("payment.webhook.deduped", { eventId: dataIdLower });
    return NextResponse.json({ received: true }, { status: 200 });
  }
  await setJson(dedupeKey, "1", WEBHOOK_DEDUPE_TTL_SECONDS);

  const paymentId = /^\d+$/.test(dataIdLower) ? dataIdLower : body.data?.id ? String(body.data.id) : "";
  if (!paymentId) {
    return NextResponse.json({ received: true }, { status: 200 });
  }

  let paymentInfo: MpPaymentResponse | null;
  let paymentResponse: Response;
  try {
    const paymentResult = await fetchPaymentByIdFromMp(paymentId, accessToken);
    paymentResponse = paymentResult.response;
    paymentInfo = paymentResult.data;
  } catch (error) {
    logEvent("error", "payments.webhook_payment_network_error", { paymentId, error });
    await trackBusinessEvent("payment.webhook.payment_lookup_failed", { paymentId });
    return NextResponse.json({ received: true }, { status: 200 });
  }

  if (!paymentResponse.ok || !paymentInfo) {
    logEvent("error", "payments.webhook_payment_fetch_failed", { paymentId, status: paymentResponse.status });
    await trackBusinessEvent("payment.webhook.payment_lookup_failed", { paymentId });
    return NextResponse.json({ received: true }, { status: 200 });
  }

  const externalReference = String(paymentInfo.external_reference || "").trim();
  if (!externalReference) {
    await trackBusinessEvent("payment.webhook.no_external_reference", { paymentId });
    return NextResponse.json({ received: true }, { status: 200 });
  }

  const order = await getOrder(externalReference);
  if (!order) {
    await trackBusinessEvent("payment.webhook.order_not_found", { externalReference });
    return NextResponse.json({ received: true }, { status: 200 });
  }

  const status = String(paymentInfo.status || "");
  const amount = Number(paymentInfo.transaction_amount);
  const currency = String(paymentInfo.currency_id || "").toUpperCase();

  if (
    status === "approved" &&
    Number.isFinite(amount) &&
    currency === "ARS" &&
    order.currency === "ARS" &&
    amountMatches(amount, order.total)
  ) {
    const paymentKey = paymentDedupeKey(String(paymentInfo.id || paymentId));
    const paymentProcessed = await getJson<string>(paymentKey);
    if (!paymentProcessed) {
      await markApproved(externalReference, {
        paymentId: String(paymentInfo.id || paymentId),
        mpStatus: status,
        approvedAt: Date.now(),
      });
      await setJson(paymentKey, "1", WEBHOOK_DEDUPE_TTL_SECONDS);
      logEvent("info", "payments.approved_from_webhook", {
        externalReference,
        paymentId: String(paymentInfo.id || paymentId),
        amount,
      });
      await trackBusinessEvent("payment.webhook.approved", {
        externalReference,
        paymentId: String(paymentInfo.id || paymentId),
      });
    }
  }

  if (REJECTED_PAYMENT_STATUSES.has(status)) {
    await markRejected(externalReference, {
      paymentId: String(paymentInfo.id || paymentId),
      mpStatus: status,
    });
    await trackBusinessEvent("payment.webhook.rejected", {
      externalReference,
      mpStatus: status,
    });
  }

  return NextResponse.json({ received: true }, { status: 200 });
}

export function GET() {
  return NextResponse.json({ error: "Method not allowed" }, { status: 405 });
}
