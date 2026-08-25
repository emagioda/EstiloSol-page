import { describe, expect, it, vi } from "vitest";
import type { CurrentSalesProjectionResult } from "./store";
import type { Order } from "./types";

vi.mock("./store", () => ({
  getOrder: vi.fn(),
  reconcileCurrentOrderSalesProjection: vi.fn(),
  ORDER_WRITE_LOCK_TTL_SECONDS: 75,
}));

import { recoverPendingSalesSheetOrder } from "./salesSheetRecovery";

let sequence = 0;
const makeOrder = (patch: Partial<Order> = {}): Order => {
  sequence += 1;
  return {
    externalReference: `sales-recovery-${Date.now()}-${sequence}`,
    status: "approved",
    paymentStatus: "confirmed",
    shippingStatus: "in_process",
    inventoryStatus: "deducted",
    stockDeductedAt: 100,
    approvedAt: 15,
    receiptOutboxVersion: 1,
    salesSheetDeferredUntilApprovedAt: 1,
    salesSheetSyncFailedAt: 2,
    items: [{ productId: "p1", title: "Producto", unitPrice: 1000, qty: 1, currency: "ARS" }],
    total: 1000,
    currency: "ARS",
    createdAt: 10,
    updatedAt: 20,
    ...patch,
  };
};

const deferred = () => {
  let resolve!: () => void;
  const promise = new Promise<void>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
};

const dependenciesFor = (
  order: Order,
  projection: CurrentSalesProjectionResult = { outcome: "appended", order },
) => ({
  isPending: vi.fn().mockResolvedValue(true),
  readOrder: vi.fn().mockResolvedValue(order),
  reconcileProjection: vi.fn().mockResolvedValue(projection),
});

describe("AUD3 H07-D1 indexed sales Sheet recovery orchestration", () => {
  it("PR2-SYNC-12 delegates a missing row to the current-state locked append", async () => {
    const order = makeOrder();
    const dependencies = dependenciesFor(order);

    await expect(
      recoverPendingSalesSheetOrder(order.externalReference, { rowExists: false }, dependencies),
    ).resolves.toMatchObject({ outcome: "appended", order });
    expect(dependencies.reconcileProjection).toHaveBeenCalledWith(order.externalReference, {
      rowExists: false,
      requirePending: true,
    });
  });

  it("PR2-SYNC-13 delegates successful index cleanup to the locked projection", async () => {
    const order = makeOrder();
    const dependencies = dependenciesFor(order);

    await recoverPendingSalesSheetOrder(order.externalReference, { rowExists: false }, dependencies);

    expect(dependencies.reconcileProjection).toHaveBeenCalledOnce();
  });

  it("PR2-SYNC-17 leaves a failed current projection indexed and retryable", async () => {
    const order = makeOrder();
    const dependencies = dependenciesFor(order, {
      outcome: "failed",
      order: { ...order, salesSheetSyncFailedAt: 30 },
      error: new Error("Sheets unavailable"),
    });

    await expect(
      recoverPendingSalesSheetOrder(order.externalReference, { rowExists: false }, dependencies),
    ).resolves.toMatchObject({ outcome: "pending" });
  });

  it("PR2-SYNC-18 reconciles a caller-reported existing row without append assumptions", async () => {
    const order = makeOrder();
    const dependencies = dependenciesFor(order, { outcome: "projected", order });

    await expect(
      recoverPendingSalesSheetOrder(order.externalReference, { rowExists: true }, dependencies),
    ).resolves.toMatchObject({ outcome: "reconciled" });
    expect(dependencies.reconcileProjection).toHaveBeenCalledWith(order.externalReference, {
      rowExists: true,
      requirePending: true,
    });
  });

  it("AUD3-H06E-SALES-02 does not suppress pending work using an old success marker", async () => {
    const order = makeOrder({ salesSheetSyncedAt: 10, salesSheetSyncFailedAt: undefined });
    const dependencies = dependenciesFor(order, { outcome: "projected", order });

    await recoverPendingSalesSheetOrder(order.externalReference, { rowExists: true }, dependencies);

    expect(dependencies.reconcileProjection).toHaveBeenCalledOnce();
  });

  it("AUD3-H06E-AUTO-SALES-08 removes an ineligible indexed entry", async () => {
    const order = makeOrder({ receiptOutboxVersion: undefined });
    const dependencies = dependenciesFor(order, { outcome: "not_eligible", order });

    await expect(
      recoverPendingSalesSheetOrder(order.externalReference, { rowExists: true }, dependencies),
    ).resolves.toMatchObject({ outcome: "not_eligible" });
  });

  it("PR2-SYNC-INDEX-03 removes a stale index entry after locked KV absence", async () => {
    const order = makeOrder();
    const dependencies = dependenciesFor(order, { outcome: "missing", order: null });

    await expect(
      recoverPendingSalesSheetOrder(order.externalReference, { rowExists: true }, dependencies),
    ).resolves.toEqual({ outcome: "stale", order: null });
  });

  it("H07D1-APPEND-01 reconciles current state after append identity dedupe", async () => {
    const order = makeOrder();
    const current = { ...order, shippingStatus: "completed" as const };
    const dependencies = dependenciesFor(order);
    dependencies.reconcileProjection
      .mockResolvedValueOnce({ outcome: "deduped", order })
      .mockResolvedValueOnce({ outcome: "projected", order: current });

    const result = await recoverPendingSalesSheetOrder(
      order.externalReference,
      { rowExists: false },
      dependencies,
    );

    expect(result).toMatchObject({ outcome: "reconciled", order: current });
    expect(dependencies.reconcileProjection).toHaveBeenNthCalledWith(2, order.externalReference, {
      rowExists: true,
      requirePending: true,
    });
  });

  it("H07D1-CRASH-02 preserves the store-owned pending outcome", async () => {
    const order = makeOrder({ salesSheetSyncedAt: 30, salesSheetSyncFailedAt: undefined });
    const dependencies = dependenciesFor(order, { outcome: "pending", order });

    await expect(
      recoverPendingSalesSheetOrder(order.externalReference, { rowExists: true }, dependencies),
    ).resolves.toMatchObject({ outcome: "pending", order });
  });

  it("PR2-SYNC-20-LOCK retains the recovery lock only as worker dedupe", async () => {
    const order = makeOrder();
    const entered = deferred();
    const release = deferred();
    const dependencies = dependenciesFor(order);
    dependencies.reconcileProjection.mockImplementationOnce(async () => {
      entered.resolve();
      await release.promise;
      return { outcome: "appended", order };
    });

    const first = recoverPendingSalesSheetOrder(
      order.externalReference,
      { rowExists: false },
      dependencies,
    );
    await entered.promise;
    const second = recoverPendingSalesSheetOrder(
      order.externalReference,
      { rowExists: false },
      dependencies,
    );

    await expect(second).resolves.toMatchObject({ outcome: "busy" });
    release.resolve();
    await expect(first).resolves.toMatchObject({ outcome: "appended" });
    expect(dependencies.reconcileProjection).toHaveBeenCalledTimes(1);
  });
});
