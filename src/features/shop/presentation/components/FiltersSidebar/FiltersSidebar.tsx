"use client";
import { useState } from "react";
import type { FilterState } from "../../view-models/useProductsStore";

type ShopWorld = "peluqueria" | "bijouterie";

interface FiltersSidebarProps {
  categories: string[];
  filters: FilterState;
  onFilterChange: {
    category: (cat: string | null) => void;
    search: (term: string) => void;
    sort: (sort: FilterState["sortBy"]) => void;
  };
  onClearFilters: () => void;
  selectedWorld: ShopWorld;
  onWorldChange: (world: ShopWorld) => void;
  isOpen?: boolean;
  onClose?: () => void;
}

export default function FiltersSidebar({
  categories,
  filters,
  onFilterChange,
  onClearFilters,
  selectedWorld,
  onWorldChange,
  isOpen = true,
  onClose,
}: FiltersSidebarProps) {
  const [expandedSections, setExpandedSections] = useState<Record<string, boolean>>({
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

          <div className="rounded-2xl border border-[var(--brand-gold-400)]/25 bg-black/10 p-2">
            <p className="mb-2 text-xs uppercase tracking-[0.2em] text-[var(--brand-gold-300)]">
              Explorá por rubro
            </p>
            <div className="grid grid-cols-2 gap-2">
              {([
                { key: "peluqueria", label: "Peluquería" },
                { key: "bijouterie", label: "Bijouterie" },
              ] as const).map((world) => {
                const active = selectedWorld === world.key;
                return (
                  <button
                    key={world.key}
                    type="button"
                    onClick={() => onWorldChange(world.key)}
                    className={`rounded-xl border px-3 py-2 text-xs font-semibold uppercase tracking-[0.12em] transition ${
                      active
                        ? "border-[var(--brand-gold-400)] bg-[var(--brand-violet-800)] text-[var(--brand-cream)] shadow-[0_8px_20px_rgba(0,0,0,0.25)]"
                        : "border-white/15 bg-white/5 text-[var(--brand-cream)]/75 hover:border-[var(--brand-gold-300)] hover:text-[var(--brand-gold-300)]"
                    }`}
                    aria-pressed={active}
                  >
                    {world.label}
                  </button>
                );
              })}
            </div>
          </div>

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
