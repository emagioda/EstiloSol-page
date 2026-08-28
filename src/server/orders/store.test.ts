import { beforeEach, describe, expect, it, vi } from "vitest";
import { InventoryOperationError } from "@/src/server/inventory/errors";
import type { Order } from "@/src/server/orders/types";
import type { RecoveryPaymentEvent } from "@/src/server/recovery/types";
import type { AdminOrderSheetRow } from "@/src/server/sheets/repository";
import { setJson } from "@/src/server/kv";
import * as kv from "@/src/server/kv";

vi.mock("@/src/server/sheets/repository", () => ({
  appendOrderToSalesSheet: vi.fn(),
  decrementProductsStockInSheet: vi.fn(),
  getUniqueOrderRowById: vi.fn(),
  updateOrderRowInSalesSheet: vi.fn(),
  SHEETS_GET_WORST_CASE_MS: 20_300,
  SHEETS_MUTATION_WORST_CASE_MS: 24_400,
  UPDATE_ORDER_ROW_WORST_CASE_MS: 48_800,
}));

vi.mock("@/src/server/catalog/getProducts", () => ({
  invalidateProductsCatalogCache: vi.fn(),
}));

vi.mock("@/src/server/observability/metrics", () => ({
  trackBusinessEvent: vi.fn(),
}));

import {
  applyAdminOrderStatusIntent,
  assertAdminPaymentTransitionRequest,
  createOrder,
  ensureOrderDurableInSalesSheet,
  ensureOrderExists,
  getOrder,
  markApproved,
  markCancelled,
  markChargedBack,
  markRefunded,
  mergeOrderUpdate,
  ORDER_WRITE_LOCK_MINIMUM_MARGIN_MS,
  ORDER_WRITE_LOCK_TTL_SECONDS,
  orderWriteLockCoversWorstCaseSheetUpdate,
  projectCurrentOrderSalesState,
  reconstructOrderFromAuthorityEvidence,
  reconcileCurrentOrderSalesProjection,
  reconcileMercadoPagoPaymentObservationBatch,
  retryPaidOrderInventory,
  runMissingOrderDestinationArbitration,
  runMissingOrderSheetFallback,
  updateOrder,
} from "./store";
import { AdminOrderStateChangedError } from "./adminIntent";
import { resolveOrderInventoryStatus } from "./inventory";
import { evaluateFulfillmentCompletion } from "./fulfillmentCompletion";
import {
  appendOrderToSalesSheet,
  decrementProductsStockInSheet,
  getUniqueOrderRowById,
  updateOrderRowInSalesSheet,
} from "@/src/server/sheets/repository";
import { invalidateProductsCatalogCache } from "@/src/server/catalog/getProducts";
import { trackBusinessEvent } from "@/src/server/observability/metrics";
import {
  addPendingSalesSheetOrder,
  isPendingSalesSheetOrder,
  removePendingSalesSheetOrder,
} from "./salesSheetSync";
import * as salesSheetSync from "./salesSheetSync";
import { recoverPendingSalesSheetOrder } from "./salesSheetRecovery";
import { getOrdersForAdminWithKvState } from "./admin";

let sequence = 0;
const makeOrder = (patch: Partial<Order> = {}): Order => {
  sequence += 1;
  const now = Date.now();
  return {
    externalReference: `pr2-store-${now}-${sequence}`,
    status: "created",
    paymentStatus: "pending",
    shippingStatus: "in_process",
    paymentMethod: "mercadopago",
    deliveryMethod: "pickup",
    items: [{ productId: "p1", title: "Producto", unitPrice: 1000, qty: 1, currency: "ARS" }],
    total: 1000,
    currency: "ARS",
    fulfillment: {
      subtotalProducts: 1000,
      discountAmount: 0,
      shippingFee: 0,
      finalTotal: 1000,
      pickupPoint: {
        id: "pickup-1",
        name: "Estilo Sol",
        address: "San Martín 123",
        reference: "Mostrador",
      },
      summary: "Retiro en Estilo Sol",
    },
    createdAt: now,
    updatedAt: now,
    ...patch,
  };
};

const approve = (order: Order) =>
  markApproved(order.externalReference, {
    paymentId: `payment-${sequence}`,
    mpStatus: "approved",
    approvedAt: Date.now(),
  }, "mp_authoritative");

const deferred = () => {
  let resolve!: () => void;
  const promise = new Promise<void>((resolvePromise) => {
    resolve = () => resolvePromise();
  });
  return { promise, resolve };
};

const timeoutAfterCommit = () => {
  const error = new Error("timed out after commit");
  error.name = "AbortError";
  return error;
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(appendOrderToSalesSheet).mockResolvedValue({ deduped: false });
  vi.mocked(updateOrderRowInSalesSheet).mockResolvedValue(undefined);
  vi.mocked(getUniqueOrderRowById).mockResolvedValue({ outcome: "missing", order: null });
  vi.mocked(invalidateProductsCatalogCache).mockResolvedValue(undefined);
  vi.mocked(decrementProductsStockInSheet).mockResolvedValue({
    deduped: false,
    updated: [{ productId: "p1", previousQty: 2, nextQty: 1 }],
  });
});

describe("PR 2 order store inventory state", () => {
  it("PR2-STORE-01 new orders start with inventory pending", async () => {
    const order = makeOrder();
    await createOrder(order);
    expect((await getOrder(order.externalReference))?.inventoryStatus).toBe("pending");
  });

  it("PR2-STORE-02 approved plus stock success is confirmed and deducted", async () => {
    const order = makeOrder();
    await createOrder(order);
    const updated = await approve(order);
    expect(updated).toMatchObject({
      paymentStatus: "confirmed",
      inventoryStatus: "deducted",
      receiptOutboxVersion: 1,
    });
    expect(updated?.stockDeductedAt).toEqual(expect.any(Number));
    expect(updateOrderRowInSalesSheet).toHaveBeenCalledWith(
      order.externalReference,
      expect.objectContaining({ receiptOutboxVersion: 1 }),
    );
  });

  it("does not enroll an already-confirmed legacy order during later approval processing", async () => {
    const order = makeOrder({
      status: "approved",
      paymentStatus: "confirmed",
      inventoryStatus: "pending",
    });
    await createOrder(order);
    const updated = await markApproved(order.externalReference, {
      paymentId: "legacy-payment",
      mpStatus: "approved",
    }, "mp_authoritative");
    expect(updated?.receiptOutboxVersion).toBeUndefined();
    expect(updateOrderRowInSalesSheet).toHaveBeenCalledWith(
      order.externalReference,
      expect.not.objectContaining({ receiptOutboxVersion: 1 }),
    );
  });

  it("PR2-STORE-03 insufficient stock keeps payment confirmed and records conflict", async () => {
    vi.mocked(decrementProductsStockInSheet).mockRejectedValueOnce(new InventoryOperationError({
      code: "INSUFFICIENT_STOCK",
      message: "insufficient",
    }));
    const order = makeOrder();
    await createOrder(order);
    expect(await approve(order)).toMatchObject({
      paymentStatus: "confirmed",
      inventoryStatus: "conflict",
      inventoryIssueCode: "INSUFFICIENT_STOCK",
    });
  });

  it("PR2-STORE-04 inactive product is a deterministic conflict", async () => {
    vi.mocked(decrementProductsStockInSheet).mockRejectedValueOnce(new InventoryOperationError({
      code: "PRODUCT_INACTIVE",
      message: "inactive",
    }));
    const order = makeOrder();
    await createOrder(order);
    expect(await approve(order)).toMatchObject({ paymentStatus: "confirmed", inventoryStatus: "conflict" });
  });

  it("PR2-STORE-05 duplicate product id is a deterministic conflict", async () => {
    vi.mocked(decrementProductsStockInSheet).mockRejectedValueOnce(new InventoryOperationError({
      code: "DUPLICATE_PRODUCT_ID",
      message: "duplicate",
    }));
    const order = makeOrder();
    await createOrder(order);
    expect(await approve(order)).toMatchObject({
      paymentStatus: "confirmed",
      inventoryStatus: "conflict",
      inventoryIssueCode: "DUPLICATE_PRODUCT_ID",
    });
  });

  it("PR2-STORE-06 timeout keeps payment confirmed and records a technical error", async () => {
    const timeout = new Error("timed out");
    timeout.name = "AbortError";
    vi.mocked(decrementProductsStockInSheet).mockRejectedValueOnce(timeout);
    const order = makeOrder();
    await createOrder(order);
    expect(await approve(order)).toMatchObject({
      paymentStatus: "confirmed",
      inventoryStatus: "error",
      inventoryIssueCode: "SHEETS_TIMEOUT",
    });
  });

  it("PR2-STORE-07 conflict never changes payment back to pending", async () => {
    vi.mocked(decrementProductsStockInSheet).mockRejectedValueOnce(new InventoryOperationError({
      code: "PRODUCT_NOT_FOUND",
      message: "missing",
    }));
    const order = makeOrder();
    await createOrder(order);
    await approve(order);
    expect((await getOrder(order.externalReference))?.paymentStatus).toBe("confirmed");
  });

  it("PR2-STORE-08 technical error never changes payment back to pending", async () => {
    vi.mocked(decrementProductsStockInSheet).mockRejectedValueOnce(new Error("unknown"));
    const order = makeOrder();
    await createOrder(order);
    await approve(order);
    expect((await getOrder(order.externalReference))?.paymentStatus).toBe("confirmed");
  });

  it("PR2-STORE-09 successful retry clears issue code and timestamp", async () => {
    const order = makeOrder({
      status: "approved",
      paymentStatus: "confirmed",
      inventoryStatus: "conflict",
      inventoryIssueCode: "INSUFFICIENT_STOCK",
      inventoryIssueAt: 123,
    });
    await createOrder(order);
    const updated = await retryPaidOrderInventory(order.externalReference);
    expect(updated).toMatchObject({ inventoryStatus: "deducted" });
    expect(updated?.inventoryIssueCode).toBeUndefined();
    expect(updated?.inventoryIssueAt).toBeUndefined();
  });

  it("AUD3-NEXT-INV-06 admin retry after a lost response reconciles ALREADY_APPLIED to deducted", async () => {
    const timeout = timeoutAfterCommit();
    vi.mocked(decrementProductsStockInSheet)
      .mockRejectedValueOnce(timeout)
      .mockResolvedValueOnce({ deduped: true, updated: [] });
    const order = makeOrder();
    await createOrder(order);
    expect(await approve(order)).toMatchObject({
      paymentStatus: "confirmed",
      inventoryStatus: "error",
      inventoryIssueCode: "SHEETS_TIMEOUT",
    });

    const retried = await retryPaidOrderInventory(order.externalReference);
    expect(retried).toMatchObject({
      paymentStatus: "confirmed",
      inventoryStatus: "deducted",
      stockDeductedAt: expect.any(Number),
    });
    expect(decrementProductsStockInSheet).toHaveBeenCalledTimes(2);
  });

  it("PR2-STORE-10 deduped authoritative response is deducted", async () => {
    vi.mocked(decrementProductsStockInSheet).mockResolvedValueOnce({ deduped: true, updated: [] });
    const order = makeOrder();
    await createOrder(order);
    expect(await approve(order)).toMatchObject({ inventoryStatus: "deducted" });
  });

  it("PR2-STORE-11 repeated markApproved on deducted does not decrement again", async () => {
    const order = makeOrder();
    await createOrder(order);
    await approve(order);
    await approve(order);
    expect(decrementProductsStockInSheet).toHaveBeenCalledTimes(1);
  });

  it("PR2-STORE-12 repeated markApproved on conflict does not retry automatically", async () => {
    vi.mocked(decrementProductsStockInSheet).mockRejectedValueOnce(new InventoryOperationError({
      code: "INSUFFICIENT_STOCK",
      message: "insufficient",
    }));
    const order = makeOrder();
    await createOrder(order);
    await approve(order);
    await approve(order);
    expect(decrementProductsStockInSheet).toHaveBeenCalledTimes(1);
  });

  it("PR2-STORE-13 repeated markApproved on error does not retry automatically", async () => {
    vi.mocked(decrementProductsStockInSheet).mockRejectedValueOnce(new Error("network"));
    const order = makeOrder();
    await createOrder(order);
    await approve(order);
    await approve(order);
    expect(decrementProductsStockInSheet).toHaveBeenCalledTimes(1);
  });

  it("PR2-STORE-14 legacy stock timestamp is interpreted as deducted", () => {
    expect(resolveOrderInventoryStatus({ stockDeductedAt: 123 })).toBe("deducted");
  });

  it("PR2-STORE-15 legacy order without inventory evidence stays unregistered", () => {
    expect(resolveOrderInventoryStatus({})).toBeUndefined();
  });

  it.each([
    ["PR2-STORE-16 refund does not restock", markRefunded, "refunded"],
    ["PR2-STORE-17 cancellation does not restock", markCancelled, "cancelled"],
    ["PR2-STORE-18 chargeback does not restock", markChargedBack, "charged_back"],
  ] as const)("%s", async (_name, transition, expectedStatus) => {
    const order = makeOrder({
      status: "approved",
      paymentStatus: "confirmed",
      inventoryStatus: "deducted",
      stockDeductedAt: 123,
    });
    await createOrder(order);
    const updated = await transition(
      order.externalReference,
      { paymentId: "pay", mpStatus: expectedStatus },
      "mp_authoritative"
    );
    expect(updated).toMatchObject({ inventoryStatus: "deducted", stockDeductedAt: 123 });
    expect(decrementProductsStockInSheet).not.toHaveBeenCalled();
  });
});

