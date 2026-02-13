"use client";
import { useEffect, useState } from "react";
import { useProductsStore, type Product } from "../view-models/useProductsStore";
import { useCartDrawer } from "../view-models/useCartDrawer";
import ProductsGrid from "@/src/features/shop/presentation/components/ProductsGrid/ProductsGrid";
import FiltersSidebar from "@/src/features/shop/presentation/components/FiltersSidebar/FiltersSidebar";
import StoreToolbar from "@/src/features/shop/presentation/components/StoreToolbar/StoreToolbar";
import CartDrawer from "@/src/features/shop/presentation/components/CartDrawer/CartDrawer";
import LoadingGrid from "@/src/features/shop/presentation/components/LoadingGrid/LoadingGrid";
import QuickViewModal from "@/src/features/shop/presentation/components/QuickViewModal/QuickViewModal";
import { useCartBadgeVisibility } from "@/src/features/shop/presentation/view-models/useCartBadgeVisibility";

type TiendaClientViewProps = {
  initialProducts: Product[];
  storeHeading?: string;
  storeDescription?: string;
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
  const { open: cartOpen, setOpen: setCartOpen } = useCartDrawer();
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [selectedWorld, setSelectedWorld] = useState<ShopWorld>("peluqueria");
  const { setSuppressBadge, setSuppressFloatingCart } = useCartBadgeVisibility();

  const categoryBelongsToWorld = (category: string, world: ShopWorld) => {
    const normalizedCategory = normalizeText(category);
    return worldKeywords[world].some((keyword) =>
      normalizedCategory.includes(normalizeText(keyword))
    );
  };

  const availableCategories = categories.filter((category) =>
    categoryBelongsToWorld(category, selectedWorld)
  );

  const worldFilteredProducts = products.filter((product) => {
    const searchable = normalizeText(
      `${product.category ?? ""} ${product.name ?? ""} ${product.description ?? ""}`
    );
    return worldKeywords[selectedWorld].some((keyword) =>
      searchable.includes(normalizeText(keyword))
    );
  });

  useEffect(() => {
    setSuppressBadge(isQuickViewOpen);
    setSuppressFloatingCart(isQuickViewOpen);
    return () => {
      setSuppressBadge(false);
      setSuppressFloatingCart(false);
    };
  }, [isQuickViewOpen, setSuppressBadge, setSuppressFloatingCart]);

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
            <ProductsGrid products={worldFilteredProducts} onQuickView={openQuickView} />
          )}
        </div>
      </section>

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
      />

      <CartDrawer open={cartOpen} onClose={() => setCartOpen(false)} />
    </main>
  );
}
