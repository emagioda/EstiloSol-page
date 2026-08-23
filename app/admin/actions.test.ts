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
  applyAdminOrderStatusIntent: vi.fn(),
  assertAdminPaymentTransitionRequest: vi.fn(),
  getOrder: vi.fn(),
  markApproved: vi.fn(),
  retryPaidOrderInventory: vi.fn(),
  updateOrder: vi.fn(),
}));

vi.mock("@/src/server/payments/adminConfirmation", () => ({
  reconcileAdminMercadoPagoConfirmation: vi.fn(),
}));

vi.mock("@/src/server/sheets/repository", () => ({
  applyAdminOrderStatusIntentInSalesSheet: vi.fn(),
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
  applyAdminOrderStatusIntent,
  assertAdminPaymentTransitionRequest,
  getOrder,
  markApproved,
  retryPaidOrderInventory,
  updateOrder,
} from "@/src/server/orders/store";
import { ensurePurchaseReceiptEventSafely } from "@/src/server/emailOutbox/service";
import {
  applyAdminOrderStatusIntentInSalesSheet,
  decrementProductsStockInSheet,
  getOrderRowById,
  updateOrderRowInSalesSheet,
} from "@/src/server/sheets/repository";
import { reconcileAdminMercadoPagoConfirmation } from "@/src/server/payments/adminConfirmation";
import {
  evaluateAdminPaymentTransitionRequest,
  getPaymentTransitionBlockMessage,
  PAYMENT_TRANSITION_BLOCK_REASONS,
  PaymentTransitionBlockedError,
} from "@/src/server/orders/paymentTransition";
import {
  parseFallbackOrderFulfillment,
  parseFallbackOrderItems,
} from "@/src/server/orders/sheetFallback";
import {
  AdminOrderStateChangedError,
  evaluateAdminStatusIntent,
} from "@/src/server/orders/adminIntent";
import {
  evaluateFulfillmentCompletion,
  FULFILLMENT_COMPLETION_BLOCK_REASONS,
  FulfillmentCompletionBlockedError,
  isTrustedHistoricalCompletion,
} from "@/src/server/orders/fulfillmentCompletion";

const baseOrder = (patch: Partial<Order> = {}): Order => ({
  externalReference: "order-admin-1",
  status: "created",
  paymentStatus: "pending",
  shippingStatus: "in_process",
  paymentMethod: "transfer",
  deliveryMethod: "pickup",
  items: [{ productId: "p1", title: "Producto", qty: 1, unitPrice: 1000, currency: "ARS" }],
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
    subtotal_productos: 1000,
    descuento: 0,
    costo_envio: 0,
    total_final: 1000,
    pickup_point_id: "pickup-1",
    pickup_point_name: "Estilo Sol",
    pickup_point_address: "San Martín 123",
    pickup_point_reference: "Mostrador",
    fulfillment_summary: "Retiro en Estilo Sol",
  },
  ...patch,
});

const save = (
  orderId: string,
  paymentStatus: Order["paymentStatus"] = "confirmed",
  shippingStatus: Order["shippingStatus"] = "in_process",
  expectedPaymentStatus: Order["paymentStatus"] = paymentStatus === "pending" ? "confirmed" : "pending",
  expectedShippingStatus: Order["shippingStatus"] = "in_process",
) => saveOrderStatusesBatchAction([{
  orderId,
  changedFields: [
    "paymentStatus",
    ...(shippingStatus !== expectedShippingStatus ? ["shippingStatus" as const] : []),
  ],
  expectedPaymentStatus,
  requestedPaymentStatus: paymentStatus,
  ...(shippingStatus !== expectedShippingStatus
    ? { expectedShippingStatus, requestedShippingStatus: shippingStatus }
    : {}),
}]);

beforeEach(() => {
  vi.clearAllMocks();
  process.env.MP_ACCESS_TOKEN = "test-token";
  vi.mocked(reconcileAdminMercadoPagoConfirmation).mockReset();
  vi.mocked(updateOrder).mockImplementation(async (_id, patch) => baseOrder(patch));
  vi.mocked(assertAdminPaymentTransitionRequest).mockImplementation(async (id, requested) => {
    const order = await vi.mocked(getOrder)(id);
    if (!order) return null;
    const decision = evaluateAdminPaymentTransitionRequest({
      current: order.paymentStatus,
      requested,
      paymentMethod: order.paymentMethod,
    });
    if (!decision.allowed) throw new PaymentTransitionBlockedError(decision.reason);
    return { order, decision };
  });
  vi.mocked(updateOrderRowInSalesSheet).mockResolvedValue(undefined);
  vi.mocked(decrementProductsStockInSheet).mockResolvedValue({
    deduped: false,
    updated: [{ productId: "p1", previousQty: 2, nextQty: 1 }],
  });
  vi.mocked(applyAdminOrderStatusIntent).mockImplementation(async (id, intent) => {
    let order = await vi.mocked(getOrder)(id);
    if (!order) return null;
    const precondition = evaluateAdminStatusIntent(order, intent);
    if (precondition.outcome === "conflict") {
      throw new AdminOrderStateChangedError(id, precondition.current);
    }
    if (precondition.outcome === "idempotent_replay") {
      return {
        order,
        outcome: "idempotent_replay",
        paymentApplied: false,
        shippingApplied: false,
        receiptEnrollmentRequired: false,
        shippingBlocked: false,
      };
    }

    let paymentApplied = false;
    if (intent.changedFields.includes("paymentStatus") && intent.requestedPaymentStatus) {
      const decision = evaluateAdminPaymentTransitionRequest({
        current: order.paymentStatus,
        requested: intent.requestedPaymentStatus,
        paymentMethod: order.paymentMethod,
      });
      if (!decision.allowed) throw new PaymentTransitionBlockedError(decision.reason);
      if (decision.authority === "mp_authoritative" && !decision.replay) {
        return {
          order,
          outcome: "provider_confirmation_required",
          paymentApplied: false,
          shippingApplied: false,
          receiptEnrollmentRequired: false,
          shippingBlocked: false,
        };
      }
      if (!decision.replay) {
        const approved = await vi.mocked(markApproved)(
          id,
          { paymentId: `manual-${id}`, mpStatus: "manual_confirmed", approvedAt: 10 },
          "admin_manual",
        );
        if (!approved) throw new Error("missing approved order");
        order = {
          ...approved,
          mpPaymentId: approved.mpPaymentId ?? `manual-${id}`,
          approvedAt: approved.approvedAt ?? 10,
        };
        paymentApplied = true;
      }
    }

    let shippingApplied = false;
    let shippingBlocked = false;
    let completionBlockReason: keyof typeof FULFILLMENT_COMPLETION_BLOCK_REASONS | undefined;
    if (intent.changedFields.includes("shippingStatus") && intent.requestedShippingStatus) {
      if (intent.requestedShippingStatus === "in_process" && isTrustedHistoricalCompletion(order)) {
        shippingBlocked = true;
        completionBlockReason = "completedReopenNotAllowed";
      } else if (intent.requestedShippingStatus === "completed") {
        const completion = evaluateFulfillmentCompletion({ ...order, shippingStatus: "completed" });
        if (completion.allowed) {
          try {
            await vi.mocked(updateOrder)(id, { shippingStatus: "completed" });
            order = { ...order, shippingStatus: "completed" };
            shippingApplied = true;
          } catch (error) {
            if (!(error instanceof FulfillmentCompletionBlockedError)) throw error;
            shippingBlocked = true;
            completionBlockReason = Object.entries(FULFILLMENT_COMPLETION_BLOCK_REASONS)
              .find(([, value]) => value === error.reason)?.[0] as keyof typeof FULFILLMENT_COMPLETION_BLOCK_REASONS;
          }
        } else {
          shippingBlocked = true;
          completionBlockReason = Object.entries(FULFILLMENT_COMPLETION_BLOCK_REASONS)
            .find(([, value]) => value === completion.reason)?.[0] as keyof typeof FULFILLMENT_COMPLETION_BLOCK_REASONS;
        }
      } else if (order.shippingStatus !== "in_process") {
        await vi.mocked(updateOrder)(id, { shippingStatus: "in_process" });
        order = { ...order, shippingStatus: "in_process" };
        shippingApplied = true;
      }
    }
    const reason = completionBlockReason
      ? FULFILLMENT_COMPLETION_BLOCK_REASONS[completionBlockReason]
      : undefined;
    return {
      order,
      outcome: "applied",
      paymentApplied,
      shippingApplied,
      receiptEnrollmentRequired: paymentApplied,
      shippingBlocked,
      ...(reason ? { completionBlockReason: reason } : {}),
    };
  });
  vi.mocked(applyAdminOrderStatusIntentInSalesSheet).mockImplementation(async (id, intent) => {
    const sheetOrder = await vi.mocked(getOrderRowById)(id);
    if (!sheetOrder) throw new Error("missing Sheet order");
    const current = {
      paymentStatus: sheetOrder.paymentStatus,
      shippingStatus: sheetOrder.shippingStatus,
    };
    const precondition = evaluateAdminStatusIntent(current, intent);
    if (precondition.outcome === "conflict") {
      throw new AdminOrderStateChangedError(id, precondition.current);
    }
    if (precondition.outcome === "idempotent_replay") {
      return {
        outcome: "idempotent_replay",
        current,
        paymentApplied: false,
        shippingApplied: false,
        shippingDeferred: false,
        mpPaymentId: String((sheetOrder.raw as Record<string, unknown>).mp_payment_id || "") || undefined,
        approvedAt: 10,
      };
    }

    let paymentApplied = false;
    let paymentBlockReason: Parameters<typeof getPaymentTransitionBlockMessage>[0] | undefined;
    if (intent.changedFields.includes("paymentStatus") && intent.requestedPaymentStatus) {
      const decision = evaluateAdminPaymentTransitionRequest({
        current: sheetOrder.paymentStatus,
        requested: intent.requestedPaymentStatus,
        paymentMethod: sheetOrder.paymentMethod,
      });
      if (decision.allowed && decision.authority === "mp_authoritative") {
        return {
          outcome: "provider_confirmation_required",
          current,
          paymentApplied: false,
          shippingApplied: false,
          shippingDeferred: false,
        };
      }
      if (!decision.allowed) {
        paymentBlockReason = decision.reason;
      } else if (!decision.replay) {
        const raw = sheetOrder.raw as Record<string, unknown>;
        sheetOrder.paymentStatus = "confirmed";
        raw.mp_payment_id = `manual-${id}`;
        raw.approved_at = new Date(10).toISOString();
        await vi.mocked(updateOrderRowInSalesSheet)(id, {
          paymentStatus: "confirmed",
          mpPaymentId: `manual-${id}`,
          receiptOutboxVersion: 1,
          approvedAt: 10,
        });
        paymentApplied = true;
      }
    }

    const inventoryCall = vi.mocked(updateOrderRowInSalesSheet).mock.calls
      .map((call) => call[1])
      .find((updates) => "inventoryStatus" in updates);
    if (inventoryCall && inventoryCall.inventoryStatus) {
      sheetOrder.inventoryStatus = inventoryCall.inventoryStatus;
      if (typeof inventoryCall.stockDeductedAt === "number") {
        sheetOrder.stockDeductedAt = new Date(inventoryCall.stockDeductedAt).toISOString();
      }
    }

    let shippingApplied = false;
    let shippingDeferred = false;
    let completionBlockReason: (typeof FULFILLMENT_COMPLETION_BLOCK_REASONS)[keyof typeof FULFILLMENT_COMPLETION_BLOCK_REASONS] | undefined;
    if (!paymentBlockReason && intent.changedFields.includes("shippingStatus") && intent.requestedShippingStatus) {
      const projected = baseOrder({
        externalReference: id,
        paymentStatus: sheetOrder.paymentStatus,
        shippingStatus: sheetOrder.shippingStatus,
        paymentMethod: sheetOrder.paymentMethod,
        deliveryMethod: sheetOrder.deliveryMethod,
        inventoryStatus: sheetOrder.inventoryStatus,
        stockDeductedAt: sheetOrder.stockDeductedAt ? Date.parse(sheetOrder.stockDeductedAt) : undefined,
        fulfillment: parseFallbackOrderFulfillment(
          sheetOrder.raw as Record<string, unknown>,
          sheetOrder.deliveryMethod,
        ),
      });
      if (intent.requestedShippingStatus === "completed") {
        const completion = evaluateFulfillmentCompletion({ ...projected, shippingStatus: "completed" });
        if (!completion.allowed && paymentApplied && completion.reason === "INVENTORY_NOT_DEDUCTED") {
          shippingDeferred = true;
        } else if (!completion.allowed) {
          completionBlockReason = completion.reason;
        } else {
          sheetOrder.shippingStatus = "completed";
          await vi.mocked(updateOrderRowInSalesSheet)(id, { shippingStatus: "completed" });
          shippingApplied = true;
        }
      }
    }
    return {
      outcome: paymentBlockReason || completionBlockReason ? "business_block" : "applied",
      current: {
        paymentStatus: sheetOrder.paymentStatus,
        shippingStatus: sheetOrder.shippingStatus,
      },
      paymentApplied,
      shippingApplied,
      shippingDeferred,
      ...(paymentBlockReason ? { paymentBlockReason } : {}),
      ...(completionBlockReason ? { completionBlockReason } : {}),
      mpPaymentId: String((sheetOrder.raw as Record<string, unknown>).mp_payment_id || "") || undefined,
      approvedAt: 10,
    };
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
    const current = baseOrder({
      status: "approved",
      paymentStatus: "confirmed",
      inventoryStatus,
    });
    vi.mocked(getOrder).mockResolvedValue(current);
    const result = await save("order-admin-1", "confirmed", "completed");
    expect(result.results[0]).toMatchObject({
      shippingStatus: "in_process",
      shippingBlocked: true,
      completionBlockReason: "INVENTORY_REQUIRES_ATTENTION",
      completionBlockMessage: "El inventario requiere atención.",
    });
  });

  it("PR2-SHIP-03 deducted can become completed", async () => {
    const current = baseOrder({
      status: "approved",
      paymentStatus: "confirmed",
      inventoryStatus: "deducted",
      stockDeductedAt: 10,
    });
    vi.mocked(getOrder).mockResolvedValue(current);
    vi.mocked(updateOrder).mockImplementation(async (_id, patch) => ({ ...current, ...patch }));
    const result = await save("order-admin-1", "confirmed", "completed");
    expect(result.results[0]).toMatchObject({ shippingStatus: "completed", shippingBlocked: false });
    expect(updateOrder).toHaveBeenCalledWith("order-admin-1", { shippingStatus: "completed" });
    expect(ensurePurchaseReceiptEventSafely).not.toHaveBeenCalled();
  });

  it.each([
    ["COMBINED-01 confirm plus completed with stock success completes", "deducted", "completed", false],
    ["COMBINED-02 confirm plus completed with conflict keeps in_process", "conflict", "in_process", true],
    ["COMBINED-03 confirm plus completed with error keeps in_process", "error", "in_process", true],
  ] as const)("%s", async (_name, inventoryStatus, expectedShipping, shippingBlocked) => {
    vi.mocked(getOrder).mockResolvedValue(baseOrder());
    const approved = baseOrder({
      status: "approved",
      paymentStatus: "confirmed",
      inventoryStatus,
      ...(inventoryStatus === "deducted" ? { stockDeductedAt: 10 } : {}),
    });
    vi.mocked(markApproved).mockResolvedValue(approved);
    vi.mocked(updateOrder).mockImplementation(async (_id, patch) => ({ ...approved, ...patch }));
    const result = await save("order-admin-1", "confirmed", "completed");
    expect(result.results[0]).toMatchObject({
      inventoryStatus,
      shippingStatus: expectedShipping,
      shippingBlocked,
    });
  });

  it("ADMIN-01 blocks a legacy undefined inventory state", async () => {
    vi.mocked(getOrder).mockResolvedValue(baseOrder({
      status: "approved",
      paymentStatus: "confirmed",
      inventoryStatus: undefined,
    }));
    const result = await save("order-admin-1", "confirmed", "completed");
    expect(result.results[0]).toMatchObject({
      shippingStatus: "in_process",
      shippingBlocked: true,
      completionBlockReason: "INVENTORY_NOT_DEDUCTED",
      completionBlockMessage: "Stock todavía no descontado.",
    });
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
      expect.objectContaining({
        paymentStatus: "confirmed",
        mpPaymentId: "manual-sheet-order-1",
      }),
    );
    expect(vi.mocked(updateOrderRowInSalesSheet).mock.invocationCallOrder[0]).toBeLessThan(
      vi.mocked(ensurePurchaseReceiptEventSafely).mock.invocationCallOrder[0],
    );
  });

  it("does not enroll an already-confirmed legacy Sheets order on Admin resave", async () => {
    vi.mocked(getOrderRowById).mockResolvedValue(baseSheetOrder({ paymentStatus: "confirmed" }));
    await save("sheet-order-1");
    expect(updateOrderRowInSalesSheet).not.toHaveBeenCalled();
    expect(ensurePurchaseReceiptEventSafely).not.toHaveBeenCalled();
  });

  it("PR2-FALLBACK-02 Mercado Pago fallback uses canonical reconciliation", async () => {
    const sheetOrder = baseSheetOrder({ paymentMethod: "mercadopago" });
    vi.mocked(getOrderRowById).mockResolvedValue(sheetOrder);
    const reconciled = baseOrder({
      externalReference: "sheet-order-1",
      paymentMethod: "mercadopago",
      status: "approved",
      paymentStatus: "confirmed",
      inventoryStatus: "deducted",
      stockDeductedAt: 10,
      mpPaymentId: "pay-1",
      mpStatus: "approved",
      mpPaymentLedger: {
        "pay-1": {
          paymentId: "pay-1",
          status: "approved",
          amount: 1000,
          currency: "ARS",
          firstSeenAt: 10,
          lastSeenAt: 10,
          approvedAt: 10,
        },
      },
    });
    vi.mocked(reconcileAdminMercadoPagoConfirmation).mockImplementation(async () => {
      sheetOrder.paymentStatus = "confirmed";
      return {
        order: reconciled,
        activeApprovedPaymentIds: ["pay-1"],
        discoveryComplete: true,
      };
    });
    await save("sheet-order-1");
    expect(reconcileAdminMercadoPagoConfirmation).toHaveBeenCalledWith(expect.objectContaining({
      accessToken: "test-token",
      order: expect.objectContaining({ externalReference: "sheet-order-1" }),
    }));
    expect(decrementProductsStockInSheet).not.toHaveBeenCalled();
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

describe("AUD3 H07 Admin fulfillment completion", () => {
  it("ADMIN-02 rejects direct completion while payment is pending", async () => {
    const current = baseOrder({ inventoryStatus: "deducted", stockDeductedAt: 10 });
    vi.mocked(getOrder).mockResolvedValue(current);
    vi.mocked(updateOrder).mockImplementation(async (_id, patch) => ({ ...current, ...patch }));

    const result = await save(current.externalReference, "pending", "completed");
    expect(result.results[0]).toMatchObject({
      shippingStatus: "in_process",
      completionBlockReason: "PAYMENT_NOT_CONFIRMED",
      completionBlockMessage: "Pago todavía no confirmado.",
    });
  });

  it("ADMIN-03 rejects an incomplete frozen pickup snapshot", async () => {
    const current = baseOrder({
      status: "approved",
      paymentStatus: "confirmed",
      inventoryStatus: "deducted",
      stockDeductedAt: 10,
      fulfillment: undefined,
    });
    vi.mocked(getOrder).mockResolvedValue(current);

    expect((await save(current.externalReference, "confirmed", "completed")).results[0]).toMatchObject({
      shippingStatus: "in_process",
      completionBlockReason: "PICKUP_INCOMPLETE",
      completionBlockMessage: "Faltan datos del punto de retiro.",
    });
  });

  it("ADMIN-04 rejects incoherent authoritative totals", async () => {
    const current = baseOrder({
      status: "approved",
      paymentStatus: "confirmed",
      inventoryStatus: "deducted",
      stockDeductedAt: 10,
      fulfillment: { ...baseOrder().fulfillment!, finalTotal: 900 },
    });
    vi.mocked(getOrder).mockResolvedValue(current);

    expect((await save(current.externalReference, "confirmed", "completed")).results[0]).toMatchObject({
      completionBlockReason: "FULFILLMENT_TOTALS_INVALID",
      completionBlockMessage: "Datos/totales históricos incompletos.",
    });
  });

  it("ADMIN-05 blocks an ordinary refund without changing historical completion", async () => {
    const current = baseOrder({
      status: "approved",
      paymentStatus: "confirmed",
      shippingStatus: "completed",
      inventoryStatus: "deducted",
      stockDeductedAt: 10,
    });
    vi.mocked(getOrder).mockResolvedValue(current);

    expect((await save(
      current.externalReference,
      "refunded",
      "completed",
      "confirmed",
      "completed",
    )).results[0]).toMatchObject({
      shippingStatus: "completed",
      paymentBlocked: true,
      paymentBlockReason: "PAYMENT_CONFIRMED_CANNOT_BE_DOWNGRADED",
    });
    expect(updateOrder).not.toHaveBeenCalled();
  });

  it("COMBINED-04 preserves durable confirmation/inventory but blocks incomplete fulfillment", async () => {
    const current = baseOrder({ paymentMethod: "cash" });
    const approved = baseOrder({
      status: "approved",
      paymentStatus: "confirmed",
      inventoryStatus: "deducted",
      stockDeductedAt: 10,
      fulfillment: undefined,
    });
    vi.mocked(getOrder).mockResolvedValue(current);
    vi.mocked(markApproved).mockResolvedValue(approved);

    const result = await save(current.externalReference, "confirmed", "completed");
    expect(result.results[0]).toMatchObject({
      inventoryStatus: "deducted",
      shippingStatus: "in_process",
      completionBlockReason: "PICKUP_INCOMPLETE",
    });
    expect(ensurePurchaseReceiptEventSafely).toHaveBeenCalledTimes(1);
  });

  it("COMBINED-05 converts a locked completion race into a safe operator reason", async () => {
    const current = baseOrder({ paymentMethod: "cash" });
    const approved = baseOrder({
      status: "approved",
      paymentStatus: "confirmed",
      inventoryStatus: "deducted",
      stockDeductedAt: 10,
    });
    vi.mocked(getOrder).mockResolvedValue(current);
    vi.mocked(markApproved).mockResolvedValue(approved);
    vi.mocked(updateOrder).mockRejectedValueOnce(new FulfillmentCompletionBlockedError(
      FULFILLMENT_COMPLETION_BLOCK_REASONS.inventoryRequiresAttention
    ));

    const result = await save(current.externalReference, "confirmed", "completed");
    expect(result.results[0]).toMatchObject({
      shippingStatus: "in_process",
      completionBlockReason: "INVENTORY_REQUIRES_ATTENTION",
      completionBlockMessage: "El inventario requiere atención.",
    });
    expect(ensurePurchaseReceiptEventSafely).toHaveBeenCalledTimes(1);
  });

  it("FALLBACK-H07-01 completes a valid exact Sheets snapshot after durable inventory success", async () => {
    vi.mocked(getOrder).mockResolvedValue(null);
    vi.mocked(getOrderRowById).mockResolvedValue(baseSheetOrder());

    const result = await save("sheet-order-1", "confirmed", "completed");
    expect(result.results[0]).toMatchObject({
      inventoryStatus: "deducted",
      shippingStatus: "completed",
      shippingBlocked: false,
    });
  });

  it("FALLBACK-H07-02 fails closed when the existing Sheet snapshot is incomplete", async () => {
    vi.mocked(getOrder).mockResolvedValue(null);
    vi.mocked(getOrderRowById).mockResolvedValue(baseSheetOrder({
      paymentStatus: "confirmed",
      inventoryStatus: "deducted",
      stockDeductedAt: "2026-08-01T00:00:00.000Z",
      raw: { items_json: JSON.stringify([{ productId: "p1", qty: 1, unitPrice: 1000 }]) },
    }));

    expect((await save("sheet-order-1", "confirmed", "completed")).results[0]).toMatchObject({
      shippingStatus: "in_process",
      completionBlockReason: "FULFILLMENT_TOTALS_INVALID",
    });
  });

  it("FALLBACK-H07-03 preserves payment and blocks completion on inventory conflict", async () => {
    vi.mocked(getOrder).mockResolvedValue(null);
    vi.mocked(getOrderRowById).mockResolvedValue(baseSheetOrder());
    vi.mocked(decrementProductsStockInSheet).mockRejectedValue(new InventoryOperationError({
      code: "INSUFFICIENT_STOCK",
      message: "none",
    }));

    const result = await save("sheet-order-1", "confirmed", "completed");
    expect(result.results[0]).toMatchObject({
      inventoryStatus: "conflict",
      shippingStatus: "in_process",
      completionBlockReason: "INVENTORY_REQUIRES_ATTENTION",
    });
    expect(updateOrderRowInSalesSheet).toHaveBeenCalledWith(
      "sheet-order-1",
      expect.objectContaining({ paymentStatus: "confirmed" })
    );
  });

  it("FALLBACK-H07-04 rejects a missing pickup reference from existing fields", async () => {
    const sheetOrder = baseSheetOrder({
      paymentStatus: "confirmed",
      inventoryStatus: "deducted",
      stockDeductedAt: "2026-08-01T00:00:00.000Z",
    });
    vi.mocked(getOrder).mockResolvedValue(null);
    vi.mocked(getOrderRowById).mockResolvedValue({
      ...sheetOrder,
      raw: { ...sheetOrder.raw, pickup_point_reference: "" },
    });

    expect((await save("sheet-order-1", "confirmed", "completed")).results[0]).toMatchObject({
      completionBlockReason: "PICKUP_INCOMPLETE",
    });
  });

  it("FALLBACK-H07-05 blocks a terminal financial update and preserves completion", async () => {
    vi.mocked(getOrder).mockResolvedValue(null);
    vi.mocked(getOrderRowById).mockResolvedValue(baseSheetOrder({
      paymentStatus: "confirmed",
      shippingStatus: "completed",
      inventoryStatus: "deducted",
      stockDeductedAt: "2026-08-01T00:00:00.000Z",
    }));

    expect((await save(
      "sheet-order-1",
      "refunded",
      "completed",
      "confirmed",
      "completed",
    )).results[0]).toMatchObject({
      shippingStatus: "completed",
      paymentBlocked: true,
      paymentBlockReason: "PAYMENT_CONFIRMED_CANNOT_BE_DOWNGRADED",
    });
    expect(updateOrderRowInSalesSheet).not.toHaveBeenCalled();
  });

  it("BATCH-01 applies the same policy independently to valid and blocked rows", async () => {
    const valid = baseOrder({
      externalReference: "valid",
      status: "approved",
      paymentStatus: "confirmed",
      inventoryStatus: "deducted",
      stockDeductedAt: 10,
    });
    const blocked = baseOrder({
      externalReference: "blocked",
      status: "approved",
      paymentStatus: "confirmed",
      inventoryStatus: undefined,
    });
    vi.mocked(getOrder).mockImplementation(async (id) => id === "valid" ? valid : blocked);
    vi.mocked(updateOrder).mockImplementation(async (_id, patch) => ({ ...valid, ...patch }));

    const result = await saveOrderStatusesBatchAction([
      {
        orderId: "valid",
        changedFields: ["shippingStatus"],
        expectedShippingStatus: "in_process",
        requestedShippingStatus: "completed",
      },
      {
        orderId: "blocked",
        changedFields: ["shippingStatus"],
        expectedShippingStatus: "in_process",
        requestedShippingStatus: "completed",
      },
    ]);
    expect(result.results).toEqual([
      expect.objectContaining({ orderId: "valid", shippingStatus: "completed", shippingBlocked: false }),
      expect.objectContaining({ orderId: "blocked", completionBlockReason: "INVENTORY_NOT_DEDUCTED" }),
    ]);
  });

  it("BATCH-02 rejects forged enum values before any persistence", async () => {
    await expect(saveOrderStatusesBatchAction([{
      orderId: "order-admin-1",
      changedFields: ["shippingStatus"],
      expectedShippingStatus: "in_process",
      requestedShippingStatus: "delivered" as never,
    }])).rejects.toThrow("Invalid batch order update payload");
    expect(updateOrder).not.toHaveBeenCalled();
  });
});

describe("AUD3 H07-C1 Admin action outcomes", () => {
  const paymentIntent = (orderId: string) => ({
    orderId,
    changedFields: ["paymentStatus" as const],
    expectedPaymentStatus: "pending" as const,
    requestedPaymentStatus: "confirmed" as const,
  });

  it("H07C1-BATCH-02 continues safely and distinguishes all four outcomes", async () => {
    vi.mocked(getOrder).mockImplementation(async (id) => baseOrder({ externalReference: id }));
    vi.mocked(applyAdminOrderStatusIntent).mockImplementation(async (id) => {
      if (id === "blocked") {
        throw new PaymentTransitionBlockedError(
          PAYMENT_TRANSITION_BLOCK_REASONS.notAllowed
        );
      }
      if (id === "stale") {
        throw new AdminOrderStateChangedError(id, {
          paymentStatus: "cancelled",
          shippingStatus: "in_process",
        });
      }
      if (id === "failed") throw new Error("synthetic per-Order failure");
      return {
        order: baseOrder({ externalReference: id }),
        outcome: "applied",
        paymentApplied: false,
        shippingApplied: false,
        receiptEnrollmentRequired: false,
        shippingBlocked: false,
      };
    });

    const result = await saveOrderStatusesBatchAction([
      paymentIntent("saved"),
      paymentIntent("blocked"),
      paymentIntent("stale"),
      paymentIntent("failed"),
    ]);
    expect(result.ok).toBe(false);
    expect(result.results.map((entry) => [entry.orderId, entry.status])).toEqual([
      ["saved", "success"],
      ["blocked", "business_block"],
      ["stale", "conflict"],
      ["failed", "failure"],
    ]);
    expect(result.results[2]).toMatchObject({
      code: "ORDER_STATE_CHANGED",
      paymentStatus: "cancelled",
    });
  });

  it("H07C1-CASH-01 enrolls one coherent receipt for concurrent same-intent calls", async () => {
    const canonical = baseOrder({
      paymentMethod: "cash",
      status: "approved",
      paymentStatus: "confirmed",
      inventoryStatus: "deducted",
      stockDeductedAt: 20,
      mpPaymentId: "manual-order-admin-1",
      approvedAt: 10,
      receiptOutboxVersion: 1,
    });
    vi.mocked(applyAdminOrderStatusIntent)
      .mockResolvedValueOnce({
        order: canonical,
        outcome: "applied",
        paymentApplied: true,
        shippingApplied: false,
        receiptEnrollmentRequired: true,
        shippingBlocked: false,
      })
      .mockResolvedValueOnce({
        order: canonical,
        outcome: "idempotent_replay",
        paymentApplied: false,
        shippingApplied: false,
        receiptEnrollmentRequired: false,
        shippingBlocked: false,
      });

    const [first, second] = await Promise.all([
      saveOrderStatusesBatchAction([paymentIntent(canonical.externalReference)]),
      saveOrderStatusesBatchAction([paymentIntent(canonical.externalReference)]),
    ]);
    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    expect(ensurePurchaseReceiptEventSafely).toHaveBeenCalledTimes(1);
    expect(ensurePurchaseReceiptEventSafely).toHaveBeenCalledWith({
      order: canonical,
      paymentId: "manual-order-admin-1",
      approvedAt: 10,
    });
  });
});

describe("AUD3 H07-B Admin payment authority", () => {
  it.each(["pending", "cancelled", "refunded", "charged_back"] as const)(
    "AUD3-H07B-ADMIN-03/05 blocks confirmed to %s",
    async (requested) => {
      const current = baseOrder({
        paymentMethod: "cash",
        status: "approved",
        paymentStatus: "confirmed",
        approvedAt: 100,
      });
      vi.mocked(getOrder).mockResolvedValue(current);

      expect((await save(
        current.externalReference,
        requested,
        "in_process",
        "confirmed",
      )).results[0]).toMatchObject({
        paymentBlocked: true,
        paymentBlockReason: "PAYMENT_CONFIRMED_CANNOT_BE_DOWNGRADED",
      });
      expect(markApproved).not.toHaveBeenCalled();
      expect(updateOrder).not.toHaveBeenCalled();
      expect(ensurePurchaseReceiptEventSafely).not.toHaveBeenCalled();
    }
  );

  it.each([
    ["cancelled", "confirmed"],
    ["refunded", "pending"],
    ["charged_back", "confirmed"],
  ] as const)(
    "AUD3-H07B-ADMIN-06/07 blocks %s to %s",
    async (currentStatus, requested) => {
      const current = baseOrder({
        paymentMethod: "transfer",
        status: currentStatus,
        paymentStatus: currentStatus,
      });
      vi.mocked(getOrder).mockResolvedValue(current);

      expect((await save(
        current.externalReference,
        requested,
        "in_process",
        currentStatus,
      )).results[0]).toMatchObject({
        paymentBlocked: true,
        paymentBlockReason: "PAYMENT_TERMINAL_REQUIRES_CORRECTION",
      });
    }
  );

  it("AUD3-H07B-REPLAY-01 confirmed replay is financially inert", async () => {
    const current = baseOrder({
      paymentMethod: "cash",
      status: "approved",
      paymentStatus: "confirmed",
      approvedAt: 100,
      inventoryStatus: "pending",
    });
    vi.mocked(getOrder).mockResolvedValue(current);

    await save(current.externalReference, "confirmed", "in_process");
    expect(markApproved).not.toHaveBeenCalled();
    expect(ensurePurchaseReceiptEventSafely).not.toHaveBeenCalled();
    expect(updateOrder).not.toHaveBeenCalled();
  });

  it("AUD3-H07B-MP-01 routes verified approval through canonical ledger reconciliation", async () => {
    const current = baseOrder({ paymentMethod: "mercadopago" });
    const reconciled = baseOrder({
      paymentMethod: "mercadopago",
      status: "approved",
      paymentStatus: "confirmed",
      mpPaymentId: "pay-admin-1",
      mpStatus: "approved",
      inventoryStatus: "deducted",
      stockDeductedAt: 10,
      receiptOutboxVersion: 1,
      mpPaymentLedger: {
        "pay-admin-1": {
          paymentId: "pay-admin-1",
          status: "approved",
          amount: 1000,
          currency: "ARS",
          firstSeenAt: 10,
          lastSeenAt: 10,
          approvedAt: 10,
        },
      },
    });
    let storedOrder = current;
    vi.mocked(getOrder).mockImplementation(async () => storedOrder);
    vi.mocked(reconcileAdminMercadoPagoConfirmation).mockImplementation(async () => {
      storedOrder = reconciled;
      return {
        order: reconciled,
        activeApprovedPaymentIds: ["pay-admin-1"],
        discoveryComplete: true,
      };
    });

    const result = await save(current.externalReference, "confirmed");
    expect(result.results[0]).toMatchObject({ inventoryStatus: "deducted" });
    expect(reconcileAdminMercadoPagoConfirmation).toHaveBeenCalledWith(expect.objectContaining({
      accessToken: "test-token",
      order: expect.objectContaining({ externalReference: current.externalReference }),
    }));
    expect(markApproved).not.toHaveBeenCalled();
    expect(ensurePurchaseReceiptEventSafely).not.toHaveBeenCalled();
  });

  it("AUD3-H07B-MP-02 fails closed when MP does not report approval", async () => {
    const current = baseOrder({ paymentMethod: "mercadopago" });
    vi.mocked(getOrder).mockResolvedValue(current);
    vi.mocked(reconcileAdminMercadoPagoConfirmation).mockRejectedValue(
      new PaymentTransitionBlockedError(
        PAYMENT_TRANSITION_BLOCK_REASONS.mercadoPagoNotApproved
      )
    );

    expect((await save(current.externalReference, "confirmed")).results[0]).toMatchObject({
      paymentBlocked: true,
      paymentBlockReason: "PAYMENT_MP_NOT_APPROVED",
      paymentBlockMessage: "Mercado Pago no informa este pago como aprobado.",
    });
    expect(markApproved).not.toHaveBeenCalled();
  });

  it("AUD3-H07B-FALLBACK-03 blocks a Sheet-only confirmed downgrade", async () => {
    vi.mocked(getOrder).mockResolvedValue(null);
    vi.mocked(getOrderRowById).mockResolvedValue(baseSheetOrder({
      paymentMethod: "cash",
      paymentStatus: "confirmed",
    }));

    expect((await save("sheet-order-1", "pending")).results[0]).toMatchObject({
      paymentBlocked: true,
      paymentBlockReason: "PAYMENT_CONFIRMED_CANNOT_BE_DOWNGRADED",
    });
    expect(updateOrderRowInSalesSheet).not.toHaveBeenCalled();
  });

  it("AUD3-H07B-FALLBACK-06 fails closed when canonical MP authority is unavailable", async () => {
    vi.mocked(getOrder).mockResolvedValue(null);
    vi.mocked(getOrderRowById).mockResolvedValue(baseSheetOrder({
      paymentMethod: "mercadopago",
    }));
    vi.mocked(reconcileAdminMercadoPagoConfirmation).mockRejectedValue(
      new PaymentTransitionBlockedError(
        PAYMENT_TRANSITION_BLOCK_REASONS.providerAuthorityRequired
      )
    );

    expect((await save("sheet-order-1", "confirmed")).results[0]).toMatchObject({
      paymentBlocked: true,
      paymentBlockReason: "PAYMENT_PROVIDER_AUTHORITY_REQUIRED",
    });
    expect(updateOrderRowInSalesSheet).not.toHaveBeenCalled();
    expect(decrementProductsStockInSheet).not.toHaveBeenCalled();
  });

  it("H07C1-BATCH-01 rejects duplicate IDs before any transition", async () => {
    let current = baseOrder({ externalReference: "duplicate", paymentMethod: "cash" });
    vi.mocked(getOrder).mockImplementation(async () => current);
    vi.mocked(markApproved).mockImplementation(async () => {
      current = {
        ...current,
        status: "approved",
        paymentStatus: "confirmed",
        approvedAt: 100,
        inventoryStatus: "deducted",
        stockDeductedAt: 100,
      };
      return current;
    });

    await expect(saveOrderStatusesBatchAction([
      {
        orderId: "duplicate",
        changedFields: ["paymentStatus"],
        expectedPaymentStatus: "pending",
        requestedPaymentStatus: "confirmed",
      },
      {
        orderId: "duplicate",
        changedFields: ["paymentStatus"],
        expectedPaymentStatus: "pending",
        requestedPaymentStatus: "confirmed",
      },
    ])).rejects.toThrow("El lote contiene pedidos duplicados");

    expect(current.paymentStatus).toBe("pending");
    expect(markApproved).not.toHaveBeenCalled();
    expect(ensurePurchaseReceiptEventSafely).not.toHaveBeenCalled();
  });
});
