"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  fetchProductsFromSheets,
  isMissingSheetsEndpointError,
} from "@/src/features/shop/infrastructure/data/fetchProducts";
import type { Departament, Product } from "@/src/features/shop/domain/entities/Product";

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
export type CatalogFacets = Partial<
  Record<
    Departament,
    {
      categories: string[];
      specifications: SpecFiltersMap;
      specificationsByCategory: Record<string, SpecFiltersMap>;
    }
  >
>;

const SESSION_CATALOG_CACHE_KEY = "es:shop:catalog:session:v1";
const SESSION_FILTERS_KEY = "es:shop:filters:session:v1";
const CATALOG_CACHE_UPDATED_EVENT = "es:catalog-cache-updated";

// Simple in-memory cache that survives component unmounts while the
// page is still open. It does not persist across full reloads, but it
// avoids re-fetching when moving between store/detail pages.
let cachedProducts: Product[] | null = null;
let cachedProductsSignature: string | null = null;
let cachedProductsComplete = false;
let catalogPrefetchPromise: Promise<boolean> | null = null;

const sortValues = new Set<FilterState["sortBy"]>([
  "price-asc",
  "price-desc",
  "name-asc",
  "name-desc",
  "newest",
]);

const createDefaultFilters = (departament: Departament = "PELUQUERIA"): FilterState => ({
  searchTerm: "",
  departament,
  category: null,
  sortBy: "newest",
  showOnlyPromos: false,
  showOnlyKits: false,
  selectedSpecs: {},
});

const readSessionFilters = (): FilterState | null => {
  if (typeof window === "undefined") return null;

  try {
    const raw = window.sessionStorage.getItem(SESSION_FILTERS_KEY);
    if (!raw) return null;

    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return null;

    const candidate = parsed as Partial<FilterState>;
    const selectedSpecs =
      candidate.selectedSpecs && typeof candidate.selectedSpecs === "object"
        ? Object.fromEntries(
            Object.entries(candidate.selectedSpecs).filter(
              (entry): entry is [string, string] =>
                typeof entry[0] === "string" &&
                entry[0].trim().length > 0 &&
                typeof entry[1] === "string" &&
                entry[1].trim().length > 0,
            ),
          )
        : {};

    return {
      searchTerm: typeof candidate.searchTerm === "string" ? candidate.searchTerm : "",
      departament:
        candidate.departament === "BIJOUTERIE" || candidate.departament === "PELUQUERIA"
          ? candidate.departament
          : "PELUQUERIA",
      category: typeof candidate.category === "string" && candidate.category.trim() ? candidate.category : null,
      sortBy: candidate.sortBy && sortValues.has(candidate.sortBy) ? candidate.sortBy : "newest",
      showOnlyPromos: candidate.showOnlyPromos === true,
      showOnlyKits: candidate.showOnlyKits === true,
      selectedSpecs,
    };
  } catch {
    return null;
  }
};

const writeSessionFilters = (filters: FilterState) => {
  if (typeof window === "undefined") return;

  try {
    window.sessionStorage.setItem(SESSION_FILTERS_KEY, JSON.stringify(filters));
  } catch {
    return;
  }
};

export const clearShopFiltersSessionState = () => {
  if (typeof window === "undefined") return;

  try {
    window.sessionStorage.removeItem(SESSION_FILTERS_KEY);
  } catch {
    return;
  }
};

const normalizeSpecifications = (product: Product): Record<string, string> =>
  product.specifications && typeof product.specifications === "object"
    ? product.specifications
    : {};

const setMemoryCatalogCache = (
  products: Product[],
  { complete = true }: { complete?: boolean } = {},
) => {
  if (!complete && cachedProductsComplete && cachedProducts && cachedProducts.length > 0) {
    return;
  }

  cachedProducts = products;
  cachedProductsSignature = productSignature(products);
  cachedProductsComplete = complete;
};

