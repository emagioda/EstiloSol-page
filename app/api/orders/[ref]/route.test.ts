import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/src/server/sheets/repository", () => ({
  appendOrderToSalesSheet: vi.fn(async () => undefined),
  decrementProductsStockInSheet: vi.fn(async () => undefined),
  updateOrderRowInSalesSheet: vi.fn(async () => undefined),
}));

import { GET } from "@/app/api/orders/[ref]/route";
import { createOrder } from "@/src/server/orders/store";

const createSummaryOrder = async () => {
  const ref = `es-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const summaryToken = `token-${Math.random().toString(16).slice(2)}`;

  await createOrder({
    externalReference: ref,
    summaryToken,
    status: "pending",
    paymentStatus: "pending",
    shippingStatus: "in_process",
    paymentMethod: "cash",
    deliveryMethod: "pickup",
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

  return { ref, summaryToken };
};

describe("/api/orders/[ref]", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("does not expose a public order summary without summaryToken", async () => {
    const { ref } = await createSummaryOrder();
    const request = new NextRequest(`http://localhost:3000/api/orders/${encodeURIComponent(ref)}`);

    const response = await GET(request, { params: Promise.resolve({ ref }) });
    const body = (await response.json()) as { error?: string };

    expect(response.status).toBe(404);
    expect(body.error).toBe("Pedido no encontrado");
  });

  it("returns the order summary with a valid summaryToken", async () => {
    const { ref, summaryToken } = await createSummaryOrder();
    const request = new NextRequest(
      `http://localhost:3000/api/orders/${encodeURIComponent(ref)}?summaryToken=${encodeURIComponent(summaryToken)}`
    );

    const response = await GET(request, { params: Promise.resolve({ ref }) });
    const body = (await response.json()) as { externalReference?: string; total?: number };

    expect(response.status).toBe(200);
    expect(body.externalReference).toBe(ref);
    expect(body.total).toBe(1000);
  });
});
