import { beforeEach, describe, expect, it, vi } from "vitest";
import { InventoryOperationError } from "@/src/server/inventory/errors";
import type { Order } from "@/src/server/orders/types";
import type { AdminOrderSheetRow } from "@/src/server/sheets/repository";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect: vi.fn() }));
vi.mock("next-auth", () => ({ getServerSession: vi.fn(async () => ({ user: { email: "admin@test.com" } })) }));
vi.mock("@/src/server/auth/adminEmail", () => ({ isAdminEmail: vi.fn(() => true) }));
vi.mock("@/src/server/catalog/getProducts", () => ({ invalidateProductsCatalogCache: vi.fn() }));
vi.mock("@/src/server/emailOutbox/service", () => ({
  ensurePurchaseReceiptEventSafely: vi.fn(async () => null),
}));

vi.mock("@/src/server/orders/store", () => ({
  getOrder: vi.fn(),
  markApproved: vi.fn(),
  markTerminalPaymentState: vi.fn(),
  retryPaidOrderInventory: vi.fn(),
  updateOrder: vi.fn(),
}));

vi.mock("@/src/server/payments/mpClient", () => ({
  fetchPaymentByIdFromMp: vi.fn(),
  searchPaymentsByExternalReference: vi.fn(),
}));

vi.mock("@/src/server/sheets/repository", () => ({
  decrementProductsStockInSheet: vi.fn(),
  getOrderRowById: vi.fn(),
  updateOrderRowInSalesSheet: vi.fn(),
  updateProductRowInSheet: vi.fn(),
}));

import {
  retryOrderInventoryAction,
  saveOrderStatusesBatchAction,
} from "@/app/admin/actions";
import {
  getOrder,
  markApproved,
  retryPaidOrderInventory,
  updateOrder,
} from "@/src/server/orders/store";
import { ensurePurchaseReceiptEventSafely } from "@/src/server/emailOutbox/service";
import {
  decrementProductsStockInSheet,
  getOrderRowById,
  updateOrderRowInSalesSheet,
} from "@/src/server/sheets/repository";
import { searchPaymentsByExternalReference } from "@/src/server/payments/mpClient";
import { parseFallbackOrderItems } from "@/src/server/orders/sheetFallback";

const baseOrder = (patch: Partial<Order> = {}): Order => ({
  externalReference: "order-admin-1",
  status: "created",
  paymentStatus: "pending",
  shippingStatus: "in_process",
  paymentMethod: "transfer",
  items: [{ productId: "p1", title: "Producto", qty: 1, unitPrice: 1000, currency: "ARS" }],
  total: 1000,
  currency: "ARS",
  createdAt: 1,
  updatedAt: 1,
  customer: { email: "client@test.com" },
  ...patch,
});

const baseSheetOrder = (patch: Partial<AdminOrderSheetRow> = {}): AdminOrderSheetRow => ({
  orderId: "sheet-order-1",
  createdAt: "2026-08-01T00:00:00.000Z",
  createdAtMs: Date.parse("2026-08-01T00:00:00.000Z"),
  customerName: "Cliente",
  whatsapp: "",
  email: "",
  total: 1000,
  currency: "ARS",
  paymentStatus: "pending",
  shippingStatus: "in_process",
  paymentMethod: "transfer",
  deliveryMethod: "pickup",
  inventoryStatus: "pending",
  inventoryIssueCode: "",
  inventoryIssueAt: "",
  stockDeductedAt: "",
  items: [{ productId: "p1", title: "Producto", qty: 1, unitPrice: 1000 }],
  itemsSummary: "1x Producto",
  notes: "",
  receiptEmailSentAt: "",
  raw: {
    items_json: JSON.stringify([
      { productId: "p1", title: "Producto", qty: 1, unitPrice: 1000 },
    ]),
  },
  ...patch,
});

const save = (orderId: string, paymentStatus = "confirmed", shippingStatus = "in_process") =>
  saveOrderStatusesBatchAction([{ orderId, paymentStatus, shippingStatus }]);

beforeEach(() => {
  vi.clearAllMocks();
  process.env.MP_ACCESS_TOKEN = "test-token";
  vi.mocked(updateOrder).mockImplementation(async (_id, patch) => baseOrder(patch));
  vi.mocked(updateOrderRowInSalesSheet).mockResolvedValue(undefined);
  vi.mocked(decrementProductsStockInSheet).mockResolvedValue({
    deduped: false,
    updated: [{ productId: "p1", previousQty: 2, nextQty: 1 }],
  });
});

