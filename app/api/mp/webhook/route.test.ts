import { createHmac } from "node:crypto";
import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/src/server/sheets/repository", () => ({
  appendOrderToSalesSheet: vi.fn(),
  decrementProductsStockInSheet: vi.fn(),
  updateOrderRowInSalesSheet: vi.fn(),
}));
vi.mock("@/src/server/notifications/orderReceipt", () => ({ sendOrderReceiptEmail: vi.fn() }));

import { POST } from "@/app/api/mp/webhook/route";
import { createOrder, getOrder } from "@/src/server/orders/store";
import {
  appendOrderToSalesSheet,
  decrementProductsStockInSheet,
  updateOrderRowInSalesSheet,
} from "@/src/server/sheets/repository";
import { sendOrderReceiptEmail } from "@/src/server/notifications/orderReceipt";
import { InventoryOperationError } from "@/src/server/inventory/errors";

const signedWebhookRequest = (paymentId: string) => {
  const ts = String(Date.now());
  const xRequestId = "req-1";
  const manifest = `id:${paymentId};request-id:${xRequestId};ts:${ts};`;
  const v1 = createHmac("sha256", "webhook-secret").update(manifest).digest("hex");

  return new NextRequest("http://localhost:3000/api/mp/webhook", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-request-id": xRequestId,
      "x-signature": `ts=${ts},v1=${v1}`,
    },
    body: JSON.stringify({ data: { id: paymentId } }),
  });
};

describe("mercado pago webhook route", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.clearAllMocks();
    process.env.MP_ACCESS_TOKEN = "test-token";
    process.env.MP_WEBHOOK_SECRET = "webhook-secret";
    vi.mocked(appendOrderToSalesSheet).mockResolvedValue(undefined);
    vi.mocked(updateOrderRowInSalesSheet).mockResolvedValue(undefined);
    vi.mocked(decrementProductsStockInSheet).mockResolvedValue({ deduped: false, updated: [] });
    vi.mocked(sendOrderReceiptEmail).mockResolvedValue({ sent: true });
  });

  it("rejects invalid signatures before calling Mercado Pago", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("{}", { status: 200 }));

    const request = new NextRequest("http://localhost:3000/api/mp/webhook", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-request-id": "req-1",
        "x-signature": `ts=${Date.now()},v1=deadbeef`,
      },
      body: JSON.stringify({ data: { id: "12345" } }),
    });

    const response = await POST(request);

    expect(response.status).toBe(401);
    expect(fetchMock).not.toHaveBeenCalled();

    fetchMock.mockRestore();
  });

  it("does not dedupe webhook events when Mercado Pago lookup fails", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("network down"));

    const first = await POST(signedWebhookRequest("12345"));
    const second = await POST(signedWebhookRequest("12345"));

    expect(first.status).toBe(503);
    expect(second.status).toBe(503);
    expect(fetchMock).toHaveBeenCalled();

    fetchMock.mockRestore();
  });

  let paymentSequence = 20000;
  const setupApprovedWebhook = async (inventoryFailure?: unknown) => {
    paymentSequence += 1;
    const paymentId = String(paymentSequence);
    const ref = `es-webhook-pr2-${paymentId}`;
    await createOrder({
      externalReference: ref,
      status: "created",
      paymentStatus: "pending",
      shippingStatus: "in_process",
      inventoryStatus: "pending",
      items: [{ productId: "p1", title: "Producto", unitPrice: 1000, qty: 1, currency: "ARS" }],
      total: 1000,
      currency: "ARS",
      createdAt: Date.now(),
      updatedAt: Date.now(),
      customer: { email: `client-${paymentId}@test.com` },
    }, { syncSheet: false });
    if (inventoryFailure) vi.mocked(decrementProductsStockInSheet).mockRejectedValueOnce(inventoryFailure);
    vi.spyOn(globalThis, "fetch").mockImplementation(async () => new Response(JSON.stringify({
      id: paymentId,
      status: "approved",
      external_reference: ref,
      transaction_amount: 1000,
      currency_id: "ARS",
    }), { status: 200, headers: { "Content-Type": "application/json" } }));
    return { ref, paymentId };
  };

  it("PR2-WEBHOOK-01 approved plus deducted confirms payment and schedules email", async () => {
    const { ref, paymentId } = await setupApprovedWebhook();
    expect((await POST(signedWebhookRequest(paymentId))).status).toBe(200);
    expect(await getOrder(ref)).toMatchObject({ paymentStatus: "confirmed", inventoryStatus: "deducted" });
    await vi.waitFor(() => expect(sendOrderReceiptEmail).toHaveBeenCalledTimes(1));
  });

  it("PR2-WEBHOOK-02 approved plus conflict confirms payment and schedules email", async () => {
    const { ref, paymentId } = await setupApprovedWebhook(new InventoryOperationError({
      code: "INSUFFICIENT_STOCK",
      message: "none",
    }));
    await POST(signedWebhookRequest(paymentId));
    expect(await getOrder(ref)).toMatchObject({ paymentStatus: "confirmed", inventoryStatus: "conflict" });
    await vi.waitFor(() => expect(sendOrderReceiptEmail).toHaveBeenCalledTimes(1));
  });

  it("PR2-WEBHOOK-03 approved plus technical error confirms payment and schedules email", async () => {
    const { ref, paymentId } = await setupApprovedWebhook(new Error("network down"));
    await POST(signedWebhookRequest(paymentId));
    expect(await getOrder(ref)).toMatchObject({ paymentStatus: "confirmed", inventoryStatus: "error" });
    await vi.waitFor(() => expect(sendOrderReceiptEmail).toHaveBeenCalledTimes(1));
  });

  it.each([
    ["PR2-WEBHOOK-04 repeated webhook after conflict does not decrement again", new InventoryOperationError({ code: "INSUFFICIENT_STOCK", message: "none" })],
    ["PR2-WEBHOOK-05 repeated webhook after error does not retry automatically", new Error("network down")],
  ])("%s", async (_name, failure) => {
    const { paymentId } = await setupApprovedWebhook(failure);
    await POST(signedWebhookRequest(paymentId));
    await POST(signedWebhookRequest(paymentId));
    expect(decrementProductsStockInSheet).toHaveBeenCalledTimes(1);
  });

  it("PR2-WEBHOOK-08 repeated approved webhook does not send duplicate receipt", async () => {
    const { paymentId } = await setupApprovedWebhook();
    await POST(signedWebhookRequest(paymentId));
    await POST(signedWebhookRequest(paymentId));
    await vi.waitFor(() => expect(sendOrderReceiptEmail).toHaveBeenCalledTimes(1));
  });
});
