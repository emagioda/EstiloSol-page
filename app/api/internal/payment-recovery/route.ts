import { NextRequest, NextResponse } from "next/server";
import { runEmailOutboxWorker } from "@/src/server/emailOutbox/worker";
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

  let financial: Awaited<ReturnType<typeof runPaymentRecoveryWorker>> | null = null;
  let financialFailed = false;
  try {
    financial = await runPaymentRecoveryWorker();
  } catch (error) {
    financialFailed = true;
    logEvent("error", "recovery.worker.failed", {
      errorName: error instanceof Error ? error.name : "unknown",
    });
  }

  let email: Awaited<ReturnType<typeof runEmailOutboxWorker>> | null = null;
  try {
    email = await runEmailOutboxWorker();
  } catch (error) {
    logEvent("error", "email.outbox.worker_failed", {
      errorName: error instanceof Error ? error.name : "unknown",
    });
  }

  return NextResponse.json(
    {
      ok: !financialFailed,
      financial,
      email: email ?? { ok: false },
    },
    { status: financialFailed ? 503 : 200 },
  );
}
