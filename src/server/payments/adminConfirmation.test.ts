import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Order } from "@/src/server/orders/types";

const { scheduledTasks } = vi.hoisted(() => ({ scheduledTasks: [] as Promise<void>[] }));

vi.mock("@/src/server/sheets/repository", () => ({
  appendOrderToSalesSheet: vi.fn(async () => ({ deduped: false })),
  decrementProductsStockInSheet: vi.fn(async () => ({ deduped: false, updated: [] })),
  updateOrderRowInSalesSheet: vi.fn(async () => undefined),
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
}));
vi.mock("@/src/server/recovery/repository", () => ({
  getRecoverySnapshot: vi.fn(async () => null),
  markRecoveryEventState: vi.fn(async () => undefined),
}));

import { ensurePurchaseReceiptEventSafely } from "@/src/server/emailOutbox/service";
import { PAYMENT_TRANSITION_BLOCK_REASONS } from "@/src/server/orders/paymentTransition";
import { createOrder, getOrder } from "@/src/server/orders/store";
import { prepareProtectedPaymentDurability } from "@/src/server/recovery/service";
import { decrementProductsStockInSheet } from "@/src/server/sheets/repository";
import { reconcileAdminMercadoPagoConfirmation } from "./adminConfirmation";

const MP_SEARCH_PAGE_SIZE = 20;
let sequence = 0;

const makeOrder = async (patch: Partial<Order> = {}) => {
  sequence += 1;
  const order: Order = {
    externalReference: `admin-page-${Date.now()}-${sequence}`,
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

const mpPayment = (order: Order, id: string, status: string) => ({
  id,
  status,
  status_detail: `${status}_detail`,
  external_reference: order.externalReference,
  transaction_amount: order.total,
  currency_id: order.currency,
});

const rejectedPayments = (order: Order, count: number, prefix: string) =>
  Array.from({ length: count }, (_, index) =>
    mpPayment(order, `${prefix}-${index + 1}`, index % 2 === 0 ? "rejected" : "cancelled")
  );

const searchPage = (total: number, offset: number, results: unknown[]) => ({
  paging: { total, offset, limit: MP_SEARCH_PAGE_SIZE },
  results,
});

const jsonResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });

const confirm = (order: Order) =>
  reconcileAdminMercadoPagoConfirmation({ order, accessToken: "test-token" });

const flushScheduledTasks = async () => {
  await Promise.all(scheduledTasks.splice(0));
};

