import { describe, expect, it } from "vitest";

import { aggregateInventoryItems, type InventoryDemandItem } from "@/src/server/inventory/items";
import type { AuthoritativeCatalogProduct } from "./getProducts";
import { validateAuthoritativeInventory } from "./stock";

const product = (overrides: Partial<AuthoritativeCatalogProduct> = {}): AuthoritativeCatalogProduct => ({
  id: "a",
  name: "Producto A",
  price: 1000,
  currency: "ARS",
  active: true,
  stock_status: "in_stock",
  stock_qty: 3,
  ...overrides,
});

const demand = (
  productId = "a",
  qty = 1,
  requestedUnitPrices: number[] = [],
): InventoryDemandItem => ({ productId, qty, requestedUnitPrices });

const aggregated = (...items: Array<{ productId: string; qty: number; unitPrice?: number }>) => {
  const result = aggregateInventoryItems(items);
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error(result.error.code);
  return result.items;
};

const expectCode = (
  catalog: AuthoritativeCatalogProduct[],
  items: InventoryDemandItem[],
  code: string,
) => {
  const result = validateAuthoritativeInventory(catalog, items);
  expect(result.ok).toBe(false);
  if (result.ok) throw new Error("Expected inventory validation to fail");
  expect(result.errors[0].code).toBe(code);
  return result.errors[0];
};

