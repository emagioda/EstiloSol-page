import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { GET } from "@/app/api/mp/verify-payment/route";
import { createOrder } from "@/src/server/orders/store";

describe("verify-payment confirmation flow", () => {
  beforeEach(() => {
    process.env.MP_ACCESS_TOKEN = "test-token";
  });

  it("confirms approved payment when Mercado Pago reports approval", async () => {
    const ref = `es-${Date.now()}-testok`;

    await createOrder({
      externalReference: ref,
      status: "created",
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
    const body = (await response.json()) as { approved?: boolean; externalReference?: string };

    expect(response.status).toBe(200);
    expect(body.approved).toBe(true);
    expect(body.externalReference).toBe(ref);

    fetchMock.mockRestore();
  });
});
