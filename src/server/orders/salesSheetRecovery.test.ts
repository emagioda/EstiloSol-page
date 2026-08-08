import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Order } from "./types";

vi.mock("@/src/server/sheets/repository", () => ({
  appendOrderToSalesSheet: vi.fn(),
  updateOrderRowInSalesSheet: vi.fn(),
  decrementProductsStockInSheet: vi.fn(),
  UPDATE_ORDER_ROW_WORST_CASE_MS: 48_800,
}));

vi.mock("./store", () => ({
  getOrder: vi.fn(),
  updateOrder: vi.fn(),
  ORDER_WRITE_LOCK_TTL_SECONDS: 75,
}));

vi.mock("@/src/server/payments/mpClient", () => ({
  createPreferenceOnMp: vi.fn(),
  searchPaymentsByExternalReference: vi.fn(),
  fetchPaymentByIdFromMp: vi.fn(),
}));

vi.mock("@/src/server/notifications/orderReceipt", () => ({
  sendOrderReceiptEmail: vi.fn(),
}));

import {
  appendOrderToSalesSheet,
  decrementProductsStockInSheet,
  updateOrderRowInSalesSheet,
} from "@/src/server/sheets/repository";
import {
  createPreferenceOnMp,
  fetchPaymentByIdFromMp,
  searchPaymentsByExternalReference,
} from "@/src/server/payments/mpClient";
import { sendOrderReceiptEmail } from "@/src/server/notifications/orderReceipt";
import { recoverPendingSalesSheetOrder } from "./salesSheetRecovery";

let sequence = 0;
const makeOrder = (patch: Partial<Order> = {}): Order => {
  sequence += 1;
  return {
    externalReference: `pr2-recovery-${Date.now()}-${sequence}`,
    status: "approved",
    paymentStatus: "confirmed",
    shippingStatus: "in_process",
    inventoryStatus: "deducted",
    stockDeductedAt: 100,
    salesSheetDeferredUntilApprovedAt: 1,
    salesSheetSyncFailedAt: 2,
    items: [
      {
        productId: "p1",
        title: "Producto",
        unitPrice: 1000,
        qty: 1,
        currency: "ARS",
      },
    ],
    total: 1000,
    currency: "ARS",
    createdAt: 10,
    updatedAt: 20,
    ...patch,
  };
};

const dependenciesFor = (order: Order) => {
  const removePending = vi.fn().mockResolvedValue(true);
  const persistOrder = vi.fn().mockImplementation(async (_orderId, patch) => ({
    ...order,
    ...patch,
  }));
  return {
    isPending: vi.fn().mockResolvedValue(true),
    readOrder: vi.fn().mockResolvedValue(order),
    persistOrder,
    addPending: vi.fn().mockResolvedValue(false),
    removePending,
    now: vi.fn().mockReturnValue(1_000),
  };
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(appendOrderToSalesSheet).mockResolvedValue(undefined);
  vi.mocked(updateOrderRowInSalesSheet).mockResolvedValue(undefined);
});

