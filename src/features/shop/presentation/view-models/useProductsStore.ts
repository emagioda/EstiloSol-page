"use client";
import { useCallback, useState } from "react";
import { fetchProductsFromSheets } from "@/src/features/shop/infrastructure/data/fetchProducts";
import type { Product } from "@/src/features/shop/domain/entities/Product";

export type FilterState = {
  searchTerm: string;
  category: string | null;
  sortBy: "price-asc" | "price-desc" | "name-asc" | "name-desc" | "newest";
};

type ProductsStatus = "idle" | "loading" | "success" | "error";

export const useProductsStore = ({
  initialProducts,
}: {
  initialProducts?: Product[];
} = {}) => {
  const [products, setProducts] = useState<Product[]>(() => initialProducts ?? []);
  const [status, setStatus] = useState<ProductsStatus>(
    initialProducts && initialProducts.length > 0 ? "success" : "idle"
  );
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [selectedProduct, setSelectedProduct] = useState<Product | null>(null);
  const [filters, setFilters] = useState<FilterState>({
    searchTerm: "",
    category: null,
    sortBy: "newest",
  });

  const loadProducts = useCallback(async () => {
    setStatus("loading");
    setErrorMessage(null);

    try {
      const data = await fetchProductsFromSheets({
        cacheMode: "no-store",
        cacheBust: true,
      });
      setProducts(data);
      setStatus("success");
    } catch (error) {
      console.error("Error fetching products:", error);
      setProducts([]);
      setStatus("error");
      const message =
        error instanceof Error
          ? error.message
          : "No se pudo cargar el catálogo. Verificá tu conexión e intentá nuevamente.";
      setErrorMessage(message);
    }
  }, []);

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
    status,
    errorMessage,
    loadProducts,
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
