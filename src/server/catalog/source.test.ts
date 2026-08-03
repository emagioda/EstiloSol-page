import { afterEach, describe, expect, it, vi } from "vitest";

import {
  adaptAuthoritativeCatalogRows,
  fetchAuthoritativeProductsFromCatalogSource,
} from "./source";

const originalSheetsEndpoint = process.env.SHEETS_ENDPOINT;
const originalSheetsAdminToken = process.env.SHEETS_ADMIN_TOKEN;

afterEach(() => {
  vi.restoreAllMocks();
  if (originalSheetsEndpoint === undefined) delete process.env.SHEETS_ENDPOINT;
  else process.env.SHEETS_ENDPOINT = originalSheetsEndpoint;
  if (originalSheetsAdminToken === undefined) delete process.env.SHEETS_ADMIN_TOKEN;
  else process.env.SHEETS_ADMIN_TOKEN = originalSheetsAdminToken;
});

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

  it("TEST-HF-09 requests the explicit admin-only authoritative Apps Script mode", async () => {
    process.env.SHEETS_ENDPOINT = "https://sheets.example.test/catalog";
    process.env.SHEETS_ADMIN_TOKEN = "admin-token";
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify([
      {
        id: "a",
        name: null,
        authoritative_price: null,
        authoritative_currency: "ARS",
        authoritative_active: true,
        authoritative_stock_status: "in_stock",
        authoritative_stock_qty: 1,
      },
    ]), { status: 200 }));

    const rows = await fetchAuthoritativeProductsFromCatalogSource();
    const requestUrl = new URL(String(fetchMock.mock.calls[0][0]));

    expect(requestUrl.searchParams.get("authoritative")).toBe("1");
    expect(requestUrl.searchParams.get("includeInactive")).toBe("1");
    expect(requestUrl.searchParams.get("force")).toBe("1");
    expect(requestUrl.searchParams.get("token")).toBe("admin-token");
    expect(rows).toEqual([
      expect.objectContaining({ id: "a", name: null, price: null }),
    ]);
  });
});
