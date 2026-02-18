"use client";
import { useEffect, useMemo, useState } from "react";
import { useProductsStore as useProductsCatalogStore } from "@/src/features/shop/presentation/stores/useProductsStore";
import type { Product } from "@/src/features/shop/domain/entities/Product";

export type FilterState = {
  searchTerm: string;
  category: string | null;
  sortBy: "price-asc" | "price-desc" | "name-asc" | "name-desc" | "newest";
};

export const useProductsStore = ({
  initialProducts,
}: {
  initialProducts?: Product[];
} = {}) => {
  const products = useProductsCatalogStore((state) => state.products);
  const status = useProductsCatalogStore((state) => state.status);
  const errorMessage = useProductsCatalogStore((state) => state.errorMessage);
  const loadProducts = useProductsCatalogStore((state) => state.loadProducts);
  const [selectedProduct, setSelectedProduct] = useState<Product | null>(null);
  const [filters, setFilters] = useState<FilterState>({
    searchTerm: "",
    category: null,
    sortBy: "newest",
  });

  useEffect(() => {
    if (!initialProducts || initialProducts.length === 0 || products.length > 0) return;

    useProductsCatalogStore.setState({
      products: initialProducts,
      status: "success",
      lastFetch: Date.now(),
    });
  }, [initialProducts, products.length]);

  const categories = useMemo(() => {
    const cats = new Set<string>();
    products.forEach((p) => {
      if (p.category) cats.add(p.category);
    });
    return Array.from(cats).sort();
  }, [products]);

  const filteredProducts = useMemo(() => {
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
  }, [filters, products]);

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
    categories,
  } as const;
};