describe("Admin Mercado Pago complete discovery", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.clearAllMocks();
    scheduledTasks.splice(0);
    vi.mocked(prepareProtectedPaymentDurability)
      .mockReset()
      .mockResolvedValue({ protected: false });
  });

  it("AUD3-H07B-MP-PAGE-01 finds an approval after a full first page", async () => {
    const order = await makeOrder();
    const firstPage = rejectedPayments(order, MP_SEARCH_PAGE_SIZE, "P1");
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(jsonResponse(searchPage(21, 0, firstPage)))
      .mockResolvedValueOnce(jsonResponse(searchPage(21, 20, [
        mpPayment(order, "APPROVED-21", "approved"),
      ])));

    const result = await confirm(order);
    await flushScheduledTasks();

    expect(result).toMatchObject({
      discoveryComplete: true,
      activeApprovedPaymentIds: ["APPROVED-21"],
      order: { paymentStatus: "confirmed" },
    });
    expect(result.order.mpPaymentLedger).toHaveProperty("APPROVED-21");
    const searchUrls = vi.mocked(globalThis.fetch).mock.calls.map(([url]) => String(url));
    expect(searchUrls).toEqual([
      expect.stringContaining("limit=20&offset=0"),
      expect.stringContaining("limit=20&offset=20"),
    ]);
  });

  it("AUD3-H07B-MP-PAGE-02 reconciles approvals on different pages with one fulfillment effect", async () => {
    const order = await makeOrder();
    const firstPage = [
      mpPayment(order, "APPROVED-A", "approved"),
      ...rejectedPayments(order, 19, "P2"),
    ];
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(jsonResponse(searchPage(21, 0, firstPage)))
      .mockResolvedValueOnce(jsonResponse(searchPage(21, 20, [
        mpPayment(order, "APPROVED-B", "approved"),
      ])));

    const result = await confirm(order);
    await flushScheduledTasks();

    expect(result.order).toMatchObject({
      paymentStatus: "confirmed",
      mpPaymentAttentionCode: "MULTIPLE_APPROVED_MP_PAYMENTS",
      mpPaymentLedger: {
        "APPROVED-A": expect.objectContaining({ status: "approved" }),
        "APPROVED-B": expect.objectContaining({ status: "approved" }),
      },
    });
    expect(result.activeApprovedPaymentIds).toEqual(["APPROVED-A", "APPROVED-B"]);
    expect(decrementProductsStockInSheet).toHaveBeenCalledTimes(1);
    expect(ensurePurchaseReceiptEventSafely).toHaveBeenCalledTimes(1);
  });

  it("AUD3-H07B-MP-PAGE-03 retains direct approval A and broad approval B canonically", async () => {
    const directPaymentId = "10003";
    const order = await makeOrder({ mpPaymentId: directPaymentId });
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(jsonResponse(mpPayment(order, directPaymentId, "approved")))
      .mockResolvedValueOnce(jsonResponse(searchPage(1, 0, [
        mpPayment(order, "APPROVED-B", "approved"),
      ])));

    const result = await confirm(order);
    await flushScheduledTasks();

    expect(result.order).toMatchObject({
      paymentStatus: "confirmed",
      mpPaymentAttentionCode: "MULTIPLE_APPROVED_MP_PAYMENTS",
      mpPaymentLedger: {
        [directPaymentId]: expect.objectContaining({ status: "approved" }),
        "APPROVED-B": expect.objectContaining({ status: "approved" }),
      },
    });
    expect(result.activeApprovedPaymentIds).toEqual([directPaymentId, "APPROVED-B"]);
    expect(decrementProductsStockInSheet).toHaveBeenCalledTimes(1);
    expect(ensurePurchaseReceiptEventSafely).toHaveBeenCalledTimes(1);
  });

  it("AUD3-H07B-MP-PAGE-04 deduplicates the direct payment against search", async () => {
    const directPaymentId = "10004";
    const order = await makeOrder({ mpPaymentId: directPaymentId });
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(jsonResponse(mpPayment(order, directPaymentId, "approved")))
      .mockResolvedValueOnce(jsonResponse(searchPage(1, 0, [
        mpPayment(order, directPaymentId, "approved"),
      ])));

    const result = await confirm(order);
    await flushScheduledTasks();

    expect(Object.keys(result.order.mpPaymentLedger ?? {})).toEqual([directPaymentId]);
    expect(result.activeApprovedPaymentIds).toEqual([directPaymentId]);
    expect(prepareProtectedPaymentDurability).toHaveBeenCalledTimes(2);
    expect(decrementProductsStockInSheet).toHaveBeenCalledTimes(1);
    expect(ensurePurchaseReceiptEventSafely).toHaveBeenCalledTimes(1);
  });

  it("AUD3-H07B-MP-PAGE-05 blocks after a complete multi-page search with no approval", async () => {
    const order = await makeOrder();
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(jsonResponse(searchPage(21, 0,
        rejectedPayments(order, MP_SEARCH_PAGE_SIZE, "P5"))))
      .mockResolvedValueOnce(jsonResponse(searchPage(21, 20, [
        mpPayment(order, "P5-21", "rejected"),
      ])));

    await expect(confirm(order)).rejects.toMatchObject({
      reason: PAYMENT_TRANSITION_BLOCK_REASONS.mercadoPagoNotApproved,
    });
    expect(await getOrder(order.externalReference)).toMatchObject({
      status: "created",
      paymentStatus: "pending",
    });
    expect((await getOrder(order.externalReference))?.mpPaymentLedger).toBeUndefined();
    expect(decrementProductsStockInSheet).not.toHaveBeenCalled();
    expect(ensurePurchaseReceiptEventSafely).not.toHaveBeenCalled();
  });

  it("AUD3-H07B-MP-PAGE-06 fails closed when broad discovery is incomplete", async () => {
    const order = await makeOrder();
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      jsonResponse({ message: "search unavailable" }, 400)
    );

    await expect(confirm(order)).rejects.toMatchObject({
      reason: PAYMENT_TRANSITION_BLOCK_REASONS.providerAuthorityRequired,
    });
    expect(await getOrder(order.externalReference)).toMatchObject({ paymentStatus: "pending" });
    expect(decrementProductsStockInSheet).not.toHaveBeenCalled();
    expect(ensurePurchaseReceiptEventSafely).not.toHaveBeenCalled();
  });

  it("AUD3-H07B-MP-PAGE-07 preserves a safely reconciled direct approval after search failure", async () => {
    const directPaymentId = "10007";
    const order = await makeOrder({ mpPaymentId: directPaymentId });
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(jsonResponse(mpPayment(order, directPaymentId, "approved")))
      .mockResolvedValueOnce(jsonResponse(searchPage(21, 0,
        rejectedPayments(order, MP_SEARCH_PAGE_SIZE, "P7"))))
      .mockResolvedValueOnce(jsonResponse({ message: "page unavailable" }, 400));

    const result = await confirm(order);
    await flushScheduledTasks();

    expect(result).toMatchObject({
      discoveryComplete: false,
      activeApprovedPaymentIds: [directPaymentId],
      order: { paymentStatus: "confirmed", mpPaymentId: directPaymentId },
    });
    expect(Object.keys(result.order.mpPaymentLedger ?? {})).toEqual([directPaymentId]);
    expect(decrementProductsStockInSheet).toHaveBeenCalledTimes(1);
    expect(ensurePurchaseReceiptEventSafely).toHaveBeenCalledTimes(1);
  });

  it("AUD3-H07B-MP-PAGE-08 rejects malformed paging without interpreting the prefix", async () => {
    const order = await makeOrder();
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(jsonResponse({
      paging: { total: 1, offset: 1, limit: MP_SEARCH_PAGE_SIZE },
      results: [mpPayment(order, "APPROVED-MALFORMED", "approved")],
    }));

    await expect(confirm(order)).rejects.toMatchObject({
      reason: PAYMENT_TRANSITION_BLOCK_REASONS.providerAuthorityRequired,
    });
    expect(await getOrder(order.externalReference)).toMatchObject({ paymentStatus: "pending" });
    expect(decrementProductsStockInSheet).not.toHaveBeenCalled();
  });

  it("AUD3-H07B-MP-PAGE-09 enforces the 200-result safety ceiling", async () => {
    const order = await makeOrder();
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(jsonResponse(
      searchPage(201, 0, [
        mpPayment(order, "APPROVED-CEILING", "approved"),
        ...rejectedPayments(order, 19, "P9"),
      ])
    ));

    await expect(confirm(order)).rejects.toMatchObject({
      reason: PAYMENT_TRANSITION_BLOCK_REASONS.providerAuthorityRequired,
    });
    expect(await getOrder(order.externalReference)).toMatchObject({ paymentStatus: "pending" });
    expect(decrementProductsStockInSheet).not.toHaveBeenCalled();
  });

  it("AUD3-H07B-MP-PAGE-10 sends one batch observation per normalized payment ID", async () => {
    const order = await makeOrder();
    const duplicateId = "DUPLICATE-10";
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(jsonResponse(searchPage(21, 0, [
        mpPayment(order, duplicateId, "approved"),
        ...rejectedPayments(order, 19, "P10"),
      ])))
      .mockResolvedValueOnce(jsonResponse(searchPage(21, 20, [
        mpPayment(order, duplicateId, "approved"),
      ])));

    const result = await confirm(order);
    await flushScheduledTasks();

    expect(Object.keys(result.order.mpPaymentLedger ?? {})).toHaveLength(20);
    expect(Object.keys(result.order.mpPaymentLedger ?? {}).filter(
      (paymentId) => paymentId === duplicateId
    )).toEqual([duplicateId]);
    expect(prepareProtectedPaymentDurability).toHaveBeenCalledTimes(20);
    expect(decrementProductsStockInSheet).toHaveBeenCalledTimes(1);
    expect(ensurePurchaseReceiptEventSafely).toHaveBeenCalledTimes(1);
  });

  it("AUD3-H07B-MP-PRECEDENCE-01 lets search approval replace a pending direct observation", async () => {
    const paymentId = "11001";
    const order = await makeOrder({ mpPaymentId: paymentId });
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(jsonResponse(mpPayment(order, paymentId, "pending")))
      .mockResolvedValueOnce(jsonResponse(searchPage(1, 0, [
        mpPayment(order, paymentId, "approved"),
      ])));

    const result = await confirm(order);
    await flushScheduledTasks();

    expect(result.order).toMatchObject({
      status: "approved",
      paymentStatus: "confirmed",
      mpPaymentLedger: {
        [paymentId]: expect.objectContaining({ status: "approved" }),
      },
    });
    expect(result.activeApprovedPaymentIds).toEqual([paymentId]);
    expect(prepareProtectedPaymentDurability).toHaveBeenCalledTimes(1);
    expect(decrementProductsStockInSheet).toHaveBeenCalledTimes(1);
    expect(ensurePurchaseReceiptEventSafely).toHaveBeenCalledTimes(1);
  });

  it("AUD3-H07B-MP-PRECEDENCE-02 applies a search refund after durable direct approval", async () => {
    const paymentId = "11002";
    const order = await makeOrder({ mpPaymentId: paymentId });
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(jsonResponse(mpPayment(order, paymentId, "approved")))
      .mockResolvedValueOnce(jsonResponse(searchPage(1, 0, [
        mpPayment(order, paymentId, "refunded"),
      ])));

    await expect(confirm(order)).rejects.toMatchObject({
      reason: PAYMENT_TRANSITION_BLOCK_REASONS.terminalRequiresCorrection,
    });
    await flushScheduledTasks();
    const stored = await getOrder(order.externalReference);

    expect(stored).toMatchObject({
      status: "refunded",
      paymentStatus: "refunded",
      inventoryStatus: "deducted",
      mpPaymentLedger: {
        [paymentId]: expect.objectContaining({
          status: "refunded",
          approvedAt: expect.any(Number),
        }),
      },
    });
    expect(decrementProductsStockInSheet).toHaveBeenCalledTimes(1);
    expect(ensurePurchaseReceiptEventSafely).toHaveBeenCalledTimes(1);
  });

  it("AUD3-H07B-MP-PRECEDENCE-03 applies a search chargeback after durable direct approval", async () => {
    const paymentId = "11003";
    const order = await makeOrder({ mpPaymentId: paymentId });
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(jsonResponse(mpPayment(order, paymentId, "approved")))
      .mockResolvedValueOnce(jsonResponse(searchPage(1, 0, [
        mpPayment(order, paymentId, "charged_back"),
      ])));

    await expect(confirm(order)).rejects.toMatchObject({
      reason: PAYMENT_TRANSITION_BLOCK_REASONS.terminalRequiresCorrection,
    });
    await flushScheduledTasks();
    const stored = await getOrder(order.externalReference);

    expect(stored).toMatchObject({
      status: "charged_back",
      paymentStatus: "charged_back",
      inventoryStatus: "deducted",
      mpPaymentLedger: {
        [paymentId]: expect.objectContaining({
          status: "charged_back",
          approvedAt: expect.any(Number),
        }),
      },
    });
    expect(decrementProductsStockInSheet).toHaveBeenCalledTimes(1);
    expect(ensurePurchaseReceiptEventSafely).toHaveBeenCalledTimes(1);
  });

  it("AUD3-H07B-MP-PRECEDENCE-04 preserves approval history against stale search rejection", async () => {
    const paymentId = "11004";
    const order = await makeOrder({ mpPaymentId: paymentId });
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(jsonResponse(mpPayment(order, paymentId, "approved")))
      .mockResolvedValueOnce(jsonResponse(searchPage(1, 0, [
        mpPayment(order, paymentId, "rejected"),
      ])));

    const result = await confirm(order);
    await flushScheduledTasks();

    expect(result.order).toMatchObject({
      status: "approved",
      paymentStatus: "confirmed",
      inventoryStatus: "deducted",
      mpPaymentLedger: {
        [paymentId]: expect.objectContaining({
          status: "rejected",
          approvedAt: expect.any(Number),
        }),
      },
    });
    expect(result.activeApprovedPaymentIds).toEqual([paymentId]);
    expect(decrementProductsStockInSheet).toHaveBeenCalledTimes(1);
    expect(ensurePurchaseReceiptEventSafely).toHaveBeenCalledTimes(1);
  });

  it("AUD3-H07B-MP-PRECEDENCE-05 appends direct approval when search omits its ID", async () => {
    const paymentId = "11005";
    const order = await makeOrder({ mpPaymentId: paymentId });
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(jsonResponse(mpPayment(order, paymentId, "approved")))
      .mockResolvedValueOnce(jsonResponse(searchPage(0, 0, [])));

    const result = await confirm(order);
    await flushScheduledTasks();

    expect(result.order).toMatchObject({
      status: "approved",
      paymentStatus: "confirmed",
      mpPaymentLedger: {
        [paymentId]: expect.objectContaining({ status: "approved" }),
      },
    });
    expect(result.activeApprovedPaymentIds).toEqual([paymentId]);
    expect(prepareProtectedPaymentDurability).toHaveBeenCalledTimes(2);
    expect(decrementProductsStockInSheet).toHaveBeenCalledTimes(1);
    expect(ensurePurchaseReceiptEventSafely).toHaveBeenCalledTimes(1);
  });
});
