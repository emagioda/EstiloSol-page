import { NextRequest, NextResponse } from "next/server";
import { logEvent } from "@/src/server/observability/log";
import { runPaymentRecoveryWorker } from "@/src/server/recovery/worker";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const cronSecret = process.env.CRON_SECRET?.trim();
  const authorization = request.headers.get("authorization");
  if (!cronSecret || authorization !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ ok: false }, { status: 401 });
  }

  try {
    const result = await runPaymentRecoveryWorker();
    return NextResponse.json(result, { status: 200 });
  } catch (error) {
    logEvent("error", "recovery.worker.failed", {
      errorName: error instanceof Error ? error.name : "unknown",
    });
    return NextResponse.json({ ok: false }, { status: 503 });
  }
}
