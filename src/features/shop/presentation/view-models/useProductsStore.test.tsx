import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Product } from "@/src/features/shop/domain/entities/Product";
import {
  clearProductsCatalogSessionCache,
  clearShopFiltersSessionState,
  hasSessionCatalogCache,
  prefetchProductsCatalogSession,
  useProductsStore,
} from "@/src/features/shop/presentation/view-models/useProductsStore";

const products: Product[] = [
  {
    id: "p1",
    name: "Ampolla capilar",
    departament: "PELUQUERIA",
    category: "Tratamientos",
    price: 1000,
    is_sale: true,
  },
  {
    id: "p2",
    name: "Aro dorado",
    departament: "BIJOUTERIE",
    category: "Aros",
    price: 2000,
  },
  {
    id: "p3",
    name: "Siete nudos",
    departament: "BIJOUTERIE",
    category: "Pulsera, Tobillera",
    price: 1999,
  },
];

describe("shop filter session state", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    window.sessionStorage.clear();
    clearProductsCatalogSessionCache();
  });

  it("keeps filters across store remounts when persistence is enabled", async () => {
    const first = renderHook(() =>
      useProductsStore({
        initialProducts: products,
        initialCatalogComplete: true,
        persistFilters: true,
      }),
    );

    act(() => {
      first.result.current.setSearchTerm("ampolla");
      first.result.current.setCategory("Tratamientos");
      first.result.current.togglePromoFilter();
    });

    await waitFor(() => {
      expect(first.result.current.filters.searchTerm).toBe("ampolla");
    });

    first.unmount();

    const second = renderHook(() =>
      useProductsStore({
        initialProducts: products,
        initialCatalogComplete: true,
        persistFilters: true,
      }),
    );

    await waitFor(() => {
      expect(second.result.current.filters).toMatchObject({
        searchTerm: "ampolla",
        category: "Tratamientos",
        showOnlyPromos: true,
      });
    });
  });

  it("clears persisted filters when the home reset runs", async () => {
    const first = renderHook(() =>
      useProductsStore({
        initialProducts: products,
        initialCatalogComplete: true,
        persistFilters: true,
      }),
    );

    act(() => {
      first.result.current.setSearchTerm("ampolla");
    });

    await waitFor(() => {
      expect(first.result.current.filters.searchTerm).toBe("ampolla");
    });

    first.unmount();
    clearShopFiltersSessionState();

    const second = renderHook(() =>
      useProductsStore({
        initialProducts: products,
        initialCatalogComplete: true,
        persistFilters: true,
      }),
    );

    await waitFor(() => {
      expect(second.result.current.filters.searchTerm).toBe("");
    });
  });

  it("splits comma-separated product categories into independent filters", () => {
    const store = renderHook(() =>
      useProductsStore({
        initialProducts: products,
        initialCatalogComplete: true,
        initialDepartament: "BIJOUTERIE",
      }),
    );

    expect(store.result.current.categories).toEqual(["Aros", "Pulsera", "Tobillera"]);

    act(() => {
      store.result.current.setCategory("Pulsera");
    });

    expect(store.result.current.products.map((product) => product.id)).toContain("p3");

    act(() => {
      store.result.current.setCategory("Tobillera");
    });

    expect(store.result.current.products.map((product) => product.id)).toContain("p3");
  });

  it("keeps the selected departament when clearing filters", () => {
    const store = renderHook(() =>
      useProductsStore({
        initialProducts: products,
        initialCatalogComplete: true,
        initialDepartament: "BIJOUTERIE",
      }),
    );

    act(() => {
      store.result.current.setCategory("Aros");
      store.result.current.setSearchTerm("aro");
      store.result.current.clearFilters();
    });

    expect(store.result.current.filters).toMatchObject({
      departament: "BIJOUTERIE",
      category: null,
      searchTerm: "",
    });
  });

  it("AUD5-FILTER-01 combines category and specification filters before sorting", () => {
    const catalog: Product[] = [
      ...products,
      {
        id: "p4",
        name: "Pulsera grande",
        departament: "BIJOUTERIE",
        category: "Pulsera",
        price: 3000,
        specifications: { Material: "Acero" },
      },
      {
        id: "p5",
        name: "Pulsera chica",
        departament: "BIJOUTERIE",
        category: "Pulsera",
        price: 1500,
        specifications: { Material: "Acero" },
      },
    ];
    const store = renderHook(() =>
      useProductsStore({
        initialProducts: catalog,
        initialCatalogComplete: true,
        initialDepartament: "BIJOUTERIE",
      }),
    );

    act(() => {
      store.result.current.setCategory("Pulsera");
      store.result.current.toggleSpecFilter("Material", "Acero");
      store.result.current.setSortBy("price-desc");
    });

    expect(store.result.current.products.map((product) => product.id)).toEqual(["p4", "p5"]);
  });

  it("AUD5-FILTER-02 keeps active filters when changing price sort and supports zero results", () => {
    const store = renderHook(() =>
      useProductsStore({
        initialProducts: products,
        initialCatalogComplete: true,
        initialDepartament: "BIJOUTERIE",
      }),
    );

    act(() => {
      store.result.current.setCategory("Aros");
      store.result.current.setSortBy("price-asc");
    });
    expect(store.result.current.products.map((product) => product.id)).toEqual(["p2"]);

    act(() => {
      store.result.current.setSearchTerm("sin coincidencias");
      store.result.current.setSortBy("price-desc");
    });
    expect(store.result.current.filters.category).toBe("Aros");
    expect(store.result.current.filters.sortBy).toBe("price-desc");
    expect(store.result.current.products).toEqual([]);
  });

  it("AUD5-STORE-04 exposes a successful empty initial catalog without entering loading", () => {
    const store = renderHook(() =>
      useProductsStore({ initialProducts: [], initialCatalogComplete: true }),
    );

    expect(store.result.current.status).toBe("success");
    expect(store.result.current.catalogComplete).toBe(true);
    expect(store.result.current.loading).toBe(false);
  });

  it("keeps home catalog prefetch out of the persistent session cache", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify([
          {
            id: "p4",
            name: "Collar nuevo",
            price: "5000",
            departament: "BIJOUTERIE",
            images: "",
          },
        ]),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );

    await expect(prefetchProductsCatalogSession()).resolves.toBe(true);

    expect(fetchMock).toHaveBeenCalledWith("/api/catalog", { cache: "no-store" });
    expect(hasSessionCatalogCache()).toBe(false);
  });
});
