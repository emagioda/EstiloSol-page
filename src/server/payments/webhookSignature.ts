import { createHmac, timingSafeEqual } from "node:crypto";
import { NextRequest } from "next/server";

type ParsedSignature = {
  ts: string;
  v1: string;
};

export const parseWebhookSignature = (headerValue: string | null): ParsedSignature | null => {
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

export const isValidWebhookSignature = (input: {
  secret: string;
  dataIdLower: string;
  xRequestId: string | null;
  xSignatureHeader: string | null;
}) => {
  const parsed = parseWebhookSignature(input.xSignatureHeader);
  if (!parsed || !input.xRequestId) {
    return { ok: false as const, reason: "missing_headers" as const };
  }

  const manifest = `id:${input.dataIdLower};request-id:${input.xRequestId};ts:${parsed.ts};`;
  const expected = createHmac("sha256", input.secret).update(manifest).digest("hex");

  if (!safeEqualHex(expected, parsed.v1.toLowerCase())) {
    return { ok: false as const, reason: "invalid_signature" as const };
  }

  return { ok: true as const };
};

export const extractWebhookDataId = (request: NextRequest, body: { data?: { id?: string | number } }) => {
  const queryId = request.nextUrl.searchParams.get("data.id") || request.nextUrl.searchParams.get("id");
  const bodyId = body.data?.id;
  const raw = queryId ?? (bodyId !== undefined ? String(bodyId) : "");
  return raw.trim().toLowerCase();
};
