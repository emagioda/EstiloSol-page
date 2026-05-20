import { beforeEach, describe, expect, it, vi } from "vitest";

import { GET } from "@/app/api/catalog/route";

describe("/api/catalog", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    process.env.SHEETS_ENDPOINT = "https://sheets.example.test/catalog";
    process.env.SHEETS_API_TOKEN = "catalog-token";
  });

  it("returns normalized public products without exposing the sheets endpoint", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify([
          {
            id: "p-1",
            name: "Producto 1",
            price: "1200",
            active: true,
            stock_status: "in_stock",
            stock_qty: "3",
          },
        ]),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );

    const response = await GET();
    const body = (await response.json()) as Array<Record<string, unknown>>;

    expect(response.status).toBe(200);
    expect(body).toHaveLength(1);
    expect(body[0]).toMatchObject({
      id: "p-1",
      price: 1200,
      stock_status: "in_stock",
      stock_qty: 3,
    });

    const requestedUrl = String(fetchMock.mock.calls[0][0]);
    expect(requestedUrl).toContain("token=catalog-token");
    expect(requestedUrl).toContain("sheet=products");
  });

  it("ignores public force=1 and keeps the cached catalog path", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify([]), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );

    const response = await GET();

    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("public, s-maxage=180, stale-while-revalidate=600");

    const requestedUrl = String(fetchMock.mock.calls[0][0]);
    expect(requestedUrl).not.toContain("force=1");
    expect(requestedUrl).toContain("sheet=products");
  });
});
