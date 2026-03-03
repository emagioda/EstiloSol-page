"use client";
import dynamic from "next/dynamic";
import { useEffect, useRef, useState } from "react";
import { hasSessionCatalogCache, useProductsStore } from "../view-models/useProductsStore";
import type { Product } from "@/src/features/shop/domain/entities/Product";
import ProductsGrid from "@/src/features/shop/presentation/components/ProductsGrid/ProductsGrid";
import FiltersSidebar from "@/src/features/shop/presentation/components/FiltersSidebar/FiltersSidebar";
import StoreToolbar from "@/src/features/shop/presentation/components/StoreToolbar/StoreToolbar";
import LoadingGrid from "@/src/features/shop/presentation/components/LoadingGrid/LoadingGrid";
import { useCartBadgeVisibility } from "@/src/features/shop/presentation/view-models/useCartBadgeVisibility";

const QuickViewModal = dynamic(
  () => import("@/src/features/shop/presentation/components/QuickViewModal/QuickViewModal"),
  { ssr: false }
);

type TiendaClientViewProps = {
  initialProducts: Product[];
  staticDetailHandles?: string[];
  storeHeading?: string;
  storeDescription?: string;
};

type CartNotice = {
  type: "success" | "error";
  message: string;
};

const departamentOptions = [
  {
    value: "PELUQUERIA",
    label: "PELUQUERÍA",
  },
  {
    value: "BIJOUTERIE",
    label: "BIJOUTERIE",
  },
];

