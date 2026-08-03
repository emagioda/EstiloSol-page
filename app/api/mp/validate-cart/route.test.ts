import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { POST } from "./route";

const catalogProduct = (overrides: Record<string, unknown> = {}) => ({
  id: "a",
  name: "Producto A",
  currency: "ARS",
  authoritative_price: 1000,
  authoritative_currency: "ARS",
  authoritative_active: true,
  authoritative_stock_status: "in_stock",
  authoritative_stock_qty: 3,
  ...overrides,
});

const request = (items: unknown[]) => new NextRequest("http://localhost/api/mp/validate-cart", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ items }),
});

beforeEach(() => {
  process.env.SHEETS_ENDPOINT = "https://sheets.example.test/catalog";
  process.env.SHEETS_ADMIN_TOKEN = "admin-token";
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("validate-cart authoritative inventory", () => {
  it("rejects repeated lines using their aggregated stock demand", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify([catalogProduct({ authoritative_stock_qty: 1 })]), { status: 200 }),
    );

    const response = await POST(request([
      { productId: "a", qty: 1, unitPrice: 1000 },
      { productId: "a", qty: 1, unitPrice: 1000 },
    ]));
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body).toMatchObject({ code: "INSUFFICIENT_STOCK" });
    expect(body.invalidProducts[0]).toMatchObject({ productId: "a", requestedQty: 2 });
  });

  it("rejects the whole malformed payload before reading the catalog", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch");
    const response = await POST(request([
      { productId: "a", qty: 1 },
      { productId: "b", qty: -1 },
    ]));
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body).toMatchObject({ code: "INVALID_QUANTITY", itemIndex: 1, productId: "b" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects duplicate requested catalog ids with a stable code", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify([catalogProduct(), catalogProduct({ name: "Duplicado" })]), { status: 200 }),
    );

    const response = await POST(request([{ productId: "a", qty: 1 }]));
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body).toMatchObject({ code: "DUPLICATE_PRODUCT_ID" });
  });

  it("accepts distinct variants with the same presentation data", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify([
        catalogProduct({ id: "125", name: "Igual" }),
        catalogProduct({ id: "126", name: "Igual" }),
      ]), { status: 200 }),
    );

    const response = await POST(request([
      { productId: "125", qty: 1 },
      { productId: "126", qty: 1 },
    ]));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({ valid: true, checkedItems: 2 });
  });
});
