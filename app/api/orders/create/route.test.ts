import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/src/server/sheets/repository", () => ({
  appendOrderToSalesSheet: vi.fn(async () => undefined),
  decrementProductsStockInSheet: vi.fn(async () => undefined),
  updateOrderRowInSalesSheet: vi.fn(async () => undefined),
}));

import { POST } from "@/app/api/orders/create/route";
import {
  appendOrderToSalesSheet,
  decrementProductsStockInSheet,
} from "@/src/server/sheets/repository";

describe("orders create manual payment flow", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.clearAllMocks();
    process.env.SHEETS_ENDPOINT = "https://sheets.example.test/catalog";
    process.env.SHEETS_API_TOKEN = "test-sheets-token";
  });

  it("creates cash/transfer orders without decrementing stock", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const url = String(input);
      const method = String(init?.method || "GET").toUpperCase();

      if (url.startsWith("https://sheets.example.test/catalog") && method === "GET") {
        return new Response(
          JSON.stringify([
            {
              id: "p-1",
              name: "Producto 1",
              price: 2000,
              currency: "ARS",
              active: true,
              stock_status: "in_stock",
              stock_qty: 5,
            },
          ]),
          { status: 200, headers: { "Content-Type": "application/json" } }
        );
      }

      throw new Error(`Unexpected fetch url: ${url}`);
    });

    const request = new NextRequest("http://localhost:3000/api/orders/create", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        items: [{ productId: "p-1", qty: 1, name: "Producto 1" }],
        paymentMethod: "cash",
        deliveryMethod: "pickup",
        payer: { name: "Ana", phone: "+5491112345678" },
      }),
    });

    const response = await POST(request);
    const body = (await response.json()) as {
      externalReference?: string;
      summaryToken?: string;
      total?: number;
    };

    expect(response.status).toBe(200);
    expect(body.externalReference?.startsWith("es-")).toBe(true);
    expect(body.summaryToken).toMatch(/^[a-f0-9]{32}$/);
    expect(body.total).toBe(2000);
    expect(appendOrderToSalesSheet).toHaveBeenCalledTimes(1);
    expect(decrementProductsStockInSheet).not.toHaveBeenCalled();

    fetchMock.mockRestore();
  });
});
