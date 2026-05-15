import { describe, expect, it } from "vitest";

import type { CatalogProduct } from "./getProducts";
import { validateCatalogItem } from "./stock";

const product = (overrides: Partial<CatalogProduct>): CatalogProduct => ({
  id: "p-1",
  name: "Producto 1",
  price: 1000,
  currency: "ARS",
  active: true,
  stock_status: "in_stock",
  stock_qty: null,
  ...overrides,
});

describe("catalog stock validation", () => {
  it("allows uncontrolled stock", () => {
    const catalog = new Map([["p-1", product({ stock_qty: null })]]);

    expect(validateCatalogItem(catalog, { productId: "p-1", qty: 99, name: "Producto 1" })).toBeNull();
  });

  it("blocks out of stock products", () => {
    const catalog = new Map([["p-1", product({ stock_status: "out_of_stock", stock_qty: 0 })]]);

    expect(validateCatalogItem(catalog, { productId: "p-1", qty: 1, name: "Producto 1" })).toMatchObject({
      productId: "p-1",
      reason: "out_of_stock",
      availableQty: 0,
    });
  });

  it("blocks quantities above numeric stock", () => {
    const catalog = new Map([["p-1", product({ stock_qty: 2 })]]);

    expect(validateCatalogItem(catalog, { productId: "p-1", qty: 3, name: "Producto 1" })).toMatchObject({
      productId: "p-1",
      reason: "insufficient_stock",
      availableQty: 2,
      requestedQty: 3,
    });
  });

  it("blocks products whose cart price is stale", () => {
    const catalog = new Map([["p-1", product({ price: 1200, stock_qty: 2 })]]);

    expect(
      validateCatalogItem(catalog, { productId: "p-1", qty: 1, name: "Producto 1", unitPrice: 1000 })
    ).toMatchObject({
      productId: "p-1",
      reason: "price_changed",
      requestedPrice: 1000,
      currentPrice: 1200,
    });
  });

  it("marks missing products as invalid", () => {
    expect(validateCatalogItem(new Map(), { productId: "missing", qty: 1, name: "" })).toMatchObject({
      productId: "missing",
      name: "missing",
      reason: "missing",
    });
  });
});
