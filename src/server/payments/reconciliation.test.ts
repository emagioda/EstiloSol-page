import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Order } from "@/src/server/orders/types";

const { scheduledTasks } = vi.hoisted(() => ({ scheduledTasks: [] as Promise<void>[] }));

vi.mock("@/src/server/sheets/repository", () => ({
  appendOrderToSalesSheet: vi.fn(async () => undefined),
  decrementProductsStockInSheet: vi.fn(async () => ({ deduped: false, updated: [] })),
  updateOrderRowInSalesSheet: vi.fn(async () => undefined),
  UPDATE_ORDER_ROW_WORST_CASE_MS: 48_800,
}));
vi.mock("@/src/server/catalog/getProducts", () => ({
  invalidateProductsCatalogCache: vi.fn(async () => undefined),
}));
vi.mock("@/src/server/notifications/orderReceipt", () => ({
  sendOrderReceiptEmail: vi.fn(async () => ({ sent: true })),
}));
vi.mock("@/src/server/http/afterResponse", () => ({
  scheduleAfterResponse: vi.fn((task: () => Promise<void> | void) => {
    scheduledTasks.push(Promise.resolve().then(task));
  }),
}));

import { sendOrderReceiptEmail } from "@/src/server/notifications/orderReceipt";
import { createOrder, getOrder } from "@/src/server/orders/store";
import {
  appendOrderToSalesSheet,
  decrementProductsStockInSheet,
} from "@/src/server/sheets/repository";
import {
  reconcileMercadoPagoPayment,
  reconcileMercadoPagoPaymentObservations,
} from "./reconciliation";

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

describe("AUD3 shared Mercado Pago reconciliation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    scheduledTasks.splice(0);
    vi.mocked(decrementProductsStockInSheet).mockResolvedValue({ deduped: false, updated: [] });
    vi.mocked(sendOrderReceiptEmail).mockResolvedValue({ sent: true });
  });

  it("AUD3-PAY-01 duplicate approval triggers inventory and receipt once", async () => {
    const order = await makeOrder();
    await reconcile(order, "A", "approved");
    await reconcile(order, "A", "approved");
    await flushReceipts();
    const stored = await getOrder(order.externalReference);

    expect(stored?.paymentStatus).toBe("confirmed");
    expect(Object.keys(stored?.mpPaymentLedger ?? {})).toEqual(["A"]);
    expect(decrementProductsStockInSheet).toHaveBeenCalledTimes(1);
    expect(sendOrderReceiptEmail).toHaveBeenCalledTimes(1);
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
    expect(sendOrderReceiptEmail).toHaveBeenCalledTimes(1);
    expect(Object.keys((await getOrder(order.externalReference))?.mpPaymentLedger ?? {})).toEqual(["A"]);
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
    expect(sendOrderReceiptEmail).toHaveBeenCalledTimes(1);
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
      expect(sendOrderReceiptEmail).toHaveBeenCalledTimes(1);
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
    expect(sendOrderReceiptEmail).not.toHaveBeenCalled();
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
    expect(sendOrderReceiptEmail).toHaveBeenCalledTimes(1);
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
    expect(sendOrderReceiptEmail).toHaveBeenCalledTimes(1);
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
    expect(sendOrderReceiptEmail).toHaveBeenCalledTimes(1);
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
    expect(sendOrderReceiptEmail).toHaveBeenCalledTimes(1);
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
    expect(sendOrderReceiptEmail).toHaveBeenCalledTimes(1);
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
    expect(sendOrderReceiptEmail).not.toHaveBeenCalled();
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
    expect(sendOrderReceiptEmail).toHaveBeenCalledTimes(1);
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
