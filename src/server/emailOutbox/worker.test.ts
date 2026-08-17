import { describe, expect, it, vi } from "vitest";
import type { EmailOutboxEvent, MissingReceiptCandidate } from "./types";
import {
  MAX_EMAIL_EVENTS_PER_RUN,
  MAX_MISSING_RECEIPT_CANDIDATES_PER_RUN,
  MAX_PENDING_SALES_RECOVERIES_PER_RUN,
  runEmailOutboxWorker,
} from "./worker";

const now = Date.parse("2026-08-16T12:00:00.000Z");
const candidate = (externalReference: string): MissingReceiptCandidate => ({
  externalReference,
  recipientEmail: "customer@example.test",
  customerName: "Cliente",
  paymentId: "pay-worker-1",
  approvedAt: "2026-08-16T11:00:00.000Z",
  itemsJson: JSON.stringify([{ title: "Producto", qty: 1, unitPrice: 1000 }]),
  total: 1000,
  currency: "ARS",
});

const event = (externalReference: string): EmailOutboxEvent => ({
  eventKey: `purchase-receipt/${externalReference}/v1`,
  externalReference,
  notificationType: "purchase_receipt",
  schemaVersion: 1,
  templateVersion: 1,
  payloadHash: "a".repeat(64),
  payloadJson: "{}",
  idempotencyKey: `purchase-receipt/${externalReference}/v1`,
  state: "processing",
  attemptCount: 1,
  leaseOwner: "email-worker-one",
  leaseExpiresAt: new Date(now + 300_000).toISOString(),
  createdAt: new Date(now - 1_000).toISOString(),
  updatedAt: new Date(now).toISOString(),
});

const runWorker = (overrides: Parameters<typeof runEmailOutboxWorker>[0]) =>
  runEmailOutboxWorker({
    listPendingSales: vi.fn(async () => []),
    getSalesRow: vi.fn(async () => null),
    recoverPendingSales: vi.fn(async () => ({ outcome: "not_indexed" as const, order: null })),
    ...overrides,
  });

