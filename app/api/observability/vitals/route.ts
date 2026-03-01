import { NextRequest, NextResponse } from "next/server";
import { checkRateLimit } from "@/src/server/security/rateLimit";
import { trackTechnicalSignal } from "@/src/server/observability/metrics";

export const runtime = "nodejs";

type WebVitalBody = {
  type?: unknown;
  name?: unknown;
  value?: unknown;
  path?: unknown;
  rating?: unknown;
};

const toFiniteNumber = (value: unknown) => {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
};

export async function POST(request: NextRequest) {
  const allowed = await checkRateLimit(request, {
    keyPrefix: "es:rl:observability:vitals",
    max: 200,
    windowSeconds: 60,
  });

  if (!allowed) {
    return NextResponse.json({ ok: false, error: "Rate limit" }, { status: 429 });
  }

  const body = (await request.json().catch(() => null)) as WebVitalBody | null;
  if (!body || typeof body !== "object") {
    return NextResponse.json({ ok: false, error: "Invalid body" }, { status: 400 });
  }

  const type = typeof body.type === "string" ? body.type : "";
  const name = typeof body.name === "string" ? body.name : "";
  const value = toFiniteNumber(body.value);
  const path = typeof body.path === "string" ? body.path.slice(0, 120) : undefined;
  const rating = typeof body.rating === "string" ? body.rating : undefined;

  if (!name || value === null) {
    return NextResponse.json({ ok: false, error: "Invalid metric fields" }, { status: 400 });
  }

  if (type === "web-vital" && (name === "LCP" || name === "INP" || name === "CLS")) {
    await trackTechnicalSignal(`webvitals.${name}`, value, {
      path,
      rating,
    });
    return NextResponse.json({ ok: true }, { status: 200 });
  }

  if (type === "client-error") {
    await trackTechnicalSignal("client.error", 1, { path, name });
    return NextResponse.json({ ok: true }, { status: 200 });
  }

  return NextResponse.json({ ok: false, error: "Unsupported metric type" }, { status: 400 });
}
