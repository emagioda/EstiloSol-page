"use client";
import dynamic from "next/dynamic";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { hasSessionCatalogCache, useProductsStore } from "../view-models/useProductsStore";
import type { Product } from "@/src/features/shop/domain/entities/Product";
import ProductsGrid from "@/src/features/shop/presentation/components/ProductsGrid/ProductsGrid";
import FiltersSidebar from "@/src/features/shop/presentation/components/FiltersSidebar/FiltersSidebar";
import StoreToolbar from "@/src/features/shop/presentation/components/StoreToolbar/StoreToolbar";
import LoadingGrid from "@/src/features/shop/presentation/components/LoadingGrid/LoadingGrid";
import Breadcrumbs from "@/src/features/shop/presentation/components/Breadcrumbs";
import { showCartAddedToast } from "@/src/features/shop/presentation/lib/cartToast";
import { useCartBadgeVisibility } from "@/src/features/shop/presentation/view-models/useCartBadgeVisibility";
import { useCartDrawer } from "@/src/features/shop/presentation/view-models/useCartDrawer";

const QuickViewModal = dynamic(
  () => import("@/src/features/shop/presentation/components/QuickViewModal/QuickViewModal"),
  { ssr: false }
);

type TiendaClientViewProps = {
  initialProducts: Product[];
  staticDetailHandles?: string[];
};

const sortOptions = [
  { value: "newest" as const, label: "Más recientes" },
  { value: "price-asc" as const, label: "Menor precio" },
  { value: "price-desc" as const, label: "Mayor precio" },
  { value: "name-asc" as const, label: "A - Z" },
  { value: "name-desc" as const, label: "Z - A" },
];

const departamentOptions = [
  {
    value: "PELUQUERIA",
    label: "PELUQUERÍA",
  },
  {
    value: "BIJOUTERIE",
    label: "BIJOUTERIE",
  },
];

const normalizeDepartamentParam = (value: string | null): string | null => {
  if (!value) return null;
  const normalized = value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase();

  if (normalized === "PELUQUERIA" || normalized === "BIJOUTERIE") {
    return normalized;
  }

  return null;
};

