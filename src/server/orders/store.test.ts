import { beforeEach, describe, expect, it, vi } from "vitest";
import { InventoryOperationError } from "@/src/server/inventory/errors";
import type { Order } from "@/src/server/orders/types";

vi.mock("@/src/server/sheets/repository", () => ({
  appendOrderToSalesSheet: vi.fn(),
  decrementProductsStockInSheet: vi.fn(),
  updateOrderRowInSalesSheet: vi.fn(),
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
  retryPaidOrderInventory,
} from "./store";
import { resolveOrderInventoryStatus } from "./inventory";
import {
  appendOrderToSalesSheet,
  decrementProductsStockInSheet,
  updateOrderRowInSalesSheet,
} from "@/src/server/sheets/repository";
import { invalidateProductsCatalogCache } from "@/src/server/catalog/getProducts";

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
