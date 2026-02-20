"use client";
import { useEffect, useState } from "react";
import { useProductsStore } from "../view-models/useProductsStore";
import type { Product } from "@/src/features/shop/domain/entities/Product";
import ProductsGrid from "@/src/features/shop/presentation/components/ProductsGrid/ProductsGrid";
import FiltersSidebar from "@/src/features/shop/presentation/components/FiltersSidebar/FiltersSidebar";
import StoreToolbar from "@/src/features/shop/presentation/components/StoreToolbar/StoreToolbar";
import LoadingGrid from "@/src/features/shop/presentation/components/LoadingGrid/LoadingGrid";
import QuickViewModal from "@/src/features/shop/presentation/components/QuickViewModal/QuickViewModal";
import { useCartBadgeVisibility } from "@/src/features/shop/presentation/view-models/useCartBadgeVisibility";

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

// el proyecto distingue dos rubros que vienen de la hoja: PELUQUERIA o BIJOUTERIE
// estos dos objetos sirven para construir los botones grandes al inicio
const departamentOptions = [
  { value: "PELUQUERIA", label: "Peluquería", description: "Productos profesionales para cuidar y realzar tu cabello." },
  { value: "BIJOUTERIE", label: "Bijouterie", description: "Diseños únicos para complementar cada estilo con personalidad." },
];

export default function TiendaClientView({
  initialProducts,
  staticDetailHandles = [],
  storeHeading = "Tienda Híbrida · Estilo y Cuidado",
  storeDescription = "Comprá Productos Profesionales para peluquería y Diseños Únicos de bijouterie. Elegí tus favoritos y coordinamos el pago por transferencia o efectivo.",
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
  const { setSuppressBadge, setSuppressFloatingCart } = useCartBadgeVisibility();

  // cuando el usuario elige rubro guardamos en el estado local
  // pero el filtro real se aplica directamente en el store

  const availableCategories = categories; // el hook ya considera departament

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
    if (status === "idle") {
      loadProducts();
    }
  }, [loadProducts, status]);

  // si todavía no hay rubro seleccionado elegimos el que tenga más productos
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
      // eslint-disable-next-line react-hooks/set-state-in-effect
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
    <main className="mx-auto w-full max-w-7xl px-4 py-8 text-[var(--brand-cream)]">
      <header className="mb-8">
        <h1 className="text-3xl font-semibold text-[var(--brand-cream)]">
          {storeHeading}
        </h1>
        <p className="mt-3 max-w-2xl text-sm text-[var(--brand-gold-300)]">
          {storeDescription}
        </p>

        <div className="mt-6 rounded-3xl border border-[var(--brand-gold-400)]/30 bg-[linear-gradient(145deg,rgba(83,52,126,0.72),rgba(41,24,66,0.82))] p-4 shadow-[0_18px_40px_rgba(18,8,35,0.32)] md:p-5">
          <p className="mb-3 text-xs uppercase tracking-[0.22em] text-[var(--brand-gold-300)]">
            Explorá por rubro
          </p>
          <div className="grid gap-3 sm:grid-cols-2">
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
                  className={`rounded-2xl border p-4 text-left transition ${
                    active
                      ? "border-[var(--brand-gold-400)] bg-[rgba(255,255,255,0.12)] shadow-[0_10px_30px_rgba(0,0,0,0.25)]"
                      : "border-white/15 bg-[rgba(255,255,255,0.04)] hover:border-[var(--brand-gold-300)] hover:bg-[rgba(255,255,255,0.08)]"
                  }`}
                  aria-pressed={active}
                >
                  <span className="block text-sm font-semibold uppercase tracking-[0.12em] text-[var(--brand-cream)]">
                    {opt.label}
                  </span>
                  <span className="mt-1 block text-xs text-[var(--brand-cream)]/80">
                    {opt.description}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      </header>

      <section className="flex flex-col gap-6 rounded-3xl border border-[var(--brand-gold-400)]/20 bg-[rgba(58,31,95,0.35)] p-4 shadow-[0_20px_50px_rgba(18,8,35,0.35)] md:flex-row md:gap-8 md:p-6">
        <div className="hidden md:block md:w-64">
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
              productCount={departamentFilteredProducts.length}
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
                  void loadProducts();
                }}
                className="mt-5 inline-flex items-center justify-center rounded-full border border-[var(--brand-gold-300)] px-5 py-2 text-sm font-semibold text-[var(--brand-cream)] transition hover:bg-[rgba(255,255,255,0.08)]"
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
      </section>

      {cartNotice && (
        <div className="pointer-events-none fixed inset-x-0 top-24 z-[70] flex justify-center px-4">
          <div
            className={`rounded-xl border px-4 py-2.5 text-sm font-medium shadow-[0_12px_30px_rgba(10,4,20,0.35)] backdrop-blur ${
              cartNotice.type === "success"
                ? "border-emerald-200/60 bg-emerald-600/85 text-white"
                : "border-rose-200/60 bg-rose-600/85 text-white"
            }`}
            role="status"
            aria-live="polite"
          >
            {cartNotice.message}
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
    </main>
  );
}