const emitCatalogCacheUpdated = (products: Product[], complete = true) => {
  if (typeof window === "undefined") return;
  window.dispatchEvent(
    new CustomEvent(CATALOG_CACHE_UPDATED_EVENT, {
      detail: { products, complete },
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

export const clearProductsCatalogSessionCache = () => {
  cachedProducts = null;
  cachedProductsSignature = null;
  cachedProductsComplete = false;

  if (typeof window === "undefined") return;

  try {
    window.sessionStorage.removeItem(SESSION_CATALOG_CACHE_KEY);
  } catch {
    return;
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
        product.is_featured ? "1" : "0",
        product.is_sale ? "1" : "0",
        product.stock_status ?? "",
        String(product.stock_qty ?? ""),
        String(imagesCount),
        String(includesCount),
        String(tagsCount),
        String(specsCount),
      ].join("|");
    })
    .sort()
    .join("~");

const updateMemoryCatalogCache = (products: Product[], complete = true) => {
  setMemoryCatalogCache(products, { complete });
  emitCatalogCacheUpdated(products, complete);
};

const updateCatalogCache = (products: Product[]) => {
  updateMemoryCatalogCache(products, true);
  writeSessionCachedProducts(products);
};

export const primeProductsCatalogCache = (
  products: Product[],
  { complete = false }: { complete?: boolean } = {},
) => {
  if (products.length === 0) return;
  setMemoryCatalogCache(products, { complete });
  if (complete) {
    writeSessionCachedProducts(products);
    emitCatalogCacheUpdated(products, true);
  }
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
      cacheBust: true,
    });
    updateCatalogCache(data);
    return true;
  } catch {
    return false;
  }
};

