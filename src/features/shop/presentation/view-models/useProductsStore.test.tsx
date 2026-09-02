import { act, renderHook, waitFor } from "@testing-library/react";
import { renderToString } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Product } from "@/src/features/shop/domain/entities/Product";
import {
  clearProductsCatalogSessionCache,
  clearShopFiltersSessionState,
  hasSessionCatalogCache,
  prefetchProductsCatalogSession,
  primeProductsCatalogCache,
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

const cachedCatalogA: Product[] = [products[0]];
const emptyServerCatalog: Product[] = [];
const serverCatalogB: Product[] = [
  {
    ...products[0],
    id: "server-b",
    name: "Snapshot del servidor",
  },
];

const CatalogRenderProbe = ({
  initialProducts,
  initialCatalogComplete,
}: {
  initialProducts: Product[];
  initialCatalogComplete: boolean;
}) => {
  const store = useProductsStore({ initialProducts, initialCatalogComplete });
  return <span>{store.allProducts.map((product) => product.id).join(",") || "empty"}</span>;
};

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

  it("prefers a complete server snapshot over an existing catalog cache and syncs the cache", () => {
    primeProductsCatalogCache(cachedCatalogA, { complete: true });

    const store = renderHook(() =>
      useProductsStore({
        initialProducts: serverCatalogB,
        initialCatalogComplete: true,
      }),
    );

    expect(store.result.current.allProducts.map((product) => product.id)).toEqual(["server-b"]);

    store.unmount();
    const restored = renderHook(() => useProductsStore());
    expect(restored.result.current.allProducts.map((product) => product.id)).toEqual(["server-b"]);
  });

  it("treats a complete empty server snapshot as success and removes older cached products", () => {
    primeProductsCatalogCache(cachedCatalogA, { complete: true });

    const store = renderHook(() =>
      useProductsStore({ initialProducts: [], initialCatalogComplete: true }),
    );

    expect(store.result.current.allProducts).toEqual([]);
    expect(store.result.current.status).toBe("success");
    expect(store.result.current.catalogComplete).toBe(true);

    store.unmount();
    const restored = renderHook(() => useProductsStore());
    expect(restored.result.current.allProducts).toEqual([]);
  });

  it("reconciles simultaneous consumers with the complete server snapshot", async () => {
    primeProductsCatalogCache(cachedCatalogA, { complete: true });

    const stores = renderHook(() => ({
      shop: useProductsStore({
        initialProducts: serverCatalogB,
        initialCatalogComplete: true,
      }),
      cart: useProductsStore(),
    }));

    expect(stores.result.current.shop.allProducts.map((product) => product.id)).toEqual([
      "server-b",
    ]);
    await waitFor(() => {
      expect(stores.result.current.cart.allProducts.map((product) => product.id)).toEqual([
        "server-b",
      ]);
    });
  });

  it("clears older products from simultaneous consumers for a complete empty snapshot", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify([]), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
    primeProductsCatalogCache(cachedCatalogA, { complete: true });

    const stores = renderHook(() => ({
      shop: useProductsStore({
        initialProducts: emptyServerCatalog,
        initialCatalogComplete: true,
      }),
      cart: useProductsStore(),
    }));

    expect(stores.result.current.shop.allProducts).toEqual([]);
    await waitFor(() => {
      expect(stores.result.current.cart.allProducts).toEqual([]);
      expect(stores.result.current.cart.status).toBe("success");
      expect(stores.result.current.cart.catalogComplete).toBe(true);
    });

    await act(async () => {
      await expect(stores.result.current.cart.loadProducts()).resolves.toBe(true);
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("keeps cache recovery when the server snapshot is incomplete", () => {
    primeProductsCatalogCache(cachedCatalogA, { complete: true });

    const store = renderHook(() =>
      useProductsStore({
        initialProducts: serverCatalogB,
        initialCatalogComplete: false,
      }),
    );

    expect(store.result.current.allProducts.map((product) => product.id)).toEqual(["p1"]);
    expect(store.result.current.status).toBe("success");
  });

  it("does not mutate the module catalog cache while rendering", () => {
    const serverMarkup = renderToString(
      <CatalogRenderProbe
        initialProducts={serverCatalogB}
        initialCatalogComplete={true}
      />,
    );
    const laterRequestMarkup = renderToString(
      <CatalogRenderProbe initialProducts={[]} initialCatalogComplete={false} />,
    );

    expect(serverMarkup).toContain("server-b");
    expect(laterRequestMarkup).toContain("empty");
    expect(laterRequestMarkup).not.toContain("server-b");
  });

  it("keeps a complete empty catalog through the automatic home prefetch", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify([
          {
            id: "prefetch-product",
            name: "Respuesta incompleta de precarga",
            price: "1500",
            departament: "PELUQUERIA",
            images: "",
          },
        ]),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );
    primeProductsCatalogCache(emptyServerCatalog, { complete: true });

    await expect(prefetchProductsCatalogSession()).resolves.toBe(true);

    expect(fetchMock).not.toHaveBeenCalled();
    primeProductsCatalogCache(serverCatalogB, { complete: false });
    const store = renderHook(() => useProductsStore());
    expect(store.result.current.allProducts).toEqual([]);
    expect(store.result.current.catalogComplete).toBe(true);
  });

  it("restores a complete empty session cache without a home prefetch request", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify(serverCatalogB), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
    window.sessionStorage.setItem(
      "es:shop:catalog:session:v1",
      JSON.stringify({ cachedAt: Date.now(), complete: true, products: [] }),
    );

    await expect(prefetchProductsCatalogSession()).resolves.toBe(true);

    expect(fetchMock).not.toHaveBeenCalled();
    const store = renderHook(() => useProductsStore());
    expect(store.result.current.allProducts).toEqual([]);
    expect(store.result.current.catalogComplete).toBe(true);
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
