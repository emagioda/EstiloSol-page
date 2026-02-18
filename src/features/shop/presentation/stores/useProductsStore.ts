"use client";

import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import type { Product } from "@/src/features/shop/domain/entities/Product";
import {
  fetchProductsFromSheets,
  isMissingSheetsEndpointError,
} from "@/src/features/shop/infrastructure/data/fetchProducts";

type ProductsStatus = "idle" | "loading" | "success" | "error";

type ProductsStore = {
  products: Product[];
  status: ProductsStatus;
  lastFetch: number | null;
  errorMessage: string | null;
  loadProducts: (force?: boolean) => Promise<void>;
  getProductBySlug: (slug: string) => Product | undefined;
};

export const useProductsStore = create<ProductsStore>()(
  persist(
    (set, get) => ({
      products: [],
      status: "idle",
      lastFetch: null,
      errorMessage: null,
      loadProducts: async (force = false) => {
        const { products } = get();

        if (!force && products.length > 0) {
          if (get().status !== "success") {
            set({ status: "success" });
          }
          return;
        }

        set({ status: "loading", errorMessage: null });

        try {
          const data = await fetchProductsFromSheets();
          set({
            products: data,
            status: "success",
            lastFetch: Date.now(),
            errorMessage: null,
          });
        } catch (error) {
          if (!isMissingSheetsEndpointError(error)) {
            console.error("Error fetching products:", error);
          }

          set({
            products: [],
            status: "error",
            errorMessage:
              error instanceof Error
                ? error.message
                : "No se pudo cargar el catálogo. Verificá tu conexión e intentá nuevamente.",
          });
        }
      },
      getProductBySlug: (slug: string) => {
        const decodedSlug = decodeURIComponent(slug);
        return get().products.find(
          (product) =>
            product.slug === decodedSlug || String(product.id) === decodedSlug
        );
      },
    }),
    {
      name: "estilosol-products-catalog",
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => ({
        products: state.products,
        status: state.status,
        lastFetch: state.lastFetch,
      }),
    }
  )
);
