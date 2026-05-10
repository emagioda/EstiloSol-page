"use client";
import { useMemo, useState } from "react";
import ProductCard from "../ProductCard/ProductCard";
import type { Product } from "@/src/features/shop/domain/entities/Product";

const PRODUCTS_PER_BATCH = 20;
const initialPagination = {
  productSignature: "",
  visibleCount: PRODUCTS_PER_BATCH,
};

export default function ProductsGrid({
  products,
  onQuickView,
}: {
  products: Product[];
  onQuickView?: (product: Product) => void;
}) {
  const [pagination, setPagination] = useState(initialPagination);
  const productSignature = useMemo(
    () => products.map((product) => product.id ?? "").join("|"),
    [products]
  );
  const visibleCount =
    pagination.productSignature === productSignature
      ? pagination.visibleCount
      : PRODUCTS_PER_BATCH;

  if (!products || products.length === 0) {
    return (
      <div className="rounded-2xl border border-white/12 bg-white/6 p-6 py-12 text-center text-[var(--brand-cream)]/80">
        <h3 className="text-lg font-medium">No encontramos productos con esos filtros</h3>
        <p className="mt-2 text-sm text-[var(--brand-cream)]/80">Probá quitar algunos filtros o buscá otro término.</p>
      </div>
    );
  }

  const visibleProducts = products.slice(0, visibleCount);
  const hasMoreProducts = visibleCount < products.length;

  return (
    <>
      <div className="grid auto-rows-fr grid-cols-2 gap-3 md:grid-cols-3 md:gap-4 lg:grid-cols-4 lg:gap-5">
        {visibleProducts.map((p, index) => (
          <ProductCard
            key={p.id}
            product={p}
            onQuickView={onQuickView}
            priority={index < 4}
          />
        ))}
      </div>

      {hasMoreProducts && (
        <div className="mt-7 flex flex-col items-center gap-3 text-center">
          <p className="text-xs font-medium text-[var(--brand-cream)]/70">
            Mostrando {visibleProducts.length} de {products.length} productos
          </p>
          <button
            type="button"
            onClick={() => {
              setPagination({
                productSignature,
                visibleCount: Math.min(visibleCount + PRODUCTS_PER_BATCH, products.length),
              });
            }}
            className="inline-flex min-h-11 items-center justify-center rounded-full border border-[var(--brand-gold-300)] bg-[var(--brand-gold-300)] px-7 text-sm font-bold text-[var(--brand-violet-950)] shadow-[0_10px_24px_rgba(45,22,75,0.22)] transition duration-200 hover:-translate-y-0.5 hover:border-[var(--brand-cream)] hover:bg-[var(--brand-cream)] hover:text-[var(--brand-violet-950)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand-gold-300)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--brand-violet-950)]"
          >
            Ver más productos
          </button>
        </div>
      )}
    </>
  );
}
