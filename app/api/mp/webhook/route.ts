import { createHmac, timingSafeEqual } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { env } from "@/src/config/env";
import { getJson, setJson } from "@/src/server/kv";
import {
  WEBHOOK_DEDUPE_TTL_SECONDS,
  getOrder,
  markApproved,
  paymentDedupeKey,
  webhookDedupeKey,
} from "@/src/server/orders/store";

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

const toDataId = (request: NextRequest, body: MpWebhookPayload): string => {
  const queryId = request.nextUrl.searchParams.get("data.id") || request.nextUrl.searchParams.get("id");
  const bodyId = body.data?.id;
  const raw = queryId ?? (bodyId !== undefined ? String(bodyId) : "");
  return raw.trim().toLowerCase();
};

const fetchMpPayment = async (paymentId: string, accessToken: string): Promise<MpPaymentResponse | null> => {
  const response = await fetch(`https://api.mercadopago.com/v1/payments/${encodeURIComponent(paymentId)}`, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
    cache: "no-store",
  });

  if (!response.ok) {
    console.error("webhook payment fetch failed", { paymentId, status: response.status });
    return null;
  }

  return (await response.json().catch(() => null)) as MpPaymentResponse | null;
};

export async function POST(request: NextRequest) {
  const accessToken = env.getOptionalServer("MP_ACCESS_TOKEN");
  if (!accessToken) {
    return NextResponse.json({ error: "MP_ACCESS_TOKEN missing" }, { status: 500 });
  }

  const webhookSecret = env.getOptionalServer("MP_WEBHOOK_SECRET");
  const body = (await request.json().catch(() => null)) as MpWebhookPayload | null;

  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "Invalid webhook payload" }, { status: 400 });
  }

  if (!webhookSecret && process.env.NODE_ENV === "production") {
    return NextResponse.json({ error: "MP_WEBHOOK_SECRET missing" }, { status: 500 });
  }

  const dataIdLower = toDataId(request, body);
  if (!dataIdLower) {
    return NextResponse.json({ received: true }, { status: 200 });
  }

  if (webhookSecret) {
    const xSignature = parseSignature(request.headers.get("x-signature"));
    const xRequestId = request.headers.get("x-request-id");

    if (!xSignature || !xRequestId) {
      return NextResponse.json({ error: "Missing webhook signature headers" }, { status: 401 });
    }

    const manifest = `id:${dataIdLower};request-id:${xRequestId};ts:${xSignature.ts};`;
    const expected = createHmac("sha256", webhookSecret).update(manifest).digest("hex");

    if (!safeEqualHex(expected, xSignature.v1.toLowerCase())) {
      return NextResponse.json({ error: "Invalid webhook signature" }, { status: 401 });
    }
  }

  const dedupeKey = webhookDedupeKey(dataIdLower);
  const alreadyProcessed = await getJson<string>(dedupeKey);
  if (alreadyProcessed) {
    return NextResponse.json({ received: true }, { status: 200 });
  }
  await setJson(dedupeKey, "1", WEBHOOK_DEDUPE_TTL_SECONDS);

  const paymentId = /^\d+$/.test(dataIdLower) ? dataIdLower : body.data?.id ? String(body.data.id) : "";
  if (!paymentId) {
    return NextResponse.json({ received: true }, { status: 200 });
  }

  const paymentInfo = await fetchMpPayment(paymentId, accessToken);
  if (!paymentInfo) {
    return NextResponse.json({ received: true }, { status: 200 });
  }

  const externalReference = String(paymentInfo.external_reference || "").trim();
  if (!externalReference) {
    return NextResponse.json({ received: true }, { status: 200 });
  }

  const order = await getOrder(externalReference);
  if (!order) {
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
    }
  }

  return NextResponse.json({ received: true }, { status: 200 });
}

export function GET() {
  return NextResponse.json({ error: "Method not allowed" }, { status: 405 });
}