describe("AUD3 H07 store fulfillment invariant", () => {
  it("RACE-01 rejects a forged direct completion at the locked store boundary", async () => {
    const order = makeOrder({ inventoryStatus: "pending" });
    await createOrder(order);

    await expect(updateOrder(order.externalReference, {
      shippingStatus: "completed",
    })).rejects.toMatchObject({
      name: "FulfillmentCompletionBlockedError",
      reason: "PAYMENT_NOT_CONFIRMED",
    });
    await expect(getOrder(order.externalReference)).resolves.toMatchObject({
      shippingStatus: "in_process",
    });
  });

  it("RACE-02 approval cannot retroactively legitimize a preexisting invalid completion", async () => {
    const order = makeOrder({ shippingStatus: "completed", inventoryStatus: "pending" });
    await createOrder(order);

    await expect(approve(order)).resolves.toMatchObject({
      paymentStatus: "confirmed",
      inventoryStatus: "deducted",
      shippingStatus: "in_process",
    });
  });

  it("RACE-03 inventory retry cleans an invalid preexisting completion", async () => {
    const order = makeOrder({
      status: "approved",
      paymentStatus: "confirmed",
      shippingStatus: "completed",
      inventoryStatus: "conflict",
      inventoryIssueCode: "INSUFFICIENT_STOCK",
    });
    await createOrder(order);

    await expect(retryPaidOrderInventory(order.externalReference)).resolves.toMatchObject({
      inventoryStatus: "deducted",
      shippingStatus: "in_process",
    });
  });

  it("RACE-04 completion racing approval can only finish in a policy-valid state", async () => {
    const order = makeOrder({ inventoryStatus: "pending" });
    await createOrder(order);

    await Promise.allSettled([
      approve(order),
      updateOrder(order.externalReference, { shippingStatus: "completed" }),
    ]);
    const finalOrder = await getOrder(order.externalReference);
    expect(finalOrder).not.toBeNull();
    if (finalOrder?.shippingStatus === "completed") {
      expect(evaluateFulfillmentCompletion(finalOrder)).toEqual({ allowed: true });
    } else {
      expect(finalOrder?.shippingStatus).toBe("in_process");
    }
  });

  it("MP-CLEAN-01 reconciliation removes an invalid preexisting completion without changing ledger semantics", async () => {
    const order = makeOrder({ shippingStatus: "completed", inventoryStatus: "pending" });
    await createOrder(order, { syncSheet: false });

    const result = await reconcileMercadoPagoPaymentObservationBatch(order.externalReference, [{
      paymentId: "approved-payment",
      status: "approved",
      amount: 1000,
      currency: "ARS",
      observedAt: 100,
    }]);
    expect(result.order).toMatchObject({
      paymentStatus: "confirmed",
      inventoryStatus: "deducted",
      shippingStatus: "in_process",
      mpPaymentLedger: {
        "approved-payment": expect.objectContaining({ status: "approved" }),
      },
    });
  });

  it("HISTORY-02 preserves a valid completed flag through refund and later chargeback", async () => {
    const order = makeOrder({
      status: "approved",
      paymentStatus: "confirmed",
      shippingStatus: "completed",
      inventoryStatus: "deducted",
      stockDeductedAt: 100,
    });
    await createOrder(order);

    await markRefunded(
      order.externalReference,
      { paymentId: "pay", mpStatus: "refunded" },
      "mp_authoritative"
    );
    await expect(getOrder(order.externalReference)).resolves.toMatchObject({
      paymentStatus: "refunded",
      shippingStatus: "completed",
    });
    await markChargedBack(
      order.externalReference,
      { paymentId: "pay", mpStatus: "charged_back" },
      "mp_authoritative"
    );
    await expect(getOrder(order.externalReference)).resolves.toMatchObject({
      paymentStatus: "charged_back",
      shippingStatus: "completed",
    });
  });

  it("HISTORY-03 keeps valid completion terminal when an operator requests reopening", async () => {
    const current = makeOrder({
      status: "approved",
      paymentStatus: "confirmed",
      shippingStatus: "completed",
      inventoryStatus: "deducted",
      stockDeductedAt: 100,
    });
    expect(mergeOrderUpdate(current, { shippingStatus: "in_process" }).order.shippingStatus).toBe(
      "completed"
    );
  });

  it("FORGE-01 rejects a single forged patch that tries to repair and complete an invalid flag", () => {
    const current = makeOrder({ shippingStatus: "completed", inventoryStatus: "pending" });
    expect(() => mergeOrderUpdate(current, {
      status: "approved",
      paymentStatus: "confirmed",
      inventoryStatus: "deducted",
      stockDeductedAt: 100,
      shippingStatus: "completed",
    }, Date.now(), "system")).toThrow(/Volvé a indicar Finalizado/);
  });
});

describe("AUD3 Mercado Pago bulk order-store reconciliation", () => {
  const observation = (paymentId: string, status: string, observedAt: number) => ({
    paymentId,
    status,
    amount: 1000,
    currency: "ARS" as const,
    observedAt,
  });

  it("AUD3-PAY-BATCH-01 persists only the final confirmed aggregate", async () => {
    const order = makeOrder();
    await createOrder(order, { syncSheet: false });
    const statesBeforeFinancialWrite: string[] = [];
    const persistOrder = vi.fn(async (key: string, value: Order, ttlSeconds: number) => {
      statesBeforeFinancialWrite.push(
        (await getOrder(order.externalReference))?.paymentStatus ?? "missing"
      );
      if (value.paymentStatus === "cancelled") {
        throw new Error("injected intermediate cancelled write failure");
      }
      expect(value).toMatchObject({ status: "approved", paymentStatus: "confirmed" });
      expect(Object.keys(value.mpPaymentLedger ?? {})).toEqual(["B", "A"]);
      await setJson(key, value, ttlSeconds);
    });

    const result = await reconcileMercadoPagoPaymentObservationBatch(
      order.externalReference,
      [observation("B", "rejected", 10), observation("A", "approved", 20)],
      { persistOrder }
    );

    expect(statesBeforeFinancialWrite).toEqual(["pending"]);
    expect(persistOrder).toHaveBeenCalledTimes(1);
    expect(result.order).toMatchObject({ status: "approved", paymentStatus: "confirmed" });
    expect(await getOrder(order.externalReference)).toMatchObject({
      status: "approved",
      paymentStatus: "confirmed",
    });
    expect(decrementProductsStockInSheet).toHaveBeenCalledTimes(1);
  });

  it("AUD3-PAY-BATCH-06 a failed final write persists no observation prefix", async () => {
    const order = makeOrder();
    await createOrder(order, { syncSheet: false });
    const persistOrder = vi.fn(async () => {
      throw new Error("KV unavailable");
    });

    await expect(
      reconcileMercadoPagoPaymentObservationBatch(
        order.externalReference,
        [
          observation("B", "rejected", 10),
          observation("C", "cancelled", 20),
          observation("A", "approved", 30),
        ],
        { persistOrder }
      )
    ).rejects.toThrow("KV unavailable");

    expect(persistOrder).toHaveBeenCalledTimes(1);
    expect(await getOrder(order.externalReference)).toMatchObject({
      status: "created",
      paymentStatus: "pending",
    });
    expect((await getOrder(order.externalReference))?.mpPaymentLedger).toBeUndefined();
    expect(decrementProductsStockInSheet).toHaveBeenCalledTimes(1);
    expect(appendOrderToSalesSheet).not.toHaveBeenCalled();
  });

  it("AUD3-H06-02 replays an applied inventory journal after final KV failure with one effective deduction", async () => {
    const order = makeOrder();
    await createOrder(order, { syncSheet: false });
    let effectiveDeductions = 0;
    vi.mocked(decrementProductsStockInSheet)
      .mockImplementationOnce(async () => {
        effectiveDeductions += 1;
        return { deduped: false, updated: [{ productId: "p1", previousQty: 2, nextQty: 1 }] };
      })
      .mockResolvedValueOnce({ deduped: true, updated: [] });

    await expect(
      reconcileMercadoPagoPaymentObservationBatch(
        order.externalReference,
        [observation("A", "approved", 30)],
        { persistOrder: async () => { throw new Error("KV unavailable after inventory"); } },
      ),
    ).rejects.toThrow("KV unavailable after inventory");

    const recovered = await reconcileMercadoPagoPaymentObservationBatch(
      order.externalReference,
      [observation("A", "approved", 30)],
    );

    expect(recovered.order).toMatchObject({
      paymentStatus: "confirmed",
      inventoryStatus: "deducted",
    });
    expect(decrementProductsStockInSheet).toHaveBeenCalledTimes(2);
    expect(effectiveDeductions).toBe(1);
    expect(appendOrderToSalesSheet).toHaveBeenCalledTimes(1);
  });

  it("AUD3-H06-19 recovers a failed second approval while preserving both IDs and one stock deduction", async () => {
    const order = makeOrder();
    await createOrder(order, { syncSheet: false });
    await reconcileMercadoPagoPaymentObservationBatch(
      order.externalReference,
      [observation("A", "approved", 10)],
    );

    await expect(
      reconcileMercadoPagoPaymentObservationBatch(
        order.externalReference,
        [observation("B", "approved", 20)],
        { persistOrder: async () => { throw new Error("KV unavailable for payment B"); } },
      ),
    ).rejects.toThrow("KV unavailable for payment B");

    const recovered = await reconcileMercadoPagoPaymentObservationBatch(
      order.externalReference,
      [observation("B", "approved", 20)],
    );
    expect(Object.keys(recovered.order?.mpPaymentLedger ?? {})).toEqual(["A", "B"]);
    expect(recovered.order).toMatchObject({
      paymentStatus: "confirmed",
      mpPaymentAttentionCode: "MULTIPLE_APPROVED_MP_PAYMENTS",
    });
    expect(decrementProductsStockInSheet).toHaveBeenCalledTimes(1);
    expect(appendOrderToSalesSheet).toHaveBeenCalledTimes(1);
  });

  it("AUD3-H06E-SALES-10 keeps MP financial, inventory, and receipt enrollment single during sales repair", async () => {
    const order = makeOrder();
    await createOrder(order);
    vi.mocked(updateOrderRowInSalesSheet).mockRejectedValueOnce(new Error("Sheets unavailable"));

    const first = await reconcileMercadoPagoPaymentObservationBatch(
      order.externalReference,
      [observation("A", "approved", 30)],
    );
    expect(first).toMatchObject({
      firstEffectiveApproval: true,
      order: {
        paymentStatus: "confirmed",
        receiptOutboxVersion: 1,
        salesSheetSyncFailedAt: expect.any(Number),
      },
      receiptOrder: { receiptOutboxVersion: 1 },
    });
    expect(await isPendingSalesSheetOrder(order.externalReference)).toBe(true);

    const replay = await reconcileMercadoPagoPaymentObservationBatch(
      order.externalReference,
      [observation("A", "approved", 31)],
    );
    expect(replay.firstEffectiveApproval).toBe(false);
    expect(replay.receiptOrder).toBeUndefined();

    vi.mocked(updateOrderRowInSalesSheet).mockResolvedValue(undefined);
    await expect(
      recoverPendingSalesSheetOrder(order.externalReference, { rowExists: true }),
    ).resolves.toMatchObject({ outcome: "reconciled" });
    expect(decrementProductsStockInSheet).toHaveBeenCalledTimes(1);
    expect(appendOrderToSalesSheet).toHaveBeenCalledTimes(1);
    expect(await isPendingSalesSheetOrder(order.externalReference)).toBe(false);
  });
});

