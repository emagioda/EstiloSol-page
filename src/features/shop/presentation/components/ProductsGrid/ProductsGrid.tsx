"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import ProductCard from "../ProductCard/ProductCard";
import type { Product } from "@/src/features/shop/domain/entities/Product";

const PRODUCTS_PER_BATCH = 24;
const PAGINATION_CACHE_KEY = "es:shop:products-grid-pagination:v1";
const initialPagination = {
  productSignature: "",
  visibleCount: PRODUCTS_PER_BATCH,
};

const clampVisibleCount = (value: number, max: number) =>
  Math.min(Math.max(value, PRODUCTS_PER_BATCH), Math.max(max, PRODUCTS_PER_BATCH));

const readPaginationCache = (): Record<string, number> => {
  if (typeof window === "undefined") return {};

  try {
    const raw = window.sessionStorage.getItem(PAGINATION_CACHE_KEY);
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    return parsed as Record<string, number>;
  } catch {
    return {};
  }
};

const readCachedVisibleCount = (productSignature: string, productCount: number) => {
  const cachedValue = readPaginationCache()[productSignature];
  return typeof cachedValue === "number" && Number.isFinite(cachedValue)
    ? clampVisibleCount(cachedValue, productCount)
    : PRODUCTS_PER_BATCH;
};

const writeCachedVisibleCount = (
  productSignature: string,
  visibleCount: number,
  productCount: number,
) => {
  if (typeof window === "undefined" || !productSignature) return;

  try {
    const cache = readPaginationCache();
    cache[productSignature] = clampVisibleCount(visibleCount, productCount);
    window.sessionStorage.setItem(PAGINATION_CACHE_KEY, JSON.stringify(cache));
  } catch {
    return;
  }
};

export default function ProductsGrid({
  products,
  onQuickView,
  catalogComplete = true,
  catalogRefreshing = false,
  onLoadMoreApproach,
}: {
  products: Product[];
  onQuickView?: (product: Product) => void;
  catalogComplete?: boolean;
  catalogRefreshing?: boolean;
  onLoadMoreApproach?: () => void;
}) {
  const [pagination, setPagination] = useState(initialPagination);
  const loadMoreSentinelRef = useRef<HTMLDivElement | null>(null);
  const productSignature = useMemo(
    () => products.map((product) => product.id ?? "").join("|"),
    [products]
  );
  const visibleCount =
    pagination.productSignature === productSignature
      ? pagination.visibleCount
      : PRODUCTS_PER_BATCH;

  useEffect(() => {
    if (!productSignature) return;

    const cachedVisibleCount = readCachedVisibleCount(productSignature, products.length);

    const restoreTimer = window.setTimeout(() => {
      setPagination((prev) => {
        if (
          prev.productSignature === productSignature &&
          prev.visibleCount >= cachedVisibleCount
        ) {
          return prev;
        }

        return {
          productSignature,
          visibleCount: cachedVisibleCount,
        };
      });
    }, 0);

    return () => window.clearTimeout(restoreTimer);
  }, [productSignature, products.length]);

  useEffect(() => {
    if (catalogComplete || !onLoadMoreApproach) return;

    const sentinel = loadMoreSentinelRef.current;
    if (!sentinel || typeof IntersectionObserver === "undefined") return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          onLoadMoreApproach();
        }
      },
      { rootMargin: "520px 0px" },
    );

    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [catalogComplete, onLoadMoreApproach]);

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

      {!catalogComplete && (
        <div ref={loadMoreSentinelRef} className="mt-6 min-h-8 text-center" aria-live="polite">
          {catalogRefreshing ? (
            <p className="text-xs font-medium text-[var(--brand-cream)]/64">
              Preparando más productos...
            </p>
          ) : null}
        </div>
      )}

      {hasMoreProducts && (
        <div className="mt-7 flex flex-col items-center gap-3 text-center">
          <p className="text-xs font-medium text-[var(--brand-cream)]/70">
            Mostrando {visibleProducts.length} de {products.length} productos
          </p>
          <button
            type="button"
            onClick={() => {
              const nextVisibleCount = Math.min(visibleCount + PRODUCTS_PER_BATCH, products.length);
              writeCachedVisibleCount(productSignature, nextVisibleCount, products.length);
              setPagination({
                productSignature,
                visibleCount: nextVisibleCount,
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
