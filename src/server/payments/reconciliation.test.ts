import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Order } from "@/src/server/orders/types";
import type { RecoveryPaymentEvent } from "@/src/server/recovery/types";

const { scheduledTasks } = vi.hoisted(() => ({ scheduledTasks: [] as Promise<void>[] }));

vi.mock("@/src/server/sheets/repository", () => ({
  appendOrderToSalesSheet: vi.fn(async () => ({ deduped: false })),
  decrementProductsStockInSheet: vi.fn(async () => ({ deduped: false, updated: [] })),
  getUniqueOrderRowById: vi.fn(async () => ({ outcome: "missing", order: null })),
  updateOrderRowInSalesSheet: vi.fn(async () => undefined),
  SHEETS_GET_WORST_CASE_MS: 20_300,
  SHEETS_MUTATION_WORST_CASE_MS: 24_400,
  UPDATE_ORDER_ROW_WORST_CASE_MS: 48_800,
}));
vi.mock("@/src/server/catalog/getProducts", () => ({
  invalidateProductsCatalogCache: vi.fn(async () => undefined),
}));
vi.mock("@/src/server/emailOutbox/service", () => ({
  ensurePurchaseReceiptEventSafely: vi.fn(async () => null),
  nudgePurchaseReceiptEvent: vi.fn(),
}));
vi.mock("@/src/server/http/afterResponse", () => ({
  scheduleAfterResponse: vi.fn((task: () => Promise<void> | void) => {
    scheduledTasks.push(Promise.resolve().then(task));
  }),
}));
vi.mock("@/src/server/recovery/service", () => ({
  prepareProtectedPaymentDurability: vi.fn(async () => ({ protected: false })),
  completeRecoveryEvent: vi.fn(async () => undefined),
  markRecoveryEventRetryableSafely: vi.fn(async () => undefined),
  loadRecoveryAuthorityEvidence: vi.fn(async ({ currentEvent }) => ({
    paymentEvents: currentEvent ? [currentEvent] : [],
    receiptEventExists: false,
  })),
}));
vi.mock("@/src/server/recovery/repository", () => ({
  getRecoverySnapshot: vi.fn(async () => null),
  markRecoveryEventState: vi.fn(async () => undefined),
}));

import { ensurePurchaseReceiptEventSafely } from "@/src/server/emailOutbox/service";
import { createOrder, getOrder } from "@/src/server/orders/store";
import {
  appendOrderToSalesSheet,
  decrementProductsStockInSheet,
  getUniqueOrderRowById,
  updateOrderRowInSalesSheet,
} from "@/src/server/sheets/repository";
import {
  reconcileMercadoPagoPayment,
  reconcileMercadoPagoPaymentObservations,
  reconcileRecoveryPaymentEvent,
} from "./reconciliation";
import {
  completeRecoveryEvent,
  markRecoveryEventRetryableSafely,
  prepareProtectedPaymentDurability,
} from "@/src/server/recovery/service";
import { getRecoverySnapshot } from "@/src/server/recovery/repository";
import {
  buildRecoveryOrderSnapshot,
  serializeRecoverySnapshot,
} from "@/src/server/recovery/snapshot";

let sequence = 0;
const makeOrder = async (patch: Partial<Order> = {}) => {
  sequence += 1;
  const order: Order = {
    externalReference: `aud3-pay-${Date.now()}-${sequence}`,
    status: "created",
    paymentStatus: "pending",
    shippingStatus: "in_process",
    inventoryStatus: "pending",
    paymentMethod: "mercadopago",
    items: [{ productId: "p1", title: "Producto", unitPrice: 1000, qty: 1, currency: "ARS" }],
    total: 1000,
    currency: "ARS",
    createdAt: Date.now(),
    updatedAt: Date.now(),
    customer: { name: "Ana", email: "ana@example.com" },
    ...patch,
  };
  await createOrder(order, { syncSheet: false });
  return order;
};

