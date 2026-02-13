"use client";
import ProductCard from "../ProductCard/ProductCard";
import type { Product } from "../ProductCard/ProductCard";

export default function ProductsGrid({
  products,
  onQuickView,
  onAddFeedback,
}: {
  products: Product[];
  onQuickView?: (product: Product) => void;
  onAddFeedback?: (params: { ok: boolean; name: string }) => void;
}) {
  if (!products || products.length === 0) {
    return (
      <div className="py-12 text-center text-[var(--brand-cream)]">
        <h3 className="text-lg font-medium">No encontramos productos con esos filtros</h3>
        <p className="mt-2 text-sm text-[var(--brand-gold-300)]">Probá quitar algunos filtros o buscá otro término.</p>
      </div>
    );
  }

  return (
    <div className="grid auto-rows-fr grid-cols-2 gap-2 sm:gap-3 md:grid-cols-3 lg:grid-cols-4">
      {products.map((p) => (
        <ProductCard
          key={p.id}
          product={p}
          onQuickView={onQuickView}
          onAddFeedback={onAddFeedback}
        />
      ))}
    </div>
  );
}
