"use client";
import { useState } from "react";
import type { FilterState } from "../../view-models/useProductsStore";

interface FiltersSidebarProps {
  categories: string[];
  filters: FilterState;
  onFilterChange: {
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
  maxPrice,
  filters,
  onFilterChange,
  onClearFilters,
  isOpen = true,
  onClose,
}: FiltersSidebarProps) {
  const [expandedSections, setExpandedSections] = useState<
    Record<string, boolean>
  >({
    category: true,
    sort: true,
  });

  const toggleSection = (section: string) => {
    setExpandedSections((prev) => ({
      ...prev,
      [section]: !prev[section],
    }));
  };

  const hasActiveFilters = filters.category || filters.searchTerm;

  return (
    <>
      {/* Mobile Overlay */}
      {!isOpen && (
        <div
          className="fixed inset-0 z-30 bg-black/50 md:hidden"
          onClick={onClose}
        />
      )}

      {/* Sidebar */}
      <aside
        className={`fixed left-0 top-0 z-40 h-screen w-64 transform bg-[var(--brand-violet-950)] transition-transform duration-300 md:relative md:top-auto md:h-auto md:transform-none md:bg-transparent md:transition-none md:rounded-3xl md:border md:border-[var(--brand-gold-400)]/20 md:bg-[rgba(58,31,95,0.35)] md:p-4 md:shadow-[0_18px_45px_rgba(18,8,35,0.3)] ${
          isOpen ? "translate-x-0" : "-translate-x-full md:translate-x-0"
        }`}
      >
        <div className="flex flex-col gap-6 p-4 pt-16 md:p-0">
          {/* Close button (mobile only) */}
          {onClose && (
            <button
              onClick={onClose}
              className="absolute right-4 top-4 md:hidden"
            >
              <span className="text-2xl text-[var(--brand-cream)]">✕</span>
            </button>
          )}

          {/* Clear Filters */}
          {hasActiveFilters && (
            <button
              onClick={onClearFilters}
              className="text-sm text-[var(--brand-gold-300)] underline transition-colors hover:text-[var(--brand-gold-400)]"
            >
              Limpiar filtros
            </button>
          )}

          {/* Sort Section */}
          <div className="border-b border-[var(--brand-violet-900)] pb-4">
            <button
              onClick={() => toggleSection("sort")}
              className="flex w-full items-center justify-between text-sm font-semibold text-[var(--brand-cream)] transition-colors hover:text-[var(--brand-gold-300)]"
            >
              Ordenar
              <span
                className={`transition-transform ${
                  expandedSections.sort ? "rotate-180" : ""
                }`}
              >
                ▼
              </span>
            </button>
            {expandedSections.sort && (
              <div className="mt-3 flex flex-col gap-2">
                {[
                  { value: "newest" as const, label: "Más recientes" },
                  { value: "price-asc" as const, label: "Menor precio" },
                  { value: "price-desc" as const, label: "Mayor precio" },
                  { value: "name-asc" as const, label: "A - Z" },
                  { value: "name-desc" as const, label: "Z - A" },
                ].map((option) => (
                  <label
                    key={option.value}
                    className="flex cursor-pointer items-center gap-2 text-sm text-[var(--brand-cream)]/80 transition-colors hover:text-[var(--brand-gold-300)]"
                  >
                    <input
                      type="radio"
                      name="sort"
                      value={option.value}
                      checked={filters.sortBy === option.value}
                      onChange={() => onFilterChange.sort(option.value)}
                      className="cursor-pointer"
                    />
                    {option.label}
                  </label>
                ))}
              </div>
            )}
          </div>

          {/* Category Section */}
          <div className="border-b border-[var(--brand-violet-900)] pb-4">
            <button
              onClick={() => toggleSection("category")}
              className="flex w-full items-center justify-between text-sm font-semibold text-[var(--brand-cream)] transition-colors hover:text-[var(--brand-gold-300)]"
            >
              Categoría
              <span
                className={`transition-transform ${
                  expandedSections.category ? "rotate-180" : ""
                }`}
              >
                ▼
              </span>
            </button>
            {expandedSections.category && (
              <div className="mt-3 flex flex-col gap-2">
                <label className="flex cursor-pointer items-center gap-2 text-sm text-[var(--brand-cream)]/80 transition-colors hover:text-[var(--brand-gold-300)]">
                  <input
                    type="checkbox"
                    checked={filters.category === null}
                    onChange={() => onFilterChange.category(null)}
                    className="cursor-pointer"
                  />
                  Todas
                </label>
                {categories.map((cat) => (
                  <label
                    key={cat}
                    className="flex cursor-pointer items-center gap-2 text-sm text-[var(--brand-cream)]/80 transition-colors hover:text-[var(--brand-gold-300)]"
                  >
                    <input
                      type="checkbox"
                      checked={filters.category === cat}
                      onChange={() =>
                        onFilterChange.category(
                          filters.category === cat ? null : cat
                        )
                      }
                      className="cursor-pointer"
                    />
                    {cat}
                  </label>
                ))}
              </div>
            )}
          </div>

          {/* Price filter removed */}
        </div>
      </aside>
    </>
  );
}
