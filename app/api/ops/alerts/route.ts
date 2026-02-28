import { timingSafeEqual } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { env } from "@/src/config/env";
import { getOperationalAlertsForToday } from "@/src/server/observability/alerts";

export const runtime = "nodejs";

const safeTokenEqual = (left: string, right: string) => {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  if (leftBuffer.length !== rightBuffer.length) return false;
  return timingSafeEqual(leftBuffer, rightBuffer);
};

export async function GET(request: NextRequest) {
  const configuredToken = env.getOptionalServer("OPS_METRICS_TOKEN");

  if (!configuredToken) {
    return NextResponse.json({ error: "Ops alerts endpoint disabled" }, { status: 503 });
  }

  const providedToken = request.headers.get("x-ops-token")?.trim() || "";
  if (!providedToken || !safeTokenEqual(providedToken, configuredToken)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const result = await getOperationalAlertsForToday();
  return NextResponse.json({ ok: true, ...result }, { status: 200 });
}