describe("AUD3-H06-E autonomous receipt discovery worker", () => {
  it("discovers missing events, repairs markers, and processes bounded email work", async () => {
    const claimed = [
      event("es-worker-accepted-000001"),
      event("es-worker-retry-000001"),
      event("es-worker-attention-000001"),
      event("es-worker-skipped-000001"),
    ];
    const discover = vi.fn(async () => ({
      rolloutAt: "2026-08-15T00:00:00.000Z",
      candidates: [candidate("es-worker-new-000001")],
      markerRepairs: [{
        externalReference: "es-worker-marker-000001",
        acceptedAt: "2026-08-16T10:00:00.000Z",
      }],
    }));
    const upsert = vi.fn(async () => ({ outcome: "stored" as const, event: claimed[0] }));
    const claim = vi.fn(async () => claimed);
    const processClaimed = vi.fn(async (input: EmailOutboxEvent) => {
      if (input.externalReference.includes("accepted")) return "accepted" as const;
      if (input.externalReference.includes("retry")) return "retryable" as const;
      if (input.externalReference.includes("attention")) return "attention" as const;
      return "skipped" as const;
    });
    const projectMarker = vi.fn(async () => true);

    await expect(runWorker({
      now: () => now,
      owner: () => "email-worker-one",
      discover,
      upsert,
      claim,
      processClaimed,
      projectMarker,
    })).resolves.toEqual({
      ok: true,
      existingWork: {
        ok: true,
        claimed: 4,
        accepted: 1,
        retryable: 1,
        attention: 1,
        skipped: 1,
      },
      salesRecovery: {
        ok: true,
        attempted: 0,
        recovered: 0,
        pending: 0,
        busy: 0,
        attention: 0,
      },
      discovery: {
        ok: true,
        rolloutAt: "2026-08-15T00:00:00.000Z",
        candidatesFound: 1,
        eventsCreated: 1,
        markerRepairs: 1,
      },
      durationMs: 0,
    });
    expect(discover).toHaveBeenCalledWith(MAX_MISSING_RECEIPT_CANDIDATES_PER_RUN);
    expect(claim).toHaveBeenCalledWith(expect.objectContaining({
      maxEvents: MAX_EMAIL_EVENTS_PER_RUN,
      leaseOwner: "email-worker-one",
    }));
    expect(projectMarker).toHaveBeenCalledTimes(1);
  });

  it("isolates one malformed discovery candidate and continues the run", async () => {
    const upsert = vi.fn();
    const claim = vi.fn(async () => []);
    const result = await runWorker({
      now: () => now,
      owner: () => "email-worker-one",
      discover: vi.fn(async () => ({
        rolloutAt: "2026-08-15T00:00:00.000Z",
        candidates: [{ ...candidate("es-worker-invalid-000001"), itemsJson: "not-json" }],
        markerRepairs: [],
      })),
      upsert,
      claim,
      processClaimed: vi.fn(),
      projectMarker: vi.fn(),
    });
    expect(result).toMatchObject({
      ok: true,
      existingWork: { ok: true, claimed: 0 },
      discovery: { ok: true, candidatesFound: 1, eventsCreated: 0 },
    });
    expect(upsert).not.toHaveBeenCalled();
  });

  it("counts a failed claimed event as retryable without aborting later events", async () => {
    const claimed = [event("es-worker-crash-000001"), event("es-worker-next-000001")];
    const processClaimed = vi.fn()
      .mockRejectedValueOnce(new Error("worker crash"))
      .mockResolvedValueOnce("accepted");
    const result = await runWorker({
      now: () => now,
      owner: () => "email-worker-one",
      discover: vi.fn(async () => ({
        rolloutAt: "2026-08-15T00:00:00.000Z",
        candidates: [],
        markerRepairs: [],
      })),
      upsert: vi.fn(),
      claim: vi.fn(async () => claimed),
      processClaimed,
      projectMarker: vi.fn(),
    });
    expect(result).toMatchObject({
      existingWork: { ok: true, claimed: 2, accepted: 1, retryable: 1 },
      discovery: { ok: true },
    });
    expect(processClaimed).toHaveBeenCalledTimes(2);
  });

  it("AUD3-H06E-WORKER-04 processes existing work when discovery throws", async () => {
    const claim = vi.fn(async () => [event("es-worker-existing-000001")]);
    const processClaimed = vi.fn(async () => "accepted" as const);
    const discover = vi.fn(async () => {
      throw new Error("ventas unavailable with sensitive detail");
    });
    const result = await runWorker({
      now: () => now,
      owner: () => "email-worker-one",
      claim,
      processClaimed,
      discover,
      upsert: vi.fn(),
      projectMarker: vi.fn(),
    });
    expect(result).toMatchObject({
      ok: false,
      existingWork: { ok: true, claimed: 1, accepted: 1 },
      discovery: { ok: false, errorCode: "EMAIL_OUTBOX_DISCOVERY_FAILED" },
    });
    expect(processClaimed).toHaveBeenCalledTimes(1);
    expect(claim.mock.invocationCallOrder[0]).toBeLessThan(discover.mock.invocationCallOrder[0]);
  });

  it("AUD3-H06E-WORKER-05 accepts existing work despite duplicate ventas discovery failure", async () => {
    const processClaimed = vi.fn(async () => "accepted" as const);
    const result = await runWorker({
      now: () => now,
      owner: () => "email-worker-one",
      claim: vi.fn(async () => [event("es-worker-existing-duplicate-000001")]),
      processClaimed,
      discover: vi.fn(async () => {
        throw new Error("duplicate ventas identity for customer@example.test");
      }),
      upsert: vi.fn(),
      projectMarker: vi.fn(),
    });
    expect(result.existingWork).toMatchObject({ ok: true, accepted: 1 });
    expect(result.discovery).toEqual({
      ok: false,
      candidatesFound: 0,
      eventsCreated: 0,
      markerRepairs: 0,
      errorCode: "EMAIL_OUTBOX_DISCOVERY_FAILED",
    });
    expect(JSON.stringify(result)).not.toContain("customer@example.test");
  });

  it("AUD3-H06E-WORKER-06 still performs discovery when the existing-event phase fails", async () => {
    const discover = vi.fn(async () => ({
      rolloutAt: "2026-08-15T00:00:00.000Z",
      candidates: [candidate("es-worker-recovery-000001")],
      markerRepairs: [],
    }));
    const upsert = vi.fn(async () => ({
      outcome: "stored" as const,
      event: event("es-worker-recovery-000001"),
    }));
    const result = await runWorker({
      now: () => now,
      owner: () => "email-worker-one",
      claim: vi.fn(async () => {
        throw new Error("outbox read failed");
      }),
      processClaimed: vi.fn(),
      discover,
      upsert,
      projectMarker: vi.fn(),
    });
    expect(result).toMatchObject({
      ok: false,
      existingWork: { ok: false, errorCode: "EMAIL_OUTBOX_EXISTING_WORK_FAILED" },
      discovery: { ok: true, candidatesFound: 1, eventsCreated: 1 },
    });
    expect(discover).toHaveBeenCalledTimes(1);
    expect(upsert).toHaveBeenCalledTimes(1);
  });

  it("AUD3-H06E-AUTO-SALES-05 isolates sales recovery failure after accepting existing work", async () => {
    const processClaimed = vi.fn(async () => "accepted" as const);
    const discover = vi.fn(async () => ({
      rolloutAt: "2026-08-15T00:00:00.000Z",
      candidates: [],
      markerRepairs: [],
    }));
    const result = await runWorker({
      now: () => now,
      owner: () => "email-worker-one",
      claim: vi.fn(async () => [event("es-worker-sales-failure-000001")]),
      processClaimed,
      listPendingSales: vi.fn(async () => {
        throw new Error("synthetic pending index failure");
      }),
      discover,
      upsert: vi.fn(),
      projectMarker: vi.fn(),
    });

    expect(result).toMatchObject({
      ok: false,
      existingWork: { ok: true, accepted: 1 },
      salesRecovery: {
        ok: false,
        attempted: 0,
        errorCode: "EMAIL_OUTBOX_SALES_RECOVERY_FAILED",
      },
      discovery: { ok: true },
    });
    expect(processClaimed).toHaveBeenCalledTimes(1);
    expect(discover).toHaveBeenCalledTimes(1);
  });

  it("AUD3-H06E-AUTO-SALES-06 runs bounded sales recovery when existing work fails", async () => {
    const listPendingSales = vi.fn(async () => ["es-worker-sales-recover-000001"]);
    const getSalesRow = vi.fn(async () => ({ orderId: "es-worker-sales-recover-000001" } as never));
    const recoverPendingSales = vi.fn(async () => ({
      outcome: "reconciled" as const,
      order: null,
    }));
    const result = await runWorker({
      now: () => now,
      owner: () => "email-worker-one",
      claim: vi.fn(async () => {
        throw new Error("synthetic outbox failure");
      }),
      processClaimed: vi.fn(),
      listPendingSales,
      getSalesRow,
      recoverPendingSales,
      discover: vi.fn(async () => ({
        rolloutAt: "2026-08-15T00:00:00.000Z",
        candidates: [],
        markerRepairs: [],
      })),
      upsert: vi.fn(),
      projectMarker: vi.fn(),
    });

    expect(result).toMatchObject({
      ok: false,
      existingWork: { ok: false },
      salesRecovery: { ok: true, attempted: 1, recovered: 1 },
      discovery: { ok: true },
    });
    expect(listPendingSales).toHaveBeenCalledWith(MAX_PENDING_SALES_RECOVERIES_PER_RUN);
    expect(getSalesRow).toHaveBeenCalledWith("es-worker-sales-recover-000001");
    expect(recoverPendingSales).toHaveBeenCalledWith(
      "es-worker-sales-recover-000001",
      { rowExists: true },
    );
  });

  it("AUD3-H06E-AUTO-SALES-07 preserves a recovered sale when discovery fails later", async () => {
    const recoverPendingSales = vi.fn(async () => ({
      outcome: "appended" as const,
      order: null,
    }));
    const discover = vi.fn(async () => {
      throw new Error("synthetic discovery failure");
    });
    const result = await runWorker({
      now: () => now,
      owner: () => "email-worker-one",
      claim: vi.fn(async () => []),
      processClaimed: vi.fn(),
      listPendingSales: vi.fn(async () => ["es-worker-sales-before-discovery-000001"]),
      getSalesRow: vi.fn(async () => null),
      recoverPendingSales,
      discover,
      upsert: vi.fn(),
      projectMarker: vi.fn(),
    });

    expect(result).toMatchObject({
      ok: false,
      salesRecovery: { ok: true, attempted: 1, recovered: 1 },
      discovery: { ok: false, errorCode: "EMAIL_OUTBOX_DISCOVERY_FAILED" },
    });
    expect(recoverPendingSales.mock.invocationCallOrder[0]).toBeLessThan(
      discover.mock.invocationCallOrder[0],
    );
    expect(recoverPendingSales).toHaveBeenCalledWith(
      "es-worker-sales-before-discovery-000001",
      { rowExists: false },
    );
  });

  it("AUD3-H06E-ROLLOUT-03 recovers a marked order after the initial outbox upsert failed", async () => {
    const recovered = event("es-worker-marked-000001");
    const claim = vi.fn()
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([recovered]);
    const discover = vi.fn()
      .mockResolvedValueOnce({
        rolloutAt: "2026-08-15T00:00:00.000Z",
        candidates: [candidate("es-worker-marked-000001")],
        markerRepairs: [],
      })
      .mockResolvedValueOnce({
        rolloutAt: "2026-08-15T00:00:00.000Z",
        candidates: [],
        markerRepairs: [],
      });
    const upsert = vi.fn(async () => ({ outcome: "stored" as const, event: recovered }));
    const processClaimed = vi.fn(async () => "accepted" as const);

    const creationRun = await runWorker({
      now: () => now,
      owner: () => "email-worker-one",
      claim,
      processClaimed,
      discover,
      upsert,
      projectMarker: vi.fn(),
    });
    const processingRun = await runWorker({
      now: () => now,
      owner: () => "email-worker-two",
      claim,
      processClaimed,
      discover,
      upsert,
      projectMarker: vi.fn(),
    });

    expect(creationRun).toMatchObject({
      existingWork: { claimed: 0 },
      discovery: { candidatesFound: 1, eventsCreated: 1 },
    });
    expect(processingRun).toMatchObject({
      existingWork: { claimed: 1, accepted: 1 },
      discovery: { candidatesFound: 0 },
    });
    expect(processClaimed).toHaveBeenCalledTimes(1);
  });

  it("AUD3-H06E-WORKER-07 reports bounded safe state across all lifecycle phases", async () => {
    const result = await runWorker({
      now: () => now,
      owner: () => "email-worker-one",
      claim: vi.fn(async () => {
        throw new Error("raw outbox token secret-one");
      }),
      processClaimed: vi.fn(),
      discover: vi.fn(async () => {
        throw new Error("customer@example.test secret-two");
      }),
      upsert: vi.fn(),
      projectMarker: vi.fn(),
    });
    expect(result).toEqual({
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
        ok: true,
        attempted: 0,
        recovered: 0,
        pending: 0,
        busy: 0,
        attention: 0,
      },
      discovery: {
        ok: false,
        candidatesFound: 0,
        eventsCreated: 0,
        markerRepairs: 0,
        errorCode: "EMAIL_OUTBOX_DISCOVERY_FAILED",
      },
      durationMs: 0,
    });
    expect(JSON.stringify(result)).not.toMatch(/secret|customer@/);
  });
});
