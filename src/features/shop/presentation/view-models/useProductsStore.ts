"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  fetchProductsFromSheets,
  isMissingSheetsEndpointError,
} from "@/src/features/shop/infrastructure/data/fetchProducts";
import type { Product } from "@/src/features/shop/domain/entities/Product";

export type FilterState = {
  searchTerm: string;
  departament: string | null;
  category: string | null;
  sortBy: "price-asc" | "price-desc" | "name-asc" | "name-desc" | "newest";
  showOnlyPromos: boolean;
  showOnlyKits: boolean;
  selectedSpecs: Record<string, string>;
};

type ProductsStatus = "idle" | "loading" | "success" | "error";
export type SelectedSpecsMap = Record<string, string>;
export type SpecFiltersMap = Record<string, string[]>;

const SESSION_CATALOG_CACHE_KEY = "es:shop:catalog:session:v1";
const CATALOG_CACHE_UPDATED_EVENT = "es:catalog-cache-updated";

// Simple in-memory cache that survives component unmounts while the
// page is still open. It does not persist across full reloads, but it
// avoids re-fetching when moving between store/detail pages.
let cachedProducts: Product[] | null = null;
let cachedProductsSignature: string | null = null;
let catalogPrefetchPromise: Promise<boolean> | null = null;

const normalizeSpecifications = (product: Product): Record<string, string> =>
  product.specifications && typeof product.specifications === "object"
    ? product.specifications
    : {};

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
      const specsCount = Object.keys(normalizeSpecifications(product)).length;
      return [
        product.id,
        product.slug ?? "",
        String(product.price),
        String(product.old_price ?? ""),
        product.departament ?? "",
        product.category ?? "",
        product.product_type ?? "",
        product.active === false ? "0" : "1",
        product.is_new ? "1" : "0",
        product.is_sale ? "1" : "0",
        String(imagesCount),
        String(includesCount),
        String(tagsCount),
        String(specsCount),
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

const sortProducts = (
  productsToSort: Product[],
  sortBy: FilterState["sortBy"]
): Product[] => {
  const sorted = [...productsToSort];

  switch (sortBy) {
    case "price-asc":
      sorted.sort((a, b) => a.price - b.price);
      break;
    case "price-desc":
      sorted.sort((a, b) => b.price - a.price);
      break;
    case "name-asc":
      sorted.sort((a, b) => (a.name || "").localeCompare(b.name || ""));
      break;
    case "name-desc":
      sorted.sort((a, b) => (b.name || "").localeCompare(a.name || ""));
      break;
    case "newest":
      sorted.sort((a, b) => Number(Boolean(b.is_new)) - Number(Boolean(a.is_new)));
      break;
    default:
      break;
  }

  return sorted;
};

const applySpecFilters = (
  productsToFilter: Product[],
  selectedSpecs: SelectedSpecsMap
): Product[] => {
  const activeSpecs = Object.entries(selectedSpecs).filter(
    ([, value]) => typeof value === "string" && value.trim().length > 0
  );

  if (activeSpecs.length === 0) {
    return productsToFilter;
  }

  return productsToFilter.filter((product) => {
    const specs = normalizeSpecifications(product);

    return activeSpecs.every(([specKey, selectedValue]) => {
      const productSpecValue = specs[specKey];
      if (typeof productSpecValue !== "string" || productSpecValue.trim().length === 0) {
        return false;
      }

      return productSpecValue === selectedValue;
    });
  });
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
    showOnlyPromos: false,
    showOnlyKits: false,
    selectedSpecs: {},
  });

  useEffect(() => {
    if (typeof window === "undefined") return;

    const syncFromCache = (event: Event) => {
      const customEvent = event as CustomEvent<{ products?: Product[] }>;
      const eventProducts = customEvent.detail?.products;
      const sourceProducts = Array.isArray(eventProducts) ? eventProducts : cachedProducts;

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

  const loadProducts = useCallback(
    async (forceRefresh = false): Promise<boolean> => {
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
            : "No se pudo cargar el catalogo. Verifica tu conexion e intenta nuevamente.";
        setErrorMessage(message);
        return false;
      }
    },
    [status]
  );

  const applyContextFilters = useCallback(
    (productsToFilter: Product[]): Product[] => {
      let filtered = [...productsToFilter];

      if (filters.searchTerm) {
        const term = filters.searchTerm.toLowerCase();
        filtered = filtered.filter(
          (product) =>
            product.name?.toLowerCase().includes(term) ||
            product.description?.toLowerCase().includes(term)
        );
      }

      if (filters.departament) {
        filtered = filtered.filter((product) => product.departament === filters.departament);
      }

      if (filters.showOnlyPromos) {
        filtered = filtered.filter((product) => product.is_sale === true);
      }

      if (filters.showOnlyKits) {
        filtered = filtered.filter((product) => product.product_type === "KIT");
      }

      return filtered;
    },
    [
      filters.searchTerm,
      filters.departament,
      filters.showOnlyPromos,
      filters.showOnlyKits,
    ]
  );

  const contextFilteredProducts = useMemo(
    () => applyContextFilters(products),
    [applyContextFilters, products]
  );

  const filteredProducts = useMemo(() => {
    const withCategory = filters.category
      ? contextFilteredProducts.filter((product) => product.category === filters.category)
      : contextFilteredProducts;
    const withSpecs = applySpecFilters(withCategory, filters.selectedSpecs);
    return sortProducts(withSpecs, filters.sortBy);
  }, [contextFilteredProducts, filters.category, filters.selectedSpecs, filters.sortBy]);

  const categories = useMemo(() => {
    const cats = new Set<string>();
    contextFilteredProducts.forEach((product) => {
      if (product.category) {
        cats.add(product.category);
      }
    });
    if (filters.category) {
      cats.add(filters.category);
    }
    return Array.from(cats).sort((a, b) => a.localeCompare(b));
  }, [contextFilteredProducts, filters.category]);

  const specsSourceProducts = useMemo(() => {
    if (!filters.category) {
      return contextFilteredProducts;
    }

    return contextFilteredProducts.filter(
      (product) => product.category === filters.category
    );
  }, [contextFilteredProducts, filters.category]);

  const availableSpecifications = useMemo<SpecFiltersMap>(() => {
    const specSets: Record<string, Set<string>> = {};

    specsSourceProducts.forEach((product) => {
      const specs = normalizeSpecifications(product);
      Object.entries(specs).forEach(([specKey, rawValue]) => {
        const key = specKey.trim();
        const value = rawValue.trim();
        if (!key || !value) return;

        if (!specSets[key]) {
          specSets[key] = new Set<string>();
        }

        specSets[key].add(value);
      });
    });

    return Object.fromEntries(
      Object.entries(specSets)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([specKey, valuesSet]) => [
          specKey,
          Array.from(valuesSet).sort((left, right) => left.localeCompare(right)),
        ])
    );
  }, [specsSourceProducts]);

  const setSearchTerm = useCallback((term: string) => {
    setFilters((prev) => ({ ...prev, searchTerm: term }));
  }, []);

  const setDepartament = useCallback((dep: string | null) => {
    setFilters((prev) => ({
      ...prev,
      departament: dep ?? "PELUQUERIA",
      category: null,
      selectedSpecs: {},
    }));
  }, []);

  const setCategory = useCallback((category: string | null) => {
    setFilters((prev) => ({ ...prev, category }));
  }, []);

  const setSortBy = useCallback((sort: FilterState["sortBy"]) => {
    setFilters((prev) => ({ ...prev, sortBy: sort }));
  }, []);

  const togglePromoFilter = useCallback(() => {
    setFilters((prev) => ({ ...prev, showOnlyPromos: !prev.showOnlyPromos }));
  }, []);

  const toggleKitFilter = useCallback(() => {
    setFilters((prev) => ({ ...prev, showOnlyKits: !prev.showOnlyKits }));
  }, []);

  const toggleSpecFilter = useCallback((specKey: string, specValue: string) => {
    const normalizedKey = specKey.trim();
    const normalizedValue = specValue.trim();

    if (!normalizedKey || !normalizedValue) {
      return;
    }

    setFilters((prev) => {
      const currentValue = prev.selectedSpecs[normalizedKey];
      const nextSelectedSpecs: SelectedSpecsMap = {
        ...prev.selectedSpecs,
      };

      if (currentValue === normalizedValue) {
        delete nextSelectedSpecs[normalizedKey];
      } else {
        nextSelectedSpecs[normalizedKey] = normalizedValue;
      }

      return {
        ...prev,
        selectedSpecs: nextSelectedSpecs,
      };
    });
  }, []);

  const clearFilters = useCallback(() => {
    setFilters({
      searchTerm: "",
      category: null,
      departament: "PELUQUERIA",
      sortBy: "newest",
      showOnlyPromos: false,
      showOnlyKits: false,
      selectedSpecs: {},
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
    togglePromoFilter,
    toggleKitFilter,
    toggleSpecFilter,
    clearFilters,
    openQuickView,
    closeQuickView,
    categories,
    availableSpecifications,
  } as const;
};
