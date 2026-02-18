"use client";
import { useCallback, useEffect, useState } from "react";
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
  storeHeading?: string;
  storeDescription?: string;
};

type CartNotice = {
  type: "success" | "error";
  message: string;
};

type ShopWorld = "peluqueria" | "bijouterie";

const worldKeywords: Record<ShopWorld, string[]> = {
  peluqueria: ["pelo", "capilar", "shampoo", "acondicionador", "tratamiento", "peine", "tintura", "peluquer"],
  bijouterie: ["bijou", "aro", "anillo", "pulsera", "collar", "accesorio", "joya"],
};

const normalizeText = (value: string) => value.toLowerCase().normalize("NFD").replace(/\p{Diacritic}/gu, "");

const worldOptions: { key: ShopWorld; label: string; description: string }[] = [
  {
    key: "peluqueria",
    label: "Peluquería",
    description: "Productos profesionales para cuidar y realzar tu cabello.",
  },
  {
    key: "bijouterie",
    label: "Bijouterie",
    description: "Diseños únicos para complementar cada estilo con personalidad.",
  },
];

export default function TiendaClientView({
  initialProducts,
  storeHeading = "Tienda Híbrida · Estilo y Cuidado",
  storeDescription = "Comprá Productos Profesionales para peluquería y Diseños Únicos de bijouterie. Elegí tus favoritos y coordinamos el pago por transferencia o efectivo.",
}: TiendaClientViewProps) {
  const {
    products,
    loading,
    filters,
    setSearchTerm,
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
  const [selectedWorld, setSelectedWorld] = useState<ShopWorld>("peluqueria");
  const [hasUserSelectedWorld, setHasUserSelectedWorld] = useState(false);
  const [cartNotice, setCartNotice] = useState<CartNotice | null>(null);
  const { setSuppressBadge, setSuppressFloatingCart } = useCartBadgeVisibility();

  const matchesWorld = useCallback((product: Product, world: ShopWorld) => {
    const searchable = normalizeText(
      `${product.category ?? ""} ${product.name ?? ""} ${product.description ?? ""}`
    );
    return worldKeywords[world].some((keyword) =>
      searchable.includes(normalizeText(keyword))
    );
  }, []);

  const categoryBelongsToWorld = (category: string, world: ShopWorld) => {
    const normalizedCategory = normalizeText(category);
    return worldKeywords[world].some((keyword) =>
      normalizedCategory.includes(normalizeText(keyword))
    );
  };

  const availableCategories = categories.filter((category) =>
    categoryBelongsToWorld(category, selectedWorld)
  );

  const worldFilteredProducts = products.filter((product) =>
    matchesWorld(product, selectedWorld)
  );

  useEffect(() => {
    if (loading || hasUserSelectedWorld || products.length === 0) return;

    const countPeluqueria = products.filter((product) =>
      matchesWorld(product, "peluqueria")
    ).length;
    const countBijouterie = products.filter((product) =>
      matchesWorld(product, "bijouterie")
    ).length;

    let nextWorld: ShopWorld | null = null;

    if (countPeluqueria === 0 && countBijouterie > 0) {
      nextWorld = "bijouterie";
    } else if (countBijouterie === 0 && countPeluqueria > 0) {
      nextWorld = "peluqueria";
    } else if (countPeluqueria > 0 && countBijouterie > 0) {
      nextWorld = countBijouterie > countPeluqueria ? "bijouterie" : "peluqueria";
    }

    if (!nextWorld || nextWorld === selectedWorld) return;

    const timer = window.setTimeout(() => {
      setSelectedWorld(nextWorld);
    }, 0);

    return () => window.clearTimeout(timer);
  }, [hasUserSelectedWorld, loading, matchesWorld, products, selectedWorld]);

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
            {worldOptions.map((world) => {
              const active = selectedWorld === world.key;
              return (
                <button
                  key={world.key}
                  type="button"
                  onClick={() => {
                    setHasUserSelectedWorld(true);
                    setSelectedWorld(world.key);
                    setCategory(null);
                  }}
                  className={`rounded-2xl border p-4 text-left transition ${
                    active
                      ? "border-[var(--brand-gold-400)] bg-[rgba(255,255,255,0.12)] shadow-[0_10px_30px_rgba(0,0,0,0.25)]"
                      : "border-white/15 bg-[rgba(255,255,255,0.04)] hover:border-[var(--brand-gold-300)] hover:bg-[rgba(255,255,255,0.08)]"
                  }`}
                  aria-pressed={active}
                >
                  <span className="block text-sm font-semibold uppercase tracking-[0.12em] text-[var(--brand-cream)]">
                    {world.label}
                  </span>
                  <span className="mt-1 block text-xs text-[var(--brand-cream)]/80">
                    {world.description}
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
              productCount={worldFilteredProducts.length}
            />

          {loading ? (
            <LoadingGrid />
          ) : (
            <ProductsGrid
              products={worldFilteredProducts}
              onQuickView={openQuickView}
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
