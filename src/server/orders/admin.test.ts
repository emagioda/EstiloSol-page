import { describe, expect, it, vi } from "vitest";
import type { AdminOrderSheetRow } from "@/src/server/sheets/repository";
import type { Order } from "./types";
import { getOrdersForAdminWithKvState, resolveAdminOrderState } from "./admin";
import { recoverPendingSalesSheetOrder } from "./salesSheetRecovery";

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

  it("PR2-SYNC-10 an indexed KV-only paid order is visible in admin", async () => {
    const kvOrder = makeKvOrder({
      salesSheetDeferredUntilApprovedAt: 1,
      salesSheetSyncFailedAt: 2,
      customer: { name: "Cliente real", phone: "3410000000", email: "cliente@example.com" },
    });

    const result = await getOrdersForAdminWithKvState({
      getSheetOrders: async () => [],
      listPendingOrderIds: async () => [kvOrder.externalReference],
      getKvOrder: async () => kvOrder,
      recoverPendingOrder: vi.fn().mockResolvedValue({ outcome: "pending", order: kvOrder }),
    });

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      orderId: kvOrder.externalReference,
      customerName: "Cliente real",
      salesSheetSyncPending: true,
    });
  });

  it("PR2-SYNC-11 a KV-only row preserves payment, inventory and stock evidence", async () => {
    const kvOrder = makeKvOrder({
      salesSheetDeferredUntilApprovedAt: 1,
      salesSheetSyncFailedAt: 2,
      inventoryStatus: "deducted",
      stockDeductedAt: STOCK_DEDUCTED_AT,
    });

    const [result] = await getOrdersForAdminWithKvState({
      getSheetOrders: async () => [],
      listPendingOrderIds: async () => [kvOrder.externalReference],
      getKvOrder: async () => kvOrder,
      recoverPendingOrder: vi.fn().mockResolvedValue({ outcome: "pending", order: kvOrder }),
    });

    expect(result).toMatchObject({
      paymentStatus: "confirmed",
      inventoryStatus: "deducted",
      stockDeductedAt: new Date(STOCK_DEDUCTED_AT).toISOString(),
      salesSheetSyncPending: true,
    });
  });

  it("PR2-SYNC-17-ADMIN a failed recovery remains visible for another attempt", async () => {
    const kvOrder = makeKvOrder({
      salesSheetDeferredUntilApprovedAt: 1,
      salesSheetSyncFailedAt: 2,
    });
    const recoverPendingOrder = vi
      .fn()
      .mockResolvedValue({ outcome: "pending", order: kvOrder });

    const [result] = await getOrdersForAdminWithKvState({
      getSheetOrders: async () => [],
      listPendingOrderIds: async () => [kvOrder.externalReference],
      getKvOrder: async () => kvOrder,
      recoverPendingOrder,
    });

    expect(result.salesSheetSyncPending).toBe(true);
    expect(recoverPendingOrder).toHaveBeenCalledTimes(1);
  });

  it("PR2-SYNC-INDEX-03 delegates expired KV cleanup to locked recovery", async () => {
    const recoverPendingOrder = vi.fn().mockResolvedValue({
      outcome: "stale",
      order: null,
    });

    const result = await getOrdersForAdminWithKvState({
      getSheetOrders: async () => [],
      listPendingOrderIds: async () => ["expired-order"],
      getKvOrder: async () => null,
      recoverPendingOrder,
    });

    expect(result).toEqual([]);
    expect(recoverPendingOrder).toHaveBeenCalledWith("expired-order", { rowExists: false });
  });

  it("PR2-SYNC-20 two concurrent admin loads perform at most one append", async () => {
    const kvOrder = makeKvOrder({
      externalReference: `order-sync-concurrent-${Date.now()}`,
      salesSheetDeferredUntilApprovedAt: 1,
      salesSheetSyncFailedAt: 2,
    });
    let releaseAppend!: () => void;
    let signalAppendEntered!: () => void;
    const appendEntered = new Promise<void>((resolve) => {
      signalAppendEntered = resolve;
    });
    const appendReleased = new Promise<void>((resolve) => {
      releaseAppend = resolve;
    });
    const indexed = true;
    const reconcileProjection = vi.fn(async () => {
      signalAppendEntered();
      await appendReleased;
      return { outcome: "appended" as const, order: kvOrder };
    });
    const recoveryDependencies = {
      isPending: vi.fn(async () => indexed),
      readOrder: vi.fn(async () => kvOrder),
      reconcileProjection,
    };
    const adminDependencies = {
      getSheetOrders: async () => [],
      listPendingOrderIds: async () => [kvOrder.externalReference],
      getKvOrder: async () => kvOrder,
      recoverPendingOrder: (orderId: string, options: { rowExists: boolean }) =>
        recoverPendingSalesSheetOrder(orderId, options, recoveryDependencies),
    };

    const firstLoad = getOrdersForAdminWithKvState(adminDependencies);
    await appendEntered;
    const secondLoad = getOrdersForAdminWithKvState(adminDependencies);
    const secondResult = await secondLoad;
    releaseAppend();
    const firstResult = await firstLoad;

    expect(firstResult).toHaveLength(1);
    expect(secondResult).toHaveLength(1);
    expect(reconcileProjection).toHaveBeenCalledTimes(1);
  });

  it("AUD3-H06-MERGE-01 preserves Sheet confirmed over stale KV pending without writing pending", () => {
    const resolution = resolveAdminOrderState(
      makeSheetOrder({ paymentStatus: "confirmed" }),
      makeKvOrder({ status: "created", paymentStatus: "pending" }),
    );
    expect(resolution.order.paymentStatus).toBe("confirmed");
    expect(resolution.syncUpdates?.paymentStatus).not.toBe("pending");
  });

  it("AUD3-H06-MERGE-02 preserves Sheet confirmed over stale KV cancelled", () => {
    const resolution = resolveAdminOrderState(
      makeSheetOrder({ paymentStatus: "confirmed" }),
      makeKvOrder({ status: "cancelled", paymentStatus: "cancelled" }),
    );
    expect(resolution.order.paymentStatus).toBe("confirmed");
    expect(resolution.syncUpdates?.paymentStatus).not.toBe("cancelled");
  });

  it("AUD3-H06-MERGE-03 promotes Sheet pending from KV confirmed", () => {
    const resolution = resolveAdminOrderState(
      makeSheetOrder({ paymentStatus: "pending" }),
      makeKvOrder({ status: "approved", paymentStatus: "confirmed" }),
    );
    expect(resolution.order.paymentStatus).toBe("confirmed");
    expect(resolution.syncUpdates).toMatchObject({
      paymentStatus: "confirmed",
      orderStatus: "approved",
    });
  });

  it("AUD3-H06-MERGE-04 applies charged_back only with actual KV ledger evidence", () => {
    const resolution = resolveAdminOrderState(
      makeSheetOrder({ paymentStatus: "confirmed" }),
      makeKvOrder({
        status: "charged_back",
        paymentStatus: "charged_back",
        mpPaymentLedger: {
          pay_1: {
            paymentId: "pay_1",
            status: "charged_back",
            amount: 1000,
            currency: "ARS",
            firstSeenAt: INVENTORY_ISSUE_AT,
            lastSeenAt: STOCK_DEDUCTED_AT,
          },
        },
      }),
    );
    expect(resolution.order.paymentStatus).toBe("charged_back");
    expect(resolution.syncUpdates?.paymentStatus).toBe("charged_back");
  });

  it("AUD3-H06-MERGE-05 flags contradictory reversal evidence without a silent downgrade", () => {
    const resolution = resolveAdminOrderState(
      makeSheetOrder({ paymentStatus: "refunded" }),
      makeKvOrder({
        status: "charged_back",
        paymentStatus: "charged_back",
        mpPaymentLedger: {
          pay_1: {
            paymentId: "pay_1",
            status: "charged_back",
            amount: 1000,
            currency: "ARS",
            firstSeenAt: INVENTORY_ISSUE_AT,
            lastSeenAt: STOCK_DEDUCTED_AT,
          },
        },
      }),
    );
    expect(resolution.order).toMatchObject({
      paymentStatus: "refunded",
      financialAttentionCode: "FINANCIAL_EVIDENCE_CONFLICT",
    });
    expect(resolution.syncUpdates?.paymentStatus).not.toBe("charged_back");
  });

  it("H07D1-ADMIN-01 derives read repair fields from the current locked Order", async () => {
    const sheetOrder = makeSheetOrder({
      paymentStatus: "pending",
      shippingStatus: "in_process",
    });
    const o1 = makeKvOrder({ shippingStatus: "in_process", updatedAt: 100 });
    const o2 = makeKvOrder({
      shippingStatus: "completed",
      inventoryStatus: "deducted",
      stockDeductedAt: STOCK_DEDUCTED_AT,
      updatedAt: 200,
    });
    let current = o1;
    let releaseProjection!: () => void;
    let signalProjectionEntered!: () => void;
    const projectionEntered = new Promise<void>((resolve) => {
      signalProjectionEntered = resolve;
    });
    const projectionReleased = new Promise<void>((resolve) => {
      releaseProjection = resolve;
    });
    const sheetWrites: Array<Record<string, unknown>> = [];

    const adminLoad = getOrdersForAdminWithKvState({
      getSheetOrders: async () => [sheetOrder],
      getKvOrder: async () => o1,
      listPendingOrderIds: async () => [],
      projectCurrentState: async (_orderId, selectUpdates) => {
        signalProjectionEntered();
        await projectionReleased;
        const updates = selectUpdates(current);
        if (updates) sheetWrites.push(updates);
        return current;
      },
    });
    await projectionEntered;
    current = o2;
    releaseProjection();
    const [result] = await adminLoad;

    expect(sheetWrites).toEqual([
      expect.objectContaining({
        paymentStatus: "confirmed",
        shippingStatus: "completed",
        inventoryStatus: "deducted",
        stockDeductedAt: STOCK_DEDUCTED_AT,
        updatedAt: 200,
      }),
    ]);
    expect(result).toMatchObject({
      paymentStatus: "confirmed",
      shippingStatus: "completed",
      inventoryStatus: "deducted",
    });
  });
});