describe("PR 2 recoverable Sheets synchronization", () => {
  it("AUD3-H06-04 a durable append marker repairs KV after response loss without a second append", async () => {
    const order = makeOrder({
      status: "approved",
      paymentStatus: "confirmed",
      salesSheetDeferredUntilApprovedAt: Date.now(),
    });
    await createOrder(order, { syncSheet: false });
    await setJson(
      `es:order:sales-sheet-sync:${order.externalReference}`,
      "synced",
      60,
    );

    const result = await ensureOrderDurableInSalesSheet(order);

    expect(result).toMatchObject({
      synced: true,
      order: { salesSheetSyncedAt: expect.any(Number) },
    });
    expect(appendOrderToSalesSheet).not.toHaveBeenCalled();
    expect(updateOrderRowInSalesSheet).toHaveBeenCalledTimes(1);
    await expect(getOrder(order.externalReference)).resolves.toMatchObject({
      salesSheetSyncedAt: expect.any(Number),
    });
  });

  it("PR2-SYNC-01 KV keeps confirmed payment and inventory error when Sheets sync fails", async () => {
    const order = makeOrder();
    await createOrder(order);
    vi.mocked(updateOrderRowInSalesSheet).mockRejectedValueOnce(new Error("Sheets unavailable"));

    const updated = await updateOrder(order.externalReference, {
      status: "approved",
      paymentStatus: "confirmed",
      inventoryStatus: "error",
      inventoryIssueCode: "SHEETS_UNAVAILABLE",
      inventoryIssueAt: 123,
      stockDeductedAt: undefined,
    }, { paymentAuthority: "system" });

    expect(updated).toMatchObject({
      paymentStatus: "confirmed",
      inventoryStatus: "error",
      inventoryIssueCode: "SHEETS_UNAVAILABLE",
    });
    expect(await getOrder(order.externalReference)).toMatchObject({
      paymentStatus: "confirmed",
      inventoryStatus: "error",
      inventoryIssueCode: "SHEETS_UNAVAILABLE",
    });
  });

  it.each(["cash", "transfer"] as const)(
    "AUD3-H06E-SALES-01 %s confirmation keeps durable enrolled recovery intent when the row update fails",
    async (paymentMethod) => {
      const order = makeOrder({ paymentMethod });
      await createOrder(order);
      const initial = await getOrder(order.externalReference);
      expect(initial?.salesSheetSyncedAt).toEqual(expect.any(Number));
      vi.mocked(updateOrderRowInSalesSheet).mockRejectedValueOnce(new Error("Sheets unavailable"));

      const updated = await approve(order);

      expect(updated).toMatchObject({
        paymentStatus: "confirmed",
        receiptOutboxVersion: 1,
        salesSheetSyncedAt: initial?.salesSheetSyncedAt,
        salesSheetSyncFailedAt: expect.any(Number),
      });
      await expect(getOrder(order.externalReference)).resolves.toMatchObject({
        paymentStatus: "confirmed",
        receiptOutboxVersion: 1,
        salesSheetSyncFailedAt: expect.any(Number),
      });
      await expect(isPendingSalesSheetOrder(order.externalReference)).resolves.toBe(true);
      await removePendingSalesSheetOrder(order.externalReference);
    },
  );

  it("AUD3-H06E-SALES-06 does not index a legacy confirmed Order after an unrelated projection failure", async () => {
    const order = makeOrder({
      status: "approved",
      paymentStatus: "confirmed",
      inventoryStatus: "deducted",
      stockDeductedAt: 123,
      receiptOutboxVersion: undefined,
    });
    await createOrder(order);
    vi.mocked(updateOrderRowInSalesSheet).mockRejectedValueOnce(new Error("Sheets unavailable"));

    const updated = await updateOrder(order.externalReference, { shippingStatus: "completed" });

    expect(updated?.receiptOutboxVersion).toBeUndefined();
    expect(updated?.salesSheetSyncFailedAt).toBeUndefined();
    await expect(isPendingSalesSheetOrder(order.externalReference)).resolves.toBe(false);
  });

  it("PR2-SYNC-09 failed approved append keeps the confirmed KV order indexed", async () => {
    const order = makeOrder();
    await createOrder(order, { syncSheet: false });
    vi.mocked(appendOrderToSalesSheet).mockRejectedValueOnce(new Error("Sheets unavailable"));

    const updated = await approve(order);

    expect(updated).toMatchObject({
      paymentStatus: "confirmed",
      inventoryStatus: "deducted",
      salesSheetSyncFailedAt: expect.any(Number),
    });
    await expect(isPendingSalesSheetOrder(order.externalReference)).resolves.toBe(true);
    await removePendingSalesSheetOrder(order.externalReference);
  });

  it("PR2-SYNC-09A indexing survives an observability failure", async () => {
    const order = makeOrder();
    await createOrder(order, { syncSheet: false });
    vi.mocked(appendOrderToSalesSheet).mockRejectedValueOnce(new Error("Sheets unavailable"));
    vi.mocked(trackBusinessEvent).mockRejectedValueOnce(new Error("Metrics unavailable"));

    const updated = await approve(order);

    expect(updated?.paymentStatus).toBe("confirmed");
    await expect(isPendingSalesSheetOrder(order.externalReference)).resolves.toBe(true);
    await removePendingSalesSheetOrder(order.externalReference);
  });

  it("PR2-SYNC-INDEX-04 an unpaid deferred preference is never indexed", async () => {
    const order = makeOrder();
    await createOrder(order, { syncSheet: false });

    await expect(isPendingSalesSheetOrder(order.externalReference)).resolves.toBe(false);
  });

  it("PR2-SYNC-INDEX-05 a successful initial append removes a stale index entry", async () => {
    const order = makeOrder();
    await createOrder(order, { syncSheet: false });
    await addPendingSalesSheetOrder(order.externalReference);

    await approve(order);

    await expect(isPendingSalesSheetOrder(order.externalReference)).resolves.toBe(false);
  });
});