describe("authoritative catalog inventory validation", () => {
  it("rejects one line above available stock", () => {
    expectCode([product({ stock_qty: 1 })], [demand("a", 2)], "INSUFFICIENT_STOCK");
  });

  it("aggregates two repeated lines before checking stock", () => {
    const items = aggregated({ productId: "a", qty: 1 }, { productId: "a", qty: 1 });
    expect(items).toEqual([{ productId: "a", qty: 2, requestedUnitPrices: [] }]);
    expectCode([product({ stock_qty: 1 })], items, "INSUFFICIENT_STOCK");
  });

  it("accepts repeated lines whose aggregate equals stock", () => {
    const items = aggregated({ productId: "a", qty: 1 }, { productId: "a", qty: 2 });
    const result = validateAuthoritativeInventory([product({ stock_qty: 3 })], items);
    expect(result).toEqual({
      ok: true,
      items: [{ productId: "a", title: "Producto A", unitPrice: 1000, qty: 3, currency: "ARS" }],
    });
  });

  it("rejects repeated lines whose aggregate exceeds stock", () => {
    const items = aggregated({ productId: "a", qty: 2 }, { productId: "a", qty: 1 });
    expectCode([product({ stock_qty: 2 })], items, "INSUFFICIENT_STOCK");
  });

  it("keeps variants with a shared slug separate by product id", () => {
    const catalog = [
      product({ id: "125", name: "Variante A", stock_qty: 1 }),
      product({ id: "126", name: "Variante B", stock_qty: 1 }),
    ];
    const result = validateAuthoritativeInventory(catalog, [demand("125"), demand("126")]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.items.map((item) => item.productId)).toEqual(["125", "126"]);
  });

  it("does not group equal names or images with different product ids", () => {
    const catalog = [
      product({ id: "a", name: "Igual" }),
      product({ id: "b", name: "Igual" }),
    ];
    const result = validateAuthoritativeInventory(catalog, [demand("a"), demand("b")]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.items).toHaveLength(2);
  });

  it("groups the same product id regardless of client names or images", () => {
    const items = aggregated(
      { productId: "a", qty: 1 },
      { productId: "a", qty: 2 },
    );
    const result = validateAuthoritativeInventory([product()], items);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.items).toEqual([
      { productId: "a", title: "Producto A", unitPrice: 1000, qty: 3, currency: "ARS" },
    ]);
  });

  it("rejects a stale client price", () => {
    const error = expectCode([product({ price: 1200 })], [demand("a", 1, [1000])], "PRICE_CHANGED");
    expect(error).toMatchObject({ requestedPrice: 1000, currentPrice: 1200 });
  });

  it("reports the mismatched price when repeated lines contain conflicting client prices", () => {
    const error = expectCode([product({ price: 1000 })], [demand("a", 2, [1000, 1])], "PRICE_CHANGED");
    expect(error).toMatchObject({ requestedPrice: 1, currentPrice: 1000 });
  });

  it("rejects a product removed from the catalog", () => {
    expectCode([], [demand("missing")], "PRODUCT_NOT_FOUND");
  });

  it("rejects active false", () => {
    expectCode([product({ active: false })], [demand()], "PRODUCT_INACTIVE");
  });

  it("fails closed when active is empty", () => {
    expectCode([product({ active: "" })], [demand()], "PRODUCT_INACTIVE");
  });

  it("fails closed when active is unknown", () => {
    expectCode([product({ active: "quizas" })], [demand()], "PRODUCT_INACTIVE");
  });

  it("rejects zero stock even with in_stock status", () => {
    expectCode([product({ stock_qty: 0 })], [demand()], "INVALID_STOCK_QTY");
  });

  it("rejects empty stock even with in_stock status", () => {
    expectCode([product({ stock_qty: "" })], [demand()], "INVALID_STOCK_QTY");
  });

  it("rejects null stock even with in_stock status", () => {
    expectCode([product({ stock_qty: null })], [demand()], "INVALID_STOCK_QTY");
  });

  it("rejects negative stock even with in_stock status", () => {
    expectCode([product({ stock_qty: -1 })], [demand()], "INVALID_STOCK_QTY");
  });

  it("rejects decimal stock even with in_stock status", () => {
    expectCode([product({ stock_qty: 1.5 })], [demand()], "INVALID_STOCK_QTY");
  });

  it("rejects non-numeric stock even with in_stock status", () => {
    expectCode([product({ stock_qty: "mucho" })], [demand()], "INVALID_STOCK_QTY");
  });

  it("rejects unknown stock status with positive stock", () => {
    expectCode([product({ stock_status: "unknown" })], [demand()], "PRODUCT_NOT_AVAILABLE");
  });

  it("rejects unavailable stock status with positive stock", () => {
    expectCode([product({ stock_status: "out_of_stock" })], [demand()], "PRODUCT_NOT_AVAILABLE");
  });

  it("rejects preorder with positive stock", () => {
    expectCode([product({ stock_status: "preorder" })], [demand()], "PRODUCT_NOT_AVAILABLE");
  });

  it("detects duplicate requested product ids before reducing to a map", () => {
    expectCode([product(), product({ name: "Duplicado" })], [demand()], "DUPLICATE_PRODUCT_ID");
  });

  it("does not block a request for an unrelated unique id when another id is duplicated", () => {
    const result = validateAuthoritativeInventory(
      [product(), product({ name: "Duplicado" }), product({ id: "b", name: "Producto B" })],
      [demand("b")],
    );
    expect(result.ok).toBe(true);
  });

  it("validates a kit only through the kit product id", () => {
    const result = validateAuthoritativeInventory(
      [product({ id: "kit-1", name: "Kit", stock_qty: 1 })],
      [demand("kit-1")],
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.items.map((item) => item.productId)).toEqual(["kit-1"]);
  });

  it("uses only authoritative name, price, currency and product id", () => {
    const result = validateAuthoritativeInventory(
      [product({ id: "catalog-a", name: "Nombre real", price: 2500 })],
      [demand("catalog-a", 1, [2500])],
    );
    expect(result).toEqual({
      ok: true,
      items: [{ productId: "catalog-a", title: "Nombre real", unitPrice: 2500, qty: 1, currency: "ARS" }],
    });
  });

  it("rejects invalid authoritative price or currency", () => {
    expectCode([product({ price: Number.NaN })], [demand()], "INVENTORY_VALIDATION_FAILED");
    expectCode([product({ currency: "USD" })], [demand()], "INVENTORY_VALIDATION_FAILED");
  });
});
