import { NextRequest } from "next/server";
import { kv } from "@/src/server/kv";

const IPV4_REGEX = /^(?:\d{1,3}\.){3}\d{1,3}$/;
const IPV6_REGEX = /^[0-9a-f:]+$/i;

const isValidIp = (value: string) => {
  if (!value) return false;
  if (IPV4_REGEX.test(value)) {
    const segments = value.split(".").map(Number);
    return segments.every((segment) => segment >= 0 && segment <= 255);
  }

  if (value.includes(":")) {
    return IPV6_REGEX.test(value) && value.length <= 45;
  }

  return false;
};

const normalizeForwardedIp = (value: string | null): string | null => {
  if (!value) return null;
  const first = value.split(",")[0]?.trim() || "";
  return isValidIp(first) ? first : null;
};

const hashString = (value: string) => {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 31 + value.charCodeAt(index)) >>> 0;
  }
  return hash.toString(16);
};

const getClientFingerprint = (request: NextRequest) => {
  const forwarded = normalizeForwardedIp(request.headers.get("x-forwarded-for"));
  const realIp = normalizeForwardedIp(request.headers.get("x-real-ip"));
  const vercelForwarded = normalizeForwardedIp(request.headers.get("x-vercel-forwarded-for"));
  const requestIp = (request as NextRequest & { ip?: unknown }).ip;
  const fromRequestIp = typeof requestIp === "string" && isValidIp(requestIp) ? requestIp : null;

  const ip = forwarded || vercelForwarded || realIp || fromRequestIp;
  if (ip) return `ip:${ip}`;

  const userAgent = request.headers.get("user-agent")?.slice(0, 200) || "unknown";
  return `ua:${hashString(userAgent)}`;
};

export async function checkRateLimit(
  request: NextRequest,
  input: { keyPrefix: string; max: number; windowSeconds: number }
): Promise<boolean> {
  const max = Number.isFinite(input.max) ? Math.max(1, Math.trunc(input.max)) : 1;
  const windowSeconds = Number.isFinite(input.windowSeconds)
    ? Math.max(1, Math.trunc(input.windowSeconds))
    : 60;
  const fingerprint = getClientFingerprint(request);
  const bucket = Math.floor(Date.now() / (windowSeconds * 1000));
  const key = `${input.keyPrefix}:${fingerprint}:${bucket}`;
  const count = await kv.incr(key);

  if (count === 1) {
    await kv.expire(key, windowSeconds + 1);
  }

  return count <= max;
}
