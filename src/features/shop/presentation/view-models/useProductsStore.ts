"use client";
import { useCallback, useRef, useState } from "react";
import {
  fetchProductsFromSheets,
  isMissingSheetsEndpointError,
} from "@/src/features/shop/infrastructure/data/fetchProducts";
import type { Product } from "@/src/features/shop/domain/entities/Product";

export type FilterState = {
  searchTerm: string;
  category: string | null;
  sortBy: "price-asc" | "price-desc" | "name-asc" | "name-desc" | "newest";
};

type ProductsStatus = "idle" | "loading" | "success" | "error";

const PRODUCTS_CACHE_KEY = "estilosol.products.cache.v1";
const DEFAULT_PRODUCTS_TTL_MS = 10 * 60 * 1000;

type ProductsCachePayload = {
  products: Product[];
  fetchedAt: number;
};

const getProductsTtlMs = () => {
  const configured = process.env.NEXT_PUBLIC_PRODUCTS_TTL_MS;
  const parsed = configured ? Number(configured) : NaN;
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_PRODUCTS_TTL_MS;
};

const isValidCachePayload = (payload: unknown): payload is ProductsCachePayload => {
  if (!payload || typeof payload !== "object") return false;

  const candidate = payload as Partial<ProductsCachePayload>;
  return Array.isArray(candidate.products) && typeof candidate.fetchedAt === "number";
};

const readProductsCache = (): ProductsCachePayload | null => {
  if (typeof window === "undefined") return null;

  try {
    const raw = window.localStorage.getItem(PRODUCTS_CACHE_KEY);
    if (!raw) return null;

    const parsed: unknown = JSON.parse(raw);
    return isValidCachePayload(parsed) ? parsed : null;
  } catch {
    return null;
  }
};

const persistProductsCache = (products: Product[], fetchedAt: number) => {
  if (typeof window === "undefined") return;

  const payload: ProductsCachePayload = { products, fetchedAt };
  window.localStorage.setItem(PRODUCTS_CACHE_KEY, JSON.stringify(payload));
};

export const useProductsStore = ({
  initialProducts,
}: {
  initialProducts?: Product[];
} = {}) => {
  const [initialSnapshot] = useState(() => {
    const initialCache = readProductsCache();
    if (initialCache?.products?.length) {
      return {
        products: initialCache.products,
        fetchedAt: initialCache.fetchedAt,
        fromCache: true,
      };
    }

    return {
      products: initialProducts ?? [],
      fetchedAt: 0,
      fromCache: false,
    };
  });

  const [products, setProducts] = useState<Product[]>(() => initialSnapshot.products);
  const [status, setStatus] = useState<ProductsStatus>(
    initialSnapshot.products.length > 0 ? "success" : "idle"
  );
  const [lastFetchedAt, setLastFetchedAt] = useState<number>(initialSnapshot.fetchedAt);
  const [hydratedFromCache] = useState<boolean>(initialSnapshot.fromCache);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [selectedProduct, setSelectedProduct] = useState<Product | null>(null);
  const isFetchingRef = useRef(false);
  const [filters, setFilters] = useState<FilterState>({
    searchTerm: "",
    category: null,
    sortBy: "newest",
  });

  const shouldRefresh = useCallback(() => {
    if (products.length === 0) return true;
    if (!lastFetchedAt) return true;

    const ttlMs = getProductsTtlMs();
    return Date.now() - lastFetchedAt >= ttlMs;
  }, [lastFetchedAt, products.length]);

  const loadProducts = useCallback(async ({ force = false }: { force?: boolean } = {}) => {
    if (isFetchingRef.current) return;
    isFetchingRef.current = true;

    const hasProducts = products.length > 0;
    if (hasProducts) {
      setIsRefreshing(true);
    } else {
      setStatus("loading");
    }

    setErrorMessage(null);

    try {
      const data = await fetchProductsFromSheets({
        cacheMode: force ? "no-store" : "default",
        cacheBust: force,
      });

      const fetchedAt = Date.now();
      setProducts(data);
      setLastFetchedAt(fetchedAt);
      setStatus("success");
      persistProductsCache(data, fetchedAt);
    } catch (error) {
      if (!isMissingSheetsEndpointError(error)) {
        console.error("Error fetching products:", error);
      }

      if (!hasProducts) {
        setProducts([]);
        setStatus("error");
      }
      const message =
        error instanceof Error
          ? error.message
          : "No se pudo cargar el catálogo. Verificá tu conexión e intentá nuevamente.";
      setErrorMessage(message);
    } finally {
      isFetchingRef.current = false;
      setIsRefreshing(false);
    }
  }, [products.length]);

  const getCategories = (): string[] => {
    const cats = new Set<string>();
    products.forEach((p) => {
      if (p.category) cats.add(p.category);
    });
    return Array.from(cats).sort();
  };

  const applyFilters = (products: Product[]): Product[] => {
    let filtered = [...products];

    if (filters.searchTerm) {
      const term = filters.searchTerm.toLowerCase();
      filtered = filtered.filter(
        (p) =>
          p.name?.toLowerCase().includes(term) ||
          p.description?.toLowerCase().includes(term)
      );
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
  };

  const filteredProducts = applyFilters(products);

  const setSearchTerm = (term: string) => {
    setFilters((prev) => ({ ...prev, searchTerm: term }));
  };

  const setCategory = (category: string | null) => {
    setFilters((prev) => ({ ...prev, category }));
  };

  const setSortBy = (sort: FilterState["sortBy"]) => {
    setFilters((prev) => ({ ...prev, sortBy: sort }));
  };

  const clearFilters = () => {
    setFilters({
      searchTerm: "",
      category: null,
      sortBy: "newest",
    });
  };

  const openQuickView = (product: Product) => {
    setSelectedProduct(product);
  };

  const closeQuickView = () => {
    setSelectedProduct(null);
  };

  return {
    products: filteredProducts,
    allProducts: products,
    selectedProduct,
    isQuickViewOpen: Boolean(selectedProduct),
    loading: status === "loading",
    isRefreshing,
    lastFetchedAt,
    hydratedFromCache,
    status,
    errorMessage,
    loadProducts,
    shouldRefresh,
    filters,
    setSearchTerm,
    setCategory,
    setSortBy,
    clearFilters,
    openQuickView,
    closeQuickView,
    categories: getCategories(),
  } as const;
};