export default function TiendaClientView({
  initialProducts,
  staticDetailHandles = [],
  storeHeading = "Tienda Híbrida · Estilo y Cuidado",
  storeDescription =
    "Comprá Productos Profesionales para peluquería y Diseños Únicos de bijouterie. Elegí tus favoritos y coordinamos el pago por transferencia o efectivo.",
}: TiendaClientViewProps) {
  const {
    products,
    loading,
    status,
    errorMessage,
    loadProducts,
    filters,
    setSearchTerm,
    setDepartament,
    setCategory,
    setSortBy,
    clearFilters,
    categories,
    selectedProduct,
    isQuickViewOpen,
    openQuickView,
    closeQuickView,
  } = useProductsStore({ initialProducts });

  const [filtersOpen, setFiltersOpen] = useState(false);
  const [selectedWorld, setSelectedWorld] = useState<string>("PELUQUERIA");
  const [cartNotice, setCartNotice] = useState<CartNotice | null>(null);
  const hasCheckedFirstVisitRef = useRef(false);
  const { setSuppressBadge, setSuppressFloatingCart } = useCartBadgeVisibility();

  const availableCategories = categories;
  const selectedWorldIndex = Math.max(
    departamentOptions.findIndex((option) => option.value === selectedWorld),
    0
  );

  const departamentFilteredProducts = !filters.departament
    ? products
    : (() => {
        const depFilter = filters.departament;
        return products.filter(
          (p) =>
            typeof p.departament === "string" &&
            p.departament.toLowerCase() === depFilter.toLowerCase()
        );
      })();

  useEffect(() => {
    if (hasCheckedFirstVisitRef.current) return;

    hasCheckedFirstVisitRef.current = true;

    if (!hasSessionCatalogCache()) {
      void loadProducts(true);
      return;
    }

    if (status === "idle") {
      void loadProducts();
    }
  }, [loadProducts, status]);

  useEffect(() => {
    if (filters.departament || products.length === 0) return;
    const counts: Record<string, number> = {};
    products.forEach((p) => {
      if (typeof p.departament === "string") {
        counts[p.departament] = (counts[p.departament] || 0) + 1;
      }
    });
    const winner = Object.entries(counts)
      .sort((a, b) => b[1] - a[1])
      .map((entry) => entry[0])[0];
    if (winner && winner !== selectedWorld) {
      setSelectedWorld(winner);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [products]);

  useEffect(() => {
    setSuppressBadge(isQuickViewOpen);
    setSuppressFloatingCart(isQuickViewOpen);
    return () => {
      setSuppressBadge(false);
      setSuppressFloatingCart(false);
    };
  }, [isQuickViewOpen, setSuppressBadge, setSuppressFloatingCart]);

  useEffect(() => {
    if (!cartNotice) return;
    const timer = window.setTimeout(() => setCartNotice(null), 2600);
    return () => window.clearTimeout(timer);
  }, [cartNotice]);

  const handleAddFeedback = ({ ok, name }: { ok: boolean; name: string }) => {
    setCartNotice({
      type: ok ? "success" : "error",
      message: ok
        ? `${name} se agregó al carrito con éxito.`
        : `No pudimos agregar ${name}. Intentá nuevamente.`,
    });
  };

  return (
    <main className="min-h-screen bg-[var(--brand-violet-950)]">
      <div className="mx-auto max-w-7xl px-4 pb-16 pt-4 text-[var(--brand-cream)] md:pt-6">
        <header className="mb-8 text-center md:mb-10">
          <h1 className="text-3xl font-semibold leading-tight tracking-wide text-[var(--brand-cream)] sm:text-4xl md:text-5xl">
            {storeHeading}
          </h1>
          <p className="mx-auto mt-2 max-w-3xl text-sm leading-relaxed text-[var(--brand-cream)]/75 sm:text-base md:mt-3 md:max-w-none md:whitespace-nowrap md:text-lg">
            {storeDescription}
          </p>

          <div className="glass-panel mt-5 mx-auto w-full max-w-4xl rounded-2xl border border-white/10 p-4 md:p-4">
            <p className="mb-2 text-center text-xs uppercase tracking-[0.18em] text-[var(--brand-gold-300)] sm:text-sm">
              Tu estilo ideal empieza acá
            </p>
            <div className="relative mx-auto grid w-full max-w-2xl grid-cols-2 rounded-full border border-white/15 bg-[var(--brand-violet-950)]/35 p-1">
              <span
                aria-hidden="true"
                className="pointer-events-none absolute bottom-1 left-1 top-1 w-[calc(50%-0.25rem)] rounded-full border border-[var(--brand-gold-400)] bg-white/12 shadow-[0_6px_14px_rgba(0,0,0,0.18)] transition-transform duration-300 ease-out"
                style={{ transform: `translateX(${selectedWorldIndex * 100}%)` }}
              />
              {departamentOptions.map((opt) => {
                const active = selectedWorld === opt.value;
                return (
                  <button
                    key={opt.value}
                    type="button"
                    onClick={() => {
                      setSelectedWorld(opt.value);
                      setCategory(null);
                      setDepartament(opt.value);
                    }}
                    className="relative z-10 rounded-full border border-transparent px-4 py-2 text-center transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand-gold-300)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--brand-violet-900)]"
                    aria-pressed={active}
                  >
                    <span
                      className={`block text-[11px] font-semibold uppercase tracking-[0.16em] sm:text-sm ${
                        active
                          ? "text-[var(--brand-cream)]"
                          : "text-[var(--brand-cream)]/80"
                      }`}
                    >
                      {opt.label}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        </header>

        <section className="mt-8">
          <div className="grid grid-cols-1 gap-6 md:grid-cols-[280px_1fr] md:gap-8">
            <div className="hidden md:block">
              <FiltersSidebar
                categories={availableCategories}
                filters={filters}
                onFilterChange={{
                  departament: setDepartament,
                  category: setCategory,
                  search: setSearchTerm,
                  sort: setSortBy,
                }}
                onClearFilters={clearFilters}
              />
            </div>

            <div className="flex-1">
              <StoreToolbar
                searchTerm={filters.searchTerm}
                onSearchChange={setSearchTerm}
                onFiltersClick={() => setFiltersOpen(true)}
              />

              {loading ? (
                <LoadingGrid />
              ) : status === "error" ? (
                <div className="rounded-2xl border border-rose-300/35 bg-rose-950/30 px-5 py-8 text-center">
                  <h3 className="text-lg font-semibold text-[var(--brand-cream)]">
                    Catálogo no disponible
                  </h3>
                  <p className="mt-2 text-sm text-[var(--brand-gold-300)]">
                    {errorMessage ?? "No pudimos cargar los productos en este momento."}
                  </p>
                  <button
                    type="button"
                    onClick={() => {
                      void loadProducts(true);
                    }}
                    className="mt-5 inline-flex items-center justify-center rounded-full border border-[var(--brand-gold-300)] px-5 py-2 text-sm font-semibold text-[var(--brand-cream)] transition duration-200 hover:bg-[rgba(255,255,255,0.08)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand-gold-300)]"
                  >
                    Reintentar
                  </button>
                </div>
              ) : (
                <ProductsGrid
                  products={departamentFilteredProducts}
                  onQuickView={openQuickView}
                  staticDetailHandles={staticDetailHandles}
                />
              )}
            </div>
          </div>
        </section>

        {cartNotice && (
          <div className="pointer-events-none fixed inset-x-0 top-24 z-[70] flex justify-center px-4">
            <div
              className={`rounded-xl border px-4 py-2.5 text-sm font-medium shadow-[0_12px_30px_rgba(10,4,20,0.35)] backdrop-blur animate-fade-up ${
                cartNotice.type === "success"
                  ? "border-emerald-200/60 bg-emerald-600/85 text-white"
                  : "border-rose-200/60 bg-rose-600/85 text-white"
              }`}
              role="status"
              aria-live="polite"
            >
              <span className="inline-flex items-center gap-2">
                <span aria-hidden>{cartNotice.type === "success" ? "✓" : "⚠"}</span>
                {cartNotice.message}
              </span>
            </div>
          </div>
        )}

        {filtersOpen && (
          <div className="fixed inset-0 z-50 md:hidden">
            <FiltersSidebar
              categories={availableCategories}
              filters={filters}
              onFilterChange={{
                departament: setDepartament,
                category: setCategory,
                search: setSearchTerm,
                sort: setSortBy,
              }}
              onClearFilters={clearFilters}
              isOpen={filtersOpen}
              onClose={() => setFiltersOpen(false)}
            />
          </div>
        )}

        <QuickViewModal
          key={selectedProduct?.id ?? "quick-view-empty"}
          open={isQuickViewOpen}
          product={selectedProduct}
          onClose={closeQuickView}
          onAddFeedback={handleAddFeedback}
        />
      </div>
    </main>
  );
}
