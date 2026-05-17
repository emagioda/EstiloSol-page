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
});
