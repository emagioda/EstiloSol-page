"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  fetchProductsFromSheets,
  isMissingSheetsEndpointError,
} from "@/src/features/shop/infrastructure/data/fetchProducts";
import type { Product } from "@/src/features/shop/domain/entities/Product";

export type FilterState = {
  searchTerm: string;
  departament: string | null; // "PELUQUERIA" | "BIJOUTERIE"
  category: string | null;
  sortBy: "price-asc" | "price-desc" | "name-asc" | "name-desc" | "newest";
};

type ProductsStatus = "idle" | "loading" | "success" | "error";
const SESSION_CATALOG_CACHE_KEY = "es:shop:catalog:session:v1";
const CATALOG_CACHE_UPDATED_EVENT = "es:catalog-cache-updated";

// simple in‑memory cache that survives component unmounts while the
// page is still open. it doesn’t persist across full reloads, but it
// guarantees that navigating between store/detail pages won’t trigger a
// network request or a loading spinner.
let cachedProducts: Product[] | null = null;
let cachedProductsSignature: string | null = null;
let catalogPrefetchPromise: Promise<boolean> | null = null;

const setMemoryCatalogCache = (products: Product[]) => {
  cachedProducts = products;
  cachedProductsSignature = productSignature(products);
};

const emitCatalogCacheUpdated = (products: Product[]) => {
  if (typeof window === "undefined") return;
  window.dispatchEvent(
    new CustomEvent(CATALOG_CACHE_UPDATED_EVENT, {
      detail: { products },
    })
  );
};

const readSessionCachedProducts = (): Product[] | null => {
  if (typeof window === "undefined") return null;

  try {
    const raw = window.sessionStorage.getItem(SESSION_CATALOG_CACHE_KEY);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return null;
    return parsed as Product[];
  } catch {
    return null;
  }
};

export const hasSessionCatalogCache = () => {
  if (typeof window === "undefined") return false;

  try {
    return Boolean(window.sessionStorage.getItem(SESSION_CATALOG_CACHE_KEY));
  } catch {
    return false;
  }
};

const writeSessionCachedProducts = (products: Product[]) => {
  if (typeof window === "undefined") return;

  try {
    window.sessionStorage.setItem(SESSION_CATALOG_CACHE_KEY, JSON.stringify(products));
  } catch {
    return;
  }
};

const productSignature = (products: Product[]): string =>
  [...products]
    .map((product) => {
      const imagesCount = Array.isArray(product.images) ? product.images.length : 0;
      const includesCount = Array.isArray(product.includes) ? product.includes.length : 0;
      const tagsCount = Array.isArray(product.tags) ? product.tags.length : 0;
      return [
        product.id,
        product.slug ?? "",
        String(product.price),
        product.departament ?? "",
        product.category ?? "",
        product.product_type ?? "",
        product.active === false ? "0" : "1",
        product.is_new ? "1" : "0",
        product.is_sale ? "1" : "0",
        String(imagesCount),
        String(includesCount),
        String(tagsCount),
      ].join("|");
    })
    .sort()
    .join("~");

const updateMemoryCatalogCache = (products: Product[]) => {
  setMemoryCatalogCache(products);
  emitCatalogCacheUpdated(products);
};

const updateCatalogCache = (products: Product[]) => {
  updateMemoryCatalogCache(products);
  writeSessionCachedProducts(products);
};

export const refreshProductsMemoryCacheFromSource = async (): Promise<boolean> => {
  try {
    const data = await fetchProductsFromSheets({
      layer: "client-refresh",
      cacheBust: true,
    });
    updateCatalogCache(data);
    return true;
  } catch {
    return false;
  }
};

export const prefetchProductsCatalogSession = async (): Promise<boolean> => {
  if (cachedProducts && cachedProducts.length > 0) {
    return true;
  }

  const sessionCachedProducts = readSessionCachedProducts();
  if (sessionCachedProducts && sessionCachedProducts.length > 0) {
    updateMemoryCatalogCache(sessionCachedProducts);
    return true;
  }

  if (catalogPrefetchPromise) {
    return catalogPrefetchPromise;
  }

  catalogPrefetchPromise = fetchProductsFromSheets({
    layer: "client-refresh",
    cacheBust: false,
  })
    .then((data) => {
      updateCatalogCache(data);
      return true;
    })
    .catch(() => false)
    .finally(() => {
      catalogPrefetchPromise = null;
    });

  return catalogPrefetchPromise;
};

