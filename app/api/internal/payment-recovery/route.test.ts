import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/src/server/recovery/worker", () => ({
  runPaymentRecoveryWorker: vi.fn(async () => ({
    ok: true,
    claimed: 2,
    completed: 1,
    retryable: 1,
    attention: 0,
    snapshotsScanned: 1,
    eventsCreated: 1,
    durationMs: 25,
  })),
}));
vi.mock("@/src/server/emailOutbox/worker", () => ({
  runEmailOutboxWorker: vi.fn(async () => ({
    ok: true,
    existingWork: {
      ok: true,
      claimed: 1,
      accepted: 1,
      retryable: 0,
      attention: 0,
      skipped: 0,
    },
    salesRecovery: {
      ok: true,
      attempted: 1,
      recovered: 1,
      pending: 0,
      busy: 0,
      attention: 0,
    },
    discovery: {
      ok: true,
      rolloutAt: "2026-08-15T00:00:00.000Z",
      candidatesFound: 1,
      eventsCreated: 1,
      markerRepairs: 0,
    },
    durationMs: 15,
  })),
}));

import { GET } from "./route";
import { runPaymentRecoveryWorker } from "@/src/server/recovery/worker";
import { runEmailOutboxWorker } from "@/src/server/emailOutbox/worker";

const request = (authorization?: string) => new NextRequest(
  "http://localhost:3000/api/internal/payment-recovery",
  { headers: authorization ? { authorization } : {} },
);

describe("AUD3-H06 protected payment recovery cron route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.CRON_SECRET = "cron-secret";
  });

  it.each([
    ["missing header", undefined],
    ["wrong scheme", "Basic cron-secret"],
    ["wrong secret", "Bearer wrong"],
  ])("returns 401 for %s without running recovery", async (_label, authorization) => {
    const response = await GET(request(authorization));
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ ok: false });
    expect(runPaymentRecoveryWorker).not.toHaveBeenCalled();
    expect(runEmailOutboxWorker).not.toHaveBeenCalled();
  });

  it("fails closed when CRON_SECRET is not configured", async () => {
    delete process.env.CRON_SECRET;
    const response = await GET(request("Bearer anything"));
    expect(response.status).toBe(401);
    expect(runPaymentRecoveryWorker).not.toHaveBeenCalled();
    expect(runEmailOutboxWorker).not.toHaveBeenCalled();
  });

  it("returns operational counters only for the exact bearer secret", async () => {
    const response = await GET(request("Bearer cron-secret"));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      ok: true,
      financial: {
        ok: true,
        claimed: 2,
        completed: 1,
        retryable: 1,
        attention: 0,
        snapshotsScanned: 1,
        eventsCreated: 1,
        durationMs: 25,
      },
      email: {
        ok: true,
        existingWork: {
          ok: true,
          claimed: 1,
          accepted: 1,
          retryable: 0,
          attention: 0,
          skipped: 0,
        },
        salesRecovery: {
          ok: true,
          attempted: 1,
          recovered: 1,
          pending: 0,
          busy: 0,
          attention: 0,
        },
        discovery: {
          ok: true,
          rolloutAt: "2026-08-15T00:00:00.000Z",
          candidatesFound: 1,
          eventsCreated: 1,
          markerRepairs: 0,
        },
        durationMs: 15,
      },
    });
    expect(runPaymentRecoveryWorker).toHaveBeenCalledTimes(1);
    expect(runEmailOutboxWorker).toHaveBeenCalledTimes(1);
  });

  it("returns a safe retryable 503 when the worker fails", async () => {
    vi.mocked(runPaymentRecoveryWorker).mockRejectedValueOnce(new Error("sensitive detail"));
    const response = await GET(request("Bearer cron-secret"));
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ ok: false, financial: null });
    expect(runEmailOutboxWorker).toHaveBeenCalledTimes(1);
  });

  it("keeps financial convergence successful when the email worker fails", async () => {
    vi.mocked(runEmailOutboxWorker).mockRejectedValueOnce(new Error("sensitive email detail"));
    const response = await GET(request("Bearer cron-secret"));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      ok: true,
      email: { ok: false },
    });
  });

  it("keeps financial convergence successful when all three email lifecycle phases report safe failure", async () => {
    vi.mocked(runEmailOutboxWorker).mockResolvedValueOnce({
      ok: false,
      existingWork: {
        ok: false,
        claimed: 0,
        accepted: 0,
        retryable: 0,
        attention: 0,
        skipped: 0,
        errorCode: "EMAIL_OUTBOX_EXISTING_WORK_FAILED",
      },
      salesRecovery: {
        ok: false,
        attempted: 0,
        recovered: 0,
        pending: 0,
        busy: 0,
        attention: 0,
        errorCode: "EMAIL_OUTBOX_SALES_RECOVERY_FAILED",
      },
      discovery: {
        ok: false,
        candidatesFound: 0,
        eventsCreated: 0,
        markerRepairs: 0,
        errorCode: "EMAIL_OUTBOX_DISCOVERY_FAILED",
      },
      durationMs: 15,
    });
    const response = await GET(request("Bearer cron-secret"));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      ok: true,
      email: {
        ok: false,
        existingWork: { errorCode: "EMAIL_OUTBOX_EXISTING_WORK_FAILED" },
        salesRecovery: { errorCode: "EMAIL_OUTBOX_SALES_RECOVERY_FAILED" },
        discovery: { errorCode: "EMAIL_OUTBOX_DISCOVERY_FAILED" },
      },
    });
  });
});