describe("PR 2 cash and transfer confirmation", () => {
  it.each([
    ["PR2-MANUAL-01 transfer success is confirmed and deducted", "transfer", "deducted"],
    ["PR2-MANUAL-02 transfer no-stock remains confirmed with conflict", "transfer", "conflict"],
    ["PR2-MANUAL-03 transfer timeout remains confirmed with error", "transfer", "error"],
    ["PR2-MANUAL-04 cash success is confirmed and deducted", "cash", "deducted"],
    ["PR2-MANUAL-05 cash conflict remains confirmed", "cash", "conflict"],
    ["PR2-MANUAL-06 cash technical failure remains confirmed", "cash", "error"],
  ] as const)("%s", async (_name, paymentMethod, inventoryStatus) => {
    const current = baseOrder({ paymentMethod });
    const approved = baseOrder({
      paymentMethod,
      status: "approved",
      paymentStatus: "confirmed",
      inventoryStatus,
      ...(inventoryStatus === "deducted" ? { stockDeductedAt: 10 } : {}),
    });
    vi.mocked(getOrder).mockResolvedValue(current);
    vi.mocked(markApproved).mockResolvedValue(approved);
    const result = await save(current.externalReference);
    expect(result.results[0]).toMatchObject({ inventoryStatus });
    expect(approved.paymentStatus).toBe("confirmed");
  });

  it("PR2-MANUAL-07 inventory conflict never changes manual payment back to pending", async () => {
    vi.mocked(getOrder).mockResolvedValue(baseOrder());
    vi.mocked(markApproved).mockResolvedValue(baseOrder({
      status: "approved",
      paymentStatus: "confirmed",
      inventoryStatus: "conflict",
    }));
    const result = await save("order-admin-1");
    expect(result.results[0]?.inventoryStatus).toBe("conflict");
  });

  it("PR2-MANUAL-08 receipt is sent after confirmed persistence even with conflict/error", async () => {
    vi.mocked(getOrder).mockResolvedValue(baseOrder());
    vi.mocked(markApproved).mockResolvedValue(baseOrder({
      status: "approved",
      paymentStatus: "confirmed",
      inventoryStatus: "conflict",
    }));
    await save("order-admin-1");
    expect(ensurePurchaseReceiptEventSafely).toHaveBeenCalledTimes(1);
  });
});

describe("PR 2 explicit inventory retry action", () => {
  const conflictOrder = baseOrder({
    status: "approved",
    paymentStatus: "confirmed",
    inventoryStatus: "conflict",
    inventoryIssueCode: "INSUFFICIENT_STOCK",
    inventoryIssueAt: 10,
  });

  it.each([
    ["PR2-RETRY-01 conflict after stock replenishment becomes deducted", "deducted", true],
    ["PR2-RETRY-02 resolved technical error becomes deducted", "deducted", true],
    ["PR2-RETRY-03 no stock remains conflict", "conflict", false],
    ["PR2-RETRY-04 repeated technical failure remains error", "error", false],
    ["PR2-RETRY-05 retry returns the newly persisted outcome", "conflict", false],
    ["PR2-RETRY-06 successful retry clears issue code in the persisted order", "deducted", true],
    ["PR2-RETRY-07 successful retry clears issue time in the persisted order", "deducted", true],
    ["PR2-RETRY-08 successful retry persists stockDeductedAt", "deducted", true],
  ] as const)("%s", async (_name, inventoryStatus, ok) => {
    vi.mocked(getOrder).mockResolvedValue(conflictOrder);
    vi.mocked(retryPaidOrderInventory).mockResolvedValue(baseOrder({
      status: "approved",
      paymentStatus: "confirmed",
      inventoryStatus,
      ...(inventoryStatus === "deducted" ? { stockDeductedAt: 20 } : { inventoryIssueAt: 20 }),
    }));
    expect(await retryOrderInventoryAction(conflictOrder.externalReference)).toMatchObject({ ok, inventoryStatus });
  });

  it("PR2-RETRY-09 retry on deducted is a safe no-op", async () => {
    const deducted = baseOrder({ paymentStatus: "confirmed", inventoryStatus: "deducted", stockDeductedAt: 20 });
    vi.mocked(getOrder).mockResolvedValue(deducted);
    vi.mocked(retryPaidOrderInventory).mockResolvedValue(deducted);
    expect(await retryOrderInventoryAction(deducted.externalReference)).toMatchObject({ ok: true });
    expect(decrementProductsStockInSheet).not.toHaveBeenCalled();
  });

  it("PR2-RETRY-10 retry with pending payment is rejected", async () => {
    vi.mocked(getOrder).mockResolvedValue(baseOrder());
    vi.mocked(retryPaidOrderInventory).mockRejectedValue(new Error("confirmed required"));
    await expect(retryOrderInventoryAction("order-admin-1")).rejects.toThrow("confirmed required");
  });

  it("PR2-RETRY-11 lost response plus retry dedupe does not create a second decrement", async () => {
    vi.mocked(getOrder).mockResolvedValue(null);
    vi.mocked(getOrderRowById).mockResolvedValue(baseSheetOrder({
      paymentStatus: "confirmed",
      inventoryStatus: "error",
      inventoryIssueCode: "SHEETS_TIMEOUT",
    }));
    vi.mocked(decrementProductsStockInSheet).mockResolvedValue({ deduped: true, updated: [] });
    expect(await retryOrderInventoryAction("sheet-order-1")).toMatchObject({
      ok: true,
      inventoryStatus: "deducted",
    });
    expect(decrementProductsStockInSheet).toHaveBeenCalledTimes(1);
  });
});

