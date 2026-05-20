import { timingSafeEqual } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { env } from "@/src/config/env";
import { getStartupCheckReport, runStartupChecks } from "@/src/server/bootstrap/startupChecks";
import { getOperationalAlertsForToday } from "@/src/server/observability/alerts";

export const runtime = "nodejs";

const safeTokenEqual = (left: string, right: string) => {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  if (leftBuffer.length !== rightBuffer.length) return false;
  return timingSafeEqual(leftBuffer, rightBuffer);
};

export async function GET(request: NextRequest) {
  const startup = getStartupCheckReport() ?? runStartupChecks();
  const ops = await getOperationalAlertsForToday();
  const ok = startup.ok && ops.summary.level !== "critical";
  const configuredToken = env.getOptionalServer("OPS_METRICS_TOKEN");
  const providedToken = request.headers.get("x-ops-token")?.trim() || "";
  const canShowDetails = Boolean(configuredToken && providedToken && safeTokenEqual(providedToken, configuredToken));

  if (!canShowDetails) {
    return NextResponse.json({ ok });
  }

  return NextResponse.json({
    ok,
    startup,
    operations: {
      level: ops.summary.level,
      alertsCount: ops.alerts.length,
      counts: ops.summary.counts,
    },
  });
}
