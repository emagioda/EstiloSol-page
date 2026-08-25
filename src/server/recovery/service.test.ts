import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Order } from "@/src/server/orders/types";
import type { RecoveryPaymentEvent, StoredRecoverySnapshot } from "./types";

vi.mock("@/src/server/orders/store", () => ({
  getOrder: vi.fn(),
  reconstructOrderFromAuthorityEvidence: vi.fn(),
}));
vi.mock("@/src/server/emailOutbox/repository", () => ({
  getEmailOutboxEvent: vi.fn(async () => null),
}));
vi.mock("@/src/server/sheets/repository", () => ({
  getOrderRowById: vi.fn(),
}));
vi.mock("./repository", () => ({
  appendRecoveryPaymentEvent: vi.fn(),
  getRecoverySnapshot: vi.fn(),
  listRecoveryPaymentEvents: vi.fn(async () => []),
  markRecoveryEventState: vi.fn(),
  markRecoverySnapshotState: vi.fn(),
  upsertRecoverySnapshot: vi.fn(),
}));

import { getOrder, reconstructOrderFromAuthorityEvidence } from "@/src/server/orders/store";
import { getOrderRowById } from "@/src/server/sheets/repository";
import {
  appendRecoveryPaymentEvent,
  getRecoverySnapshot,
  listRecoveryPaymentEvents,
  markRecoveryEventState,
  markRecoverySnapshotState,
  upsertRecoverySnapshot,
} from "./repository";
import { buildRecoveryOrderSnapshot, serializeRecoverySnapshot } from "./snapshot";
import { completeRecoveryEvent, prepareProtectedPaymentDurability } from "./service";

const NOW = Date.parse("2026-08-13T12:00:00.000Z");
const order = (): Order => ({
  externalReference: "es-service-recovery-000001",
  status: "preference_created",
  paymentStatus: "pending",
  shippingStatus: "in_process",
  inventoryStatus: "pending",
  paymentMethod: "mercadopago",
  deliveryMethod: "pickup",
  items: [{ productId: "p1", title: "Producto", unitPrice: 1000, qty: 1, currency: "ARS" }],
  total: 1000,
  currency: "ARS",
  createdAt: NOW - 60_000,
  updatedAt: NOW - 60_000,
});
const storedSnapshot = (redacted = false): StoredRecoverySnapshot => {
  const snapshot = buildRecoveryOrderSnapshot({
    order: order(),
    checkoutAttemptId: "attempt-service-recovery-000001",
    preferenceValidFrom: NOW - 60_000,
    preferenceExpiresAt: NOW - 60_000 + 48 * 60 * 60 * 1000,
  });
  const serialized = serializeRecoverySnapshot(snapshot);
  return {
    externalReference: snapshot.externalReference,
    checkoutAttemptId: snapshot.checkoutAttemptId,
    schemaVersion: 1,
    snapshotHash: serialized.snapshotHash,
    snapshotJson: redacted ? "" : serialized.snapshotJson,
    createdAt: new Date(snapshot.createdAt).toISOString(),
    preferenceValidFrom: new Date(snapshot.preferenceValidFrom).toISOString(),
    preferenceExpiresAt: new Date(snapshot.preferenceExpiresAt).toISOString(),
    recoveryState: redacted ? "completed" : "pending_payment",
    updatedAt: new Date(NOW).toISOString(),
  };
};
const payment = (status = "approved") => ({
  id: "pay_service_1",
  status,
  status_detail: status === "approved" ? "accredited" : "reverted",
  external_reference: order().externalReference,
  transaction_amount: 1000,
  currency_id: "ARS",
  date_last_updated: "2026-08-13T12:00:00.000Z",
});