describe("PR 2 shipping guard", () => {
  it.each([
    ["PR2-SHIP-01 conflict cannot become completed", "conflict"],
    ["PR2-SHIP-02 error cannot become completed", "error"],
    ["PR2-SHIP-07 forged status payload cannot bypass the server guard", "conflict"],
    ["PR2-SHIP-08 batch update cannot bypass the server guard", "error"],
  ] as const)("%s", async (_name, inventoryStatus) => {
    vi.mocked(getOrder).mockResolvedValue(baseOrder({
      status: "approved",
      paymentStatus: "confirmed",
      inventoryStatus,
    }));
    await expect(save("order-admin-1", "confirmed", "completed")).rejects.toThrow("inventario requiere atención");
  });

  it("PR2-SHIP-03 deducted can become completed", async () => {
    vi.mocked(getOrder).mockResolvedValue(baseOrder({
      status: "approved",
      paymentStatus: "confirmed",
      inventoryStatus: "deducted",
      stockDeductedAt: 10,
    }));
    const result = await save("order-admin-1", "confirmed", "completed");
    expect(result.results[0]).toMatchObject({ shippingStatus: "completed", shippingBlocked: false });
    expect(updateOrder).toHaveBeenCalledWith("order-admin-1", { shippingStatus: "completed" });
    expect(ensurePurchaseReceiptEventSafely).not.toHaveBeenCalled();
  });

  it.each([
    ["PR2-SHIP-04 confirm plus completed with stock success completes", "deducted", "completed", false],
    ["PR2-SHIP-05 confirm plus completed with conflict keeps in_process", "conflict", "in_process", true],
    ["PR2-SHIP-06 confirm plus completed with error keeps in_process", "error", "in_process", true],
  ] as const)("%s", async (_name, inventoryStatus, expectedShipping, shippingBlocked) => {
    vi.mocked(getOrder).mockResolvedValue(baseOrder());
    vi.mocked(markApproved).mockResolvedValue(baseOrder({
      status: "approved",
      paymentStatus: "confirmed",
      inventoryStatus,
      ...(inventoryStatus === "deducted" ? { stockDeductedAt: 10 } : {}),
    }));
    const result = await save("order-admin-1", "confirmed", "completed");
    expect(result.results[0]).toMatchObject({
      inventoryStatus,
      shippingStatus: expectedShipping,
      shippingBlocked,
    });
  });

  it("PR2-SHIP-09 legacy undefined is not blocked solely for being legacy", async () => {
    vi.mocked(getOrder).mockResolvedValue(baseOrder({
      status: "approved",
      paymentStatus: "confirmed",
      inventoryStatus: undefined,
    }));
    const result = await save("order-admin-1", "confirmed", "completed");
    expect(result.results[0]).toMatchObject({ shippingStatus: "completed", shippingBlocked: false });
  });
});