export const useProductsStore = ({
  initialProducts,
}: {
  initialProducts?: Product[];
} = {}) => {
  const [products, setProducts] = useState<Product[]>(() => {
    if (cachedProducts && cachedProducts.length > 0) {
      if (!cachedProductsSignature) {
        cachedProductsSignature = productSignature(cachedProducts);
      }
      return cachedProducts;
    }

    if (initialProducts && initialProducts.length > 0) {
      setMemoryCatalogCache(initialProducts);
      return initialProducts;
    }

    return initialProducts ?? [];
  });

  const [status, setStatus] = useState<ProductsStatus>(
    // cache takes precedence, otherwise fall back to the value computed
    // from the prop. status is used later so we can decide whether to run
    // the loader effect.
    cachedProducts && cachedProducts.length > 0
      ? "success"
      : initialProducts && initialProducts.length > 0
      ? "success"
      : "idle"
  );
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [selectedProduct, setSelectedProduct] = useState<Product | null>(null);
  const [filters, setFilters] = useState<FilterState>({
    searchTerm: "",
    departament: "PELUQUERIA",
    category: null,
    sortBy: "newest",
  });

  useEffect(() => {
    if (typeof window === "undefined") return;

    const syncFromCache = (event: Event) => {
      const customEvent = event as CustomEvent<{ products?: Product[] }>;
      const eventProducts = customEvent.detail?.products;
      const sourceProducts = Array.isArray(eventProducts)
        ? eventProducts
        : cachedProducts;

      if (!sourceProducts || sourceProducts.length === 0) return;

      setMemoryCatalogCache(sourceProducts);
      setProducts([...sourceProducts]);
      setStatus("success");
      setErrorMessage(null);
    };

    window.addEventListener(CATALOG_CACHE_UPDATED_EVENT, syncFromCache);
    return () => {
      window.removeEventListener(CATALOG_CACHE_UPDATED_EVENT, syncFromCache);
    };
  }, []);

  useEffect(() => {
    const sessionCachedProducts = readSessionCachedProducts();
    if (!sessionCachedProducts || sessionCachedProducts.length === 0) return;

    const sessionSignature = productSignature(sessionCachedProducts);
    if (sessionSignature === cachedProductsSignature) return;

    const hydrateTimer = window.setTimeout(() => {
      setMemoryCatalogCache(sessionCachedProducts);
      setProducts([...sessionCachedProducts]);
      setStatus("success");
      setErrorMessage(null);
    }, 0);

    return () => window.clearTimeout(hydrateTimer);
  }, []);

  const loadProducts = useCallback(async (forceRefresh = false): Promise<boolean> => {
    // if we've already fetched once this session just reuse the data
    if (!forceRefresh && cachedProducts && cachedProducts.length > 0) {
      setProducts(cachedProducts);
      setStatus("success");
      return true;
    }

    setStatus("loading");
    setErrorMessage(null);

    try {
      const data = await fetchProductsFromSheets({
        layer: "client-refresh",
        cacheBust: forceRefresh,
      });

      const nextSignature = productSignature(data);
      const hasChanged = nextSignature !== cachedProductsSignature;

      updateCatalogCache(data);

      setProducts((prev) => {
        if (hasChanged || prev.length === 0 || status === "error") {
          return data;
        }
        return prev;
      });

      setStatus("success");
      return true;
    } catch (error) {
      if (!isMissingSheetsEndpointError(error)) {
        console.error("Error fetching products:", error);
      }

      setProducts([]);
      setStatus("error");
      const message =
        error instanceof Error
          ? error.message
          : "No se pudo cargar el catálogo. Verificá tu conexión e intentá nuevamente.";
      setErrorMessage(message);
      return false;
    }
  }, [status]);

  const categories = useMemo(() => {
    const cats = new Set<string>();
    products.forEach((p) => {
      if (filters.departament && p.departament !== filters.departament) return;
      if (p.category) cats.add(p.category);
    });
    return Array.from(cats).sort();
  }, [products, filters.departament]);

  const applyFilters = useCallback((productsToFilter: Product[]): Product[] => {
    let filtered = [...productsToFilter];

    if (filters.searchTerm) {
      const term = filters.searchTerm.toLowerCase();
      filtered = filtered.filter(
        (p) =>
          p.name?.toLowerCase().includes(term) ||
          p.description?.toLowerCase().includes(term)
      );
    }

    if (filters.departament) {
      filtered = filtered.filter((p) => p.departament === filters.departament);
    }

    if (filters.category) {
      filtered = filtered.filter((p) => p.category === filters.category);
    }

    switch (filters.sortBy) {
      case "price-asc":
        filtered.sort((a, b) => a.price - b.price);
        break;
      case "price-desc":
        filtered.sort((a, b) => b.price - a.price);
        break;
      case "name-asc":
        filtered.sort((a, b) => (a.name || "").localeCompare(b.name || ""));
        break;
      case "name-desc":
        filtered.sort((a, b) => (b.name || "").localeCompare(a.name || ""));
        break;
      case "newest":
      default:
        break;
    }

    return filtered;
  }, [filters]);

  const filteredProducts = useMemo(() => applyFilters(products), [applyFilters, products]);

  const setSearchTerm = useCallback((term: string) => {
    setFilters((prev) => ({ ...prev, searchTerm: term }));
  }, []);

  const setDepartament = useCallback((dep: string | null) => {
    setFilters((prev) => ({ ...prev, departament: dep ?? "PELUQUERIA", category: null }));
  }, []);

  const setCategory = useCallback((category: string | null) => {
    setFilters((prev) => ({ ...prev, category }));
  }, []);

  const setSortBy = useCallback((sort: FilterState["sortBy"]) => {
    setFilters((prev) => ({ ...prev, sortBy: sort }));
  }, []);

  const clearFilters = useCallback(() => {
    setFilters({
      searchTerm: "",
      category: null,
      departament: "PELUQUERIA",
      sortBy: "newest",
    });
  }, []);

  const openQuickView = useCallback((product: Product) => {
    setSelectedProduct(product);
  }, []);

  const closeQuickView = useCallback(() => {
    setSelectedProduct(null);
  }, []);

  return {
    products: filteredProducts,
    allProducts: products,
    selectedProduct,
    isQuickViewOpen: Boolean(selectedProduct),
    loading: status === "loading",
    status,
    errorMessage,
    loadProducts,
    filters,
    setSearchTerm,
    setDepartament,
    setCategory,
    setSortBy,
    clearFilters,
    openQuickView,
    closeQuickView,
    categories,
  } as const;
};