const payment = (order: Order, paymentId: string, status: string, overrides: Record<string, unknown> = {}) => ({
  id: paymentId,
  status,
  status_detail: `${status}_detail`,
  external_reference: order.externalReference,
  transaction_amount: order.total,
  currency_id: order.currency,
  ...overrides,
});

const reconcile = (order: Order, paymentId: string, status: string, overrides: Record<string, unknown> = {}) =>
  reconcileMercadoPagoPayment({
    externalReference: order.externalReference,
    payment: payment(order, paymentId, status, overrides),
    source: "verify_search",
  });

const reconcileBatch = (
  order: Order,
  observations: Array<{ paymentId: string; status: string; observedAt?: number }>
) =>
  reconcileMercadoPagoPaymentObservations({
    externalReference: order.externalReference,
    validationOrder: order,
    observations: observations.map(({ paymentId, status, observedAt }) => ({
      payment: payment(order, paymentId, status),
      source: "verify_search",
      ...(observedAt === undefined ? {} : { observedAt }),
    })),
  });

const flushReceipts = async () => {
  await Promise.all(scheduledTasks.splice(0));
};

const durableEvent = (order: Order): RecoveryPaymentEvent => ({
  eventKey: "d".repeat(64),
  paymentId: "pay_durable_1",
  externalReference: order.externalReference,
  financialStatus: "approved",
  amount: order.total,
  currency: order.currency,
  observedAt: new Date(order.createdAt + 1_000).toISOString(),
  source: "webhook",
  schemaVersion: 1,
  snapshotHash: "e".repeat(64),
  validationState: "validated",
  processingState: "pending",
  attemptCount: 0,
  updatedAt: new Date(order.createdAt + 1_000).toISOString(),
});