describe("PR 2 monotonic deducted persistence", () => {
  it("PR2-CONC-LOCK-TTL covers both Sheet update attempts plus a safety margin", () => {
    expect(ORDER_WRITE_LOCK_TTL_SECONDS).toBe(75);
    expect(ORDER_WRITE_LOCK_TTL_SECONDS * 1000).toBeGreaterThanOrEqual(
      48_800 + ORDER_WRITE_LOCK_MINIMUM_MARGIN_MS
    );
    expect(orderWriteLockCoversWorstCaseSheetUpdate()).toBe(true);
  });

  it("PR2-CONC-06 concurrent real and deduped approvals finish deducted with one authoritative decrement", async () => {
    const firstAttemptEntered = deferred();
    const releaseFirstAttempt = deferred();
    let callCount = 0;
    let authoritativeDecrements = 0;
    vi.mocked(decrementProductsStockInSheet).mockImplementation(async () => {
      callCount += 1;
      if (callCount === 1) {
        authoritativeDecrements += 1;
        firstAttemptEntered.resolve();
        await releaseFirstAttempt.promise;
        return {
          deduped: false,
          updated: [{ productId: "p1", previousQty: 2, nextQty: 1 }],
        };
      }
      return { deduped: true, updated: [] };
    });
    const order = makeOrder();
    await createOrder(order);

    const firstApproval = approve(order);
    await firstAttemptEntered.promise;
    const secondApproval = approve(order);
    await secondApproval;
    releaseFirstAttempt.resolve();
    await firstApproval;

    expect(await getOrder(order.externalReference)).toMatchObject({
      paymentStatus: "confirmed",
      inventoryStatus: "deducted",
      stockDeductedAt: expect.any(Number),
    });
    expect(decrementProductsStockInSheet).toHaveBeenCalledTimes(2);
    expect(authoritativeDecrements).toBe(1);
  });

  it("PR2-CONC-07 timeout after commit cannot overwrite a later deduped deduction", async () => {
    const timeoutAttemptEntered = deferred();
    const releaseTimeout = deferred();
    let callCount = 0;
    let authoritativeDecrements = 0;
    vi.mocked(decrementProductsStockInSheet).mockImplementation(async () => {
      callCount += 1;
      if (callCount === 1) {
        authoritativeDecrements += 1;
        timeoutAttemptEntered.resolve();
        await releaseTimeout.promise;
        throw timeoutAfterCommit();
      }
      return { deduped: true, updated: [] };
    });
    const order = makeOrder();
    await createOrder(order);

    const timeoutApproval = approve(order);
    await timeoutAttemptEntered.promise;
    const dedupedApproval = approve(order);
    await dedupedApproval;
    releaseTimeout.resolve();
    await timeoutApproval;

    expect(await getOrder(order.externalReference)).toMatchObject({
      inventoryStatus: "deducted",
      stockDeductedAt: expect.any(Number),
    });
    expect(authoritativeDecrements).toBe(1);
  });

  it("PR2-CONC-08 an earlier temporary error followed by dedupe finishes deducted", async () => {
    const errorAttemptEntered = deferred();
    const releaseError = deferred();
    const dedupeAttemptEntered = deferred();
    const releaseDedupe = deferred();
    let callCount = 0;
    vi.mocked(decrementProductsStockInSheet).mockImplementation(async () => {
      callCount += 1;
      if (callCount === 1) {
        errorAttemptEntered.resolve();
        await releaseError.promise;
        throw timeoutAfterCommit();
      }
      dedupeAttemptEntered.resolve();
      await releaseDedupe.promise;
      return { deduped: true, updated: [] };
    });
    const order = makeOrder();
    await createOrder(order);

    const errorApproval = approve(order);
    await errorAttemptEntered.promise;
    const dedupedApproval = approve(order);
    await dedupeAttemptEntered.promise;
    releaseError.resolve();
    await errorApproval;
    expect((await getOrder(order.externalReference))?.inventoryStatus).toBe("error");
    releaseDedupe.resolve();
    await dedupedApproval;

    expect(await getOrder(order.externalReference)).toMatchObject({
      inventoryStatus: "deducted",
      stockDeductedAt: expect.any(Number),
    });
  });

  it("PR2-CONC-09 a late conflict patch cannot degrade deducted", async () => {
    const order = makeOrder({ inventoryStatus: "deducted", stockDeductedAt: 100 });
    await createOrder(order);

    const updated = await updateOrder(order.externalReference, {
      inventoryStatus: "conflict",
      inventoryIssueCode: "INSUFFICIENT_STOCK",
      inventoryIssueAt: 200,
      stockDeductedAt: undefined,
    });

    expect(updated).toMatchObject({ inventoryStatus: "deducted", stockDeductedAt: 100 });
    expect(updated?.inventoryIssueCode).toBeUndefined();
  });

  it("PR2-CONC-10 a late technical error patch cannot degrade deducted", async () => {
    const order = makeOrder({ inventoryStatus: "deducted", stockDeductedAt: 101 });
    await createOrder(order);

    await updateOrder(order.externalReference, {
      inventoryStatus: "error",
      inventoryIssueCode: "SHEETS_TIMEOUT",
      inventoryIssueAt: 201,
      stockDeductedAt: undefined,
    });

    expect(await getOrder(order.externalReference)).toMatchObject({
      inventoryStatus: "deducted",
      stockDeductedAt: 101,
    });
  });

  it("PR2-CONC-11 a late pending patch cannot erase deducted evidence", async () => {
    const order = makeOrder({ inventoryStatus: "deducted", stockDeductedAt: 102 });
    await createOrder(order);

    await updateOrder(order.externalReference, {
      inventoryStatus: "pending",
      stockDeductedAt: undefined,
    });

    expect(await getOrder(order.externalReference)).toMatchObject({
      inventoryStatus: "deducted",
      stockDeductedAt: 102,
    });
  });

  it("PR2-CONC-12 different orders do not share a global write lock", async () => {
    const firstSheetSyncEntered = deferred();
    const releaseFirstSheetSync = deferred();
    const firstOrder = makeOrder();
    const secondOrder = makeOrder();
    await createOrder(firstOrder);
    await createOrder(secondOrder);
    vi.mocked(updateOrderRowInSalesSheet).mockImplementation(async (orderId) => {
      if (orderId === firstOrder.externalReference) {
        firstSheetSyncEntered.resolve();
        await releaseFirstSheetSync.promise;
      }
    });

    const firstUpdate = updateOrder(
      firstOrder.externalReference,
      { mpStatus: "first" },
      { paymentAuthority: "system" }
    );
    await firstSheetSyncEntered.promise;
    const secondUpdate = updateOrder(
      secondOrder.externalReference,
      { mpStatus: "second" },
      { paymentAuthority: "system" }
    );
    await expect(secondUpdate).resolves.toMatchObject({ mpStatus: "second" });
    releaseFirstSheetSync.resolve();
    await firstUpdate;
  });

  it("PR2-CONC-13 admin retry concurrent with approval decrements once and finishes deducted", async () => {
    const retryAttemptEntered = deferred();
    const releaseRetry = deferred();
    let authoritativeDecrements = 0;
    vi.mocked(decrementProductsStockInSheet).mockImplementationOnce(async () => {
      authoritativeDecrements += 1;
      retryAttemptEntered.resolve();
      await releaseRetry.promise;
      return {
        deduped: false,
        updated: [{ productId: "p1", previousQty: 2, nextQty: 1 }],
      };
    });
    const order = makeOrder({
      status: "approved",
      paymentStatus: "confirmed",
      inventoryStatus: "error",
      inventoryIssueCode: "SHEETS_TIMEOUT",
      inventoryIssueAt: 123,
    });
    await createOrder(order);

    const retry = retryPaidOrderInventory(order.externalReference);
    await retryAttemptEntered.promise;
    const webhookApproval = markApproved(order.externalReference, {
      paymentId: "webhook-payment",
      mpStatus: "approved",
    }, "mp_authoritative");
    await webhookApproval;
    releaseRetry.resolve();
    await retry;

    expect(await getOrder(order.externalReference)).toMatchObject({
      paymentStatus: "confirmed",
      inventoryStatus: "deducted",
      stockDeductedAt: expect.any(Number),
    });
    expect(decrementProductsStockInSheet).toHaveBeenCalledTimes(1);
    expect(authoritativeDecrements).toBe(1);
  });

  it("PR2-CONC-14 verify-payment and webhook concurrency finishes confirmed and deducted", async () => {
    const verifyAttemptEntered = deferred();
    const releaseVerifyTimeout = deferred();
    let callCount = 0;
    let authoritativeDecrements = 0;
    vi.mocked(decrementProductsStockInSheet).mockImplementation(async () => {
      callCount += 1;
      if (callCount === 1) {
        authoritativeDecrements += 1;
        verifyAttemptEntered.resolve();
        await releaseVerifyTimeout.promise;
        throw timeoutAfterCommit();
      }
      return { deduped: true, updated: [] };
    });
    const order = makeOrder();
    await createOrder(order);

    const verifyPayment = markApproved(order.externalReference, {
      paymentId: "verify-payment-id",
      mpStatus: "approved",
    }, "mp_authoritative");
    await verifyAttemptEntered.promise;
    const webhook = markApproved(order.externalReference, {
      paymentId: "webhook-payment-id",
      mpStatus: "approved",
    }, "mp_authoritative");
    await webhook;
    releaseVerifyTimeout.resolve();
    await verifyPayment;

    expect(await getOrder(order.externalReference)).toMatchObject({
      paymentStatus: "confirmed",
      inventoryStatus: "deducted",
      stockDeductedAt: expect.any(Number),
    });
    expect(authoritativeDecrements).toBe(1);
  });

  it("PR2-CONC-15 refund cancellation and chargeback preserve deducted history", async () => {
    const transitions = [
      [markRefunded, "refunded"],
      [markCancelled, "cancelled"],
      [markChargedBack, "charged_back"],
    ] as const;

    for (const [transition, status] of transitions) {
      const order = makeOrder({
        status: "approved",
        paymentStatus: "confirmed",
        inventoryStatus: "deducted",
        stockDeductedAt: 500,
      });
      await createOrder(order);
      await transition(
        order.externalReference,
        { paymentId: "pay", mpStatus: status },
        "mp_authoritative"
      );
      expect(await getOrder(order.externalReference)).toMatchObject({
        inventoryStatus: "deducted",
        stockDeductedAt: 500,
      });
    }
    expect(decrementProductsStockInSheet).not.toHaveBeenCalled();
  });
});

describe("AUD3 H07-C1 atomic Admin status intent", () => {
  it("H07C1-KV-01 rejects a stale reopen and preserves trusted completion", async () => {
    const order = makeOrder({
      status: "approved",
      paymentStatus: "confirmed",
      shippingStatus: "completed",
      paymentMethod: "cash",
      inventoryStatus: "deducted",
      stockDeductedAt: 10,
    });
    await createOrder(order);

    await expect(applyAdminOrderStatusIntent(order.externalReference, {
      changedFields: ["shippingStatus"],
      expectedShippingStatus: "in_process",
      requestedShippingStatus: "in_process",
    })).rejects.toBeInstanceOf(AdminOrderStateChangedError);
    expect((await getOrder(order.externalReference))?.shippingStatus).toBe("completed");
  });

  it("H07C1-SHIP-01 ignores stale payment context for shipping-only intent", async () => {
    const order = makeOrder({ paymentMethod: "cash" });
    await createOrder(order);
    await markApproved(order.externalReference, {
      paymentId: "provider-confirmed",
      mpStatus: "approved",
      approvedAt: 20,
    }, "system");

    const result = await applyAdminOrderStatusIntent(order.externalReference, {
      changedFields: ["shippingStatus"],
      expectedShippingStatus: "in_process",
      requestedShippingStatus: "completed",
    });
    expect(result?.order).toMatchObject({
      paymentStatus: "confirmed",
      shippingStatus: "completed",
      inventoryStatus: "deducted",
    });
  });

  it("H07C1-KV-03/CASH-01 serializes concurrent confirmations with canonical metadata", async () => {
    const order = makeOrder({ paymentMethod: "cash" });
    await createOrder(order);
    const intent = {
      changedFields: ["paymentStatus" as const],
      expectedPaymentStatus: "pending" as const,
      requestedPaymentStatus: "confirmed" as const,
    };

    const [first, second] = await Promise.all([
      applyAdminOrderStatusIntent(order.externalReference, intent),
      applyAdminOrderStatusIntent(order.externalReference, intent),
    ]);
    const persisted = await getOrder(order.externalReference);
    expect([first?.outcome, second?.outcome].sort()).toEqual([
      "applied",
      "idempotent_replay",
    ]);
    expect(decrementProductsStockInSheet).toHaveBeenCalledTimes(1);
    expect(persisted).toMatchObject({
      paymentStatus: "confirmed",
      mpPaymentId: `manual-${order.externalReference}`,
      approvedAt: expect.any(Number),
      inventoryStatus: "deducted",
    });
    expect(first?.order.mpPaymentId).toBe(second?.order.mpPaymentId);
    expect(first?.order.approvedAt).toBe(second?.order.approvedAt);
  });

  it("H07C1-KV-04 returns a shipping response-loss retry as an inert replay", async () => {
    const order = makeOrder({
      status: "approved",
      paymentStatus: "confirmed",
      paymentMethod: "cash",
      inventoryStatus: "deducted",
      stockDeductedAt: 10,
    });
    await createOrder(order);
    const intent = {
      changedFields: ["shippingStatus" as const],
      expectedShippingStatus: "in_process" as const,
      requestedShippingStatus: "completed" as const,
    };
    expect((await applyAdminOrderStatusIntent(order.externalReference, intent))?.outcome).toBe("applied");
    expect((await applyAdminOrderStatusIntent(order.externalReference, intent))?.outcome).toBe("idempotent_replay");
  });

  it("H07C1-KV-05 rejects the whole multi-field intent before inventory when one field conflicts", async () => {
    const order = makeOrder({ paymentMethod: "cash", shippingStatus: "completed" });
    await createOrder(order);
    await expect(applyAdminOrderStatusIntent(order.externalReference, {
      changedFields: ["paymentStatus", "shippingStatus"],
      expectedPaymentStatus: "pending",
      requestedPaymentStatus: "confirmed",
      expectedShippingStatus: "in_process",
      requestedShippingStatus: "in_process",
    })).rejects.toBeInstanceOf(AdminOrderStateChangedError);
    expect(decrementProductsStockInSheet).not.toHaveBeenCalled();
    expect((await getOrder(order.externalReference))?.paymentStatus).toBe("pending");
  });
});