export const prefetchProductsCatalogSession = async (): Promise<boolean> => {
  if (cachedProductsComplete && cachedProducts && cachedProducts.length > 0) {
    return true;
  }

  const sessionCachedProducts = readSessionCachedProducts();
  if (sessionCachedProducts && sessionCachedProducts.length > 0) {
    updateMemoryCatalogCache(sessionCachedProducts, true);
    return true;
  }

  if (catalogPrefetchPromise) {
    return catalogPrefetchPromise;
  }

  catalogPrefetchPromise = fetchProductsFromSheets({
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
  initialCatalogComplete = false,
  initialFacets,
  initialDepartament = "PELUQUERIA",
  persistFilters = false,
  initialDepartamentOverridesPersistedFilters = false,
}: {
  initialProducts?: Product[];
  initialCatalogComplete?: boolean;
  initialFacets?: CatalogFacets;
  initialDepartament?: Departament;
  persistFilters?: boolean;
  initialDepartamentOverridesPersistedFilters?: boolean;
} = {}) => {
  const [products, setProducts] = useState<Product[]>(() => {
    if (cachedProducts && cachedProducts.length > 0) {
      if (!cachedProductsSignature) {
        cachedProductsSignature = productSignature(cachedProducts);
      }
      return cachedProducts;
    }

    if (initialProducts && initialProducts.length > 0) {
      setMemoryCatalogCache(initialProducts, { complete: initialCatalogComplete });
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
  const [catalogComplete, setCatalogComplete] = useState(
    cachedProductsComplete || (initialCatalogComplete && Boolean(initialProducts?.length))
  );
  const [catalogRefreshing, setCatalogRefreshing] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [selectedProduct, setSelectedProduct] = useState<Product | null>(null);
  const [filters, setFilters] = useState<FilterState>(() => createDefaultFilters(initialDepartament));
  const filtersHydratedRef = useRef(!persistFilters);
  const skipNextFiltersPersistRef = useRef(persistFilters);

  useEffect(() => {
    if (initialProducts && initialProducts.length > 0) {
      primeProductsCatalogCache(initialProducts, { complete: initialCatalogComplete });
    }
  }, [initialCatalogComplete, initialProducts]);

  useEffect(() => {
    if (!persistFilters) return;

    const storedFilters = readSessionFilters();
    if (storedFilters) {
      const shouldOverrideDepartament =
        initialDepartamentOverridesPersistedFilters &&
        storedFilters.departament !== initialDepartament;

      setFilters({
        ...storedFilters,
        ...(initialDepartamentOverridesPersistedFilters
          ? { departament: initialDepartament }
          : {}),
        ...(shouldOverrideDepartament ? { category: null, selectedSpecs: {} } : {}),
      });
    }

    filtersHydratedRef.current = true;
  }, [initialDepartament, initialDepartamentOverridesPersistedFilters, persistFilters]);

  useEffect(() => {
    if (!persistFilters || !filtersHydratedRef.current) return;
    if (skipNextFiltersPersistRef.current) {
      skipNextFiltersPersistRef.current = false;
      return;
    }
    writeSessionFilters(filters);
  }, [filters, persistFilters]);

  useEffect(() => {
    if (typeof window === "undefined") return;

    const syncFromCache = (event: Event) => {
      const customEvent = event as CustomEvent<{ products?: Product[]; complete?: boolean }>;
      const eventProducts = customEvent.detail?.products;
      const sourceProducts = Array.isArray(eventProducts) ? eventProducts : cachedProducts;

      if (!sourceProducts || sourceProducts.length === 0) return;

      const complete = customEvent.detail?.complete ?? cachedProductsComplete;
      setMemoryCatalogCache(sourceProducts, { complete });
      setProducts([...sourceProducts]);
      setCatalogComplete(complete);
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
      setCatalogComplete(true);
      setStatus("success");
      setErrorMessage(null);
    }, 0);

    return () => window.clearTimeout(hydrateTimer);
  }, []);

  const loadProducts = useCallback(
    async (
      forceRefresh = false,
      options: { silent?: boolean } = {},
    ): Promise<boolean> => {
      if (!forceRefresh && cachedProductsComplete && cachedProducts && cachedProducts.length > 0) {
        setProducts(cachedProducts);
        setCatalogComplete(true);
        setStatus("success");
        return true;
      }

      const silent = options.silent === true;
      if (silent) {
        setCatalogRefreshing(true);
      } else {
        setStatus("loading");
      }
      setErrorMessage(null);

      try {
        const data = await fetchProductsFromSheets({
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

        setCatalogComplete(true);
        setStatus("success");
        return true;
      } catch (error) {
        if (!isMissingSheetsEndpointError(error)) {
          console.error("Error fetching products:", error);
        }

        const message =
          error instanceof Error
            ? error.message
            : "No se pudo cargar el catalogo. Verifica tu conexion e intenta nuevamente.";
        setErrorMessage(message);
        if (!silent) {
          setProducts([]);
          setStatus("error");
        }
        return false;
      } finally {
        if (silent) {
          setCatalogRefreshing(false);
        }
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
  const selectedDepartament =
    filters.departament === "BIJOUTERIE" ? "BIJOUTERIE" : "PELUQUERIA";
  const canUseInitialFacets =
    !catalogComplete &&
    Boolean(initialFacets) &&
    !filters.searchTerm.trim() &&
    !filters.showOnlyPromos &&
    !filters.showOnlyKits;
  const initialDepartamentFacets = canUseInitialFacets
    ? initialFacets?.[selectedDepartament]
    : undefined;

  const filteredProducts = useMemo(() => {
    const withCategory = filters.category
      ? contextFilteredProducts.filter((product) => product.category === filters.category)
      : contextFilteredProducts;
    const withSpecs = applySpecFilters(withCategory, filters.selectedSpecs);
    return sortProducts(withSpecs, filters.sortBy);
  }, [contextFilteredProducts, filters.category, filters.selectedSpecs, filters.sortBy]);

  const categories = useMemo(() => {
    if (initialDepartamentFacets) {
      const cats = new Set(initialDepartamentFacets.categories);
      if (filters.category) {
        cats.add(filters.category);
      }
      return Array.from(cats).sort((a, b) => a.localeCompare(b));
    }

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
  }, [contextFilteredProducts, filters.category, initialDepartamentFacets]);

  const specsSourceProducts = useMemo(() => {
    if (!filters.category) {
      return contextFilteredProducts;
    }

    return contextFilteredProducts.filter(
      (product) => product.category === filters.category
    );
  }, [contextFilteredProducts, filters.category]);

  const availableSpecifications = useMemo<SpecFiltersMap>(() => {
    if (initialDepartamentFacets) {
      return filters.category
        ? initialDepartamentFacets.specificationsByCategory[filters.category] ?? {}
        : initialDepartamentFacets.specifications;
    }

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
  }, [filters.category, initialDepartamentFacets, specsSourceProducts]);

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
    setFilters(createDefaultFilters("PELUQUERIA"));
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
    catalogComplete,
    catalogRefreshing,
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
