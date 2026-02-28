import { NextResponse } from "next/server";
import { getStartupCheckReport, runStartupChecks } from "@/src/server/bootstrap/startupChecks";
import { getOperationalAlertsForToday } from "@/src/server/observability/alerts";

export const runtime = "nodejs";

export async function GET() {
  const startup = getStartupCheckReport() ?? runStartupChecks();
  const ops = await getOperationalAlertsForToday();
  return NextResponse.json({
    ok: startup.ok && ops.summary.level !== "critical",
    startup,
    operations: {
      level: ops.summary.level,
      alertsCount: ops.alerts.length,
      counts: ops.summary.counts,
    },
  });
}