describe("AUD3 H07-B locked payment authority", () => {
  it.each(["cash", "transfer"] as const)(
    "AUD3-H07B-STORE-01 allows Admin %s pending to confirmed",
    async (paymentMethod) => {
      const order = makeOrder({ paymentMethod });
      await createOrder(order);

      const updated = await markApproved(
        order.externalReference,
        { paymentId: "manual-1", mpStatus: "manual_confirmed", approvedAt: 200 },
        "admin_manual"
      );

      expect(updated).toMatchObject({
        status: "approved",
        paymentStatus: "confirmed",
        approvedAt: 200,
        receiptOutboxVersion: 1,
      });
    }
  );

  it("AUD3-H07B-STORE-02 blocks direct Admin MP confirmation before inventory", async () => {
    const order = makeOrder({ paymentMethod: "mercadopago" });
    await createOrder(order);

    await expect(markApproved(
      order.externalReference,
      { paymentId: "mp-1", mpStatus: "approved" },
      "admin_manual"
    )).rejects.toMatchObject({
      reason: "PAYMENT_PROVIDER_AUTHORITY_REQUIRED",
    });
    expect(decrementProductsStockInSheet).not.toHaveBeenCalled();
    await expect(getOrder(order.externalReference)).resolves.toMatchObject({
      paymentStatus: "pending",
    });
  });

  it("AUD3-H07B-REPLAY-01 keeps approvedAt and skips inventory on Admin replay", async () => {
    const order = makeOrder({
      paymentMethod: "cash",
      status: "approved",
      paymentStatus: "confirmed",
      approvedAt: 100,
      inventoryStatus: "pending",
      receiptOutboxVersion: 1,
    });
    await createOrder(order);

    const replay = await markApproved(
      order.externalReference,
      { paymentId: "manual-new", mpStatus: "manual_confirmed", approvedAt: 300 },
      "admin_manual"
    );

    expect(replay).toMatchObject({ approvedAt: 100, paymentStatus: "confirmed" });
    expect(replay?.mpPaymentId).toBe(order.mpPaymentId);
    expect(decrementProductsStockInSheet).not.toHaveBeenCalled();
  });

  it("AUD3-H07B-STORE-03 rejects a financial patch without authority", async () => {
    const order = makeOrder({ paymentMethod: "cash" });
    await createOrder(order);

    await expect(updateOrder(order.externalReference, {
      status: "approved",
      paymentStatus: "confirmed",
    })).rejects.toMatchObject({ reason: "PAYMENT_TRANSITION_AUTHORITY_REQUIRED" });
  });

  it("AUD3-H07B-STORE-04 blocks an Admin metadata-only financial bypass", async () => {
    const order = makeOrder({ paymentMethod: "mercadopago" });
    await createOrder(order);

    await expect(updateOrder(
      order.externalReference,
      { mpStatus: "refunded" },
      { paymentAuthority: "admin_manual" }
    )).rejects.toMatchObject({ reason: "PAYMENT_TRANSITION_NOT_ALLOWED" });
  });

  it("AUD3-H07B-STALE-01 blocks stale pending after provider approval", async () => {
    const order = makeOrder({ paymentMethod: "mercadopago" });
    await createOrder(order);
    await reconcileMercadoPagoPaymentObservationBatch(order.externalReference, [{
      paymentId: "mp-approved",
      status: "approved",
      amount: order.total,
      currency: "ARS",
      observedAt: 100,
    }]);

    await expect(assertAdminPaymentTransitionRequest(
      order.externalReference,
      "pending"
    )).rejects.toMatchObject({ reason: "PAYMENT_CONFIRMED_CANNOT_BE_DOWNGRADED" });
  });

  it.each(["refunded", "charged_back"] as const)(
    "AUD3-H07B-STALE-02/03 blocks stale confirmed after %s",
    async (terminalStatus) => {
      const order = makeOrder({
        paymentMethod: "mercadopago",
        status: terminalStatus,
        paymentStatus: terminalStatus,
      });
      await createOrder(order);

      await expect(assertAdminPaymentTransitionRequest(
        order.externalReference,
        "confirmed"
      )).rejects.toMatchObject({ reason: "PAYMENT_TERMINAL_REQUIRES_CORRECTION" });
    }
  );

  it("AUD3-H07B-STALE-04 blocks a stale cash downgrade after another tab confirms", async () => {
    const order = makeOrder({ paymentMethod: "cash" });
    await createOrder(order);
    await markApproved(
      order.externalReference,
      { paymentId: "manual-a", mpStatus: "manual_confirmed" },
      "admin_manual"
    );

    await expect(assertAdminPaymentTransitionRequest(
      order.externalReference,
      "pending"
    )).rejects.toMatchObject({ reason: "PAYMENT_CONFIRMED_CANNOT_BE_DOWNGRADED" });
  });
});

