"use client";

import { useEffect } from "react";
import { notFound } from "next/navigation";
import ProductDetail from "@/src/features/shop/presentation/pages/ProductDetail";
import { useProductsStore } from "@/src/features/shop/presentation/stores/useProductsStore";

type Props = {
  slug: string;
};

export default function ProductDetailClientPage({ slug }: Props) {
  const productsLength = useProductsStore((state) => state.products.length);
  const status = useProductsStore((state) => state.status);
  const loadProducts = useProductsStore((state) => state.loadProducts);
  const product = useProductsStore((state) => state.getProductBySlug(slug));

  useEffect(() => {
    if (productsLength === 0) {
      void loadProducts();
    }
  }, [loadProducts, productsLength]);

  if (product) {
    return <ProductDetail product={product} />;
  }

  if (status === "loading" || (status === "idle" && productsLength === 0)) {
    return (
      <main className="mx-auto w-full max-w-6xl px-4 py-16 text-[var(--brand-cream)]">
        <p className="text-sm text-[var(--brand-gold-300)]">Cargando producto…</p>
      </main>
    );
  }

  if (status === "error") {
    return (
      <main className="mx-auto w-full max-w-6xl px-4 py-16 text-[var(--brand-cream)]">
        <p className="text-sm text-[var(--brand-gold-300)]">
          No pudimos cargar el producto en este momento.
        </p>
      </main>
    );
  }

  notFound();
}
