"use client";
import { useMemo, useState } from "react";
import { useBodyScrollLock } from "@/src/core/presentation/hooks/useBodyScrollLock";
import type { FilterState } from "../../view-models/useProductsStore";

interface FiltersSidebarProps {
  categories: string[];
  availableSpecifications: Record<string, string[]>;
  filters: FilterState;
  onFilterChange: {
    departament: (dep: string | null) => void;
    category: (cat: string | null) => void;
    search: (term: string) => void;
    sort: (sort: FilterState["sortBy"]) => void;
    togglePromo: () => void;
    toggleKit: () => void;
    toggleSpec: (specKey: string, specValue: string) => void;
  };
  onClearFilters: () => void;
  isOpen?: boolean;
  onClose?: () => void;
  showSortSection?: boolean;
  showDepartamentSection?: boolean;
}

const sortLabels: Record<FilterState["sortBy"], string> = {
  newest: "Mas recientes",
  "price-asc": "Menor precio",
  "price-desc": "Mayor precio",
  "name-asc": "A - Z",
  "name-desc": "Z - A",
};

const optionClass = (active: boolean) =>
  `flex cursor-pointer items-center gap-2 rounded-xl border border-transparent px-2.5 py-2 text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#d4ac62] ${
    active
      ? "bg-[#fff4dc] font-semibold text-[#3a1f5f]"
      : "text-[#674a7f] hover:border-[#eadcf4] hover:bg-white/70 hover:text-[#3a1f5f]"
  }`;

const checkboxIndicatorClass = (active: boolean) =>
  `flex h-4 w-4 shrink-0 items-center justify-center rounded border-2 transition-colors ${
    active ? "border-[#d6a64b] bg-[#d6a64b]" : "border-[#b99dcc]"
  }`;

const sectionButtonClass =
  "flex w-full items-center justify-between text-[12px] font-semibold text-[#3a1f5f] transition-colors hover:text-[#7a4d91] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#d4ac62]";