describe("AUD3 H07-D1 serialized KV-derived sales projections", () => {
  const enrolledOrder = (patch: Partial<Order> = {}) =>
    makeOrder({
      status: "approved",
      paymentStatus: "confirmed",
      shippingStatus: "in_process",
      inventoryStatus: "deducted",
      stockDeductedAt: 100,
      approvedAt: 90,
      receiptOutboxVersion: 1,
      salesSheetDeferredUntilApprovedAt: 1,
      salesSheetSyncFailedAt: 2,
      ...patch,
    });

  const confirmManualPayment = (externalReference: string) =>
    applyAdminOrderStatusIntent(externalReference, {
      changedFields: ["paymentStatus"],
      expectedPaymentStatus: "pending",
      requestedPaymentStatus: "confirmed",
    });

  const runRecoveryAfterNormalMutation = async (
    order: Order,
    mutate: () => Promise<unknown>,
  ) => {
    await createOrder(order, { syncSheet: false });
    await addPendingSalesSheetOrder(order.externalReference);
    const recoveryReached = deferred();
    const releaseRecovery = deferred();
    const recovery = recoverPendingSalesSheetOrder(
      order.externalReference,
      { rowExists: true },
      {
        isPending: async () => {
          recoveryReached.resolve();
          await releaseRecovery.promise;
          return true;
        },
      },
    );
    await recoveryReached.promise;
    await mutate();
    releaseRecovery.resolve();
    await expect(recovery).resolves.toMatchObject({ outcome: "reconciled" });
    return getOrder(order.externalReference);
  };

  const boundaryCases: Array<{
    name: string;
    order: () => Order;
    mutate: (order: Order) => Promise<unknown>;
    expected: Partial<Order>;
  }> = [
    {
      name: "H07D1-BND-01 projects O2 after recovery captured earlier workflow state",
      order: () => enrolledOrder({ mpPreferenceId: "pref-o1" }),
      mutate: (order) => updateOrder(order.externalReference, { mpPreferenceId: "pref-o2" }),
      expected: { mpPreferenceId: "pref-o2" },
    },
    {
      name: "H07D1-BND-02 cannot reopen completed shipping to in_process",
      order: () => enrolledOrder(),
      mutate: (order) => updateOrder(order.externalReference, { shippingStatus: "completed" }),
      expected: { shippingStatus: "completed" },
    },
    {
      name: "H07D1-BND-03 cannot regress a provider refund to confirmed",
      order: () => enrolledOrder(),
      mutate: (order) =>
        markRefunded(
          order.externalReference,
          { paymentId: "pay-refund", mpStatus: "refunded" },
          "mp_authoritative",
        ),
      expected: { status: "refunded", paymentStatus: "refunded", mpStatus: "refunded" },
    },
    {
      name: "H07D1-BND-04 cannot regress a chargeback to confirmed",
      order: () => enrolledOrder(),
      mutate: (order) =>
        markChargedBack(
          order.externalReference,
          { paymentId: "pay-chargeback", mpStatus: "charged_back" },
          "mp_authoritative",
        ),
      expected: {
        status: "charged_back",
        paymentStatus: "charged_back",
        mpStatus: "charged_back",
      },
    },
    {
      name: "H07D1-BND-05 preserves one journal-backed inventory deduction",
      order: () => enrolledOrder({ inventoryStatus: "pending", stockDeductedAt: undefined }),
      mutate: (order) => retryPaidOrderInventory(order.externalReference),
      expected: { inventoryStatus: "deducted", stockDeductedAt: expect.any(Number) },
    },
    {
      name: "H07D1-BND-06 preserves current inventory conflict evidence",
      order: () => enrolledOrder({ inventoryStatus: "pending", stockDeductedAt: undefined }),
      mutate: async (order) => {
        vi.mocked(decrementProductsStockInSheet).mockRejectedValueOnce(
          new InventoryOperationError({ code: "INSUFFICIENT_STOCK", message: "insufficient" }),
        );
        return retryPaidOrderInventory(order.externalReference);
      },
      expected: {
        inventoryStatus: "conflict",
        inventoryIssueCode: "INSUFFICIENT_STOCK",
        inventoryIssueAt: expect.any(Number),
      },
    },
    {
      name: "H07D1-BND-07 preserves newer canonical MP metadata",
      order: () =>
        enrolledOrder({
          status: "created",
          paymentStatus: "pending",
          inventoryStatus: "pending",
          stockDeductedAt: undefined,
          approvedAt: undefined,
          mpPaymentId: undefined,
          mpStatus: undefined,
        }),
      mutate: (order) =>
        updateOrder(
          order.externalReference,
          {
            status: "approved",
            paymentStatus: "confirmed",
            mpPaymentId: "pay-o2",
            mpStatus: "approved",
            approvedAt: 300,
          },
          { paymentAuthority: "system" },
        ),
      expected: {
        paymentStatus: "confirmed",
        mpPaymentId: "pay-o2",
        mpStatus: "approved",
        approvedAt: 300,
      },
    },
    {
      name: "H07D1-BND-08 preserves current receipt enrollment and delivery markers",
      order: () => enrolledOrder({ receiptEmailSentAt: undefined }),
      mutate: (order) => updateOrder(order.externalReference, { receiptEmailSentAt: 400 }),
      expected: { receiptOutboxVersion: 1, receiptEmailSentAt: 400 },
    },
  ];

  it.each(boundaryCases)("$name", async ({ order: makeBoundaryOrder, mutate, expected }) => {
    const order = makeBoundaryOrder();
    const finalOrder = await runRecoveryAfterNormalMutation(order, () => mutate(order));

    expect(finalOrder).toMatchObject({
      ...expected,
      salesSheetSyncedAt: expect.any(Number),
      salesSheetSyncFailedAt: undefined,
    });
    const { status: expectedStatus, ...expectedSheetFields } = expected;
    const finalProjection = vi.mocked(updateOrderRowInSalesSheet).mock.calls.at(-1);
    expect(finalProjection?.[0]).toBe(order.externalReference);
    expect(finalProjection?.[1]).toMatchObject({
      ...(expectedStatus ? { orderStatus: expectedStatus } : {}),
      ...expectedSheetFields,
    });
    expect(await isPendingSalesSheetOrder(order.externalReference)).toBe(false);
    if (expected.inventoryStatus === "deducted" && order.inventoryStatus === "pending") {
      expect(decrementProductsStockInSheet).toHaveBeenCalledTimes(1);
    }
  });

  it("H07D1-BND-09 keeps the safe reverse interleaving serialized", async () => {
    const order = enrolledOrder({ mpPreferenceId: "pref-o1" });
    await createOrder(order, { syncSheet: false });
    await addPendingSalesSheetOrder(order.externalReference);
    const projectionEntered = deferred();
    const releaseProjection = deferred();
    vi.mocked(updateOrderRowInSalesSheet).mockImplementationOnce(async () => {
      projectionEntered.resolve();
      await releaseProjection.promise;
    });

    const recovery = recoverPendingSalesSheetOrder(order.externalReference, { rowExists: true });
    await projectionEntered.promise;
    let normalCompleted = false;
    const normal = updateOrder(order.externalReference, { mpPreferenceId: "pref-o2" }).then(() => {
      normalCompleted = true;
    });
    await Promise.resolve();
    expect(normalCompleted).toBe(false);
    releaseProjection.resolve();
    await Promise.all([recovery, normal]);

    await expect(getOrder(order.externalReference)).resolves.toMatchObject({
      mpPreferenceId: "pref-o2",
    });
    expect(vi.mocked(updateOrderRowInSalesSheet).mock.calls.at(-1)?.[1]).toMatchObject({
      mpPreferenceId: "pref-o2",
    });
  });

  it("H07D1-INDEX-01 serializes old recovery success before a newer projection failure", async () => {
    const order = enrolledOrder({ mpPreferenceId: "pref-o1" });
    await createOrder(order, { syncSheet: false });
    await addPendingSalesSheetOrder(order.externalReference);
    const removeEntered = deferred();
    const releaseRemove = deferred();
    const originalRemovePending = salesSheetSync.removePendingSalesSheetOrder;
    const removePendingSpy = vi
      .spyOn(salesSheetSync, "removePendingSalesSheetOrder")
      .mockImplementationOnce(async (orderId) => {
        removeEntered.resolve();
        await releaseRemove.promise;
        return originalRemovePending(orderId);
      });

    const recovery = recoverPendingSalesSheetOrder(order.externalReference, { rowExists: true });
    await removeEntered.promise;
    vi.mocked(updateOrderRowInSalesSheet).mockRejectedValueOnce(new Error("new O2 projection failed"));
    const newerMutation = updateOrder(order.externalReference, { mpPreferenceId: "pref-o2" });
    await Promise.resolve();
    await expect(getOrder(order.externalReference)).resolves.toMatchObject({
      mpPreferenceId: "pref-o1",
    });

    releaseRemove.resolve();
    await expect(recovery).resolves.toMatchObject({ outcome: "reconciled" });
    await expect(newerMutation).resolves.toMatchObject({ mpPreferenceId: "pref-o2" });
    removePendingSpy.mockRestore();

    await expect(getOrder(order.externalReference)).resolves.toMatchObject({
      mpPreferenceId: "pref-o2",
      salesSheetSyncFailedAt: expect.any(Number),
    });
    expect(await isPendingSalesSheetOrder(order.externalReference)).toBe(true);
  });

  it("H07D1-INDEX-02 cannot finish with a newer failure marker and an absent pending member", async () => {
    const order = enrolledOrder({ mpPreferenceId: "pref-o1" });
    await createOrder(order, { syncSheet: false });
    await addPendingSalesSheetOrder(order.externalReference);
    const removalCommitted = deferred();
    const releaseRemoveResponse = deferred();
    const originalRemovePending = salesSheetSync.removePendingSalesSheetOrder;
    const removePendingSpy = vi
      .spyOn(salesSheetSync, "removePendingSalesSheetOrder")
      .mockImplementationOnce(async (orderId) => {
        const removed = await originalRemovePending(orderId);
        removalCommitted.resolve();
        await releaseRemoveResponse.promise;
        return removed;
      });

    const recovery = recoverPendingSalesSheetOrder(order.externalReference, { rowExists: true });
    await removalCommitted.promise;
    expect(await isPendingSalesSheetOrder(order.externalReference)).toBe(false);
    vi.mocked(updateOrderRowInSalesSheet).mockRejectedValueOnce(new Error("new O2 projection failed"));
    const newerMutation = updateOrder(order.externalReference, { mpPreferenceId: "pref-o2" });
    await Promise.resolve();
    await expect(getOrder(order.externalReference)).resolves.toMatchObject({
      mpPreferenceId: "pref-o1",
    });

    releaseRemoveResponse.resolve();
    await Promise.all([recovery, newerMutation]);
    removePendingSpy.mockRestore();

    await expect(getOrder(order.externalReference)).resolves.toMatchObject({
      mpPreferenceId: "pref-o2",
      salesSheetSyncFailedAt: expect.any(Number),
    });
    expect(await isPendingSalesSheetOrder(order.externalReference)).toBe(true);
  });

  it("H07D1-INDEX-03 serializes stale not-eligible cleanup before later eligibility and failure", async () => {
    const order = makeOrder({
      paymentMethod: "cash",
      salesSheetDeferredUntilApprovedAt: 1,
    });
    await createOrder(order, { syncSheet: false });
    await addPendingSalesSheetOrder(order.externalReference);
    const removeEntered = deferred();
    const releaseRemove = deferred();
    const originalRemovePending = salesSheetSync.removePendingSalesSheetOrder;
    const removePendingSpy = vi
      .spyOn(salesSheetSync, "removePendingSalesSheetOrder")
      .mockImplementationOnce(async (orderId) => {
        removeEntered.resolve();
        await releaseRemove.promise;
        return originalRemovePending(orderId);
      });

    const recovery = recoverPendingSalesSheetOrder(order.externalReference, { rowExists: true });
    await removeEntered.promise;
    vi.mocked(updateOrderRowInSalesSheet).mockRejectedValueOnce(
      new Error("eligible projection failed"),
    );
    const confirmation = confirmManualPayment(order.externalReference);
    await Promise.resolve();
    expect(decrementProductsStockInSheet).not.toHaveBeenCalled();
    await expect(getOrder(order.externalReference)).resolves.toMatchObject({
      paymentStatus: "pending",
    });

    releaseRemove.resolve();
    await expect(recovery).resolves.toMatchObject({ outcome: "not_eligible" });
    await expect(confirmation).resolves.toMatchObject({
      order: { paymentStatus: "confirmed" },
    });
    removePendingSpy.mockRestore();

    expect(decrementProductsStockInSheet).toHaveBeenCalledTimes(1);
    await expect(getOrder(order.externalReference)).resolves.toMatchObject({
      paymentStatus: "confirmed",
      salesSheetSyncFailedAt: expect.any(Number),
    });
    expect(await isPendingSalesSheetOrder(order.externalReference)).toBe(true);
  });

  it("H07D1-INDEX-04 serializes missing-order cleanup before reconstruction and later failure", async () => {
    const reconstructed = enrolledOrder({
      externalReference: `h07d1-reconstructed-${Date.now()}-${sequence}`,
      mpPreferenceId: "pref-o1",
    });
    await addPendingSalesSheetOrder(reconstructed.externalReference);
    const removeEntered = deferred();
    const releaseRemove = deferred();
    const originalRemovePending = salesSheetSync.removePendingSalesSheetOrder;
    const removePendingSpy = vi
      .spyOn(salesSheetSync, "removePendingSalesSheetOrder")
      .mockImplementationOnce(async (orderId) => {
        removeEntered.resolve();
        await releaseRemove.promise;
        return originalRemovePending(orderId);
      });

    const recovery = recoverPendingSalesSheetOrder(reconstructed.externalReference, {
      rowExists: true,
    });
    await removeEntered.promise;
    const reconstruction = ensureOrderExists(reconstructed, { syncSheet: false });
    await Promise.resolve();
    await expect(getOrder(reconstructed.externalReference)).resolves.toBeNull();

    releaseRemove.resolve();
    await expect(recovery).resolves.toMatchObject({ outcome: "stale", order: null });
    await expect(reconstruction).resolves.toMatchObject({ created: true });
    removePendingSpy.mockRestore();

    vi.mocked(updateOrderRowInSalesSheet).mockRejectedValueOnce(
      new Error("reconstructed projection failed"),
    );
    await updateOrder(reconstructed.externalReference, { mpPreferenceId: "pref-o2" });
    await expect(getOrder(reconstructed.externalReference)).resolves.toMatchObject({
      mpPreferenceId: "pref-o2",
      salesSheetSyncFailedAt: expect.any(Number),
    });
    expect(await isPendingSalesSheetOrder(reconstructed.externalReference)).toBe(true);
  });

  it("H07D1-INDEX-05 restores pending membership after removal commits but its response is lost", async () => {
    const order = enrolledOrder();
    await createOrder(order, { syncSheet: false });
    await addPendingSalesSheetOrder(order.externalReference);
    const originalRemovePending = salesSheetSync.removePendingSalesSheetOrder;
    const removePendingSpy = vi
      .spyOn(salesSheetSync, "removePendingSalesSheetOrder")
      .mockImplementationOnce(async (orderId) => {
        await originalRemovePending(orderId);
        throw timeoutAfterCommit();
      });

    await expect(
      recoverPendingSalesSheetOrder(order.externalReference, { rowExists: true }),
    ).resolves.toMatchObject({ outcome: "pending" });
    removePendingSpy.mockRestore();

    await expect(getOrder(order.externalReference)).resolves.toMatchObject({
      salesSheetSyncedAt: expect.any(Number),
      salesSheetSyncFailedAt: undefined,
    });
    expect(await isPendingSalesSheetOrder(order.externalReference)).toBe(true);
  });

  it("H07D1-INDEX-06 serializes approved append cleanup before a newer projection failure", async () => {
    const order = enrolledOrder({ mpPreferenceId: "pref-o1" });
    await createOrder(order, { syncSheet: false });
    await addPendingSalesSheetOrder(order.externalReference);
    const removeEntered = deferred();
    const releaseRemove = deferred();
    const originalRemovePending = salesSheetSync.removePendingSalesSheetOrder;
    const removePendingSpy = vi
      .spyOn(salesSheetSync, "removePendingSalesSheetOrder")
      .mockImplementationOnce(async (orderId) => {
        removeEntered.resolve();
        await releaseRemove.promise;
        return originalRemovePending(orderId);
      });

    const durable = ensureOrderDurableInSalesSheet(order);
    await removeEntered.promise;
    vi.mocked(updateOrderRowInSalesSheet).mockRejectedValueOnce(new Error("new O2 projection failed"));
    const newerMutation = updateOrder(order.externalReference, { mpPreferenceId: "pref-o2" });
    await Promise.resolve();
    await expect(getOrder(order.externalReference)).resolves.toMatchObject({
      mpPreferenceId: "pref-o1",
    });

    releaseRemove.resolve();
    await expect(durable).resolves.toMatchObject({ synced: true });
    await newerMutation;
    removePendingSpy.mockRestore();

    await expect(getOrder(order.externalReference)).resolves.toMatchObject({
      mpPreferenceId: "pref-o2",
      salesSheetSyncFailedAt: expect.any(Number),
    });
    expect(await isPendingSalesSheetOrder(order.externalReference)).toBe(true);
  });

  it("H07D1-INDEX-07 keeps the real Admin pending cleanup inside Order serialization", async () => {
    const order = makeOrder({
      paymentMethod: "cash",
      salesSheetDeferredUntilApprovedAt: 1,
    });
    await createOrder(order, { syncSheet: false });
    await addPendingSalesSheetOrder(order.externalReference);
    const removeEntered = deferred();
    const releaseRemove = deferred();
    const originalRemovePending = salesSheetSync.removePendingSalesSheetOrder;
    const removePendingSpy = vi
      .spyOn(salesSheetSync, "removePendingSalesSheetOrder")
      .mockImplementationOnce(async (orderId) => {
        removeEntered.resolve();
        await releaseRemove.promise;
        return originalRemovePending(orderId);
      });

    const adminRead = getOrdersForAdminWithKvState({
      getSheetOrders: async () => [],
      listPendingOrderIds: async () => [order.externalReference],
    });
    await removeEntered.promise;
    vi.mocked(updateOrderRowInSalesSheet).mockRejectedValueOnce(
      new Error("eligible projection failed"),
    );
    const confirmation = confirmManualPayment(order.externalReference);
    await Promise.resolve();
    expect(decrementProductsStockInSheet).not.toHaveBeenCalled();

    releaseRemove.resolve();
    await expect(adminRead).resolves.toEqual([]);
    await expect(confirmation).resolves.toMatchObject({
      order: { paymentStatus: "confirmed" },
    });
    removePendingSpy.mockRestore();

    await expect(getOrder(order.externalReference)).resolves.toMatchObject({
      paymentStatus: "confirmed",
      salesSheetSyncFailedAt: expect.any(Number),
    });
    expect(await isPendingSalesSheetOrder(order.externalReference)).toBe(true);
  });

  it("H07D1-APPEND-01 does not bind a deduped append as projection success", async () => {
    const order = enrolledOrder();
    await createOrder(order, { syncSheet: false });
    await addPendingSalesSheetOrder(order.externalReference);
    vi.mocked(appendOrderToSalesSheet).mockResolvedValueOnce({ deduped: true });

    const result = await reconcileCurrentOrderSalesProjection(order.externalReference, {
      rowExists: false,
      requirePending: true,
    });

    expect(result.outcome).toBe("deduped");
    expect(result.order?.salesSheetSyncFailedAt).toBe(2);
    expect(result.order?.salesSheetSyncedAt).toBeUndefined();
    expect(await isPendingSalesSheetOrder(order.externalReference)).toBe(true);
  });

  it("H07D1-CRASH-01 retries current O2 after Sheet success and marker persistence failure", async () => {
    const order = enrolledOrder({ mpPreferenceId: "pref-o1" });
    await createOrder(order, { syncSheet: false });
    await addPendingSalesSheetOrder(order.externalReference);
    const originalSetJson = kv.setJson;
    const setJsonSpy = vi
      .spyOn(kv, "setJson")
      .mockRejectedValueOnce(new Error("KV marker write unavailable"))
      .mockImplementation(originalSetJson);

    const first = await reconcileCurrentOrderSalesProjection(order.externalReference, {
      rowExists: true,
      requirePending: true,
    });
    setJsonSpy.mockRestore();

    expect(first).toMatchObject({ outcome: "failed" });
    expect(await isPendingSalesSheetOrder(order.externalReference)).toBe(true);
    await updateOrder(order.externalReference, { mpPreferenceId: "pref-o2" });
    await expect(
      recoverPendingSalesSheetOrder(order.externalReference, { rowExists: true }),
    ).resolves.toMatchObject({ outcome: "reconciled" });
    expect(vi.mocked(updateOrderRowInSalesSheet).mock.calls.at(-1)?.[1]).toMatchObject({
      mpPreferenceId: "pref-o2",
    });
    await expect(getOrder(order.externalReference)).resolves.toMatchObject({
      mpPreferenceId: "pref-o2",
      salesSheetSyncedAt: expect.any(Number),
      salesSheetSyncFailedAt: undefined,
    });
  });

  it("H07D1-CRASH-02 retries current O2 after marker success and index removal failure", async () => {
    const order = enrolledOrder({ mpPreferenceId: "pref-o1" });
    await createOrder(order, { syncSheet: false });
    await addPendingSalesSheetOrder(order.externalReference);
    const originalRemovePending = salesSheetSync.removePendingSalesSheetOrder;
    const removePendingSpy = vi
      .spyOn(salesSheetSync, "removePendingSalesSheetOrder")
      .mockRejectedValueOnce(new Error("pending index unavailable"))
      .mockImplementation(originalRemovePending);

    await expect(
      recoverPendingSalesSheetOrder(order.externalReference, { rowExists: true }),
    ).resolves.toMatchObject({ outcome: "pending" });
    removePendingSpy.mockRestore();
    await expect(getOrder(order.externalReference)).resolves.toMatchObject({
      salesSheetSyncedAt: expect.any(Number),
      salesSheetSyncFailedAt: undefined,
    });

    await updateOrder(order.externalReference, { mpPreferenceId: "pref-o2" });
    await expect(
      recoverPendingSalesSheetOrder(order.externalReference, { rowExists: true }),
    ).resolves.toMatchObject({ outcome: "reconciled" });
    expect(vi.mocked(updateOrderRowInSalesSheet).mock.calls.at(-1)?.[1]).toMatchObject({
      mpPreferenceId: "pref-o2",
    });
    expect(await isPendingSalesSheetOrder(order.externalReference)).toBe(false);
  });

  it("H07D1-DURABLE-01 final durable projection ignores caller O1", async () => {
    const order = enrolledOrder({ salesSheetSyncedAt: undefined, mpPreferenceId: "pref-o1" });
    await createOrder(order, { syncSheet: false });
    const appendEntered = deferred();
    const releaseAppend = deferred();
    vi.mocked(appendOrderToSalesSheet).mockImplementationOnce(async () => {
      appendEntered.resolve();
      await releaseAppend.promise;
      return { deduped: false };
    });

    const durable = ensureOrderDurableInSalesSheet(order);
    await appendEntered.promise;
    await updateOrder(order.externalReference, { mpPreferenceId: "pref-o2" });
    releaseAppend.resolve();
    await expect(durable).resolves.toMatchObject({
      synced: true,
      order: { mpPreferenceId: "pref-o2" },
    });
    expect(vi.mocked(updateOrderRowInSalesSheet).mock.calls.at(-1)?.[1]).toMatchObject({
      mpPreferenceId: "pref-o2",
    });
  });

  it("H07D1-RECOVERY-01 overlapping workers and a normal mutation cannot end stale", async () => {
    const order = enrolledOrder({ mpPreferenceId: "pref-o1" });
    await createOrder(order, { syncSheet: false });
    await addPendingSalesSheetOrder(order.externalReference);
    const firstProjectionEntered = deferred();
    const releaseFirstProjection = deferred();
    vi.mocked(updateOrderRowInSalesSheet).mockImplementationOnce(async () => {
      firstProjectionEntered.resolve();
      await releaseFirstProjection.promise;
    });

    const firstWorker = reconcileCurrentOrderSalesProjection(order.externalReference, {
      rowExists: true,
      requirePending: true,
    });
    await firstProjectionEntered.promise;
    const secondWorker = reconcileCurrentOrderSalesProjection(order.externalReference, {
      rowExists: true,
      requirePending: true,
    });
    const normal = updateOrder(order.externalReference, { mpPreferenceId: "pref-o2" });
    releaseFirstProjection.resolve();
    await Promise.all([firstWorker, secondWorker, normal]);

    await expect(getOrder(order.externalReference)).resolves.toMatchObject({
      mpPreferenceId: "pref-o2",
    });
    expect(vi.mocked(updateOrderRowInSalesSheet).mock.calls.at(-1)?.[1]).toMatchObject({
      mpPreferenceId: "pref-o2",
    });
  });

  it("selective current-state projection holds the normal lock through its Sheet write", async () => {
    const order = enrolledOrder({ mpPreferenceId: "pref-o1" });
    await createOrder(order, { syncSheet: false });
    const projectionEntered = deferred();
    const releaseProjection = deferred();
    vi.mocked(updateOrderRowInSalesSheet).mockImplementationOnce(async () => {
      projectionEntered.resolve();
      await releaseProjection.promise;
    });

    const projection = projectCurrentOrderSalesState(order.externalReference, (current) => ({
      mpPreferenceId: current.mpPreferenceId,
      updatedAt: current.updatedAt,
    }));
    await projectionEntered.promise;
    const normal = updateOrder(order.externalReference, { mpPreferenceId: "pref-o2" });
    releaseProjection.resolve();
    await Promise.all([projection, normal]);

    expect(vi.mocked(updateOrderRowInSalesSheet).mock.calls.at(-1)?.[1]).toMatchObject({
      mpPreferenceId: "pref-o2",
    });
  });
});