describe("AUD3 shared Mercado Pago reconciliation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    scheduledTasks.splice(0);
    vi.mocked(decrementProductsStockInSheet).mockResolvedValue({ deduped: false, updated: [] });
    vi.mocked(prepareProtectedPaymentDurability).mockResolvedValue({ protected: false });
    vi.mocked(completeRecoveryEvent).mockResolvedValue(undefined);
    vi.mocked(getRecoverySnapshot).mockResolvedValue(null);
  });

  it("AUD3-H06-EVT-01 stores protected evidence before inventory/KV/ventas effects", async () => {
    const order = await makeOrder();
    const event = durableEvent(order);
    vi.mocked(prepareProtectedPaymentDurability).mockResolvedValue({
      protected: true,
      outcome: "ready",
      event,
      order,
    });

    const result = await reconcile(order, event.paymentId, "approved", {
      date_last_updated: "2026-08-13T12:00:00.000Z",
    });

    expect(result.outcome).toBe("reconciled");
    expect(prepareProtectedPaymentDurability).toHaveBeenCalledTimes(1);
    expect(decrementProductsStockInSheet).toHaveBeenCalledTimes(1);
    expect(vi.mocked(prepareProtectedPaymentDurability).mock.invocationCallOrder[0]).toBeLessThan(
      vi.mocked(decrementProductsStockInSheet).mock.invocationCallOrder[0],
    );
    expect(completeRecoveryEvent).toHaveBeenCalledWith(event);
    expect(vi.mocked(appendOrderToSalesSheet).mock.invocationCallOrder[0]).toBeLessThan(
      vi.mocked(completeRecoveryEvent).mock.invocationCallOrder[0],
    );
  });

  it("AUD3-H06-EVT-02 performs no local effect when durable event persistence fails", async () => {
    const order = await makeOrder();
    vi.mocked(prepareProtectedPaymentDurability).mockRejectedValueOnce(
      new Error("recovery inbox unavailable"),
    );

    await expect(reconcile(order, "pay_durable_failure", "approved")).rejects.toThrow(
      /inbox unavailable/,
    );
    expect(decrementProductsStockInSheet).not.toHaveBeenCalled();
    expect(appendOrderToSalesSheet).not.toHaveBeenCalled();
    expect(await getOrder(order.externalReference)).toMatchObject({
      paymentStatus: "pending",
      inventoryStatus: "pending",
    });
  });

  it("AUD3-H06-04 worker ensures ventas for a confirmed duplicate event before completion", async () => {
    const now = Date.now();
    const order = await makeOrder({
      status: "approved",
      paymentStatus: "confirmed",
      inventoryStatus: "deducted",
      stockDeductedAt: now,
      salesSheetDeferredUntilApprovedAt: now,
      mpPaymentId: "pay_durable_1",
      mpStatus: "approved",
      mpPaymentLedger: {
        pay_durable_1: {
          paymentId: "pay_durable_1",
          status: "approved",
          amount: 1000,
          currency: "ARS",
          firstSeenAt: now,
          lastSeenAt: now,
          approvedAt: now,
        },
      },
    });
    const event = durableEvent(order);

    const result = await reconcileRecoveryPaymentEvent(event, "worker:h06:04");

    expect(result).toMatchObject({ outcome: "completed" });
    expect(appendOrderToSalesSheet).toHaveBeenCalledTimes(1);
    expect(decrementProductsStockInSheet).not.toHaveBeenCalled();
    expect(completeRecoveryEvent).toHaveBeenCalledWith(event, "worker:h06:04");
  });

  it("AUD3-H06-06/14 retries a durable event after ventas failure without relying on the KV pending index", async () => {
    const now = Date.now();
    const order = await makeOrder({
      status: "approved",
      paymentStatus: "confirmed",
      inventoryStatus: "deducted",
      stockDeductedAt: now,
      salesSheetDeferredUntilApprovedAt: now,
      mpPaymentId: "pay_durable_1",
      mpStatus: "approved",
      mpPaymentLedger: {
        pay_durable_1: {
          paymentId: "pay_durable_1",
          status: "approved",
          amount: 1000,
          currency: "ARS",
          firstSeenAt: now,
          lastSeenAt: now,
          approvedAt: now,
        },
      },
    });
    const event = durableEvent(order);
    vi.mocked(appendOrderToSalesSheet)
      .mockRejectedValueOnce(new Error("ventas unavailable"))
      .mockResolvedValueOnce({ deduped: false });

    await expect(
      reconcileRecoveryPaymentEvent(event, "worker:h06:first"),
    ).rejects.toThrow("RECOVERY_SALES_ROW_NOT_DURABLE");
    const recovered = await reconcileRecoveryPaymentEvent(event, "worker:h06:retry");

    expect(recovered).toMatchObject({ outcome: "completed" });
    expect(appendOrderToSalesSheet).toHaveBeenCalledTimes(2);
    expect(markRecoveryEventRetryableSafely).toHaveBeenCalledWith(
      event,
      "RECOVERY_SALES_ROW_NOT_DURABLE",
      "worker:h06:first",
    );
    expect(completeRecoveryEvent).toHaveBeenCalledWith(event, "worker:h06:retry");
  });

  it("AUD3-H06-07 worker reconstructs expired KV from the independent snapshot and completes the sale", async () => {
    sequence += 1;
    const now = Date.now();
    const order: Order = {
      externalReference: `es-worker-rebuild-${now}-${sequence}`,
      status: "preference_created",
      paymentStatus: "pending",
      shippingStatus: "in_process",
      inventoryStatus: "pending",
      paymentMethod: "mercadopago",
      deliveryMethod: "pickup",
      items: [{ productId: "p1", title: "Producto", unitPrice: 1000, qty: 1, currency: "ARS" }],
      total: 1000,
      currency: "ARS",
      createdAt: now,
      updatedAt: now,
    };
    const snapshot = buildRecoveryOrderSnapshot({
      order,
      checkoutAttemptId: `attempt-worker-rebuild-${sequence}`,
      preferenceValidFrom: now,
      preferenceExpiresAt: now + 48 * 60 * 60 * 1000,
    });
    const serialized = serializeRecoverySnapshot(snapshot);
    vi.mocked(getRecoverySnapshot).mockResolvedValue({
      externalReference: snapshot.externalReference,
      checkoutAttemptId: snapshot.checkoutAttemptId,
      schemaVersion: 1,
      snapshotHash: serialized.snapshotHash,
      snapshotJson: serialized.snapshotJson,
      createdAt: new Date(now).toISOString(),
      preferenceValidFrom: new Date(snapshot.preferenceValidFrom).toISOString(),
      preferenceExpiresAt: new Date(snapshot.preferenceExpiresAt).toISOString(),
      recoveryState: "payment_observed",
      updatedAt: new Date(now).toISOString(),
    });
    const event = durableEvent(order);

    const result = await reconcileRecoveryPaymentEvent(event, "worker:h06:07");

    expect(result).toMatchObject({ outcome: "completed" });
    expect(await getOrder(order.externalReference)).toMatchObject({
      paymentStatus: "confirmed",
      inventoryStatus: "deducted",
    });
    expect(decrementProductsStockInSheet).toHaveBeenCalledTimes(1);
    expect(appendOrderToSalesSheet).toHaveBeenCalledTimes(1);
  });

  it("AUD3-H06-20 worker preserves reversal truth in ventas while KV and snapshot content are unavailable", async () => {
    const event: RecoveryPaymentEvent = {
      ...durableEvent({
        externalReference: `es-reversal-${Date.now()}-${++sequence}`,
        status: "approved",
        paymentStatus: "confirmed",
        shippingStatus: "in_process",
        paymentMethod: "mercadopago",
        items: [],
        total: 1000,
        currency: "ARS",
        createdAt: Date.now(),
        updatedAt: Date.now(),
      }),
      financialStatus: "charged_back",
    };
    vi.mocked(getUniqueOrderRowById).mockResolvedValueOnce({
      outcome: "unique",
      order: {
        orderId: event.externalReference,
        total: event.amount,
        currency: event.currency,
        paymentStatus: "confirmed",
      } as never,
    });

    const result = await reconcileRecoveryPaymentEvent(event, "worker:h06:20");

    expect(result).toEqual({ outcome: "completed", order: null });
    expect(updateOrderRowInSalesSheet).toHaveBeenCalledWith(event.externalReference, {
      paymentStatus: "charged_back",
      orderStatus: "charged_back",
      mpStatus: "charged_back",
      mpPaymentId: event.paymentId,
      updatedAt: Date.parse(event.observedAt),
    });
    expect(decrementProductsStockInSheet).not.toHaveBeenCalled();
    expect(completeRecoveryEvent).toHaveBeenCalledWith(event, "worker:h06:20");
  });

  it("D2B-RECOVERY-01 suppresses direct fallback when KV returns before terminal projection", async () => {
    const now = Date.now();
    const externalReference = `es-reversal-handoff-${now}-${++sequence}`;
    const event: RecoveryPaymentEvent = {
      ...durableEvent({
        externalReference,
        status: "approved",
        paymentStatus: "confirmed",
        shippingStatus: "in_process",
        paymentMethod: "mercadopago",
        items: [],
        total: 1000,
        currency: "ARS",
        createdAt: now,
        updatedAt: now,
      }),
      financialStatus: "charged_back",
    };
    const current: Order = {
      externalReference,
      status: "approved",
      paymentStatus: "confirmed",
      shippingStatus: "in_process",
      inventoryStatus: "deducted",
      stockDeductedAt: now,
      paymentMethod: "mercadopago",
      deliveryMethod: "pickup",
      items: [{ productId: "p1", title: "Producto", unitPrice: 1000, qty: 1, currency: "ARS" }],
      total: 1000,
      currency: "ARS",
      createdAt: now,
      updatedAt: now,
      mpPaymentId: event.paymentId,
      mpStatus: "approved",
      approvedAt: now,
      receiptOutboxVersion: 1,
    };
    vi.mocked(getRecoverySnapshot).mockImplementationOnce(async () => {
      await createOrder(current, { syncSheet: false });
      return null;
    });

    const result = await reconcileRecoveryPaymentEvent(event, "worker:d2b:handoff");

    expect(result).toMatchObject({
      outcome: "completed",
      order: { paymentStatus: "charged_back" },
    });
    await expect(getOrder(externalReference)).resolves.toMatchObject({
      paymentStatus: "charged_back",
      mpPaymentLedger: {
        [event.paymentId]: expect.objectContaining({ status: "charged_back" }),
      },
    });
    expect(completeRecoveryEvent).toHaveBeenCalledWith(event, "worker:d2b:handoff");
  });

  it("D2B-RECOVERY-PRECEDENCE keeps charged_back over an older refunded fallback", async () => {
    const event: RecoveryPaymentEvent = {
      ...durableEvent({
        externalReference: `es-reversal-precedence-${Date.now()}-${++sequence}`,
        status: "approved",
        paymentStatus: "confirmed",
        shippingStatus: "in_process",
        paymentMethod: "mercadopago",
        items: [],
        total: 1000,
        currency: "ARS",
        createdAt: Date.now(),
        updatedAt: Date.now(),
      }),
      financialStatus: "refunded",
    };
    vi.mocked(getUniqueOrderRowById).mockResolvedValueOnce({
      outcome: "unique",
      order: {
        orderId: event.externalReference,
        total: event.amount,
        currency: event.currency,
        paymentStatus: "charged_back",
      } as never,
    });

    await expect(reconcileRecoveryPaymentEvent(event, "worker:d2b:precedence")).resolves.toEqual({
      outcome: "completed",
      order: null,
    });
    expect(updateOrderRowInSalesSheet).not.toHaveBeenCalled();
    expect(completeRecoveryEvent).toHaveBeenCalledWith(event, "worker:d2b:precedence");
  });

  it("D2B-RECOVERY-DUP fails closed before terminal projection and event completion", async () => {
    const event: RecoveryPaymentEvent = {
      ...durableEvent({
        externalReference: `es-reversal-duplicate-${Date.now()}-${++sequence}`,
        status: "approved",
        paymentStatus: "confirmed",
        shippingStatus: "in_process",
        paymentMethod: "mercadopago",
        items: [],
        total: 1000,
        currency: "ARS",
        createdAt: Date.now(),
        updatedAt: Date.now(),
      }),
      financialStatus: "charged_back",
    };
    vi.mocked(getUniqueOrderRowById).mockResolvedValueOnce({
      outcome: "duplicate",
      order: null,
      count: 2,
    });

    await expect(reconcileRecoveryPaymentEvent(event, "worker:d2b:duplicate")).rejects.toMatchObject({
      code: "ORDER_AUTHORITY_DUPLICATE_SALES_ROWS",
    });
    expect(updateOrderRowInSalesSheet).not.toHaveBeenCalled();
    expect(completeRecoveryEvent).not.toHaveBeenCalled();
    expect(markRecoveryEventRetryableSafely).toHaveBeenCalledWith(
      event,
      expect.any(String),
      "worker:d2b:duplicate",
    );
  });

  it("AUD3-PAY-01 duplicate approval triggers inventory and receipt once", async () => {
    const order = await makeOrder();
    await reconcile(order, "A", "approved");
    await reconcile(order, "A", "approved");
    await flushReceipts();
    const stored = await getOrder(order.externalReference);

    expect(stored?.paymentStatus).toBe("confirmed");
    expect(stored?.receiptOutboxVersion).toBe(1);
    expect(Object.keys(stored?.mpPaymentLedger ?? {})).toEqual(["A"]);
    expect(decrementProductsStockInSheet).toHaveBeenCalledTimes(1);
    expect(ensurePurchaseReceiptEventSafely).toHaveBeenCalledTimes(1);
    const markerCallIndex = vi.mocked(appendOrderToSalesSheet).mock.calls.findIndex(
      ([projected]) => projected.receiptOutboxVersion === 1,
    );
    expect(markerCallIndex).toBeGreaterThanOrEqual(0);
    expect(vi.mocked(appendOrderToSalesSheet).mock.invocationCallOrder[markerCallIndex]).toBeLessThan(
      vi.mocked(ensurePurchaseReceiptEventSafely).mock.invocationCallOrder[0],
    );
  });

  it("AUD3-PAY-02 webhook and verify concurrency for one ID has one logical effect", async () => {
    const order = await makeOrder();
    await Promise.all([
      reconcileMercadoPagoPayment({
        externalReference: order.externalReference,
        payment: payment(order, "A", "approved"),
        source: "webhook",
      }),
      reconcileMercadoPagoPayment({
        externalReference: order.externalReference,
        payment: payment(order, "A", "approved"),
        source: "verify_search",
      }),
    ]);
    await flushReceipts();
    expect(decrementProductsStockInSheet).toHaveBeenCalledTimes(1);
    expect(ensurePurchaseReceiptEventSafely).toHaveBeenCalledTimes(1);
    expect(Object.keys((await getOrder(order.externalReference))?.mpPaymentLedger ?? {})).toEqual(["A"]);
  });

  it.each([
    ["AUD3-H06-REF-02", "verify_search"],
    ["AUD3-H06-REF-03", "snapshot_scan"],
  ] as const)("%s rejects protected evidence for another order during %s with zero local mutation", async (_caseId, source) => {
    const order = await makeOrder();
    const before = await getOrder(order.externalReference);
    vi.mocked(prepareProtectedPaymentDurability).mockImplementationOnce(async (input) =>
      input.payment.external_reference === input.expectedExternalReference
        ? { protected: false }
        : { protected: true, outcome: "reference_mismatch" },
    );

    const result = await reconcileMercadoPagoPaymentObservations({
      externalReference: order.externalReference,
      validationOrder: order,
      observations: [{
        payment: payment(order, "B", "approved", {
          external_reference: `${order.externalReference}-other`,
        }),
        source,
      }],
    });

    expect(result).toMatchObject({
      outcome: "reconciled",
      observationResults: [{ outcome: "ignored", reason: "reference_mismatch", order: null }],
      firstEffectiveApproval: false,
    });
    expect(prepareProtectedPaymentDurability).toHaveBeenCalledWith(expect.objectContaining({
      expectedExternalReference: order.externalReference,
      source,
    }));
    expect(await getOrder(order.externalReference)).toEqual(before);
    expect(decrementProductsStockInSheet).not.toHaveBeenCalled();
    expect(appendOrderToSalesSheet).not.toHaveBeenCalled();
    expect(updateOrderRowInSalesSheet).not.toHaveBeenCalled();
    expect(ensurePurchaseReceiptEventSafely).not.toHaveBeenCalled();
  });

  it("AUD3-PAY-07 two approvals retain both and do not repeat effects", async () => {
    const order = await makeOrder();
    await reconcile(order, "A", "approved");
    await reconcile(order, "B", "approved");
    await flushReceipts();
    const stored = await getOrder(order.externalReference);

    expect(stored).toMatchObject({
      paymentStatus: "confirmed",
      mpPaymentAttentionCode: "MULTIPLE_APPROVED_MP_PAYMENTS",
    });
    expect(Object.keys(stored?.mpPaymentLedger ?? {})).toEqual(["A", "B"]);
    expect(decrementProductsStockInSheet).toHaveBeenCalledTimes(1);
    expect(ensurePurchaseReceiptEventSafely).toHaveBeenCalledTimes(1);
  });

  it.each(["refunded", "charged_back"])(
    "AUD3-PAY-08/09 %s does not restock or send another receipt",
    async (status) => {
      const order = await makeOrder();
      await reconcile(order, "A", "approved");
      await flushReceipts();
      await reconcile(order, "A", status);
      await flushReceipts();
      const stored = await getOrder(order.externalReference);

      expect(stored?.paymentStatus).toBe(status);
      expect(stored?.inventoryStatus).toBe("deducted");
      expect(decrementProductsStockInSheet).toHaveBeenCalledTimes(1);
      expect(ensurePurchaseReceiptEventSafely).toHaveBeenCalledTimes(1);
    }
  );

  it.each([
    ["reference_mismatch", { external_reference: "es-other-order" }],
    ["amount_mismatch", { transaction_amount: 999 }],
    ["currency_mismatch", { currency_id: "USD" }],
  ] as const)("AUD3-PAY-12/13/14 ignores %s with zero mutation", async (reason, override) => {
    const order = await makeOrder();
    const before = await getOrder(order.externalReference);
    const result = await reconcile(order, "A", "approved", override);
    const after = await getOrder(order.externalReference);

    expect(result).toMatchObject({ outcome: "ignored", reason });
    expect(after).toEqual(before);
    expect(decrementProductsStockInSheet).not.toHaveBeenCalled();
    expect(ensurePurchaseReceiptEventSafely).not.toHaveBeenCalled();
  });

  it("AUD3-PAY-19 concurrent different IDs cannot lose either ledger entry", async () => {
    const order = await makeOrder();
    await Promise.all([
      reconcile(order, "A", "approved"),
      reconcile(order, "B", "rejected"),
    ]);
    await flushReceipts();
    const stored = await getOrder(order.externalReference);

    expect(stored?.paymentStatus).toBe("confirmed");
    expect(Object.keys(stored?.mpPaymentLedger ?? {}).sort()).toEqual(["A", "B"]);
    expect(decrementProductsStockInSheet).toHaveBeenCalledTimes(1);
    expect(ensurePurchaseReceiptEventSafely).toHaveBeenCalledTimes(1);
  });

  it("AUD3-PAY-CAP-04 capacity compaction cannot repeat inventory or receipt effects", async () => {
    const mpPaymentLedger = Object.fromEntries(
      Array.from({ length: 20 }, (_, index) => {
        const paymentId = `N${index}`;
        return [
          paymentId,
          {
            paymentId,
            status: "rejected",
            amount: 1000,
            currency: "ARS" as const,
            firstSeenAt: index + 1,
            lastSeenAt: index + 1,
          },
        ];
      })
    );
    const order = await makeOrder({ mpPaymentLedger });

    await reconcile(order, "A", "approved");
    await reconcile(order, "A", "approved");
    await flushReceipts();
    const stored = await getOrder(order.externalReference);

    expect(stored?.paymentStatus).toBe("confirmed");
    expect(stored?.mpPaymentLedger).toHaveProperty("A.approvedAt");
    expect(decrementProductsStockInSheet).toHaveBeenCalledTimes(1);
    expect(ensurePurchaseReceiptEventSafely).toHaveBeenCalledTimes(1);
  });

  it("AUD3-PAY-BATCH-02 aggregates two approvals with one inventory and receipt effect", async () => {
    const order = await makeOrder();
    const result = await reconcileBatch(order, [
      { paymentId: "A", status: "approved", observedAt: 10 },
      { paymentId: "B", status: "approved", observedAt: 20 },
    ]);
    await flushReceipts();
    const stored = await getOrder(order.externalReference);

    expect(result).toMatchObject({ outcome: "reconciled", firstEffectiveApproval: true });
    expect(stored).toMatchObject({
      paymentStatus: "confirmed",
      mpPaymentAttentionCode: "MULTIPLE_APPROVED_MP_PAYMENTS",
    });
    expect(Object.keys(stored?.mpPaymentLedger ?? {})).toEqual(["A", "B"]);
    expect(decrementProductsStockInSheet).toHaveBeenCalledTimes(1);
    expect(ensurePurchaseReceiptEventSafely).toHaveBeenCalledTimes(1);
  });

  it("AUD3-PAY-BATCH-03 persists only confirmed for refund plus other approval", async () => {
    const order = await makeOrder();
    const result = await reconcileBatch(order, [
      { paymentId: "A", status: "refunded", observedAt: 10 },
      { paymentId: "B", status: "approved", observedAt: 20 },
    ]);
    await flushReceipts();
    const stored = await getOrder(order.externalReference);

    expect(result).toMatchObject({ outcome: "reconciled", firstEffectiveApproval: true });
    expect(stored?.paymentStatus).toBe("confirmed");
    expect(stored?.mpPaymentLedger).toMatchObject({
      A: { status: "refunded" },
      B: { status: "approved" },
    });
    expect(appendOrderToSalesSheet).toHaveBeenCalledTimes(1);
    expect(vi.mocked(appendOrderToSalesSheet).mock.calls[0]?.[0]).toMatchObject({
      paymentStatus: "confirmed",
      mpPaymentId: "B",
    });
    expect(decrementProductsStockInSheet).toHaveBeenCalledTimes(1);
    expect(ensurePurchaseReceiptEventSafely).toHaveBeenCalledTimes(1);
  });

  it("AUD3-PAY-BATCH-04 applies rejected cancelled and approved as one final aggregate", async () => {
    const order = await makeOrder();
    await reconcileBatch(order, [
      { paymentId: "B", status: "rejected", observedAt: 10 },
      { paymentId: "C", status: "cancelled", observedAt: 20 },
      { paymentId: "A", status: "approved", observedAt: 30 },
    ]);
    await flushReceipts();
    const stored = await getOrder(order.externalReference);

    expect(stored?.paymentStatus).toBe("confirmed");
    expect(Object.keys(stored?.mpPaymentLedger ?? {})).toEqual(["B", "C", "A"]);
    expect(decrementProductsStockInSheet).toHaveBeenCalledTimes(1);
    expect(ensurePurchaseReceiptEventSafely).toHaveBeenCalledTimes(1);
  });

  it("AUD3-PAY-BATCH-05 commits a complete non-approved aggregate normally", async () => {
    const order = await makeOrder();
    const result = await reconcileBatch(order, [
      { paymentId: "B", status: "rejected", observedAt: 10 },
      { paymentId: "C", status: "cancelled", observedAt: 20 },
    ]);
    await flushReceipts();
    const stored = await getOrder(order.externalReference);

    expect(result).toMatchObject({ outcome: "reconciled", firstEffectiveApproval: false });
    expect(stored).toMatchObject({ status: "cancelled", paymentStatus: "cancelled" });
    expect(Object.keys(stored?.mpPaymentLedger ?? {})).toEqual(["B", "C"]);
    expect(decrementProductsStockInSheet).not.toHaveBeenCalled();
    expect(ensurePurchaseReceiptEventSafely).not.toHaveBeenCalled();
  });

  it("AUD3-PAY-BATCH-07 retry is ledger-idempotent with no duplicate effects", async () => {
    const order = await makeOrder();
    const observations = [
      { paymentId: "B", status: "rejected", observedAt: 10 },
      { paymentId: "A", status: "approved", observedAt: 20 },
    ];

    await reconcileBatch(order, observations);
    await flushReceipts();
    const firstLedger = (await getOrder(order.externalReference))?.mpPaymentLedger;
    await reconcileBatch(order, observations);
    await flushReceipts();
    const stored = await getOrder(order.externalReference);

    expect(stored?.mpPaymentLedger).toEqual(firstLedger);
    expect(stored?.paymentStatus).toBe("confirmed");
    expect(decrementProductsStockInSheet).toHaveBeenCalledTimes(1);
    expect(ensurePurchaseReceiptEventSafely).toHaveBeenCalledTimes(1);
  });

  it("AUD3-PREF-10 reconciles valid payment evidence after the preference window time", async () => {
    const order = await makeOrder();
    const expiredWindow = Date.UTC(2026, 7, 1);
    const result = await reconcileMercadoPagoPayment({
      externalReference: order.externalReference,
      payment: payment(order, "A", "approved"),
      source: "webhook",
      observedAt: expiredWindow + 72 * 60 * 60 * 1000,
    });
    await flushReceipts();
    expect(result).toMatchObject({ outcome: "reconciled" });
    expect((await getOrder(order.externalReference))?.paymentStatus).toBe("confirmed");
  });
});