export default function FiltersSidebar({
  categories,
  availableSpecifications,
  filters,
  onFilterChange,
  onClearFilters,
  isOpen = true,
  onClose,
  showSortSection = true,
  showDepartamentSection = true,
}: FiltersSidebarProps) {
  const [expandedSections, setExpandedSections] = useState<Record<string, boolean>>({
    departament: false,
    sort: false,
  });

  const specSections = useMemo(
    () => Object.entries(availableSpecifications),
    [availableSpecifications]
  );

  const activeSpecChips = Object.entries(filters.selectedSpecs).map(([specKey, value]) => ({
    key: `spec-${specKey}-${value}`,
    label: `${specKey}: ${value}`,
    onRemove: () => onFilterChange.toggleSpec(specKey, value),
  }));

  const activeChips = [
    ...(filters.showOnlyPromos
      ? [{ key: "promo", label: "Solo ofertas", onRemove: onFilterChange.togglePromo }]
      : []),
    ...(filters.showOnlyKits
      ? [{ key: "kit", label: "Combos", onRemove: onFilterChange.toggleKit }]
      : []),
    ...(filters.searchTerm.trim()
      ? [{ key: "search", label: filters.searchTerm.trim(), onRemove: () => onFilterChange.search("") }]
      : []),
    ...(showSortSection && filters.sortBy !== "newest"
      ? [{ key: "sort", label: sortLabels[filters.sortBy], onRemove: () => onFilterChange.sort("newest") }]
      : []),
    ...activeSpecChips,
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
  const backdropAnimationClass = isOpen ? "animate-fadeInBackdrop" : "animate-fadeOutBackdrop";

  useBodyScrollLock(isMobileDrawer);

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
        className={`elegant-scrollbar fixed left-0 top-0 z-[240] h-full w-72 overflow-y-auto border-r border-[#eadcf4] bg-[#f8effc] text-[#3a1f5f] shadow-[8px_0_34px_rgba(54,25,80,0.18)] md:relative md:top-auto md:z-auto md:h-auto md:w-full md:rounded-2xl md:border md:border-[#eadcf4] md:bg-[#f8effc]/82 md:px-5 md:py-4 md:shadow-[0_16px_34px_rgba(54,25,80,0.16)] ${drawerAnimationClass}`}
      >
        <div className="flex flex-col gap-5 p-5 pt-5 md:p-0">
          {onClose && (
            <div className="-mx-5 -mt-5 mb-1 border-b border-black/10 bg-white px-3 py-2 md:hidden">
              <div className="flex items-center justify-between">
                <p className="text-xs font-medium text-[var(--brand-violet-950)]">Filtrar por</p>
                <button
                  type="button"
                  onClick={onClose}
                  className="inline-flex h-8 w-8 items-center justify-center text-[var(--brand-violet-950)] transition hover:opacity-70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand-violet-600)]"
                  aria-label="Cerrar filtros"
                >
                  <span className="text-lg leading-none">x</span>
                </button>
              </div>
            </div>
          )}

          {activeChips.length > 0 && (
            <div className="border-b border-[#eadcf4] pb-3.5">
              <div className="mb-2 flex items-center justify-between">
                <span className="text-[11px] font-semibold text-[#5d3b76]">
                  Filtros aplicados
                </span>
                <button
                  type="button"
                  onClick={onClearFilters}
                  className="text-[11px] font-semibold text-[#7a4d91] underline underline-offset-2 transition-colors hover:text-[#3a1f5f] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#d4ac62]"
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
                    className="inline-flex min-h-7 items-center gap-1 rounded-full border border-[#eadcf4] bg-white/70 px-2.5 py-1 text-[11px] font-medium text-[#3a1f5f] transition-colors hover:bg-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#d4ac62]"
                    aria-label={`Quitar filtro ${chip.label}`}
                  >
                    <span className="leading-none">{chip.label}</span>
                    <span aria-hidden className="leading-none text-[#c08a2e]">
                      x
                    </span>
                  </button>
                ))}
              </div>
            </div>
          )}

          {showDepartamentSection && (
            <div className="border-b border-[#eadcf4] pb-3.5">
              <button
                type="button"
                onClick={() => toggleSection("departament")}
                className={sectionButtonClass}
              >
                Rubro
                <span className={`text-[10px] transition-transform ${expandedSections.departament ? "rotate-180" : ""}`}>
                  v
                </span>
              </button>
              {expandedSections.departament && (
                <div className="mt-2.5 flex flex-col gap-1.5" role="radiogroup" aria-label="Filtrar por rubro">
                  {[
                    { value: "PELUQUERIA", label: "Peluqueria" },
                    { value: "BIJOUTERIE", label: "Bijouterie" },
                  ].map((option) => {
                    const active = filters.departament === option.value;
                    return (
                      <label key={option.value} className={optionClass(active)}>
                        <input
                          type="radio"
                          name="departament"
                          value={option.value}
                          checked={active}
                          onChange={() => onFilterChange.departament(option.value)}
                          className="sr-only"
                        />
                        <span
                          aria-hidden="true"
                          className={`flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-full border-2 transition-colors ${
                            active ? "border-[#d6a64b]" : "border-[#b99dcc]"
                          }`}
                        >
                          {active && <span className="h-1.5 w-1.5 rounded-full bg-[#d6a64b]" />}
                        </span>
                        <span className="flex-1">{option.label}</span>
                      </label>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {showSortSection && (
            <div className="border-b border-[#eadcf4] pb-3.5">
              <button
                type="button"
                onClick={() => toggleSection("sort")}
                className={sectionButtonClass}
              >
                Ordenar
                <span className={`text-[10px] transition-transform ${expandedSections.sort ? "rotate-180" : ""}`}>
                  v
                </span>
              </button>
              {expandedSections.sort && (
                <div className="mt-2.5 flex flex-col gap-1.5" role="radiogroup" aria-label="Ordenar productos">
                  {[
                    { value: "newest" as const, label: "Mas recientes" },
                    { value: "price-asc" as const, label: "Menor precio" },
                    { value: "price-desc" as const, label: "Mayor precio" },
                    { value: "name-asc" as const, label: "A - Z" },
                    { value: "name-desc" as const, label: "Z - A" },
                  ].map((option) => {
                    const active = filters.sortBy === option.value;
                    return (
                      <label key={option.value} className={optionClass(active)}>
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
                            active ? "border-[#d6a64b]" : "border-[#b99dcc]"
                          }`}
                        >
                          {active && <span className="h-1.5 w-1.5 rounded-full bg-[#d6a64b]" />}
                        </span>
                        <span className="flex-1">{option.label}</span>
                      </label>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          <div className="border-b border-[#eadcf4] pb-3.5">
            <div className={sectionButtonClass}>
              Categoría
            </div>
            <div className="mt-2.5 flex flex-col gap-1.5" role="radiogroup" aria-label="Filtrar por categoria">
              <label className={optionClass(filters.category === null)}>
                <input
                  type="radio"
                  name="category"
                  value=""
                  checked={filters.category === null}
                  onChange={() => onFilterChange.category(null)}
                  className="sr-only"
                />
                <span
                  aria-hidden="true"
                  className={`flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-full border-2 transition-colors ${
                    filters.category === null ? "border-[#d6a64b]" : "border-[#b99dcc]"
                  }`}
                >
                  {filters.category === null && (
                    <span className="h-1.5 w-1.5 rounded-full bg-[#d6a64b]" />
                  )}
                </span>
                <span className="flex-1">Todas</span>
              </label>
              {categories.map((category) => {
                const active = filters.category === category;
                return (
                  <label key={category} className={optionClass(active)}>
                    <input
                      type="radio"
                      name="category"
                      value={category}
                      checked={active}
                      onChange={() => onFilterChange.category(active ? null : category)}
                      className="sr-only"
                    />
                    <span
                      aria-hidden="true"
                      className={`flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-full border-2 transition-colors ${
                        active ? "border-[#d6a64b]" : "border-[#b99dcc]"
                      }`}
                    >
                      {active && <span className="h-1.5 w-1.5 rounded-full bg-[#d6a64b]" />}
                    </span>
                    <span className="flex-1">{category}</span>
                  </label>
                );
              })}
              {categories.length === 0 && (
                <p className="px-2 py-1 text-xs text-[#7a5b92]">
                  No hay categorias disponibles para este rubro.
                </p>
              )}
            </div>
          </div>

          <div className="pt-1">
            <p className="px-1 text-[11px] font-semibold text-[#5d3b76]">
              Características
            </p>
          </div>

          {specSections.map(([specKey, values]) => {
            const sectionId = `spec-${specKey}`;
            const isExpanded = expandedSections[sectionId] ?? false;

            return (
              <div
                key={specKey}
                className="border-b border-[#eadcf4] pb-3.5"
              >
                <button
                  type="button"
                  onClick={() => toggleSection(sectionId)}
                  className={sectionButtonClass}
                >
                  {specKey}
                  <span className={`text-[10px] transition-transform ${isExpanded ? "rotate-180" : ""}`}>v</span>
                </button>
                {isExpanded && (
                  <div className="mt-2.5 flex flex-col gap-1.5">
                    {values.map((value) => {
                      const active = filters.selectedSpecs[specKey] === value;
                      return (
                        <label key={`${specKey}-${value}`} className={optionClass(active)}>
                          <input
                            type="checkbox"
                            checked={active}
                            onChange={() => onFilterChange.toggleSpec(specKey, value)}
                            className="sr-only"
                          />
                          <span aria-hidden className={checkboxIndicatorClass(active)}>
                            {active && <span className="h-1.5 w-1.5 rounded-[1px] bg-white" />}
                          </span>
                          <span className="flex-1">{value}</span>
                        </label>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </aside>
    </>
  );
}