describe("PR 2 indexed sales Sheet recovery", () => {
  it("PR2-SYNC-12 a missing row is appended from the authoritative KV order", async () => {
    const order = makeOrder();
    const dependencies = dependenciesFor(order);

    const result = await recoverPendingSalesSheetOrder(
      order.externalReference,
      { rowExists: false },
      dependencies
    );

    expect(result.outcome).toBe("appended");
    expect(appendOrderToSalesSheet).toHaveBeenCalledWith(order);
    expect(dependencies.persistOrder).toHaveBeenCalledWith(
      order.externalReference,
      expect.objectContaining({
        salesSheetSyncedAt: 1_000,
        salesSheetSyncFailedAt: undefined,
      }),
      { syncSheet: false }
    );
  });

  it("PR2-SYNC-13 successful recovery removes the pending index entry", async () => {
    const order = makeOrder();
    const dependencies = dependenciesFor(order);

    await recoverPendingSalesSheetOrder(
      order.externalReference,
      { rowExists: false },
      dependencies
    );

    expect(dependencies.removePending).toHaveBeenCalledOnce();
    expect(dependencies.removePending).toHaveBeenCalledWith(order.externalReference);
  });

  it("PR2-SYNC-14 recovery never decrements stock", async () => {
    const order = makeOrder();

    await recoverPendingSalesSheetOrder(
      order.externalReference,
      { rowExists: false },
      dependenciesFor(order)
    );

    expect(decrementProductsStockInSheet).not.toHaveBeenCalled();
  });

  it("PR2-SYNC-15 recovery never calls Mercado Pago", async () => {
    const order = makeOrder();

    await recoverPendingSalesSheetOrder(
      order.externalReference,
      { rowExists: false },
      dependenciesFor(order)
    );

    expect(createPreferenceOnMp).not.toHaveBeenCalled();
    expect(searchPaymentsByExternalReference).not.toHaveBeenCalled();
    expect(fetchPaymentByIdFromMp).not.toHaveBeenCalled();
  });

  it("PR2-SYNC-16 recovery never sends another receipt", async () => {
    const order = makeOrder();

    await recoverPendingSalesSheetOrder(
      order.externalReference,
      { rowExists: false },
      dependenciesFor(order)
    );

    expect(sendOrderReceiptEmail).not.toHaveBeenCalled();
  });

  it("PR2-SYNC-17 a failed append remains pending, indexed and retryable", async () => {
    const order = makeOrder();
    const dependencies = dependenciesFor(order);
    vi.mocked(appendOrderToSalesSheet).mockRejectedValueOnce(
      new Error("Sheets unavailable")
    );

    const result = await recoverPendingSalesSheetOrder(
      order.externalReference,
      { rowExists: false },
      dependencies
    );

    expect(result.outcome).toBe("pending");
    expect(dependencies.addPending).toHaveBeenCalledWith(order.externalReference);
    expect(dependencies.removePending).not.toHaveBeenCalled();
    expect(dependencies.persistOrder).toHaveBeenCalledWith(
      order.externalReference,
      { salesSheetSyncFailedAt: 1_000 },
      { syncSheet: false }
    );
  });

  it("PR2-SYNC-18 a row found after a lost response is not appended again", async () => {
    const order = makeOrder();

    await recoverPendingSalesSheetOrder(
      order.externalReference,
      { rowExists: true },
      dependenciesFor(order)
    );

    expect(appendOrderToSalesSheet).not.toHaveBeenCalled();
    expect(updateOrderRowInSalesSheet).toHaveBeenCalledOnce();
  });

  it("PR2-SYNC-19 an existing row is reconciled and removed from the index", async () => {
    const order = makeOrder();
    const dependencies = dependenciesFor(order);

    const result = await recoverPendingSalesSheetOrder(
      order.externalReference,
      { rowExists: true },
      dependencies
    );

    expect(result.outcome).toBe("reconciled");
    expect(updateOrderRowInSalesSheet).toHaveBeenCalledWith(
      order.externalReference,
      expect.objectContaining({
        paymentStatus: "confirmed",
        inventoryStatus: "deducted",
        stockDeductedAt: 100,
      })
    );
    expect(dependencies.removePending).toHaveBeenCalledWith(order.externalReference);
  });

  it("PR2-SYNC-20-LOCK concurrent recovery allows at most one effective append", async () => {
    const order = makeOrder();
    const firstAppendEntered = Promise.withResolvers<void>();
    const releaseFirstAppend = Promise.withResolvers<void>();
    const dependencies = dependenciesFor(order);
    vi.mocked(appendOrderToSalesSheet).mockImplementationOnce(async () => {
      firstAppendEntered.resolve();
      await releaseFirstAppend.promise;
    });

    const first = recoverPendingSalesSheetOrder(
      order.externalReference,
      { rowExists: false },
      dependencies
    );
    await firstAppendEntered.promise;
    const second = recoverPendingSalesSheetOrder(
      order.externalReference,
      { rowExists: false },
      dependencies
    );
    await expect(second).resolves.toMatchObject({ outcome: "busy" });
    releaseFirstAppend.resolve();
    await expect(first).resolves.toMatchObject({ outcome: "appended" });

    expect(appendOrderToSalesSheet).toHaveBeenCalledTimes(1);
  });
});
