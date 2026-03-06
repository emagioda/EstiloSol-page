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
  showSortSection?: boolean;
  showDepartamentSection?: boolean;
}

const sortLabels: Record<FilterState["sortBy"], string> = {
  newest: "Más recientes",
  "price-asc": "Menor precio",
  "price-desc": "Mayor precio",
  "name-asc": "A - Z",
  "name-desc": "Z - A",
};

const optionClass = (active: boolean) =>
  `flex cursor-pointer items-center gap-2 rounded-md border border-transparent px-2 py-1.5 text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand-gold-300)] ${
    active
      ? "font-medium text-[var(--brand-gold-300)]"
      : "text-[var(--brand-cream)]/78 hover:border-[var(--brand-gold-300)]/20 hover:bg-white/5 hover:text-[var(--brand-gold-300)]"
  }`;

export default function FiltersSidebar({
  categories,
  filters,
  onFilterChange,
  onClearFilters,
  isOpen = true,
  onClose,
  showSortSection = true,
  showDepartamentSection = true,
}: FiltersSidebarProps) {
  const [expandedSections, setExpandedSections] = useState<Record<string, boolean>>({
    departament: true,
    category: true,
    sort: true,
  });

  const activeChips = [
    ...(filters.category
      ? [{ key: "category", label: filters.category, onRemove: () => onFilterChange.category(null) }]
      : []),
    ...(filters.searchTerm.trim()
      ? [{ key: "search", label: filters.searchTerm.trim(), onRemove: () => onFilterChange.search("") }]
      : []),
    ...(showSortSection && filters.sortBy !== "newest"
      ? [{ key: "sort", label: sortLabels[filters.sortBy], onRemove: () => onFilterChange.sort("newest") }]
      : []),
  ];

  const toggleSection = (section: string) => {
    setExpandedSections((prev) => ({
      ...prev,
      [section]: !prev[section],
    }));
  };

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
          className={`fixed inset-0 z-[230] bg-black/50 md:hidden ${backdropAnimationClass}`}
          onClick={() => onClose?.()}
        />
      )}

      <aside
        role="complementary"
        aria-label="Filtros de productos"
        className={`elegant-scrollbar fixed left-0 top-0 z-[240] h-full w-72 overflow-y-auto border-r border-[var(--brand-gold-300)]/20 bg-[var(--brand-violet-950)]/94 backdrop-blur-sm md:relative md:top-auto md:z-auto md:h-auto md:w-full md:rounded-2xl md:border md:border-[var(--brand-gold-300)]/24 md:bg-white/[0.09] md:px-5 md:py-4 md:shadow-[0_16px_36px_rgba(18,8,35,0.28)] ${drawerAnimationClass}`}
      >
        <div className="flex flex-col gap-5 p-5 pt-5 md:p-0">
          {onClose && (
            <div className="-mx-5 -mt-5 mb-1 border-b border-black/10 bg-white px-3 py-2 md:hidden">
              <div className="flex items-center justify-between">
                <p className="text-xs font-medium text-[var(--brand-violet-950)]">Filtrar por</p>
                <button
                  type="button"
                  onClick={onClose}
                  className="inline-flex h-6 w-6 items-center justify-center text-[var(--brand-violet-950)] transition hover:opacity-70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand-violet-600)]"
                  aria-label="Cerrar filtros"
                >
                  <span className="text-lg leading-none">✕</span>
                </button>
              </div>
            </div>
          )}

          {/* Applied filter chips */}
          {activeChips.length > 0 && (
            <div className="border-b border-[var(--brand-gold-300)]/12 pb-3.5">
              <div className="mb-2 flex items-center justify-between">
                <span className="text-[11px] font-medium uppercase tracking-[0.14em] text-[var(--brand-cream)]/85">
                  Filtros aplicados
                </span>
                <button
                  type="button"
                  onClick={onClearFilters}
                  className="text-[11px] font-semibold text-[var(--brand-cream)] underline underline-offset-2 transition-colors hover:text-[var(--brand-gold-300)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand-gold-300)]"
                >
                  Borrar todo
                </button>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {activeChips.map((chip) => (
                  <button
                    key={chip.key}
                    type="button"
                    onClick={chip.onRemove}
                    className="inline-flex items-center gap-1 rounded-full border border-white/28 bg-white/14 px-2.5 py-1 text-[11px] font-medium text-[var(--brand-cream)] transition-colors hover:bg-white/22 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand-gold-300)]"
                    aria-label={`Quitar filtro ${chip.label}`}
                  >
                    <span className="leading-none">{chip.label}</span>
                    <span aria-hidden className="text-[var(--brand-gold-300)] leading-none">×</span>
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Departament section */}
          {showDepartamentSection && (
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
                ].map((opt) => {
                  const active = filters.departament === opt.value;
                  return (
                    <label
                      key={opt.value}
                      className={optionClass(active)}
                    >
                      <input
                        type="radio"
                        name="departament"
                        value={opt.value}
                        checked={active}
                        onChange={() => onFilterChange.departament(opt.value)}
                        className="sr-only"
                      />
                      <span
                        aria-hidden="true"
                        className={`flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-full border-2 transition-colors ${
                          active
                            ? "border-[var(--brand-gold-400)]"
                            : "border-[var(--brand-cream)]/40"
                        }`}
                      >
                        {active && <span className="h-1.5 w-1.5 rounded-full bg-[var(--brand-gold-400)]" />}
                      </span>
                      <span className="flex-1">{opt.label}</span>
                    </label>
                  );
                })}
              </div>
            )}
          </div>
          )}

          {/* Sort section */}
          {showSortSection && (
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
                ].map((option) => {
                  const active = filters.sortBy === option.value;
                  return (
                    <label
                      key={option.value}
                      className={optionClass(active)}
                    >
                      <input
                        type="radio"
                        name="sort"
                        value={option.value}
                        checked={active}
                        onChange={() => onFilterChange.sort(option.value)}
                        className="sr-only"
                      />
                      <span
                        aria-hidden="true"
                        className={`flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-full border-2 transition-colors ${
                          active
                            ? "border-[var(--brand-gold-400)]"
                            : "border-[var(--brand-cream)]/40"
                        }`}
                      >
                        {active && <span className="h-1.5 w-1.5 rounded-full bg-[var(--brand-gold-400)]" />}
                      </span>
                      <span className="flex-1">{option.label}</span>
                    </label>
                  );
                })}
              </div>
            )}
          </div>
          )}

          {/* Category section */}
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
                {(() => {
                  const allActive = filters.category === null;
                  return (
                    <label className={optionClass(allActive)}>
                      <input
                        type="radio"
                        name="category"
                        value=""
                        checked={allActive}
                        onChange={() => onFilterChange.category(null)}
                        className="sr-only"
                      />
                      <span
                        aria-hidden="true"
                        className={`flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-full border-2 transition-colors ${
                          allActive
                            ? "border-[var(--brand-gold-400)]"
                            : "border-[var(--brand-cream)]/40"
                        }`}
                      >
                        {allActive && <span className="h-1.5 w-1.5 rounded-full bg-[var(--brand-gold-400)]" />}
                      </span>
                      <span className="flex-1">Todas</span>
                    </label>
                  );
                })()}
                {categories.map((cat) => {
                  const active = filters.category === cat;
                  return (
                    <label
                      key={cat}
                      className={optionClass(active)}
                    >
                      <input
                        type="radio"
                        name="category"
                        value={cat}
                        checked={active}
                        onChange={() => onFilterChange.category(active ? null : cat)}
                        className="sr-only"
                      />
                      <span
                        aria-hidden="true"
                        className={`flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-full border-2 transition-colors ${
                          active
                            ? "border-[var(--brand-gold-400)]"
                            : "border-[var(--brand-cream)]/40"
                        }`}
                      >
                        {active && <span className="h-1.5 w-1.5 rounded-full bg-[var(--brand-gold-400)]" />}
                      </span>
                      <span className="flex-1">{cat}</span>
                    </label>
                  );
                })}
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