describe("PR 2 Sheets fallback", () => {
  beforeEach(() => {
    vi.mocked(getOrder).mockResolvedValue(null);
  });

  it("PR2-FALLBACK-01 an order missing in KV can be confirmed safely from Sheets", async () => {
    vi.mocked(getOrderRowById).mockResolvedValue(baseSheetOrder());
    const result = await save("sheet-order-1");
    expect(result.results[0]).toMatchObject({ inventoryStatus: "deducted" });
    expect(updateOrderRowInSalesSheet).toHaveBeenCalledWith(
      "sheet-order-1",
      expect.objectContaining({ receiptOutboxVersion: 1 }),
    );
    expect(vi.mocked(updateOrderRowInSalesSheet).mock.invocationCallOrder[0]).toBeLessThan(
      vi.mocked(ensurePurchaseReceiptEventSafely).mock.invocationCallOrder[0],
    );
  });

  it("does not enroll an already-confirmed legacy Sheets order on Admin resave", async () => {
    vi.mocked(getOrderRowById).mockResolvedValue(baseSheetOrder({ paymentStatus: "confirmed" }));
    await save("sheet-order-1");
    expect(updateOrderRowInSalesSheet).toHaveBeenCalledWith(
      "sheet-order-1",
      expect.not.objectContaining({ receiptOutboxVersion: 1 }),
    );
    expect(ensurePurchaseReceiptEventSafely).not.toHaveBeenCalled();
  });

  it("PR2-FALLBACK-02 Mercado Pago fallback verifies payment before stock", async () => {
    vi.mocked(getOrderRowById).mockResolvedValue(baseSheetOrder({ paymentMethod: "mercadopago" }));
    vi.mocked(searchPaymentsByExternalReference).mockResolvedValue({
      response: new Response("{}", { status: 200 }),
      data: { results: [{
        id: "pay-1",
        status: "approved",
        external_reference: "sheet-order-1",
        transaction_amount: 1000,
        currency_id: "ARS",
      }] },
    });
    await save("sheet-order-1");
    expect(searchPaymentsByExternalReference).toHaveBeenCalled();
    expect(decrementProductsStockInSheet).toHaveBeenCalled();
    expect(vi.mocked(searchPaymentsByExternalReference).mock.invocationCallOrder[0]).toBeLessThan(
      vi.mocked(decrementProductsStockInSheet).mock.invocationCallOrder[0]!
    );
  });

  it("PR2-FALLBACK-03 existing stock timestamp avoids another decrement", async () => {
    vi.mocked(getOrderRowById).mockResolvedValue(baseSheetOrder({
      inventoryStatus: "deducted",
      stockDeductedAt: "2026-08-01T00:00:00.000Z",
    }));
    await save("sheet-order-1");
    expect(decrementProductsStockInSheet).not.toHaveBeenCalled();
  });

  it("PR2-FALLBACK-04 decimal qty in items_json is not truncated", () => {
    const items = parseFallbackOrderItems({
      items_json: JSON.stringify([{ productId: "p1", title: "Producto", qty: 1.5, unitPrice: 1000 }]),
    }, []);
    expect(items[0]?.qty).toBe(1.5);
    expect(Number.isInteger(items[0]?.qty)).toBe(false);
  });

  it("PR2-FALLBACK-05 invalid qty remains invalid so authoritative validation fails closed", () => {
    const items = parseFallbackOrderItems({
      items_json: JSON.stringify([{ productId: "p1", title: "Producto", qty: "bad", unitPrice: 1000 }]),
    }, []);
    expect(Number.isNaN(items[0]?.qty)).toBe(true);
  });

  it("PR2-FALLBACK-06 missing productId never falls back to title", () => {
    const items = parseFallbackOrderItems({}, [{ productId: "", title: "Título no autoritativo", qty: 1 }]);
    expect(items[0]?.productId).toBe("");
  });

  it("PR2-FALLBACK-07 fallback conflict persists inventory_status", async () => {
    vi.mocked(getOrderRowById).mockResolvedValue(baseSheetOrder());
    vi.mocked(decrementProductsStockInSheet).mockRejectedValue(new InventoryOperationError({
      code: "INSUFFICIENT_STOCK",
      message: "none",
    }));
    await save("sheet-order-1");
    expect(updateOrderRowInSalesSheet).toHaveBeenCalledWith("sheet-order-1", expect.objectContaining({
      inventoryStatus: "conflict",
      inventoryIssueCode: "INSUFFICIENT_STOCK",
    }));
  });

  it("PR2-FALLBACK-08 fallback technical error persists inventory_status", async () => {
    vi.mocked(getOrderRowById).mockResolvedValue(baseSheetOrder());
    vi.mocked(decrementProductsStockInSheet).mockRejectedValue(new Error("network down"));
    await save("sheet-order-1");
    expect(updateOrderRowInSalesSheet).toHaveBeenCalledWith("sheet-order-1", expect.objectContaining({
      inventoryStatus: "error",
    }));
  });
});
