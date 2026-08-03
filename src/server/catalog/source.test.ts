import { describe, expect, it } from "vitest";

import { adaptAuthoritativeCatalogRows } from "./source";

describe("authoritative catalog source adapter", () => {
  it("uses only strict inventory metadata supplied by Apps Script", () => {
    expect(adaptAuthoritativeCatalogRows([{
      id: "a",
      name: "Producto A",
      price: 999999,
      currency: "ARS",
      active: true,
      stock_status: "in_stock",
      stock_qty: 999,
      authoritative_price: 1000,
      authoritative_currency: "ARS",
      authoritative_active: null,
      authoritative_stock_status: null,
      authoritative_stock_qty: null,
    }])).toEqual([{
      id: "a",
      name: "Producto A",
      price: 1000,
      currency: "ARS",
      active: null,
      stock_status: null,
      stock_qty: null,
    }]);
  });

  it("preserves duplicate rows for downstream integrity validation", () => {
    const rows = adaptAuthoritativeCatalogRows([
      { id: "a", authoritative_price: 1, authoritative_currency: "ARS" },
      { id: "a", authoritative_price: 2, authoritative_currency: "ARS" },
    ]);
    expect(rows).toHaveLength(2);
    expect(rows.map((row) => row.id)).toEqual(["a", "a"]);
  });
});
