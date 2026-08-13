import { beforeEach, describe, expect, it, vi } from "vitest";
import { InventoryOperationError } from "@/src/server/inventory/errors";
import type { Order } from "@/src/server/orders/types";
import { setJson } from "@/src/server/kv";

vi.mock("@/src/server/sheets/repository", () => ({
  appendOrderToSalesSheet: vi.fn(),
  decrementProductsStockInSheet: vi.fn(),
  updateOrderRowInSalesSheet: vi.fn(),
  UPDATE_ORDER_ROW_WORST_CASE_MS: 48_800,
}));

vi.mock("@/src/server/catalog/getProducts", () => ({
  invalidateProductsCatalogCache: vi.fn(),
}));

vi.mock("@/src/server/observability/metrics", () => ({
  trackBusinessEvent: vi.fn(),
}));

import {
  createOrder,
  getOrder,
  markApproved,
  markCancelled,
  markChargedBack,
  markRefunded,
  ORDER_WRITE_LOCK_MINIMUM_MARGIN_MS,
  ORDER_WRITE_LOCK_TTL_SECONDS,
  orderWriteLockCoversWorstCaseSheetUpdate,
  reconcileMercadoPagoPaymentObservationBatch,
  retryPaidOrderInventory,
  updateOrder,
} from "./store";
import { resolveOrderInventoryStatus } from "./inventory";
import {
  appendOrderToSalesSheet,
  decrementProductsStockInSheet,
  updateOrderRowInSalesSheet,
} from "@/src/server/sheets/repository";
import { invalidateProductsCatalogCache } from "@/src/server/catalog/getProducts";
import { trackBusinessEvent } from "@/src/server/observability/metrics";
import {
  addPendingSalesSheetOrder,
  isPendingSalesSheetOrder,
  removePendingSalesSheetOrder,
} from "./salesSheetSync";

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
    items: [{ productId: "p1", title: "Producto", unitPrice: 1000, qty: 1, currency: "ARS" }],
    total: 1000,
    currency: "ARS",
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
  });

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
  vi.mocked(appendOrderToSalesSheet).mockResolvedValue(undefined);
  vi.mocked(updateOrderRowInSalesSheet).mockResolvedValue(undefined);
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
    expect(updated).toMatchObject({ paymentStatus: "confirmed", inventoryStatus: "deducted" });
    expect(updated?.stockDeductedAt).toEqual(expect.any(Number));
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
    const updated = await transition(order.externalReference, { paymentId: "pay", mpStatus: expectedStatus });
    expect(updated).toMatchObject({ inventoryStatus: "deducted", stockDeductedAt: 123 });
    expect(decrementProductsStockInSheet).not.toHaveBeenCalled();
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
});

describe("PR 2 recoverable Sheets synchronization", () => {
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
    });

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

    const firstUpdate = updateOrder(firstOrder.externalReference, { mpStatus: "first" });
    await firstSheetSyncEntered.promise;
    const secondUpdate = updateOrder(secondOrder.externalReference, { mpStatus: "second" });
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
    });
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
    });
    await verifyAttemptEntered.promise;
    const webhook = markApproved(order.externalReference, {
      paymentId: "webhook-payment-id",
      mpStatus: "approved",
    });
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
      await transition(order.externalReference, { paymentId: "pay", mpStatus: status });
      expect(await getOrder(order.externalReference)).toMatchObject({
        inventoryStatus: "deducted",
        stockDeductedAt: 500,
      });
    }
    expect(decrementProductsStockInSheet).not.toHaveBeenCalled();
  });
});
