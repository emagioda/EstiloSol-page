"use client";
import { useCallback, useState, useEffect } from "react";
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

// simple in‑memory cache that survives component unmounts while the
// page is still open. it doesn’t persist across full reloads, but it
// guarantees that navigating between store/detail pages won’t trigger a
// network request or a loading spinner.
let cachedProducts: Product[] | null = null;

export const useProductsStore = ({
  initialProducts,
}: {
  initialProducts?: Product[];
} = {}) => {
  const [products, setProducts] = useState<Product[]>(() => {
    if (cachedProducts && cachedProducts.length > 0) {
      return cachedProducts;
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
    departament: null,
    category: null,
    sortBy: "newest",
  });

  const loadProducts = useCallback(async () => {
    // if we've already fetched once this session just reuse the data
    if (cachedProducts && cachedProducts.length > 0) {
      setProducts(cachedProducts);
      setStatus("success");
      return;
    }

    setStatus("loading");
    setErrorMessage(null);

    try {
      const data = await fetchProductsFromSheets({
        // we've shortened the server TTL so the endpoint runs at most
        // once per minute. on the client we disable caching too so every
        // navigation triggers a fresh request.
        cacheMode: "no-store",
      });

      cachedProducts = data;
      setProducts(data);
      setStatus("success");
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
    }
  }, []);

  // fetch on every mount. `loadProducts` itself is smart enough to
  // bail out early if we already have cached data, so repeated
  // navigation won't hit the network. but a full page reload resets
  // the JS state and (crucially) clears `cachedProducts`, which means
  // this effect will trigger a fresh request to the sheet.
  useEffect(() => {
    loadProducts();
  }, [loadProducts]);

  const getCategories = (): string[] => {
    const cats = new Set<string>();
    products.forEach((p) => {
      if (filters.departament && p.departament !== filters.departament) return;
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
  };

  const filteredProducts = applyFilters(products);

  const setSearchTerm = (term: string) => {
    setFilters((prev) => ({ ...prev, searchTerm: term }));
  };

  const setDepartament = (dep: string | null) => {
    setFilters((prev) => ({ ...prev, departament: dep, category: null }));
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
      departament: null,
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
    categories: getCategories(),
  } as const;
};
