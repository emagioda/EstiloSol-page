"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import ProductCard from "../ProductCard/ProductCard";
import type { Product } from "@/src/features/shop/domain/entities/Product";
import {
  getCurrentShopLocationKey,
  isMatchingShopListingCache,
  isShopScrollRestoreRequested,
  readShopScrollCache,
} from "@/src/features/shop/presentation/lib/shopScrollRestoration";

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

const visibleCountForProductIndex = (index: number, productCount: number) =>
  clampVisibleCount(
    Math.ceil((index + 1) / PRODUCTS_PER_BATCH) * PRODUCTS_PER_BATCH,
    productCount,
  );

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
    [products],
  );
  const visibleCount =
    pagination.productSignature === productSignature
      ? pagination.visibleCount
      : PRODUCTS_PER_BATCH;
  const hasMoreProducts = visibleCount < products.length;

  useEffect(() => {
    if (!productSignature) return;

    const cachedScroll = readShopScrollCache();
    const shouldRestoreCachedPageSize =
      cachedScroll &&
      isMatchingShopListingCache(cachedScroll.locationKey, getCurrentShopLocationKey()) &&
      isShopScrollRestoreRequested(cachedScroll);
    const cachedVisibleCount = shouldRestoreCachedPageSize
      ? readCachedVisibleCount(productSignature, products.length)
      : PRODUCTS_PER_BATCH;

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
    const cachedScroll = readShopScrollCache();
    if (!cachedScroll) return;
    if (!isMatchingShopListingCache(cachedScroll.locationKey, getCurrentShopLocationKey())) return;
    if (!isShopScrollRestoreRequested(cachedScroll)) return;
    if (!cachedScroll.productId && !cachedScroll.productHandle) return;

    const targetProductIndex = products.findIndex(
      (product) =>
        product.id === cachedScroll.productId ||
        product.slug === cachedScroll.productHandle ||
        product.id === cachedScroll.productHandle,
    );
    if (targetProductIndex < 0) return;

    const targetVisibleCount = visibleCountForProductIndex(targetProductIndex, products.length);

    const restoreTargetTimer = window.setTimeout(() => {
      setPagination((prev) => {
        if (
          prev.productSignature === productSignature &&
          prev.visibleCount >= targetVisibleCount
        ) {
          return prev;
        }

        return {
          productSignature,
          visibleCount: targetVisibleCount,
        };
      });
    }, 0);

    return () => window.clearTimeout(restoreTargetTimer);
  }, [productSignature, products]);

  useEffect(() => {
    if (catalogComplete && !hasMoreProducts) return;

    const sentinel = loadMoreSentinelRef.current;
    if (!sentinel || typeof IntersectionObserver === "undefined") return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries.some((entry) => entry.isIntersecting)) return;

        if (!catalogComplete) {
          onLoadMoreApproach?.();
        }

        if (hasMoreProducts) {
          const nextVisibleCount = Math.min(visibleCount + PRODUCTS_PER_BATCH, products.length);
          writeCachedVisibleCount(productSignature, nextVisibleCount, products.length);
          setPagination({
            productSignature,
            visibleCount: nextVisibleCount,
          });
        }
      },
      { rootMargin: "720px 0px" },
    );

    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [
    catalogComplete,
    hasMoreProducts,
    onLoadMoreApproach,
    productSignature,
    products.length,
    visibleCount,
  ]);

  if (!products || products.length === 0) {
    return (
      <div className="rounded-2xl border border-white/12 bg-white/6 p-6 py-12 text-center text-[var(--brand-cream)]/80">
        <h3 className="text-lg font-medium">No encontramos productos con esos filtros</h3>
        <p className="mt-2 text-sm text-[var(--brand-cream)]/80">
          Proba quitar algunos filtros o busca otro termino.
        </p>
      </div>
    );
  }

  const visibleProducts = products.slice(0, visibleCount);
  const shouldRenderLoadSentinel = hasMoreProducts || !catalogComplete;

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

      {shouldRenderLoadSentinel && (
        <div ref={loadMoreSentinelRef} className="mt-6 min-h-10 text-center" aria-live="polite">
          {catalogRefreshing ? (
            <p className="text-xs font-medium text-[var(--brand-cream)]/64">
              Preparando mas productos...
            </p>
          ) : null}
        </div>
      )}
    </>
  );
}
