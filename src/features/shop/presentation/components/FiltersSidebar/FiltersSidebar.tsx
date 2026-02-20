"use client";
import { useState } from "react";
import type { FilterState } from "../../view-models/useProductsStore";

interface FiltersSidebarProps {
  departaments: string[];
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
  departaments,
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

  const hasActiveFilters = filters.departament || filters.category || filters.searchTerm;

  return (
    <>
      {isOpen && <div className="fixed inset-0 z-30 bg-black/50 md:hidden" onClick={onClose} />}

      <aside
        className={`fixed left-0 top-0 z-40 h-screen w-72 transform bg-[linear-gradient(180deg,rgba(58,31,95,0.98)_0%,rgba(34,18,55,0.98)_100%)] transition-transform duration-300 md:relative md:top-auto md:h-auto md:w-full md:transform-none md:rounded-3xl md:border md:border-[var(--brand-gold-400)]/30 md:bg-[rgba(58,31,95,0.45)] md:p-5 md:shadow-[0_18px_45px_rgba(18,8,35,0.3)] ${
          isOpen ? "translate-x-0" : "-translate-x-full md:translate-x-0"
        }`}
      >
        <div className="flex flex-col gap-6 p-5 pt-16 md:p-0">
          {onClose && (
            <button
              onClick={onClose}
              className="absolute right-4 top-4 rounded-full border border-[var(--brand-gold-400)]/40 p-1.5 transition hover:bg-white/10 md:hidden"
            >
              <span className="text-2xl text-[var(--brand-cream)]">✕</span>
            </button>
          )}

          {hasActiveFilters && (
            <button
              onClick={onClearFilters}
              className="rounded-lg border border-[var(--brand-gold-400)]/30 px-3 py-1.5 text-left text-xs uppercase tracking-[0.12em] text-[var(--brand-gold-300)] transition-colors hover:border-[var(--brand-gold-400)] hover:bg-white/5 hover:text-[var(--brand-gold-400)]"
            >
              Limpiar filtros
            </button>
          )}

          <div className="border-b border-white/10 pb-4">
            <button
              onClick={() => toggleSection("sort")}
              className="flex w-full items-center justify-between text-sm font-semibold uppercase tracking-[0.08em] text-[var(--brand-cream)] transition-colors hover:text-[var(--brand-gold-300)]"
            >
              Ordenar
              <span className={`transition-transform ${expandedSections.sort ? "rotate-180" : ""}`}>
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
                    className="flex cursor-pointer items-center gap-2 rounded-lg border border-transparent px-2 py-1.5 text-sm text-[var(--brand-cream)]/80 transition hover:border-white/10 hover:bg-white/5 hover:text-[var(--brand-gold-300)]"
                  >
                    <input
                      type="radio"
                      name="sort"
                      value={option.value}
                      checked={filters.sortBy === option.value}
                      onChange={() => onFilterChange.sort(option.value)}
                      className="h-4 w-4 cursor-pointer accent-[var(--brand-gold-400)]"
                    />
                    {option.label}
                  </label>
                ))}
              </div>
            )}
          </div>

          <div className="border-b border-white/10 pb-4">
            <button
              onClick={() => toggleSection("departament")}
              className="flex w-full items-center justify-between text-sm font-semibold uppercase tracking-[0.08em] text-[var(--brand-cream)] transition-colors hover:text-[var(--brand-gold-300)]"
            >
              Departamento
              <span className={`transition-transform ${expandedSections.departament ? "rotate-180" : ""}`}>
                ▼
              </span>
            </button>
            {expandedSections.departament && (
              <div className="mt-3 flex flex-col gap-2">
                <label className="flex cursor-pointer items-center gap-2 rounded-lg border border-transparent px-2 py-1.5 text-sm text-[var(--brand-cream)]/80 transition hover:border-white/10 hover:bg-white/5 hover:text-[var(--brand-gold-300)]">
                  <input
                    type="radio"
                    name="departament"
                    checked={filters.departament === null}
                    onChange={() => onFilterChange.departament(null)}
                    className="h-4 w-4 cursor-pointer accent-[var(--brand-gold-400)]"
                  />
                  Todos
                </label>
                {departaments.map((departament) => (
                  <label
                    key={departament}
                    className="flex cursor-pointer items-center gap-2 rounded-lg border border-transparent px-2 py-1.5 text-sm text-[var(--brand-cream)]/80 transition hover:border-white/10 hover:bg-white/5 hover:text-[var(--brand-gold-300)]"
                  >
                    <input
                      type="radio"
                      name="departament"
                      checked={filters.departament === departament}
                      onChange={() => onFilterChange.departament(departament)}
                      className="h-4 w-4 cursor-pointer accent-[var(--brand-gold-400)]"
                    />
                    {departament}
                  </label>
                ))}
              </div>
            )}
          </div>

          <div className="border-b border-white/10 pb-4">
            <button
              onClick={() => toggleSection("category")}
              className="flex w-full items-center justify-between text-sm font-semibold uppercase tracking-[0.08em] text-[var(--brand-cream)] transition-colors hover:text-[var(--brand-gold-300)]"
            >
              Categoría
              <span className={`transition-transform ${expandedSections.category ? "rotate-180" : ""}`}>
                ▼
              </span>
            </button>
            {expandedSections.category && (
              <div className="mt-3 flex flex-col gap-2">
                <label className="flex cursor-pointer items-center gap-2 rounded-lg border border-transparent px-2 py-1.5 text-sm text-[var(--brand-cream)]/80 transition hover:border-white/10 hover:bg-white/5 hover:text-[var(--brand-gold-300)]">
                  <input
                    type="checkbox"
                    checked={filters.category === null}
                    onChange={() => onFilterChange.category(null)}
                    className="h-4 w-4 cursor-pointer accent-[var(--brand-gold-400)]"
                  />
                  Todas
                </label>
                {categories.map((cat) => (
                  <label
                    key={cat}
                    className="flex cursor-pointer items-center gap-2 rounded-lg border border-transparent px-2 py-1.5 text-sm text-[var(--brand-cream)]/80 transition hover:border-white/10 hover:bg-white/5 hover:text-[var(--brand-gold-300)]"
                  >
                    <input
                      type="checkbox"
                      checked={filters.category === cat}
                      onChange={() => onFilterChange.category(filters.category === cat ? null : cat)}
                      className="h-4 w-4 cursor-pointer accent-[var(--brand-gold-400)]"
                    />
                    {cat}
                  </label>
                ))}
                {categories.length === 0 && (
                  <p className="px-2 py-1 text-xs text-[var(--brand-cream)]/60">
                    {filters.departament
                      ? "No hay categorías disponibles para el departamento seleccionado."
                      : "No hay categorías disponibles por el momento."}
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
