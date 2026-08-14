import { describe, expect, it, vi } from "vitest";
import type { Order } from "@/src/server/orders/types";
import { buildRecoveryOrderSnapshot, serializeRecoverySnapshot } from "./snapshot";
import type { RecoveryPaymentEvent, StoredRecoverySnapshot } from "./types";
import {
  MAX_EVENTS_PER_RUN,
  MAX_SNAPSHOTS_PER_RUN,
  RECOVERY_WORK_LEASE_MS,
  UNPAID_SNAPSHOT_RECOVERY_MARGIN_MS,
  runPaymentRecoveryWorker,
} from "./worker";

const NOW = Date.parse("2026-08-13T12:00:00.000Z");
const baseOrder = (): Order => ({
  externalReference: "es-worker-recovery-000001",
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
const storedSnapshot = (expiresAt = NOW + 60_000): StoredRecoverySnapshot => {
  const validFrom = expiresAt - 48 * 60 * 60 * 1000;
  const snapshot = buildRecoveryOrderSnapshot({
    order: { ...baseOrder(), createdAt: validFrom, updatedAt: validFrom },
    checkoutAttemptId: "attempt-worker-recovery-000001",
    preferenceValidFrom: validFrom,
    preferenceExpiresAt: expiresAt,
  });
  const serialized = serializeRecoverySnapshot(snapshot);
  return {
    externalReference: snapshot.externalReference,
    checkoutAttemptId: snapshot.checkoutAttemptId,
    schemaVersion: 1,
    snapshotHash: serialized.snapshotHash,
    snapshotJson: serialized.snapshotJson,
    createdAt: new Date(snapshot.createdAt).toISOString(),
    preferenceValidFrom: new Date(snapshot.preferenceValidFrom).toISOString(),
    preferenceExpiresAt: new Date(snapshot.preferenceExpiresAt).toISOString(),
    recoveryState: "pending_payment",
    updatedAt: new Date(snapshot.createdAt).toISOString(),
  };
};
const recoveryEvent = (): RecoveryPaymentEvent => ({
  eventKey: "a".repeat(64),
  paymentId: "pay_worker_1",
  externalReference: baseOrder().externalReference,
  financialStatus: "approved",
  amount: 1000,
  currency: "ARS",
  observedAt: new Date(NOW).toISOString(),
  source: "webhook",
  schemaVersion: 1,
  validationState: "validated",
  processingState: "processing",
  attemptCount: 1,
  leaseOwner: "worker:test",
  leaseExpiresAt: new Date(NOW + RECOVERY_WORK_LEASE_MS).toISOString(),
  updatedAt: new Date(NOW).toISOString(),
});

const dependencies = (input: { events?: RecoveryPaymentEvent[]; snapshots?: StoredRecoverySnapshot[] } = {}) => ({
  now: vi.fn(() => NOW),
  leaseOwner: vi.fn(() => "worker:test:000001"),
  claimWork: vi.fn(async () => ({ events: input.events ?? [], snapshots: input.snapshots ?? [] })),
  reconcileEvent: vi.fn(async () => ({ outcome: "completed" as const, order: baseOrder() })),
  searchPayments: vi.fn(async () => []),
  reconcileObservations: vi.fn(async () => ({
    outcome: "reconciled" as const,
    order: baseOrder(),
    observationResults: [],
    firstEffectiveApproval: false,
    activeApprovedPaymentIds: [],
  })),
  markSnapshot: vi.fn(async (input) => ({ ...storedSnapshot(), recoveryState: input.state })),
});

describe("AUD3-H06 autonomous recovery worker", () => {
  it("claims bounded work with a deterministic five-minute lease", async () => {
    const deps = dependencies();
    await runPaymentRecoveryWorker(deps);
    expect(deps.claimWork).toHaveBeenCalledWith({
      leaseOwner: "worker:test:000001",
      claimedAt: new Date(NOW).toISOString(),
      leaseExpiresAt: new Date(NOW + RECOVERY_WORK_LEASE_MS).toISOString(),
      maxEvents: MAX_EVENTS_PER_RUN,
      maxSnapshots: MAX_SNAPSHOTS_PER_RUN,
    });
  });

  it("AUD3-H06-18 processes durable claimed events without any Admin or customer traffic", async () => {
    const deps = dependencies({ events: [recoveryEvent()] });
    const result = await runPaymentRecoveryWorker(deps);
    expect(deps.reconcileEvent).toHaveBeenCalledWith(recoveryEvent(), "worker:test:000001");
    expect(result).toMatchObject({ claimed: 1, completed: 1, retryable: 0, attention: 0 });
  });

  it("AUD3-H06-14/25 keeps a failed durable event retryable through a KV outage and converges", async () => {
    const deps = dependencies({ events: [recoveryEvent()] });
    deps.reconcileEvent
      .mockRejectedValueOnce(new Error("temporary KV outage"))
      .mockResolvedValueOnce({ outcome: "completed", order: baseOrder() });
    const first = await runPaymentRecoveryWorker(deps);
    const second = await runPaymentRecoveryWorker(deps);
    expect(first).toMatchObject({ retryable: 1, completed: 0 });
    expect(second).toMatchObject({ retryable: 0, completed: 1 });
  });

  it("AUD3-H06-16 finds an approved payment by snapshot scan when webhook/customer/Admin are absent", async () => {
    const snapshot = storedSnapshot();
    const deps = dependencies({ snapshots: [snapshot] });
    deps.searchPayments.mockResolvedValue([{
      id: "pay_scan_1",
      status: "approved",
      external_reference: snapshot.externalReference,
      transaction_amount: 1000,
      currency_id: "ARS",
      date_last_updated: "2026-08-13T11:59:00.000Z",
    }] as never);
    deps.reconcileObservations.mockResolvedValue({
      outcome: "reconciled",
      order: baseOrder(),
      observationResults: [{
        outcome: "reconciled",
        order: baseOrder(),
        paymentId: "pay_scan_1",
        status: "approved",
        duplicate: false,
        firstEffectiveApproval: true,
        activeApprovedPaymentIds: ["pay_scan_1"],
      }],
      firstEffectiveApproval: true,
      activeApprovedPaymentIds: ["pay_scan_1"],
    } as never);
    const result = await runPaymentRecoveryWorker(deps);
    expect(deps.reconcileObservations).toHaveBeenCalledWith(expect.objectContaining({
      externalReference: snapshot.externalReference,
      observations: [expect.objectContaining({ source: "snapshot_scan" })],
    }));
    expect(result).toMatchObject({ snapshotsScanned: 1, eventsCreated: 1, completed: 1 });
  });

  it("AUD3-H06-REF-03 keeps snapshot A pending when its scan returns protected payment B", async () => {
    const snapshot = storedSnapshot();
    const deps = dependencies({ snapshots: [snapshot] });
    const paymentB = {
      id: "pay_scan_other_order",
      status: "approved",
      external_reference: "es-worker-recovery-other-order",
      transaction_amount: 1000,
      currency_id: "ARS",
      date_last_updated: "2026-08-13T11:59:00.000Z",
    };
    deps.searchPayments.mockResolvedValue([paymentB] as never);
    deps.reconcileObservations.mockResolvedValue({
      outcome: "reconciled",
      order: baseOrder(),
      observationResults: [{
        outcome: "ignored",
        reason: "reference_mismatch",
        order: null,
      }],
      firstEffectiveApproval: false,
      activeApprovedPaymentIds: [],
    } as never);

    const result = await runPaymentRecoveryWorker(deps);

    expect(deps.reconcileObservations).toHaveBeenCalledWith({
      externalReference: snapshot.externalReference,
      validationOrder: expect.objectContaining({
        externalReference: snapshot.externalReference,
      }),
      observations: [{ payment: paymentB, source: "snapshot_scan" }],
    });
    expect(deps.markSnapshot).toHaveBeenCalledWith({
      externalReference: snapshot.externalReference,
      state: "pending_payment",
    });
    expect(result).toMatchObject({ eventsCreated: 0, completed: 0, attention: 0 });
  });

  it("keeps snapshot recovery retryable with a safe code when financial reconciliation fails", async () => {
    const snapshot = storedSnapshot();
    const deps = dependencies({ snapshots: [snapshot] });
    deps.searchPayments.mockResolvedValue([{
      id: "pay_scan_failure_1",
      status: "approved",
      external_reference: snapshot.externalReference,
      transaction_amount: 1000,
      currency_id: "ARS",
      date_last_updated: "2026-08-13T11:59:00.000Z",
    }] as never);
    deps.reconcileObservations.mockRejectedValue(
      new Error("sensitive customer@example.test detail"),
    );

    const result = await runPaymentRecoveryWorker(deps);

    expect(deps.markSnapshot).toHaveBeenCalledWith({
      externalReference: snapshot.externalReference,
      state: snapshot.recoveryState,
      errorCode: "RECOVERY_RECONCILIATION_FAILED",
    });
    expect(result).toMatchObject({ retryable: 1, completed: 0 });
  });

  it("does not expire an unpaid snapshot inside its recovery horizon", async () => {
    const deps = dependencies({ snapshots: [storedSnapshot(NOW - UNPAID_SNAPSHOT_RECOVERY_MARGIN_MS + 1)] });
    const result = await runPaymentRecoveryWorker(deps);
    expect(deps.markSnapshot).toHaveBeenCalledWith(expect.objectContaining({ state: "pending_payment" }));
    expect(result).toMatchObject({ snapshotsScanned: 1, completed: 0, eventsCreated: 0 });
  });

  it("expires and redacts only after a complete empty search and the safe margin", async () => {
    const deps = dependencies({ snapshots: [storedSnapshot(NOW - UNPAID_SNAPSHOT_RECOVERY_MARGIN_MS)] });
    const result = await runPaymentRecoveryWorker(deps);
    expect(deps.searchPayments).toHaveBeenCalledTimes(1);
    expect(deps.markSnapshot).toHaveBeenCalledWith({
      externalReference: baseOrder().externalReference,
      state: "expired_unpaid",
      redactSnapshot: true,
    });
    expect(result).toMatchObject({ completed: 1, eventsCreated: 0 });
  });

  it("preserves a snapshot for retry when the authoritative MP search fails", async () => {
    const snapshot = storedSnapshot();
    const deps = dependencies({ snapshots: [snapshot] });
    deps.searchPayments.mockRejectedValue(new Error("network unavailable"));
    const result = await runPaymentRecoveryWorker(deps);
    expect(deps.markSnapshot).toHaveBeenCalledWith({
      externalReference: snapshot.externalReference,
      state: "pending_payment",
      errorCode: "MP_SEARCH_UNAVAILABLE",
    });
    expect(result).toMatchObject({ retryable: 1, completed: 0 });
  });

  it("AUD3-H06-24 continues claiming unresolved paid evidence after the primary Order TTL", async () => {
    const oldEvent = {
      ...recoveryEvent(),
      observedAt: new Date(NOW - 31 * 24 * 60 * 60 * 1000).toISOString(),
      updatedAt: new Date(NOW - 31 * 24 * 60 * 60 * 1000).toISOString(),
    };
    const deps = dependencies({ events: [oldEvent] });

    const result = await runPaymentRecoveryWorker(deps);

    expect(deps.reconcileEvent).toHaveBeenCalledWith(oldEvent, "worker:test:000001");
    expect(result).toMatchObject({ claimed: 1, completed: 1 });
  });
});
