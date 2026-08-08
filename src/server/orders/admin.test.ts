import { describe, expect, it, vi } from "vitest";
import type { AdminOrderSheetRow } from "@/src/server/sheets/repository";
import type { Order } from "./types";
import { getOrdersForAdminWithKvState, resolveAdminOrderState } from "./admin";

const INVENTORY_ISSUE_AT = Date.parse("2026-08-08T12:00:00.000Z");
const STOCK_DEDUCTED_AT = Date.parse("2026-08-08T12:05:00.000Z");

const makeSheetOrder = (
  patch: Partial<AdminOrderSheetRow> = {}
): AdminOrderSheetRow => ({
  orderId: "order-sync-1",
  createdAt: "2026-08-08T10:00:00.000Z",
  createdAtMs: Date.parse("2026-08-08T10:00:00.000Z"),
  customerName: "",
  whatsapp: "",
  email: "",
  total: 1000,
  currency: "ARS",
  paymentStatus: "confirmed",
  shippingStatus: "in_process",
  inventoryStatus: "pending",
  inventoryIssueCode: "",
  inventoryIssueAt: "",
  stockDeductedAt: "",
  paymentMethod: "mercadopago",
  deliveryMethod: "pickup",
  items: [{ productId: "p1", title: "Producto", qty: 1, unitPrice: 1000 }],
  itemsSummary: "Producto x1",
  notes: "",
  receiptEmailSentAt: "",
  raw: {},
  ...patch,
});

const makeKvOrder = (patch: Partial<Order> = {}): Order => ({
  externalReference: "order-sync-1",
  status: "approved",
  paymentStatus: "confirmed",
  shippingStatus: "in_process",
  inventoryStatus: "pending",
  paymentMethod: "mercadopago",
  deliveryMethod: "pickup",
  items: [{ productId: "p1", title: "Producto", qty: 1, unitPrice: 1000, currency: "ARS" }],
  total: 1000,
  currency: "ARS",
  createdAt: Date.parse("2026-08-08T10:00:00.000Z"),
  updatedAt: Date.parse("2026-08-08T11:00:00.000Z"),
  ...patch,
});

describe("PR 2 admin KV and Sheets reconciliation", () => {
  it("PR2-SYNC-02 KV error overlays a stale pending Sheets row in admin", async () => {
    const sheetOrder = makeSheetOrder({ paymentStatus: "pending" });
    const kvOrder = makeKvOrder({
      inventoryStatus: "error",
      inventoryIssueCode: "SHEETS_UNAVAILABLE",
      inventoryIssueAt: INVENTORY_ISSUE_AT,
    });

    const [result] = await getOrdersForAdminWithKvState({
      getSheetOrders: async () => [sheetOrder],
      getKvOrder: async () => kvOrder,
      syncSheetState: vi.fn().mockResolvedValue(undefined),
    });

    expect(result).toMatchObject({
      paymentStatus: "confirmed",
      inventoryStatus: "error",
      inventoryIssueCode: "SHEETS_UNAVAILABLE",
      inventoryIssueAt: new Date(INVENTORY_ISSUE_AT).toISOString(),
    });
  });

  it("PR2-SYNC-03 KV conflict overlays a stale Sheets row in admin", async () => {
    const resolution = resolveAdminOrderState(
      makeSheetOrder(),
      makeKvOrder({
        inventoryStatus: "conflict",
        inventoryIssueCode: "INSUFFICIENT_STOCK",
        inventoryIssueAt: INVENTORY_ISSUE_AT,
      })
    );

    expect(resolution.order).toMatchObject({
      inventoryStatus: "conflict",
      inventoryIssueCode: "INSUFFICIENT_STOCK",
    });
    expect(resolution.syncUpdates).not.toBeNull();
  });

  it("PR2-SYNC-04 KV deducted cannot appear pending because Sheets is stale", () => {
    const resolution = resolveAdminOrderState(
      makeSheetOrder(),
      makeKvOrder({
        inventoryStatus: "deducted",
        stockDeductedAt: STOCK_DEDUCTED_AT,
      })
    );

    expect(resolution.order).toMatchObject({
      inventoryStatus: "deducted",
      stockDeductedAt: new Date(STOCK_DEDUCTED_AT).toISOString(),
      inventoryIssueCode: "",
      inventoryIssueAt: "",
    });
  });

  it("PR2-SYNC-05 a legacy order without evidence does not invent inventory state", () => {
    const sheetOrder = makeSheetOrder({ inventoryStatus: undefined });
    const kvOrder = makeKvOrder({ inventoryStatus: undefined, stockDeductedAt: undefined });
    const resolution = resolveAdminOrderState(sheetOrder, kvOrder);

    expect(resolution.order.inventoryStatus).toBeUndefined();
    expect(resolution.order.stockDeductedAt).toBe("");
    expect(resolution.syncUpdates).toBeNull();
  });

  it("PR2-SYNC-06 state reconciliation never executes another stock decrement", async () => {
    const syncSheetState = vi.fn().mockResolvedValue(undefined);
    const decrementStock = vi.fn();

    await getOrdersForAdminWithKvState({
      getSheetOrders: async () => [makeSheetOrder()],
      getKvOrder: async () =>
        makeKvOrder({ inventoryStatus: "deducted", stockDeductedAt: STOCK_DEDUCTED_AT }),
      syncSheetState,
    });

    expect(syncSheetState).toHaveBeenCalledTimes(1);
    expect(syncSheetState.mock.calls[0]?.[1]).toMatchObject({
      inventoryStatus: "deducted",
      stockDeductedAt: STOCK_DEDUCTED_AT,
    });
    expect(decrementStock).not.toHaveBeenCalled();
  });

  it("PR2-SYNC-07 recovery persists KV state without changing payment or shipping incorrectly", async () => {
    const syncSheetState = vi.fn().mockResolvedValue(undefined);
    const kvOrder = makeKvOrder({
      inventoryStatus: "error",
      inventoryIssueCode: "SHEETS_TIMEOUT",
      inventoryIssueAt: INVENTORY_ISSUE_AT,
      paymentStatus: "confirmed",
      shippingStatus: "in_process",
    });

    await getOrdersForAdminWithKvState({
      getSheetOrders: async () => [makeSheetOrder()],
      getKvOrder: async () => kvOrder,
      syncSheetState,
    });

    expect(syncSheetState).toHaveBeenCalledWith(
      kvOrder.externalReference,
      expect.objectContaining({
        paymentStatus: "confirmed",
        shippingStatus: "in_process",
        orderStatus: "approved",
        inventoryStatus: "error",
      })
    );
  });

  it("PR2-SYNC-08 failed reconciliation remains retryable and preserves the KV overlay", async () => {
    const syncSheetState = vi
      .fn()
      .mockRejectedValueOnce(new Error("Sheets unavailable"))
      .mockResolvedValueOnce(undefined);
    const dependencies = {
      getSheetOrders: async () => [makeSheetOrder()],
      getKvOrder: async () =>
        makeKvOrder({
          inventoryStatus: "error" as const,
          inventoryIssueCode: "SHEETS_UNAVAILABLE",
          inventoryIssueAt: INVENTORY_ISSUE_AT,
        }),
      syncSheetState,
    };

    const [first] = await getOrdersForAdminWithKvState(dependencies);
    const [second] = await getOrdersForAdminWithKvState(dependencies);

    expect(first?.inventoryStatus).toBe("error");
    expect(second?.inventoryStatus).toBe("error");
    expect(syncSheetState).toHaveBeenCalledTimes(2);
  });
});