describe("AUD3-H06 recovery durability service", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getOrder).mockResolvedValue(null);
    vi.mocked(getRecoverySnapshot).mockResolvedValue(null);
    vi.mocked(getOrderRowById).mockResolvedValue(null);
    vi.mocked(markRecoverySnapshotState).mockResolvedValue(storedSnapshot());
    vi.mocked(markRecoveryEventState).mockResolvedValue({} as RecoveryPaymentEvent);
    vi.mocked(reconstructOrderFromAuthorityEvidence).mockImplementation(async (candidate) => ({
      order: candidate,
      created: true,
    }));
    vi.mocked(listRecoveryPaymentEvents).mockResolvedValue([]);
    vi.mocked(appendRecoveryPaymentEvent).mockImplementation(async (candidate) => ({
      outcome: "stored",
      event: {
        ...candidate,
        processingState: candidate.processingState ?? "pending",
        attemptCount: 0,
        updatedAt: new Date(NOW).toISOString(),
      } as RecoveryPaymentEvent,
    }));
  });

  it("H06-07 reconstructs a missing Order from snapshot only after the event is durable", async () => {
    const stored = storedSnapshot();
    vi.mocked(getRecoverySnapshot).mockResolvedValue(stored);
    const result = await prepareProtectedPaymentDurability({
      expectedExternalReference: order().externalReference,
      payment: payment(),
      source: "webhook",
      observedAt: NOW,
    });

    expect(result).toMatchObject({ protected: true, outcome: "ready" });
    expect(appendRecoveryPaymentEvent).toHaveBeenCalledWith(expect.objectContaining({
      validationState: "validated",
      financialStatus: "approved",
      snapshotHash: stored.snapshotHash,
    }));
    expect(vi.mocked(appendRecoveryPaymentEvent).mock.invocationCallOrder[0]).toBeLessThan(
      vi.mocked(reconstructOrderFromAuthorityEvidence).mock.invocationCallOrder[0],
    );
    expect(reconstructOrderFromAuthorityEvidence).toHaveBeenCalledWith(
      expect.objectContaining({
        externalReference: order().externalReference,
        paymentStatus: "pending",
      }),
      expect.objectContaining({
        paymentEvents: [expect.objectContaining({ financialStatus: "approved" })],
        receiptEventExists: false,
      }),
    );
    expect(markRecoverySnapshotState).toHaveBeenCalledWith({
      externalReference: stored.externalReference,
      state: "payment_observed",
    });
    expect(markRecoverySnapshotState).not.toHaveBeenCalledWith(
      expect.objectContaining({ redactSnapshot: true }),
    );
  });

  it("H06-08 keeps independent evidence usable through a primary KV read outage", async () => {
    vi.mocked(getOrder).mockRejectedValueOnce(new Error("KV unavailable"));
    vi.mocked(getRecoverySnapshot).mockResolvedValue(storedSnapshot());
    const result = await prepareProtectedPaymentDurability({
      expectedExternalReference: order().externalReference,
      payment: payment(),
      source: "webhook",
      observedAt: NOW,
    });
    expect(result).toMatchObject({ protected: true, outcome: "ready" });
    expect(appendRecoveryPaymentEvent).toHaveBeenCalledTimes(1);
  });

  it("persists genuine protected evidence as attention when both Order and snapshot are missing", async () => {
    const result = await prepareProtectedPaymentDurability({
      expectedExternalReference: order().externalReference,
      payment: payment(),
      source: "webhook",
      observedAt: NOW,
    });
    expect(result).toMatchObject({ protected: true, outcome: "attention", order: null });
    expect(appendRecoveryPaymentEvent).toHaveBeenCalledWith(expect.objectContaining({
      validationState: "missing_snapshot",
      processingState: "attention",
      lastErrorCode: "RECOVERY_SNAPSHOT_NOT_FOUND",
    }));
    expect(reconstructOrderFromAuthorityEvidence).not.toHaveBeenCalled();
  });

  it("H06-20 validates a reversal against durable ventas after snapshot PII redaction", async () => {
    const stored = storedSnapshot(true);
    vi.mocked(getRecoverySnapshot).mockResolvedValue(stored);
    vi.mocked(getOrderRowById).mockResolvedValue({
      orderId: order().externalReference,
      total: 1000,
      currency: "ARS",
    } as Awaited<ReturnType<typeof getOrderRowById>>);

    const result = await prepareProtectedPaymentDurability({
      expectedExternalReference: order().externalReference,
      payment: payment("refunded"),
      source: "webhook",
      observedAt: NOW,
    });

    expect(result).toMatchObject({ protected: true, outcome: "deferred", order: null });
    expect(appendRecoveryPaymentEvent).toHaveBeenCalledWith(expect.objectContaining({
      validationState: "validated",
      financialStatus: "refunded",
      snapshotHash: stored.snapshotHash,
    }));
    expect(reconstructOrderFromAuthorityEvidence).not.toHaveBeenCalled();
  });

  it("does not validate a redacted reversal when ventas amount conflicts", async () => {
    vi.mocked(getRecoverySnapshot).mockResolvedValue(storedSnapshot(true));
    vi.mocked(getOrderRowById).mockResolvedValue({
      orderId: order().externalReference,
      total: 999,
      currency: "ARS",
    } as Awaited<ReturnType<typeof getOrderRowById>>);
    const result = await prepareProtectedPaymentDurability({
      expectedExternalReference: order().externalReference,
      payment: payment("charged_back"),
      source: "webhook",
      observedAt: NOW,
    });
    expect(result).toMatchObject({ protected: true, outcome: "attention" });
    expect(appendRecoveryPaymentEvent).toHaveBeenCalledWith(expect.objectContaining({
      validationState: "missing_snapshot",
      processingState: "attention",
    }));
  });

  it("binds protected evidence to the expected reference before any recovery read or write", async () => {
    const result = await prepareProtectedPaymentDurability({
      expectedExternalReference: "es-expected-order-000001",
      payment: {
        ...payment(),
        external_reference: "es-other-order-000002",
      },
      source: "verify_payment_id",
      observedAt: NOW,
    });

    expect(result).toEqual({ protected: true, outcome: "reference_mismatch" });
    expect(getOrder).not.toHaveBeenCalled();
    expect(getRecoverySnapshot).not.toHaveBeenCalled();
    expect(getOrderRowById).not.toHaveBeenCalled();
    expect(upsertRecoverySnapshot).not.toHaveBeenCalled();
    expect(appendRecoveryPaymentEvent).not.toHaveBeenCalled();
    expect(markRecoveryEventState).not.toHaveBeenCalled();
    expect(markRecoverySnapshotState).not.toHaveBeenCalled();
    expect(reconstructOrderFromAuthorityEvidence).not.toHaveBeenCalled();
  });

  it("minimizes completed snapshot PII only after the durable event is completed", async () => {
    const stored = storedSnapshot();
    const event: RecoveryPaymentEvent = {
      eventKey: "f".repeat(64),
      paymentId: "pay_service_1",
      externalReference: stored.externalReference,
      financialStatus: "approved",
      amount: 1000,
      currency: "ARS",
      observedAt: new Date(NOW).toISOString(),
      source: "webhook",
      schemaVersion: 1,
      snapshotHash: stored.snapshotHash,
      validationState: "validated",
      processingState: "processing",
      attemptCount: 1,
      updatedAt: new Date(NOW).toISOString(),
    };

    await completeRecoveryEvent(event, "worker:privacy:one");

    expect(markRecoveryEventState).toHaveBeenCalledWith({
      eventKey: event.eventKey,
      state: "completed",
      leaseOwner: "worker:privacy:one",
    });
    expect(markRecoverySnapshotState).toHaveBeenCalledWith({
      externalReference: event.externalReference,
      state: "completed",
      redactSnapshot: true,
    });
    expect(vi.mocked(markRecoveryEventState).mock.invocationCallOrder[0]).toBeLessThan(
      vi.mocked(markRecoverySnapshotState).mock.invocationCallOrder[0],
    );
  });
});
