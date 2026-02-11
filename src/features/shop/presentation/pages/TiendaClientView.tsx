"use client";
import { useState } from "react";
import { useProductsStore, type Product } from "../view-models/useProductsStore";
import { useCartDrawer } from "../view-models/useCartDrawer";
import ProductsGrid from "@/src/features/shop/presentation/components/ProductsGrid/ProductsGrid";
import FiltersSidebar from "@/src/features/shop/presentation/components/FiltersSidebar/FiltersSidebar";
import StoreToolbar from "@/src/features/shop/presentation/components/StoreToolbar/StoreToolbar";
import CartDrawer from "@/src/features/shop/presentation/components/CartDrawer/CartDrawer";
import LoadingGrid from "@/src/features/shop/presentation/components/LoadingGrid/LoadingGrid";

type TiendaClientViewProps = {
  initialProducts: Product[];
};

export default function TiendaClientView({ initialProducts }: TiendaClientViewProps) {
  const {
    products,
    loading,
    filters,
    setSearchTerm,
    setCategory,
    setSortBy,
    clearFilters,
    categories,
  } = useProductsStore({ initialProducts });
  const { open: cartOpen, setOpen: setCartOpen } = useCartDrawer();
  const [filtersOpen, setFiltersOpen] = useState(false);

  return (
    <main className="mx-auto w-full max-w-7xl px-4 py-8 text-[var(--brand-cream)]">
      <header className="mb-8">
        <h1 className="text-3xl font-semibold text-[var(--brand-cream)]">
          Tienda de Bijouterie
        </h1>
        <p className="mt-3 max-w-2xl text-sm text-[var(--brand-gold-300)]">
          Elegí tus favoritos, armá tu carrito y coordinamos el pago por
          transferencia o efectivo.
        </p>
      </header>

      <section className="flex flex-col gap-6 rounded-3xl border border-[var(--brand-gold-400)]/20 bg-[rgba(58,31,95,0.35)] p-4 shadow-[0_20px_50px_rgba(18,8,35,0.35)] md:flex-row md:gap-8 md:p-6">
        <div className="hidden md:block md:w-64">
          <FiltersSidebar
            categories={categories}
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
            productCount={products.length}
          />

          {loading ? <LoadingGrid /> : <ProductsGrid products={products} />}
        </div>
      </section>

      {filtersOpen && (
        <div className="fixed inset-0 z-50 md:hidden">
          <FiltersSidebar
            categories={categories}
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

      <CartDrawer open={cartOpen} onClose={() => setCartOpen(false)} />
    </main>
  );
}
