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

import { GET } from "./route";
import { runPaymentRecoveryWorker } from "@/src/server/recovery/worker";

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
  });

  it("fails closed when CRON_SECRET is not configured", async () => {
    delete process.env.CRON_SECRET;
    const response = await GET(request("Bearer anything"));
    expect(response.status).toBe(401);
    expect(runPaymentRecoveryWorker).not.toHaveBeenCalled();
  });

  it("returns operational counters only for the exact bearer secret", async () => {
    const response = await GET(request("Bearer cron-secret"));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      ok: true,
      claimed: 2,
      completed: 1,
      retryable: 1,
      attention: 0,
      snapshotsScanned: 1,
      eventsCreated: 1,
      durationMs: 25,
    });
    expect(runPaymentRecoveryWorker).toHaveBeenCalledTimes(1);
  });

  it("returns a safe retryable 503 when the worker fails", async () => {
    vi.mocked(runPaymentRecoveryWorker).mockRejectedValueOnce(new Error("sensitive detail"));
    const response = await GET(request("Bearer cron-secret"));
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ ok: false });
  });
});
