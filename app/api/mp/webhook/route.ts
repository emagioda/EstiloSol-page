import { createHmac, timingSafeEqual } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";

type PaymentRecord = {
  id: string | number;
  externalReference: string;
  status: string;
  timestamp: number;
};

const paymentStore = new Map<string, PaymentRecord>();

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

export async function POST(request: NextRequest) {
  const webhookSecret = process.env.MP_WEBHOOK_SECRET;
  const body = await request.json().catch(() => null);

  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "Invalid webhook payload" }, { status: 400 });
  }

  if (!webhookSecret && process.env.NODE_ENV === "production") {
    return NextResponse.json({ error: "MP_WEBHOOK_SECRET missing" }, { status: 500 });
  }

  if (webhookSecret) {
    const xSignature = parseSignature(request.headers.get("x-signature"));
    const xRequestId = request.headers.get("x-request-id");
    const dataId =
      request.nextUrl.searchParams.get("data.id") ||
      request.nextUrl.searchParams.get("id") ||
      (typeof (body as { data?: { id?: unknown } }).data?.id === "string"
        ? (body as { data?: { id?: string } }).data?.id
        : "");

    if (!xSignature || !xRequestId || !dataId) {
      return NextResponse.json({ error: "Missing webhook signature headers" }, { status: 401 });
    }

    const manifest = `id:${dataId};request-id:${xRequestId};ts:${xSignature.ts};`;
    const expected = createHmac("sha256", webhookSecret).update(manifest).digest("hex");

    if (!safeEqualHex(expected, xSignature.v1.toLowerCase())) {
      return NextResponse.json({ error: "Invalid webhook signature" }, { status: 401 });
    }
  }

  const action = (body as { action?: unknown }).action;
  if (action === "payment.updated") {
    const data = (body as { data?: { id?: unknown; status?: unknown; external_reference?: unknown } }).data;
    if (data && typeof data.id !== "undefined") {
      const paymentId = String(data.id);
      const status = String(data.status || "");
      const externalRef = String(data.external_reference || "");

      if (status === "approved" && externalRef) {
        paymentStore.set(externalRef, {
          id: paymentId,
          externalReference: externalRef,
          status: "approved",
          timestamp: Date.now(),
        });
      }
    }
  }

  return NextResponse.json({ received: true }, { status: 200 });
}

export function GET() {
  return NextResponse.json({ error: "Method not allowed" }, { status: 405 });
}

export function getPaymentStatus(externalReference: string) {
  return paymentStore.get(externalReference) || null;
}