describe("AUD3 H07-D2A KV absence authority serialization", () => {
  const recoveryEvent = (order: Order): RecoveryPaymentEvent => ({
    eventKey: `event-${order.externalReference}`,
    paymentId: `payment-${order.externalReference}`,
    externalReference: order.externalReference,
    financialStatus: "approved",
    amount: order.total,
    currency: order.currency,
    observedAt: new Date(order.createdAt + 1000).toISOString(),
    source: "webhook",
    schemaVersion: 1,
    snapshotHash: "a".repeat(64),
    validationState: "validated",
    processingState: "pending",
    attemptCount: 0,
    updatedAt: new Date(order.createdAt + 1000).toISOString(),
  });

  const authorityEvidence = (order: Order) => ({
    paymentEvents: [recoveryEvent(order)],
    receiptEventExists: false,
  });

  const row = (order: Order): AdminOrderSheetRow => ({
    orderId: order.externalReference,
    createdAt: new Date(order.createdAt).toISOString(),
    createdAtMs: order.createdAt,
    customerName: "Sheet",
    whatsapp: "",
    email: "",
    total: order.total,
    currency: "ARS",
    paymentStatus: "confirmed",
    shippingStatus: "in_process",
    inventoryStatus: "pending",
    inventoryIssueCode: "",
    inventoryIssueAt: "",
    stockDeductedAt: "",
    paymentMethod: "mercadopago",
    deliveryMethod: order.deliveryMethod,
    items: order.items,
    itemsSummary: "1x Producto",
    notes: "",
    receiptEmailSentAt: "",
    raw: {
      nro_de_compra: order.externalReference,
      fecha: new Date(order.createdAt).toISOString(),
      total: order.total,
      currency: "ARS",
      estado_de_pago: "Confirmado",
      estado_de_envio: "En proceso",
      payment_method_code: "mercadopago",
      delivery_method_code: order.deliveryMethod,
    },
  });

  it("H07D2-KVABS-01 publishes and projects completed without an in_process seed", async () => {
    const order = makeOrder();
    const completedRow = {
      ...row(order),
      shippingStatus: "completed" as const,
      raw: { ...row(order).raw, estado_de_envio: "Finalizado" },
    };
    vi.mocked(getUniqueOrderRowById).mockResolvedValue({
      outcome: "unique",
      order: completedRow,
    });
    vi.mocked(decrementProductsStockInSheet).mockResolvedValue({ deduped: true, updated: [] });

    const reconstructed = await reconstructOrderFromAuthorityEvidence(
      order,
      authorityEvidence(order),
    );
    expect(reconstructed.order).toMatchObject({
      paymentStatus: "confirmed",
      inventoryStatus: "deducted",
      shippingStatus: "completed",
    });
    await expect(getOrder(order.externalReference)).resolves.toMatchObject({
      shippingStatus: "completed",
    });

    await expect(reconcileCurrentOrderSalesProjection(order.externalReference, {
      rowExists: true,
    })).resolves.toMatchObject({ outcome: "projected" });
    expect(updateOrderRowInSalesSheet).toHaveBeenCalledWith(
      order.externalReference,
      expect.objectContaining({ shippingStatus: "completed" }),
    );
  });

  it("H07D2-RACE-01 lets fallback commit before reconstruction publishes one merged candidate", async () => {
    const order = makeOrder();
    const fallbackEntered = deferred();
    const releaseFallback = deferred();
    let currentRow = row(order);
    vi.mocked(getUniqueOrderRowById).mockImplementation(async () => ({
      outcome: "unique",
      order: currentRow,
    }));
    vi.mocked(decrementProductsStockInSheet).mockResolvedValue({ deduped: true, updated: [] });

    const fallback = runMissingOrderSheetFallback(order.externalReference, async () => {
      fallbackEntered.resolve();
      await releaseFallback.promise;
      currentRow = { ...currentRow, paymentStatus: "confirmed" };
      return "committed";
    });
    await fallbackEntered.promise;
    const reconstruction = reconstructOrderFromAuthorityEvidence(order, authorityEvidence(order));
    await expect(getOrder(order.externalReference)).resolves.toBeNull();
    releaseFallback.resolve();

    await expect(fallback).resolves.toEqual({ outcome: "sheet_fallback", result: "committed" });
    await expect(reconstruction).resolves.toMatchObject({
      created: true,
      order: { paymentStatus: "confirmed", inventoryStatus: "deducted" },
    });
  });

  it("H07D2-RACE-02 suppresses a stale fallback after reconstruction wins the lock", async () => {
    const order = makeOrder();
    const lookupEntered = deferred();
    const releaseLookup = deferred();
    vi.mocked(getUniqueOrderRowById).mockImplementationOnce(async () => {
      lookupEntered.resolve();
      await releaseLookup.promise;
      return { outcome: "unique", order: row(order) };
    });
    vi.mocked(decrementProductsStockInSheet).mockResolvedValue({ deduped: true, updated: [] });
    const reconstruction = reconstructOrderFromAuthorityEvidence(order, authorityEvidence(order));
    await lookupEntered.promise;
    const sheetFallback = vi.fn(async () => "must-not-run");
    const fallback = runMissingOrderSheetFallback(order.externalReference, sheetFallback);
    releaseLookup.resolve();

    await expect(reconstruction).resolves.toMatchObject({ created: true });
    await expect(fallback).resolves.toEqual({ outcome: "kv_authority_returned" });
    expect(sheetFallback).not.toHaveBeenCalled();
  });

  it("H07D2-KVERR-01 fails closed without invoking the Sheet fallback", async () => {
    const order = makeOrder();
    const sheetFallback = vi.fn(async () => "must-not-run");
    const getSpy = vi.spyOn(kv, "getJson").mockRejectedValueOnce(new Error("KV unavailable"));
    await expect(
      runMissingOrderSheetFallback(order.externalReference, sheetFallback),
    ).rejects.toThrow("KV unavailable");
    expect(sheetFallback).not.toHaveBeenCalled();
    getSpy.mockRestore();
  });

  it("H07D2-MALFORMED-KV-01 does not treat an incoherent KV value as absence", async () => {
    const order = makeOrder();
    await setJson(`es:order:${order.externalReference}`, { externalReference: order.externalReference }, 60);
    const sheetFallback = vi.fn(async () => "must-not-run");
    await expect(
      runMissingOrderSheetFallback(order.externalReference, sheetFallback),
    ).rejects.toMatchObject({ code: "ORDER_AUTHORITY_MALFORMED_KV_ORDER" });
    expect(sheetFallback).not.toHaveBeenCalled();
  });

  it("H07D2-DUP-01 rejects duplicate ventas rows before the first KV claim", async () => {
    const order = makeOrder();
    vi.mocked(getUniqueOrderRowById).mockResolvedValue({
      outcome: "duplicate",
      order: null,
      count: 2,
    });
    await expect(
      reconstructOrderFromAuthorityEvidence(order, authorityEvidence(order)),
    ).rejects.toMatchObject({ code: "ORDER_AUTHORITY_DUPLICATE_SALES_ROWS" });
    await expect(getOrder(order.externalReference)).resolves.toBeNull();
  });

  it("H07D2-MALFORMED-SHEET-01 rejects incoherent ventas before inventory or KV", async () => {
    const order = makeOrder();
    vi.mocked(getUniqueOrderRowById).mockResolvedValue({
      outcome: "unique",
      order: { ...row(order), raw: { estado_de_pago: "???" } },
    });
    await expect(
      reconstructOrderFromAuthorityEvidence(order, authorityEvidence(order)),
    ).rejects.toMatchObject({ code: "ORDER_AUTHORITY_INCOHERENT_SALES_ROW" });
    expect(decrementProductsStockInSheet).not.toHaveBeenCalled();
    await expect(getOrder(order.externalReference)).resolves.toBeNull();
  });

  it("H07D2-MALFORMED-EVENT-01 rejects provider evidence before inventory or KV", async () => {
    const order = makeOrder();
    vi.mocked(getUniqueOrderRowById).mockResolvedValue({ outcome: "missing", order: null });
    await expect(
      reconstructOrderFromAuthorityEvidence(order, {
        paymentEvents: [{ ...recoveryEvent(order), amount: order.total + 1 }],
        receiptEventExists: false,
      }),
    ).rejects.toMatchObject({ code: "ORDER_AUTHORITY_INVALID_CANDIDATE" });
    expect(decrementProductsStockInSheet).not.toHaveBeenCalled();
    await expect(getOrder(order.externalReference)).resolves.toBeNull();
  });

  it("H07D2-CRASH-01 leaves KV absent when evidence arbitration fails before claim", async () => {
    const order = makeOrder();
    vi.mocked(getUniqueOrderRowById).mockRejectedValueOnce(new Error("ventas unavailable"));
    await expect(
      reconstructOrderFromAuthorityEvidence(order, authorityEvidence(order)),
    ).rejects.toThrow("ventas unavailable");
    await expect(getOrder(order.externalReference)).resolves.toBeNull();
  });

  it("H07D2-CRASH-02 leaves the first published KV fully authoritative before projection", async () => {
    const order = makeOrder();
    vi.mocked(getUniqueOrderRowById).mockResolvedValue({ outcome: "unique", order: row(order) });
    vi.mocked(decrementProductsStockInSheet).mockResolvedValue({ deduped: true, updated: [] });
    const reconstructed = await reconstructOrderFromAuthorityEvidence(order, {
      ...authorityEvidence(order),
      receiptEventExists: true,
    });

    expect(reconstructed.order).toMatchObject({
      paymentStatus: "confirmed",
      inventoryStatus: "deducted",
      shippingStatus: "in_process",
      receiptOutboxVersion: 1,
    });
    expect(updateOrderRowInSalesSheet).not.toHaveBeenCalled();
    await expect(getOrder(order.externalReference)).resolves.toMatchObject(reconstructed.order);
  });

  it("D2B-ARB-01 projects current KV and suppresses the prepared fallback under the Order lock", async () => {
    const order = makeOrder({
      status: "approved",
      paymentStatus: "confirmed",
      inventoryStatus: "deducted",
      stockDeductedAt: 50,
    });
    await createOrder(order, { syncSheet: false });
    const sheetFallback = vi.fn(async () => "must-not-run");

    await expect(runMissingOrderDestinationArbitration(order.externalReference, {
      projectCurrentKv: true,
      onKvAuthority: (current) => current.externalReference,
      onSheetFallback: sheetFallback,
    })).resolves.toMatchObject({
      outcome: "kv_authority",
      result: order.externalReference,
    });

    expect(sheetFallback).not.toHaveBeenCalled();
    expect(getUniqueOrderRowById).not.toHaveBeenCalled();
    expect(updateOrderRowInSalesSheet).toHaveBeenCalledWith(
      order.externalReference,
      expect.objectContaining({
        paymentStatus: "confirmed",
        inventoryStatus: "deducted",
        stockDeductedAt: 50,
      }),
    );
  });

  it("D2B-ARB-02 owns the final unique ventas re-read and fallback commit", async () => {
    const order = makeOrder();
    const currentRow = row(order);
    vi.mocked(getUniqueOrderRowById).mockResolvedValue({
      outcome: "unique",
      order: currentRow,
    });
    const fallbackCommit = vi.fn(async (latest: AdminOrderSheetRow) => latest.orderId);

    await expect(runMissingOrderDestinationArbitration(order.externalReference, {
      onKvAuthority: () => "kv",
      onSheetFallback: fallbackCommit,
    })).resolves.toEqual({
      outcome: "sheet_fallback",
      order: currentRow,
      result: order.externalReference,
    });
    expect(fallbackCommit).toHaveBeenCalledWith(currentRow);
  });

  it("D2B-ARB-03 rejects duplicate ventas authority before the fallback callback", async () => {
    const order = makeOrder();
    vi.mocked(getUniqueOrderRowById).mockResolvedValue({
      outcome: "duplicate",
      order: null,
      count: 2,
    });
    const fallbackCommit = vi.fn(async () => "must-not-run");

    await expect(runMissingOrderDestinationArbitration(order.externalReference, {
      onKvAuthority: () => "kv",
      onSheetFallback: fallbackCommit,
    })).rejects.toMatchObject({ code: "ORDER_AUTHORITY_DUPLICATE_SALES_ROWS" });
    expect(fallbackCommit).not.toHaveBeenCalled();
  });

  it("D2B-ARB-04 treats a KV outage as failure rather than key absence", async () => {
    const order = makeOrder();
    const fallbackCommit = vi.fn(async () => "must-not-run");
    const getSpy = vi.spyOn(kv, "getJson").mockRejectedValueOnce(new Error("KV unavailable"));

    await expect(runMissingOrderDestinationArbitration(order.externalReference, {
      onKvAuthority: () => "kv",
      onSheetFallback: fallbackCommit,
    })).rejects.toThrow("KV unavailable");
    expect(getUniqueOrderRowById).not.toHaveBeenCalled();
    expect(fallbackCommit).not.toHaveBeenCalled();
    getSpy.mockRestore();
  });

  it("D2B-CONC-01 serializes overlapping fallback commits and exposes the newer epoch", async () => {
    const order = makeOrder();
    let currentRow = row(order);
    vi.mocked(getUniqueOrderRowById).mockImplementation(async () => ({
      outcome: "unique",
      order: currentRow,
    }));
    const firstEntered = deferred();
    const releaseFirst = deferred();
    const first = runMissingOrderDestinationArbitration(order.externalReference, {
      onKvAuthority: () => "kv",
      onSheetFallback: async () => {
        firstEntered.resolve();
        await releaseFirst.promise;
        currentRow = {
          ...currentRow,
          inventoryStatus: "deducted",
          stockDeductedAt: new Date(50).toISOString(),
        };
        return "first";
      },
    });
    await firstEntered.promise;
    const secondFallback = vi.fn(async (latest: AdminOrderSheetRow) => {
      if (latest.inventoryStatus !== "pending") throw new Error("ORDER_STATE_CHANGED");
      return "second";
    });
    const second = runMissingOrderDestinationArbitration(order.externalReference, {
      onKvAuthority: () => "kv",
      onSheetFallback: secondFallback,
    });
    releaseFirst.resolve();

    await expect(first).resolves.toMatchObject({ outcome: "sheet_fallback", result: "first" });
    await expect(second).rejects.toThrow("ORDER_STATE_CHANGED");
    expect(secondFallback).toHaveBeenCalledWith(expect.objectContaining({
      inventoryStatus: "deducted",
    }));
  });

  it("D2B-CONC-02 suppresses fallback when reconstruction publishes KV first", async () => {
    const order = makeOrder();
    const lookupEntered = deferred();
    const releaseLookup = deferred();
    vi.mocked(getUniqueOrderRowById).mockImplementationOnce(async () => {
      lookupEntered.resolve();
      await releaseLookup.promise;
      return { outcome: "unique", order: row(order) };
    });
    vi.mocked(decrementProductsStockInSheet).mockResolvedValue({ deduped: true, updated: [] });
    const reconstruction = reconstructOrderFromAuthorityEvidence(order, authorityEvidence(order));
    await lookupEntered.promise;
    const fallbackCommit = vi.fn(async () => "must-not-run");
    const arbitration = runMissingOrderDestinationArbitration(order.externalReference, {
      onKvAuthority: (current) => current.paymentStatus,
      onSheetFallback: fallbackCommit,
    });
    releaseLookup.resolve();

    await expect(reconstruction).resolves.toMatchObject({ created: true });
    await expect(arbitration).resolves.toMatchObject({
      outcome: "kv_authority",
      result: "confirmed",
    });
    expect(fallbackCommit).not.toHaveBeenCalled();
  });
});
