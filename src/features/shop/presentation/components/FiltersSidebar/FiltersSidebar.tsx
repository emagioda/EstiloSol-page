"use client";
import { useState } from "react";
import type { FilterState } from "../../view-models/useProductsStore";

interface FiltersSidebarProps {
  categories: string[];
  filters: FilterState;
  onFilterChange: {
    departament: (dep: string | null) => void;
    category: (cat: string | null) => void;
    search: (term: string) => void;
    sort: (sort: FilterState["sortBy"]) => void;
  };
  onClearFilters: () => void;
  isOpen?: boolean;
  onClose?: () => void;
}

export default function FiltersSidebar({
  categories,
  filters,
  onFilterChange,
  onClearFilters,
  isOpen = true,
  onClose,
}: FiltersSidebarProps) {
  const [expandedSections, setExpandedSections] = useState<Record<string, boolean>>({
    departament: true,
    category: true,
    sort: true,
  });

  const toggleSection = (section: string) => {
    setExpandedSections((prev) => ({
      ...prev,
      [section]: !prev[section],
    }));
  };

  const hasActiveFilters =
    filters.category || filters.searchTerm || filters.departament;
  const isMobileDrawer = Boolean(onClose);
  const drawerAnimationClass = isMobileDrawer
    ? isOpen
      ? "animate-slideInDrawerLeft"
      : "animate-slideOutDrawerLeft"
    : "";
  const backdropAnimationClass = isOpen
    ? "animate-fadeInBackdrop"
    : "animate-fadeOutBackdrop";

  return (
    <>
      {isMobileDrawer && (
        <div
          className={`fixed inset-0 z-30 bg-black/50 md:hidden ${backdropAnimationClass}`}
          onClick={() => onClose?.()}
        />
      )}

      <aside
        role="complementary"
        aria-label="Filtros de productos"
        className={`elegant-scrollbar fixed left-0 top-0 z-40 h-screen w-72 overflow-y-auto border-r border-[var(--brand-gold-300)]/20 bg-[var(--brand-violet-950)]/94 backdrop-blur-sm md:relative md:top-auto md:h-auto md:w-full md:rounded-2xl md:border md:border-[var(--brand-gold-300)]/24 md:bg-white/[0.09] md:px-5 md:py-4 md:shadow-[0_16px_36px_rgba(18,8,35,0.28)] ${drawerAnimationClass}`}
      >
        <div className="flex flex-col gap-5 p-5 pt-16 md:p-0">
          {onClose && (
            <button
              onClick={onClose}
              className="absolute right-4 top-4 rounded-full border border-[var(--brand-gold-400)]/30 p-1.5 transition hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand-gold-300)] md:hidden"
              aria-label="Cerrar filtros"
            >
              <span className="text-2xl text-[var(--brand-cream)]">✕</span>
            </button>
          )}

          {hasActiveFilters && (
            <button
              onClick={onClearFilters}
              className="rounded-md border border-[var(--brand-gold-400)]/24 px-3 py-1.5 text-left text-[11px] uppercase tracking-[0.14em] text-[var(--brand-gold-300)]/95 transition-colors hover:border-[var(--brand-gold-400)] hover:bg-white/5 hover:text-[var(--brand-gold-400)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand-gold-300)]"
            >
              Limpiar filtros
            </button>
          )}

          {/* departament section */}
          <div className="border-b border-[var(--brand-gold-300)]/12 pb-3.5">
            <button
              onClick={() => toggleSection("departament")}
              className="flex w-full items-center justify-between text-[11px] font-medium uppercase tracking-[0.14em] text-[var(--brand-cream)]/85 transition-colors hover:text-[var(--brand-gold-300)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand-gold-300)]"
            >
              Rubro
              <span className={`text-[10px] transition-transform ${expandedSections.departament ? "rotate-180" : ""}`}>
                ▼
              </span>
            </button>
            {expandedSections.departament && (
              <div className="mt-2.5 flex flex-col gap-1.5" role="radiogroup" aria-label="Filtrar por rubro">
                {[
                  { value: "PELUQUERIA", label: "Peluquería" },
                  { value: "BIJOUTERIE", label: "Bijouterie" },
                ].map((opt) => (
                  <label
                    key={String(opt.value)}
                    className="flex cursor-pointer items-center gap-2 rounded-md border border-transparent px-2 py-1.5 text-sm text-[var(--brand-cream)]/78 transition-colors hover:border-[var(--brand-gold-300)]/20 hover:bg-white/5 hover:text-[var(--brand-gold-300)]"
                  >
                    <input
                      type="radio"
                      name="departament"
                      value={opt.value ?? ""}
                      checked={filters.departament === opt.value}
                      onChange={() => onFilterChange.departament(opt.value)}
                      className="h-3.5 w-3.5 cursor-pointer accent-[var(--brand-gold-400)]"
                    />
                    {opt.label}
                  </label>
                ))}
              </div>
            )}
          </div>

          <div className="border-b border-[var(--brand-gold-300)]/12 pb-3.5">
            <button
              onClick={() => toggleSection("sort")}
              className="flex w-full items-center justify-between text-[11px] font-medium uppercase tracking-[0.14em] text-[var(--brand-cream)]/85 transition-colors hover:text-[var(--brand-gold-300)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand-gold-300)]"
            >
              Ordenar
              <span className={`text-[10px] transition-transform ${expandedSections.sort ? "rotate-180" : ""}`}>
                ▼
              </span>
            </button>
            {expandedSections.sort && (
              <div className="mt-2.5 flex flex-col gap-1.5" role="radiogroup" aria-label="Ordenar productos">
                {[
                  { value: "newest" as const, label: "Más recientes" },
                  { value: "price-asc" as const, label: "Menor precio" },
                  { value: "price-desc" as const, label: "Mayor precio" },
                  { value: "name-asc" as const, label: "A - Z" },
                  { value: "name-desc" as const, label: "Z - A" },
                ].map((option) => (
                  <label
                    key={option.value}
                    className="flex cursor-pointer items-center gap-2 rounded-md border border-transparent px-2 py-1.5 text-sm text-[var(--brand-cream)]/78 transition-colors hover:border-[var(--brand-gold-300)]/20 hover:bg-white/5 hover:text-[var(--brand-gold-300)]"
                  >
                    <input
                      type="radio"
                      name="sort"
                      value={option.value}
                      checked={filters.sortBy === option.value}
                      onChange={() => onFilterChange.sort(option.value)}
                      className="h-3.5 w-3.5 cursor-pointer accent-[var(--brand-gold-400)]"
                    />
                    {option.label}
                  </label>
                ))}
              </div>
            )}
          </div>

          <div className="border-b border-[var(--brand-gold-300)]/12 pb-3.5">
            <button
              onClick={() => toggleSection("category")}
              className="flex w-full items-center justify-between text-[11px] font-medium uppercase tracking-[0.14em] text-[var(--brand-cream)]/85 transition-colors hover:text-[var(--brand-gold-300)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand-gold-300)]"
            >
              Categoría
              <span className={`text-[10px] transition-transform ${expandedSections.category ? "rotate-180" : ""}`}>
                ▼
              </span>
            </button>
            {expandedSections.category && (
              <div className="mt-2.5 flex flex-col gap-1.5" role="radiogroup" aria-label="Filtrar por categoría">
                <label className="flex cursor-pointer items-center gap-2 rounded-md border border-transparent px-2 py-1.5 text-sm text-[var(--brand-cream)]/78 transition-colors hover:border-[var(--brand-gold-300)]/20 hover:bg-white/5 hover:text-[var(--brand-gold-300)]">
                  <input
                    type="radio"
                    name="category"
                    checked={filters.category === null}
                    onChange={() => onFilterChange.category(null)}
                    className="h-3.5 w-3.5 cursor-pointer accent-[var(--brand-gold-400)]"
                  />
                  Todas
                </label>
                {categories.map((cat) => (
                  <label
                    key={cat}
                    className="flex cursor-pointer items-center gap-2 rounded-md border border-transparent px-2 py-1.5 text-sm text-[var(--brand-cream)]/78 transition-colors hover:border-[var(--brand-gold-300)]/20 hover:bg-white/5 hover:text-[var(--brand-gold-300)]"
                  >
                    <input
                      type="radio"
                      name="category"
                      checked={filters.category === cat}
                      onChange={() => onFilterChange.category(filters.category === cat ? null : cat)}
                      className="h-3.5 w-3.5 cursor-pointer accent-[var(--brand-gold-400)]"
                    />
                    {cat}
                  </label>
                ))}
                {categories.length === 0 && (
                  <p className="px-2 py-1 text-xs text-[var(--brand-cream)]/60">
                    No hay categorías disponibles para este rubro.
                  </p>
                )}
              </div>
            )}
          </div>
        </div>
      </aside>
    </>
  );
}
