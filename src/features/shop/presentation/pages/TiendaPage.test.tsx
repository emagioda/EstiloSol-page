import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { Product } from "@/src/features/shop/domain/entities/Product";
import TiendaPage from "./TiendaPage";

const fetchCatalog = vi.hoisted(() => vi.fn());

vi.mock("@/src/server/catalog/source", () => ({
  fetchProductsFromCatalogSource: fetchCatalog,
}));

vi.mock("./TiendaClientView", () => ({
  default: ({
    initialProducts,
    initialCatalogComplete,
  }: {
    initialProducts: Product[];
    initialCatalogComplete: boolean;
  }) => (
    <div>
      <span>{initialProducts.map((product) => product.name).join(",")}</span>
      <span>{initialCatalogComplete ? "complete" : "recoverable"}</span>
    </div>
  ),
}));

describe("TiendaPage server catalog", () => {
  it("AUD5-STORE-01 delivers catalog products in the initial render", async () => {
    fetchCatalog.mockResolvedValueOnce([
      { id: "p1", name: "Ampolla inicial", price: 1000, departament: "PELUQUERIA" },
    ] satisfies Product[]);

    render(await TiendaPage({}));

    expect(screen.getByText("Ampolla inicial")).toBeInTheDocument();
    expect(screen.getByText("complete")).toBeInTheDocument();
  });

  it("AUD5-STORE-02 preserves client recovery when the server catalog is unavailable", async () => {
    fetchCatalog.mockRejectedValueOnce(new Error("temporary catalog failure"));

    render(await TiendaPage({}));

    expect(screen.getByText("recoverable")).toBeInTheDocument();
  });

  it("AUD5-STORE-03 treats a successful empty catalog as complete", async () => {
    fetchCatalog.mockResolvedValueOnce([]);

    render(await TiendaPage({}));

    expect(screen.getByText("complete")).toBeInTheDocument();
  });
});
