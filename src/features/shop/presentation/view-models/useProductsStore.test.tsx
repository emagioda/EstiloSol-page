import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import type { Product } from "@/src/features/shop/domain/entities/Product";
import {
  clearShopFiltersSessionState,
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
    window.sessionStorage.clear();
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
});
