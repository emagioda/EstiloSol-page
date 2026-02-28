import { createHmac, timingSafeEqual } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { env } from "@/src/config/env";
import { fetchWithPolicy } from "@/src/server/http/fetchWithPolicy";
import { getJson, setJson } from "@/src/server/kv";
import { logEvent } from "@/src/server/observability/log";
import { trackBusinessEvent } from "@/src/server/observability/metrics";
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

type MpPaymentResponse = {
  id?: string | number;
  status?: string;
  external_reference?: string;
  transaction_amount?: number;
  currency_id?: string;
};

const parseSignature = (headerValue: string | null) => {
  if (!headerValue) return null;

  const parts = headerValue.split(",").map((part) => part.trim());
  const parsed = Object.fromEntries(
    parts
      .map((part) => {
        const [key, value] = part.split("=");
        if (!key || !value) return null;
        return [key.trim(), value.trim()];
      })
      .filter((entry): entry is [string, string] => entry !== null)
  );

  if (!parsed.ts || !parsed.v1) return null;
  return { ts: parsed.ts, v1: parsed.v1 };
};

const safeEqualHex = (leftHex: string, rightHex: string) => {
  const left = Buffer.from(leftHex, "hex");
  const right = Buffer.from(rightHex, "hex");

  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
};

const amountMatches = (actual: number, expected: number, tolerance = 0.01) => {
  return Math.abs(actual - expected) <= tolerance;
};

const REJECTED_PAYMENT_STATUSES = new Set(["rejected", "cancelled", "charged_back"]);

const toDataId = (request: NextRequest, body: MpWebhookPayload): string => {
  const queryId = request.nextUrl.searchParams.get("data.id") || request.nextUrl.searchParams.get("id");
  const bodyId = body.data?.id;
  const raw = queryId ?? (bodyId !== undefined ? String(bodyId) : "");
  return raw.trim().toLowerCase();
};

const fetchMpPayment = async (paymentId: string, accessToken: string): Promise<MpPaymentResponse | null> => {
  let response: Response;
  try {
    response = await fetchWithPolicy(
      `https://api.mercadopago.com/v1/payments/${encodeURIComponent(paymentId)}`,
      {
        method: "GET",
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
        cache: "no-store",
      },
      {
        timeoutMs: 8000,
        retries: 1,
      }
    );
  } catch (error) {
    logEvent("error", "payments.webhook_payment_network_error", { paymentId, error });
    return null;
  }

  if (!response.ok) {
    logEvent("error", "payments.webhook_payment_fetch_failed", { paymentId, status: response.status });
    return null;
  }

  return (await response.json().catch(() => null)) as MpPaymentResponse | null;
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

  const dataIdLower = toDataId(request, body);
  if (!dataIdLower) {
    await trackBusinessEvent("payment.webhook.no_data_id", { route: "webhook" });
    return NextResponse.json({ received: true }, { status: 200 });
  }

  if (webhookSecret) {
    const xSignature = parseSignature(request.headers.get("x-signature"));
    const xRequestId = request.headers.get("x-request-id");

    if (!xSignature || !xRequestId) {
      await trackBusinessEvent("payment.webhook.missing_signature_headers", { eventId: dataIdLower });
      return NextResponse.json({ error: "Missing webhook signature headers" }, { status: 401 });
    }

    const manifest = `id:${dataIdLower};request-id:${xRequestId};ts:${xSignature.ts};`;
    const expected = createHmac("sha256", webhookSecret).update(manifest).digest("hex");

    if (!safeEqualHex(expected, xSignature.v1.toLowerCase())) {
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

  const paymentInfo = await fetchMpPayment(paymentId, accessToken);
  if (!paymentInfo) {
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
