import { describe, expect, it, vi } from "vitest";
import type { EmailOutboxEvent, MissingReceiptCandidate } from "./types";
import {
  MAX_EMAIL_EVENTS_PER_RUN,
  MAX_MISSING_RECEIPT_CANDIDATES_PER_RUN,
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

    await expect(runEmailOutboxWorker({
      now: () => now,
      owner: () => "email-worker-one",
      discover,
      upsert,
      claim,
      processClaimed,
      projectMarker,
    })).resolves.toEqual({
      ok: true,
      rolloutAt: "2026-08-15T00:00:00.000Z",
      candidatesFound: 1,
      eventsCreated: 1,
      markerRepairs: 1,
      claimed: 4,
      accepted: 1,
      retryable: 1,
      attention: 1,
      skipped: 1,
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
    const result = await runEmailOutboxWorker({
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
    expect(result).toMatchObject({ ok: true, candidatesFound: 1, eventsCreated: 0, claimed: 0 });
    expect(upsert).not.toHaveBeenCalled();
  });

  it("counts a failed claimed event as retryable without aborting later events", async () => {
    const claimed = [event("es-worker-crash-000001"), event("es-worker-next-000001")];
    const processClaimed = vi.fn()
      .mockRejectedValueOnce(new Error("worker crash"))
      .mockResolvedValueOnce("accepted");
    const result = await runEmailOutboxWorker({
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
    expect(result).toMatchObject({ claimed: 2, accepted: 1, retryable: 1 });
    expect(processClaimed).toHaveBeenCalledTimes(2);
  });
});