export default function TiendaClientView({
  initialProducts,
  staticDetailHandles = [],
}: TiendaClientViewProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
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
  const [filtersShouldRender, setFiltersShouldRender] = useState(false);
  const [filtersClosing, setFiltersClosing] = useState(false);
  const [sortOpen, setSortOpen] = useState(false);
  const [sortShouldRender, setSortShouldRender] = useState(false);
  const [sortClosing, setSortClosing] = useState(false);
  const hasCheckedFirstVisitRef = useRef(false);
  const filtersCloseTimerRef = useRef<number | null>(null);
  const sortCloseTimerRef = useRef<number | null>(null);
  const filtersOpenRef = useRef(false);
  const filtersShouldRenderRef = useRef(false);
  const sortOpenRef = useRef(false);
  const introBlockRef = useRef<HTMLDivElement | null>(null);
  const hasInitializedFromQueryRef = useRef(false);
  const skipNextUrlSyncRef = useRef(false);
  const { setSuppressBadge, setSuppressFloatingCart } = useCartBadgeVisibility();
  const { setOpen } = useCartDrawer();

  const availableCategories = categories;
  const selectedWorld = filters.departament ?? "PELUQUERIA";
  const rubroFromQuery = normalizeDepartamentParam(searchParams.get("rubro"));
  const selectedWorldIndex = Math.max(
    departamentOptions.findIndex((option) => option.value === selectedWorld),
    0
  );

  const departamentFilteredProducts = products.filter(
    (p) =>
      typeof p.departament === "string" &&
      p.departament.toLowerCase() === selectedWorld.toLowerCase()
  );

  const activeFilterChips = [
    ...(filters.category
      ? [
          {
            key: "category",
            label: filters.category,
            onRemove: () => setCategory(null),
          },
        ]
      : []),
    ...(filters.searchTerm.trim()
      ? [
          {
            key: "search",
            label: filters.searchTerm.trim(),
            onRemove: () => setSearchTerm(""),
          },
        ]
      : []),
  ];

  useEffect(() => {
    if (hasCheckedFirstVisitRef.current) return;

    hasCheckedFirstVisitRef.current = true;

    if (!hasSessionCatalogCache()) {
      void loadProducts(true);
      return;
    }

    if (status === "idle") {
      void loadProducts();
    }
  }, [loadProducts, status]);

  useEffect(() => {
    setSuppressBadge(isQuickViewOpen);
    setSuppressFloatingCart(isQuickViewOpen);
    return () => {
      setSuppressBadge(false);
      setSuppressFloatingCart(false);
    };
  }, [isQuickViewOpen, setSuppressBadge, setSuppressFloatingCart]);
  useEffect(() => {
    filtersOpenRef.current = filtersOpen;
    filtersShouldRenderRef.current = filtersShouldRender;

    if (filtersOpen) {
      if (filtersCloseTimerRef.current !== null) {
        window.clearTimeout(filtersCloseTimerRef.current);
        filtersCloseTimerRef.current = null;
      }
      setFiltersShouldRender(true);
      setFiltersClosing(false);
      return;
    }

    if (!filtersShouldRender || filtersClosing) return;

    setFiltersClosing(true);
    filtersCloseTimerRef.current = window.setTimeout(() => {
      setFiltersClosing(false);
      setFiltersShouldRender(false);
      filtersCloseTimerRef.current = null;
    }, 300);
  }, [filtersOpen, filtersShouldRender, filtersClosing]);

  useEffect(() => {
    sortOpenRef.current = sortOpen;
  }, [sortOpen]);

  useEffect(() => {
    if (sortOpen) {
      if (sortCloseTimerRef.current !== null) {
        window.clearTimeout(sortCloseTimerRef.current);
        sortCloseTimerRef.current = null;
      }
      setSortShouldRender(true);
      setSortClosing(false);
      return;
    }

    if (!sortShouldRender || sortClosing) return;

    setSortClosing(true);
    sortCloseTimerRef.current = window.setTimeout(() => {
      setSortClosing(false);
      setSortShouldRender(false);
      sortCloseTimerRef.current = null;
    }, 300);
  }, [sortOpen, sortShouldRender, sortClosing]);

  useEffect(() => {
    return () => {
      if (filtersCloseTimerRef.current !== null) {
        window.clearTimeout(filtersCloseTimerRef.current);
      }
      if (sortCloseTimerRef.current !== null) {
        window.clearTimeout(sortCloseTimerRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (!isQuickViewOpen) return;

    window.history.pushState({ ...(window.history.state ?? {}), shopQuickViewOpen: true }, "", window.location.href);

    const handlePopState = () => {
      closeQuickView();
    };

    window.addEventListener("popstate", handlePopState);
    return () => {
      window.removeEventListener("popstate", handlePopState);
    };
  }, [isQuickViewOpen, closeQuickView]);

  useEffect(() => {
    if (!filtersOpen) return;

    window.history.pushState({ ...(window.history.state ?? {}), shopFiltersOpen: true }, "", window.location.href);

    const handlePopState = () => {
      setFiltersOpen(false);
    };

    window.addEventListener("popstate", handlePopState);
    return () => {
      window.removeEventListener("popstate", handlePopState);
    };
  }, [filtersOpen]);

  useEffect(() => {
    if (!sortOpen) return;

    window.history.pushState({ ...(window.history.state ?? {}), shopSortOpen: true }, "", window.location.href);

    const handlePopState = () => {
      setSortOpen(false);
    };

    window.addEventListener("popstate", handlePopState);
    return () => {
      window.removeEventListener("popstate", handlePopState);
    };
  }, [sortOpen]);

  useEffect(() => {
    const handleToggleFilters = () => {
      if (sortOpenRef.current) {
        setSortOpen(false);
      }

      const isDrawerVisible = filtersOpenRef.current || filtersShouldRenderRef.current;

      if (isDrawerVisible) {
        setFiltersOpen(false);
        return;
      }

      if (filtersCloseTimerRef.current !== null) {
        window.clearTimeout(filtersCloseTimerRef.current);
        filtersCloseTimerRef.current = null;
      }

      setFiltersClosing(false);
      setFiltersShouldRender(true);
      setFiltersOpen(true);
    };

    window.addEventListener("shop:toggle-filters", handleToggleFilters);
    return () => {
      window.removeEventListener("shop:toggle-filters", handleToggleFilters);
    };
  }, []);

  useEffect(() => {
    const readPxVar = (varName: string) => {
      const value = getComputedStyle(document.documentElement).getPropertyValue(varName);
      const parsed = Number.parseFloat(value.replace("px", "").trim());
      return Number.isFinite(parsed) ? parsed : 0;
    };

    const getHideThreshold = () => {
      const isDesktop = window.matchMedia("(min-width: 768px)").matches;

      if (isDesktop) {
        const desktopBase = readPxVar("--header-height-desktop-base");
        const desktopTicker = readPxVar("--shop-ticker-height-desktop");
        return desktopBase + desktopTicker;
      }

      const mobileBase = readPxVar("--header-height-mobile-base");
      const mobileTicker = readPxVar("--shop-ticker-height-mobile");
      const safeAreaTop = readPxVar("--safe-area-top");
      return mobileBase + mobileTicker + safeAreaTop;
    };

    const updateTickerVisibility = () => {
      const blockEl = introBlockRef.current;
      if (!blockEl) return;

      const rect = blockEl.getBoundingClientRect();
      const hideThreshold = getHideThreshold();
      const visible = rect.bottom > hideThreshold;

      window.dispatchEvent(
        new CustomEvent("shop:ticker-visibility", {
          detail: { visible },
        })
      );
    };

    updateTickerVisibility();
    window.addEventListener("scroll", updateTickerVisibility, { passive: true });
    window.addEventListener("resize", updateTickerVisibility);

    return () => {
      window.removeEventListener("scroll", updateTickerVisibility);
      window.removeEventListener("resize", updateTickerVisibility);
      window.dispatchEvent(
        new CustomEvent("shop:ticker-visibility", {
          detail: { visible: true },
        })
      );
    };
  }, []);

  useEffect(() => {
    if (hasInitializedFromQueryRef.current) return;

    hasInitializedFromQueryRef.current = true;

    if (!rubroFromQuery || rubroFromQuery === selectedWorld) return;

    skipNextUrlSyncRef.current = true;
    setCategory(null);
    setDepartament(rubroFromQuery);
  }, [rubroFromQuery, selectedWorld, setCategory, setDepartament]);

  useEffect(() => {
    if (skipNextUrlSyncRef.current) {
      skipNextUrlSyncRef.current = false;
      return;
    }

    if (!pathname) return;

    if (rubroFromQuery === selectedWorld) return;

    const params = new URLSearchParams(searchParams.toString());
    const desiredRubro = selectedWorld.toLowerCase();

    params.set("rubro", desiredRubro);
    const nextUrl = `${pathname}?${params.toString()}`;
    router.replace(nextUrl, { scroll: false });
  }, [pathname, router, rubroFromQuery, searchParams, selectedWorld]);

  const handleAddFeedback = ({ ok, name, image }: { ok: boolean; name: string; image?: string }) => {
    if (!ok) {
      toast.error(`No pudimos agregar ${name}. Intentá nuevamente.`);
      return;
    }

    showCartAddedToast({
      productName: name,
      image,
      onViewCart: () => setOpen(true),
    });
  };

  return (
    <main className="min-h-screen bg-[var(--brand-violet-950)]">
      <div className="mx-auto max-w-7xl px-4 pb-16 pt-4 text-[var(--brand-cream)] md:pt-6">
        <Breadcrumbs
          items={[
            { label: "INICIO", href: "/" },
            { label: "Tienda" },
          ]}
        />
        <section className="mt-6">
          <div ref={introBlockRef}>
          {/* Rubro toggle — full width, desktop only */}
          <div className="glass-panel mb-6 hidden md:block w-full rounded-2xl border border-white/10 p-2.5 md:p-3">
            <p className="mb-2 text-center text-xs uppercase tracking-[0.18em] text-[var(--brand-gold-300)] sm:text-sm">
              Tu estilo ideal empieza acá
            </p>
            <div className="relative grid w-full grid-cols-2 items-center rounded-full border border-white/15 bg-[var(--brand-violet-950)]/35 p-1.5">
              <span
                aria-hidden="true"
                className="pointer-events-none absolute left-1.5 top-1.5 h-[calc(100%-0.75rem)] w-[calc(50%-0.375rem)] rounded-full border border-[var(--brand-gold-400)] bg-white/12 shadow-[0_6px_14px_rgba(0,0,0,0.18)] transition-transform duration-300 ease-out"
                style={{ transform: `translateX(${selectedWorldIndex * 100}%)` }}
              />
              {departamentOptions.map((opt) => {
                const active = selectedWorld === opt.value;
                return (
                  <button
                    key={opt.value}
                    type="button"
                    onClick={() => { setCategory(null); setDepartament(opt.value); }}
                    className="relative z-10 rounded-full border border-transparent px-4 py-2 text-center transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand-gold-300)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--brand-violet-900)]"
                    aria-pressed={active}
                    aria-label={`Filtrar por ${opt.label}`}
                  >
                    <span className={`block text-[11px] font-semibold uppercase tracking-[0.16em] sm:text-sm ${active ? "text-[var(--brand-cream)]" : "text-[var(--brand-cream)]/80"}`}>
                      {opt.label}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Rubro toggle — mobile only */}
          <div className="glass-panel mb-4 w-full rounded-2xl border border-white/10 p-2.5 md:hidden">
            <p className="mb-2 text-center text-xs uppercase tracking-[0.18em] text-[var(--brand-gold-300)] sm:text-sm">
              Tu estilo ideal empieza acá
            </p>
            <div className="relative grid w-full grid-cols-2 items-center rounded-full border border-white/15 bg-[var(--brand-violet-950)]/35 p-1.5">
              <span
                aria-hidden="true"
                className="pointer-events-none absolute left-1.5 top-1.5 h-[calc(100%-0.75rem)] w-[calc(50%-0.375rem)] rounded-full border border-[var(--brand-gold-400)] bg-white/12 shadow-[0_6px_14px_rgba(0,0,0,0.18)] transition-transform duration-300 ease-out"
                style={{ transform: `translateX(${selectedWorldIndex * 100}%)` }}
              />
              {departamentOptions.map((opt) => {
                const active = selectedWorld === opt.value;
                return (
                  <button
                    key={opt.value}
                    type="button"
                    onClick={() => { setCategory(null); setDepartament(opt.value); }}
                    className="relative z-10 rounded-full border border-transparent px-4 py-2 text-center transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand-gold-300)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--brand-violet-900)]"
                    aria-pressed={active}
                    aria-label={`Filtrar por ${opt.label}`}
                  >
                    <span className={`block text-[11px] font-semibold uppercase tracking-[0.16em] sm:text-sm ${active ? "text-[var(--brand-cream)]" : "text-[var(--brand-cream)]/80"}`}>
                      {opt.label}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
          </div>

          <div className="grid grid-cols-1 gap-6 md:grid-cols-[280px_1fr] md:gap-8">
            <div className="hidden md:block">
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
                showSortSection={false}
                showDepartamentSection={false}
              />
            </div>

            <div className="flex-1">
              <div className="sticky top-[var(--header-height-mobile)] z-30 -mx-1 rounded-xl bg-[var(--brand-violet-950)] px-1 pt-1 md:hidden">
                <StoreToolbar
                  searchTerm={filters.searchTerm}
                  onSearchChange={setSearchTerm}
                  onFiltersClick={() => {
                    setSortOpen(false);
                    setFiltersOpen(true);
                  }}
                  onSortClick={() => {
                    setFiltersOpen(false);
                    setSortOpen(true);
                  }}
                />

                {activeFilterChips.length > 0 && (
                  <div className="mb-1.5 flex items-center gap-2 overflow-x-auto px-2 py-1 md:hidden">
                    {activeFilterChips.map((chip) => (
                      <button
                        key={chip.key}
                        type="button"
                        onClick={chip.onRemove}
                        className="inline-flex h-6 shrink-0 items-center gap-1 rounded-full border border-white/28 bg-white/14 px-2.5 text-[11px] font-medium leading-none text-[var(--brand-cream)] transition-colors hover:bg-white/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand-gold-300)]"
                        aria-label={`Quitar filtro ${chip.label}`}
                      >
                        <span className="leading-none">{chip.label}</span>
                        <span aria-hidden className="text-[var(--brand-gold-300)] leading-none">×</span>
                      </button>
                    ))}

                    <button
                      type="button"
                      onClick={clearFilters}
                      className="inline-flex h-6 shrink-0 items-center text-[11px] font-semibold leading-none text-[var(--brand-cream)] underline underline-offset-2 transition-colors hover:text-[var(--brand-gold-300)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand-gold-300)]"
                    >
                      Borrar filtros
                    </button>
                  </div>
                )}
              </div>

              {/* Search + Sort row — desktop only, aligned to product grid columns */}
              <div className="mb-4 hidden md:grid grid-cols-3 lg:grid-cols-4 gap-3 md:gap-4 lg:gap-5 items-center">
                <div className="col-span-2 lg:col-span-3 relative">
                  <label htmlFor="desktop-search" className="sr-only">Buscar productos</label>
                  <input
                    id="desktop-search"
                    type="text"
                    placeholder="¿Qué estás buscando?"
                    value={filters.searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    className="w-full rounded-xl border border-white/20 bg-white/10 px-3.5 py-2.5 text-sm text-[var(--brand-cream)] placeholder-[var(--brand-cream)]/55 backdrop-blur-sm transition duration-200 focus:border-[var(--brand-gold-300)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand-gold-300)]/55"
                  />
                  <span aria-hidden className="absolute right-3 top-1/2 -translate-y-1/2 text-[var(--brand-gold-300)]/90">🔍</span>
                </div>
                <div className="flex items-center justify-end gap-2">
                  <span className="text-xs text-[var(--brand-cream)]/70 shrink-0">Ordenar:</span>
                  <div className="relative flex-1">
                    <select
                      value={filters.sortBy}
                      onChange={(e) => setSortBy(e.target.value as typeof filters.sortBy)}
                      className="w-full cursor-pointer appearance-none rounded-lg border border-white/20 bg-white/8 py-1.5 pl-3 pr-7 text-sm text-[var(--brand-cream)] transition hover:border-white/35 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand-gold-300)]"
                    >
                      {sortOptions.map((opt) => (
                        <option key={opt.value} value={opt.value} className="bg-[#1a0a2e]">
                          {opt.label}
                        </option>
                      ))}
                    </select>
                    <span aria-hidden className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-[9px] text-[var(--brand-cream)]/60">▼</span>
                  </div>
                </div>
              </div>

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
                      void loadProducts(true);
                    }}
                    className="mt-5 inline-flex items-center justify-center rounded-full border border-[var(--brand-gold-300)] px-5 py-2 text-sm font-semibold text-[var(--brand-cream)] transition duration-200 hover:bg-[rgba(255,255,255,0.08)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand-gold-300)]"
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
          </div>
        </section>

        {filtersShouldRender && (
          <div className="fixed inset-0 z-[250] md:hidden">
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
              isOpen={!filtersClosing}
              onClose={() => setFiltersOpen(false)}
              showSortSection={false}
            />
          </div>
        )}

        {sortShouldRender && (
          <div className="fixed inset-0 z-[60] md:hidden">
            <div
              className={`absolute inset-0 bg-black/50 ${sortOpen ? "animate-fadeInBackdrop" : "animate-fadeOutBackdrop"}`}
              onClick={() => setSortOpen(false)}
            />
            <div
              role="dialog"
              aria-modal="true"
              aria-label="Ordenar productos"
              className={`absolute inset-x-0 bottom-0 rounded-t-2xl border border-white/10 bg-[var(--brand-violet-950)] px-4 pb-[calc(1rem+var(--safe-area-bottom))] pt-3 shadow-[0_-16px_36px_rgba(18,8,35,0.4)] ${sortOpen ? "animate-slideInSheetUp" : "animate-slideOutSheetDown"}`}
            >
              <div className="mb-2 flex items-center justify-between">
                <h3 className="text-sm font-semibold uppercase tracking-[0.14em] text-[var(--brand-cream)]">
                  Ordenar por
                </h3>
                <button
                  type="button"
                  onClick={() => setSortOpen(false)}
                  className="rounded-full border border-[var(--brand-gold-400)]/30 p-1.5 text-[var(--brand-cream)] transition hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand-gold-300)]"
                  aria-label="Cerrar orden"
                >
                  ✕
                </button>
              </div>
              <div className="mt-2 flex flex-col gap-1.5" role="radiogroup" aria-label="Ordenar productos">
                {sortOptions.map((option) => {
                  const active = filters.sortBy === option.value;
                  return (
                    <label
                      key={option.value}
                      className={`flex cursor-pointer items-center gap-2 rounded-md border border-transparent px-2 py-1.5 text-sm transition-colors hover:border-[var(--brand-gold-300)]/20 hover:bg-white/5 hover:text-[var(--brand-gold-300)] ${
                        active
                          ? "font-medium text-[var(--brand-gold-300)]"
                          : "text-[var(--brand-cream)]/82"
                      }`}
                    >
                      <input
                        type="radio"
                        name="sort-mobile"
                        value={option.value}
                        checked={active}
                        onChange={() => {
                          setSortBy(option.value);
                          setSortOpen(false);
                        }}
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
                      {option.label}
                    </label>
                  );
                })}
              </div>
            </div>
          </div>
        )}

        <QuickViewModal
          key={selectedProduct?.id ?? "quick-view-empty"}
          open={isQuickViewOpen}
          product={selectedProduct}
          onClose={closeQuickView}
          onAddFeedback={handleAddFeedback}
        />
      </div>
    </main>
  );
}
