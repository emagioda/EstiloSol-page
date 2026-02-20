"use client";
import ProductCard from "../ProductCard/ProductCard";
import type { Product } from "@/src/features/shop/domain/entities/Product";

export default function ProductsGrid({
  products,
  onQuickView,
  staticDetailHandles,
}: {
  products: Product[];
  onQuickView?: (product: Product) => void;
  staticDetailHandles?: string[];
}) {
  if (!products || products.length === 0) {
    return (
      <div className="rounded-2xl border border-white/12 bg-white/6 p-6 py-12 text-center text-[var(--brand-cream)]/80">
        <h3 className="text-lg font-medium">No encontramos productos con esos filtros</h3>
        <p className="mt-2 text-sm text-[var(--brand-cream)]/80">Probá quitar algunos filtros o buscá otro término.</p>
      </div>
    );
  }

  return (
    <div className="grid auto-rows-fr grid-cols-1 gap-6 sm:grid-cols-2 md:gap-8 lg:grid-cols-3">
      {products.map((p) => (
        <ProductCard
          key={p.id}
          product={p}
          onQuickView={onQuickView}
          staticDetailHandles={staticDetailHandles}
        />
      ))}
    </div>
  );
}
