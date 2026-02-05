"use client";
import { useCallback, useEffect, useState } from "react";

export type Product = {
  id: string;
  name: string;
  slug?: string;
  description?: string;
  category?: string;
  price: number;
  currency?: string;
  images?: string[];
  [k: string]: unknown;
};

export type FilterState = {
  searchTerm: string;
  category: string | null;
  sortBy: "price-asc" | "price-desc" | "name-asc" | "name-desc" | "newest";
};

export const useProductsStore = () => {
  const sheetsEndpoint =
    process.env.NEXT_PUBLIC_SHEETS_ENDPOINT ||
    "https://script.google.com/macros/s/AKfycbz6DR8Q1sFG4CuZ0UtMn889EUQNQAUQjdDMbjt689wLfY45jWFvBkgkEKlgapYaQm1sIg/exec";
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedProduct, setSelectedProduct] = useState<Product | null>(null);
  const [filters, setFilters] = useState<FilterState>({
    searchTerm: "",
    category: null,
    sortBy: "newest",
  });

  const fetchProducts = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(sheetsEndpoint, { cache: "no-store" });
      if (!res.ok) {
        console.error("Failed to fetch products:", res.status);
        setProducts([]);
        return;
      }
      const data = await res.json();
      setProducts(Array.isArray(data) ? data : []);
    } catch (error) {
      console.error("Error fetching products:", error);
      setProducts([]);
    } finally {
      setLoading(false);
    }
  }, [sheetsEndpoint]);

  useEffect(() => {
    fetchProducts();
  }, [fetchProducts]);

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

  const refresh = async () => {
    await fetchProducts();
  };

  return {
    products: filteredProducts,
    allProducts: products,
    selectedProduct,
    isQuickViewOpen: Boolean(selectedProduct),
    loading,
    refresh,
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
