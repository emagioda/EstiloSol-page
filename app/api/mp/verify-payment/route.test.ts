import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/src/server/sheets/repository", () => ({
  appendOrderAndDecrementStockInSheet: vi.fn(async () => undefined),
  appendOrderToSalesSheet: vi.fn(async () => undefined),
  decrementProductsStockInSheet: vi.fn(async () => undefined),
  updateOrderRowInSalesSheet: vi.fn(async () => undefined),
}));

import { GET, POST } from "@/app/api/mp/verify-payment/route";
import { createOrder, getOrder } from "@/src/server/orders/store";
import { decrementProductsStockInSheet } from "@/src/server/sheets/repository";

describe("verify-payment confirmation flow", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.clearAllMocks();
    process.env.MP_ACCESS_TOKEN = "test-token";
  });

  it("confirms approved payment when Mercado Pago reports approval", async () => {
    const ref = `es-${Date.now()}-testok`;

    await createOrder({
      externalReference: ref,
      status: "created",
      paymentStatus: "pending",
      shippingStatus: "in_process",
      items: [
        {
          productId: "p1",
          title: "Producto",
          unitPrice: 1000,
          qty: 1,
          currency: "ARS",
        },
      ],
      total: 1000,
      currency: "ARS",
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });

    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          results: [
            {
              id: "pay-1",
              status: "approved",
              external_reference: ref,
              transaction_amount: 1000,
              currency_id: "ARS",
            },
          ],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      )
    );

    const request = new NextRequest("http://localhost:3000/api/mp/verify-payment", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ref }),
    });
    const response = await POST(request);
    const body = (await response.json()) as { approved?: boolean; externalReference?: string };

    expect(response.status).toBe(200);
    expect(body.approved).toBe(true);
    expect(body.externalReference).toBe(ref);
    expect(decrementProductsStockInSheet).toHaveBeenCalledWith(ref, [
      {
        productId: "p1",
        qty: 1,
        title: "Producto",
      },
    ]);

    fetchMock.mockRestore();
  });

  it("does not approve payment_id when order is not found", async () => {
    const ref = `es-${Date.now()}-missingorder`;
    const paymentId = "148769407279";

    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          id: paymentId,
          status: "approved",
          external_reference: ref,
          transaction_amount: 58000,
          currency_id: "ARS",
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      )
    );

    const request = new NextRequest("http://localhost:3000/api/mp/verify-payment", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ref, paymentId }),
    });
    const response = await POST(request);
    const body = (await response.json()) as { approved?: boolean; externalReference?: string; paymentId?: string };

    expect(response.status).toBe(200);
    expect(body.approved).toBe(false);
    expect(body.externalReference).toBeUndefined();
    expect(body.paymentId).toBeUndefined();
    expect(fetchMock).not.toHaveBeenCalled();

    fetchMock.mockRestore();
  });

  it("does not approve when Mercado Pago reports a mismatched amount", async () => {
    const ref = `es-${Date.now()}-badamount`;

    await createOrder({
      externalReference: ref,
      status: "created",
      paymentStatus: "pending",
      shippingStatus: "in_process",
      items: [
        {
          productId: "p1",
          title: "Producto",
          unitPrice: 1000,
          qty: 1,
          currency: "ARS",
        },
      ],
      total: 1000,
      currency: "ARS",
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });

    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          results: [
            {
              id: "pay-1",
              status: "approved",
              external_reference: ref,
              transaction_amount: 1,
              currency_id: "ARS",
            },
          ],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      )
    );

    const request = new NextRequest("http://localhost:3000/api/mp/verify-payment", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ref }),
    });
    const response = await POST(request);
    const body = (await response.json()) as { approved?: boolean };
    const updatedOrder = await getOrder(ref);

    expect(response.status).toBe(200);
    expect(body.approved).toBe(false);
    expect(updatedOrder?.status).toBe("pending");
    expect(decrementProductsStockInSheet).not.toHaveBeenCalled();
  });

  it("rate limits repeated POST confirmation attempts by externalReference", async () => {
    const ref = `es-${Date.now()}-ratelimit`;

    await createOrder({
      externalReference: ref,
      status: "created",
      paymentStatus: "pending",
      shippingStatus: "in_process",
      items: [
        {
          productId: "p1",
          title: "Producto",
          unitPrice: 1000,
          qty: 1,
          currency: "ARS",
        },
      ],
      total: 1000,
      currency: "ARS",
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });

    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ results: [] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })
    );

    let response: Response | null = null;
    for (let index = 0; index < 21; index += 1) {
      const request = new NextRequest("http://localhost:3000/api/mp/verify-payment", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-vercel-forwarded-for": `10.0.0.${index + 1}`,
        },
        body: JSON.stringify({ ref }),
      });
      response = await POST(request);
    }

    expect(response?.status).toBe(429);
    expect(fetchMock).toHaveBeenCalledTimes(20);
  });

  it("updates approved orders when Mercado Pago later reports a refund", async () => {
    const ref = `es-${Date.now()}-refund`;

    await createOrder({
      externalReference: ref,
      status: "approved",
      paymentStatus: "confirmed",
      shippingStatus: "in_process",
      mpPaymentId: "pay-1",
      mpStatus: "approved",
      approvedAt: Date.now(),
      items: [
        {
          productId: "p1",
          title: "Producto",
          unitPrice: 1000,
          qty: 1,
          currency: "ARS",
        },
      ],
      total: 1000,
      currency: "ARS",
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });

    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          results: [
            {
              id: "pay-1",
              status: "refunded",
              external_reference: ref,
              transaction_amount: 1000,
              currency_id: "ARS",
            },
          ],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      )
    );

    const request = new NextRequest("http://localhost:3000/api/mp/verify-payment", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ref }),
    });
    const response = await POST(request);
    const body = (await response.json()) as { approved?: boolean; status?: string };
    const updatedOrder = await getOrder(ref);

    expect(response.status).toBe(200);
    expect(body.approved).toBe(false);
    expect(body.status).toBe("refunded");
    expect(updatedOrder?.status).toBe("refunded");
    expect(updatedOrder?.paymentStatus).toBe("refunded");

    fetchMock.mockRestore();
  });

  it("keeps GET read-only and does not call Mercado Pago", async () => {
    const ref = `es-${Date.now()}-readonly`;

    await createOrder({
      externalReference: ref,
      status: "created",
      paymentStatus: "pending",
      shippingStatus: "in_process",
      items: [
        {
          productId: "p1",
          title: "Producto",
          unitPrice: 1000,
          qty: 1,
          currency: "ARS",
        },
      ],
      total: 1000,
      currency: "ARS",
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });

    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          results: [
            {
              id: "pay-1",
              status: "approved",
              external_reference: ref,
              transaction_amount: 1000,
              currency_id: "ARS",
            },
          ],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      )
    );

    const request = new NextRequest(`http://localhost:3000/api/mp/verify-payment?ref=${encodeURIComponent(ref)}`);
    const response = await GET(request);
    const body = (await response.json()) as { approved?: boolean };
    const order = await getOrder(ref);

    expect(response.status).toBe(200);
    expect(body.approved).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(order?.status).toBe("created");

    fetchMock.mockRestore();
  });
});
