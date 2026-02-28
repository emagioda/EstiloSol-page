import { NextRequest } from "next/server";
import { kv } from "@/src/server/kv";

const getClientIp = (request: NextRequest) => {
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0]?.trim() || "unknown";
  return request.headers.get("x-real-ip") || "unknown";
};

export async function checkRateLimit(
  request: NextRequest,
  input: { keyPrefix: string; max: number; windowSeconds: number }
): Promise<boolean> {
  const ip = getClientIp(request);
  const bucket = Math.floor(Date.now() / (input.windowSeconds * 1000));
  const key = `${input.keyPrefix}:${ip}:${bucket}`;
  const count = await kv.incr(key);

  if (count === 1) {
    await kv.expire(key, input.windowSeconds + 1);
  }

  return count <= input.max;
}
