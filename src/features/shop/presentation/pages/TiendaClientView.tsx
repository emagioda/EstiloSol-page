"use client";
import dynamic from "next/dynamic";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import {
  clearProductsCatalogSessionCache,
  hasSessionCatalogCache,
  useProductsStore,
  type CatalogFacets,
  type FilterState,
} from "../view-models/useProductsStore";
import type { Departament, Product } from "@/src/features/shop/domain/entities/Product";
import ProductsGrid from "@/src/features/shop/presentation/components/ProductsGrid/ProductsGrid";
import FiltersSidebar from "@/src/features/shop/presentation/components/FiltersSidebar/FiltersSidebar";
import StoreToolbar from "@/src/features/shop/presentation/components/StoreToolbar/StoreToolbar";
import LoadingGrid from "@/src/features/shop/presentation/components/LoadingGrid/LoadingGrid";
import Breadcrumbs from "@/src/features/shop/presentation/components/Breadcrumbs";
import BackToTopButton from "@/src/features/shop/presentation/components/BackToTopButton/BackToTopButton";
import { showCartAddedToast } from "@/src/features/shop/presentation/lib/cartToast";
import {
  clearShopScrollRestoreRequest,
  getShopScrollCacheRestoreKey,
  isMatchingShopListingCache,
  isShopScrollRestoreRequested,
  readShopScrollCache,
  restoreWindowScroll,
  writeShopScrollCache,
} from "@/src/features/shop/presentation/lib/shopScrollRestoration";
import { useCartBadgeVisibility } from "@/src/features/shop/presentation/view-models/useCartBadgeVisibility";
import { useCartDrawer } from "@/src/features/shop/presentation/view-models/useCartDrawer";
import { useBodyScrollLock } from "@/src/core/presentation/hooks/useBodyScrollLock";

const QuickViewModal = dynamic(
  () => import("@/src/features/shop/presentation/components/QuickViewModal/QuickViewModal"),
  { ssr: false }
);

type TiendaClientViewProps = {
  initialProducts: Product[];
  initialCatalogComplete?: boolean;
  initialDepartament?: Departament;
  initialFacets?: CatalogFacets;
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
  initialCatalogComplete = false,
  initialDepartament = "PELUQUERIA",
  initialFacets,
}: TiendaClientViewProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const rubroFromQuery = normalizeDepartamentParam(searchParams.get("rubro"));
  const effectiveInitialDepartament = (rubroFromQuery ?? initialDepartament) as Departament;
  const {
    products,
    loading,
    status,
    errorMessage,
    loadProducts,
    catalogComplete,
    catalogRefreshing,
    filters,
    setSearchTerm,
    setDepartament,
    setCategory,
    setSortBy,
    togglePromoFilter,
    toggleKitFilter,
    toggleSpecFilter,
    clearFilters,
    categories,
    availableSpecifications,
    selectedProduct,
    isQuickViewOpen,
    openQuickView,
    closeQuickView,
  } = useProductsStore({
    initialProducts,
    initialCatalogComplete,
    initialDepartament: effectiveInitialDepartament,
    initialFacets,
    persistFilters: true,
    initialDepartamentOverridesPersistedFilters: Boolean(rubroFromQuery),
  });

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
  const quickViewScrollYRef = useRef(0);
  const skipNextUrlSyncRef = useRef(false);
  const restoredScrollCacheKeyRef = useRef<string | null>(null);
  const cancelActiveScrollRestoreRef = useRef<(() => void) | null>(null);
  const handledShopVisitKeyRef = useRef<string | null>(null);
  const clearRestoreRequestTimerRef = useRef<number | null>(null);
  const previousRubroFromQueryRef = useRef<string | null | undefined>(undefined);
  const { setSuppressBadge, setSuppressFloatingCart } = useCartBadgeVisibility();
  const { setOpen } = useCartDrawer();
  useBodyScrollLock(sortShouldRender);

  const availableCategories = categories;
  const selectedWorld = filters.departament ?? "PELUQUERIA";
  const shouldRefreshCatalog = searchParams.get("refresh") === "1";
  const hasInitialCatalog = initialProducts.length > 0;
  const shopLocationKey = useMemo(() => {
    const query = searchParams.toString();
    return query ? `${pathname}?${query}` : pathname ?? "/tienda";
  }, [pathname, searchParams]);
  const selectedWorldIndex = Math.max(
    departamentOptions.findIndex((option) => option.value === selectedWorld),
    0
  );
  const ensureFullCatalog = useCallback(() => {
    if (catalogComplete || catalogRefreshing) return;
    void loadProducts(false, { silent: true });
  }, [catalogComplete, catalogRefreshing, loadProducts]);

  const syncDepartamentToUrl = useCallback(
    (departament: string, mode: "push" | "replace" = "replace") => {
      if (!pathname) return;

      const normalizedDepartament = normalizeDepartamentParam(departament);
      if (!normalizedDepartament) return;

      const params = new URLSearchParams(searchParams.toString());
      const desiredRubro = normalizedDepartament.toLowerCase();

      if (params.get("rubro") === desiredRubro) return;

      params.set("rubro", desiredRubro);
      const nextUrl = `${pathname}?${params.toString()}`;

      if (mode === "push") {
        router.push(nextUrl, { scroll: false });
        return;
      }

      router.replace(nextUrl, { scroll: false });
    },
    [pathname, router, searchParams]
  );

  const handleSearchChange = useCallback(
    (term: string) => {
      ensureFullCatalog();
      setSearchTerm(term);
    },
    [ensureFullCatalog, setSearchTerm]
  );
  const handleDepartamentChange = useCallback(
    (departament: string | null) => {
      ensureFullCatalog();
      const normalizedDepartament = normalizeDepartamentParam(departament);
      if (normalizedDepartament) {
        skipNextUrlSyncRef.current = true;
        syncDepartamentToUrl(normalizedDepartament, "push");
      }
      setDepartament(departament);
    },
    [ensureFullCatalog, setDepartament, syncDepartamentToUrl]
  );
  const handleCategoryChange = useCallback(
    (category: string | null) => {
      ensureFullCatalog();
      setCategory(category);
    },
    [ensureFullCatalog, setCategory]
  );
  const handleSortChange = useCallback(
    (sortBy: FilterState["sortBy"]) => {
      ensureFullCatalog();
      setSortBy(sortBy);
    },
    [ensureFullCatalog, setSortBy]
  );
  const handleTogglePromoFilter = useCallback(() => {
    ensureFullCatalog();
    togglePromoFilter();
  }, [ensureFullCatalog, togglePromoFilter]);
  const handleToggleKitFilter = useCallback(() => {
    ensureFullCatalog();
    toggleKitFilter();
  }, [ensureFullCatalog, toggleKitFilter]);
  const handleToggleSpecFilter = useCallback(
    (specKey: string, specValue: string) => {
      ensureFullCatalog();
      toggleSpecFilter(specKey, specValue);
    },
    [ensureFullCatalog, toggleSpecFilter]
  );

  const departamentFilteredProducts = products.filter(
    (p) =>
      typeof p.departament === "string" &&
      p.departament.toLowerCase() === selectedWorld.toLowerCase()
  );

  const activeFilterChips = [
    ...(filters.showOnlyPromos
      ? [
          {
            key: "promo",
            label: "Solo ofertas",
            onRemove: handleTogglePromoFilter,
          },
        ]
      : []),
    ...(filters.showOnlyKits
      ? [
          {
            key: "kits",
            label: "Combos",
            onRemove: handleToggleKitFilter,
          },
        ]
      : []),
    ...(filters.category
      ? [
          {
            key: "category",
            label: filters.category,
            onRemove: () => handleCategoryChange(null),
          },
        ]
      : []),
    ...(filters.searchTerm.trim()
      ? [
          {
            key: "search",
            label: filters.searchTerm.trim(),
            onRemove: () => handleSearchChange(""),
          },
        ]
      : []),
    ...Object.entries(filters.selectedSpecs).map(([specKey, value]) => ({
      key: `spec-${specKey}-${value}`,
      label: `${specKey}: ${value}`,
      onRemove: () => handleToggleSpecFilter(specKey, value),
    })),
  ];

  useEffect(() => {
    const paymentRef =
      searchParams.get("ref") || searchParams.get("external_reference");

    if (!paymentRef) return;

    const paymentStatus = (
      searchParams.get("status") ||
      searchParams.get("collection_status") ||
      ""
    ).toLowerCase();

    if (paymentStatus && paymentStatus !== "approved") return;

    router.replace(`/tienda/success?ref=${encodeURIComponent(paymentRef)}`);
  }, [router, searchParams]);

  useEffect(() => {
    if (shouldRefreshCatalog) {
      hasCheckedFirstVisitRef.current = true;
      clearProductsCatalogSessionCache();
      void loadProducts(true).finally(() => {
        const params = new URLSearchParams(searchParams.toString());
        params.delete("refresh");
        const query = params.toString();
        router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
      });
      return;
    }

    if (hasCheckedFirstVisitRef.current) return;

    hasCheckedFirstVisitRef.current = true;

    if (!hasSessionCatalogCache()) {
      if (hasInitialCatalog) return;
      void loadProducts();
      return;
    }

    if (status === "idle") {
      void loadProducts();
    }
  }, [hasInitialCatalog, loadProducts, pathname, router, searchParams, shouldRefreshCatalog, status]);

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
      const openSyncTimer = window.setTimeout(() => {
        setFiltersShouldRender(true);
        setFiltersClosing(false);
      }, 0);
      return () => window.clearTimeout(openSyncTimer);
    }

    if (!filtersShouldRender || filtersClosing) return;

    const startCloseTimer = window.setTimeout(() => {
      setFiltersClosing(true);
      filtersCloseTimerRef.current = window.setTimeout(() => {
        setFiltersClosing(false);
        setFiltersShouldRender(false);
        filtersCloseTimerRef.current = null;
      }, 300);
    }, 0);
    return () => window.clearTimeout(startCloseTimer);
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
      const openSyncTimer = window.setTimeout(() => {
        setSortShouldRender(true);
        setSortClosing(false);
      }, 0);
      return () => window.clearTimeout(openSyncTimer);
    }

    if (!sortShouldRender || sortClosing) return;

    const startCloseTimer = window.setTimeout(() => {
      setSortClosing(true);
      sortCloseTimerRef.current = window.setTimeout(() => {
        setSortClosing(false);
        setSortShouldRender(false);
        sortCloseTimerRef.current = null;
      }, 300);
    }, 0);
    return () => window.clearTimeout(startCloseTimer);
  }, [sortOpen, sortShouldRender, sortClosing]);

  useEffect(() => {
    return () => {
      cancelActiveScrollRestoreRef.current?.();
      if (clearRestoreRequestTimerRef.current !== null) {
        window.clearTimeout(clearRestoreRequestTimerRef.current);
      }
      if (filtersCloseTimerRef.current !== null) {
        window.clearTimeout(filtersCloseTimerRef.current);
      }
      if (sortCloseTimerRef.current !== null) {
        window.clearTimeout(sortCloseTimerRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (!("scrollRestoration" in window.history)) return;

    const previousScrollRestoration = window.history.scrollRestoration;
    window.history.scrollRestoration = "manual";

    return () => {
      window.history.scrollRestoration = previousScrollRestoration;
    };
  }, []);

  useEffect(() => {
    const saveScroll = () => {
      writeShopScrollCache(shopLocationKey, window.scrollY);
    };

    window.addEventListener("pagehide", saveScroll);
    window.addEventListener("beforeunload", saveScroll);

    return () => {
      window.removeEventListener("pagehide", saveScroll);
      window.removeEventListener("beforeunload", saveScroll);
    };
  }, [shopLocationKey]);

  useEffect(() => {
    if (loading || status === "loading") return;
    if (handledShopVisitKeyRef.current === shopLocationKey) return;

    const cachedScroll = readShopScrollCache();
    const shouldRestore =
      cachedScroll &&
      isMatchingShopListingCache(cachedScroll.locationKey, shopLocationKey) &&
      Date.now() - cachedScroll.updatedAt <= 1000 * 60 * 30 &&
      isShopScrollRestoreRequested(cachedScroll);

    handledShopVisitKeyRef.current = shopLocationKey;

    if (!shouldRestore) {
      cancelActiveScrollRestoreRef.current?.();
      clearShopScrollRestoreRequest();
      window.scrollTo({ top: 0, left: 0, behavior: "auto" });
      return;
    }

    const restoreKey = getShopScrollCacheRestoreKey(cachedScroll);
    if (restoredScrollCacheKeyRef.current === restoreKey) return;

    restoredScrollCacheKeyRef.current = restoreKey;
    cancelActiveScrollRestoreRef.current?.();
    cancelActiveScrollRestoreRef.current = restoreWindowScroll(cachedScroll.scrollY);

    if (clearRestoreRequestTimerRef.current !== null) {
      window.clearTimeout(clearRestoreRequestTimerRef.current);
    }
    clearRestoreRequestTimerRef.current = window.setTimeout(() => {
      clearShopScrollRestoreRequest();
      clearRestoreRequestTimerRef.current = null;
    }, 700);
  }, [loading, shopLocationKey, status]);

  useEffect(() => {
    if (!isQuickViewOpen) return;

    const quickViewScrollY = quickViewScrollYRef.current;
    window.history.pushState(
      {
        ...(window.history.state ?? {}),
        shopQuickViewOpen: true,
        shopScrollY: quickViewScrollY,
      },
      "",
      window.location.href
    );

    const handlePopState = () => {
      closeQuickView();
      restoreWindowScroll(quickViewScrollY);
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
    const previousRubroFromQuery = previousRubroFromQueryRef.current;
    previousRubroFromQueryRef.current = rubroFromQuery;

    if (!rubroFromQuery) return;
    if (previousRubroFromQuery !== undefined && previousRubroFromQuery === rubroFromQuery) return;
    if (rubroFromQuery === selectedWorld) return;

    ensureFullCatalog();
    skipNextUrlSyncRef.current = true;
    setCategory(null);
    setDepartament(rubroFromQuery);
  }, [ensureFullCatalog, rubroFromQuery, selectedWorld, setCategory, setDepartament]);

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

  const handleOpenQuickView = useCallback(
    (product: Product) => {
      quickViewScrollYRef.current = window.scrollY;
      openQuickView(product);
    },
    [openQuickView]
  );

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
          <div className="mb-5 hidden w-full md:block">
            <p className="mb-2 text-center text-xs font-semibold uppercase tracking-[0.2em] text-[var(--brand-gold-300)]/90">
              Tu estilo ideal empieza acá
            </p>
            <div className="relative mx-auto grid min-h-12 w-full max-w-5xl grid-cols-2 items-center rounded-full border border-white/20 bg-white/[0.10] p-1 shadow-[0_10px_26px_rgba(34,14,66,0.18)] backdrop-blur-sm">
              <span
                aria-hidden="true"
                className="pointer-events-none absolute left-1 top-1 h-[calc(100%-0.5rem)] w-[calc(50%-0.25rem)] rounded-full border border-white/65 bg-[var(--brand-gold-300)] shadow-[0_8px_20px_rgba(45,22,75,0.22)] transition-transform duration-300 ease-out"
                style={{ transform: `translateX(${selectedWorldIndex * 100}%)` }}
              />
              {departamentOptions.map((opt) => {
                const active = selectedWorld === opt.value;
                return (
                  <button
                    key={opt.value}
                    type="button"
                    onClick={() => { setCategory(null); handleDepartamentChange(opt.value); }}
                    className="relative z-10 flex h-10 items-center justify-center rounded-full border border-transparent px-4 text-center transition-colors duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand-gold-300)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--brand-violet-900)]"
                    aria-pressed={active}
                    aria-label={`Filtrar por ${opt.label}`}
                  >
                    <span className={`block text-[11px] font-bold uppercase tracking-[0.17em] sm:text-sm ${active ? "text-[var(--brand-violet-950)]" : "text-[var(--brand-cream)]/76"}`}>
                      {opt.label}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Rubro toggle — mobile only */}
          <div className="mb-4 w-full md:hidden">
            <p className="mb-2 text-center text-[11px] font-semibold uppercase tracking-[0.18em] text-[var(--brand-gold-300)]/90">
              Tu estilo ideal empieza acá
            </p>
            <div className="relative grid min-h-11 w-full grid-cols-2 items-center rounded-full border border-white/20 bg-white/[0.10] p-1 shadow-[0_8px_20px_rgba(34,14,66,0.16)] backdrop-blur-sm">
              <span
                aria-hidden="true"
                className="pointer-events-none absolute left-1 top-1 h-[calc(100%-0.5rem)] w-[calc(50%-0.25rem)] rounded-full border border-white/65 bg-[var(--brand-gold-300)] shadow-[0_7px_18px_rgba(45,22,75,0.2)] transition-transform duration-300 ease-out"
                style={{ transform: `translateX(${selectedWorldIndex * 100}%)` }}
              />
              {departamentOptions.map((opt) => {
                const active = selectedWorld === opt.value;
                return (
                  <button
                    key={opt.value}
                    type="button"
                    onClick={() => { setCategory(null); handleDepartamentChange(opt.value); }}
                    className="relative z-10 flex h-9 items-center justify-center rounded-full border border-transparent px-3 text-center transition-colors duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand-gold-300)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--brand-violet-900)]"
                    aria-pressed={active}
                    aria-label={`Filtrar por ${opt.label}`}
                  >
                    <span className={`block text-[10px] font-bold uppercase tracking-[0.14em] sm:text-[11px] ${active ? "text-[var(--brand-violet-950)]" : "text-[var(--brand-cream)]/76"}`}>
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
                availableSpecifications={availableSpecifications}
                filters={filters}
                onFilterChange={{
                  departament: handleDepartamentChange,
                  category: handleCategoryChange,
                  search: handleSearchChange,
                  sort: handleSortChange,
                  togglePromo: handleTogglePromoFilter,
                  toggleKit: handleToggleKitFilter,
                  toggleSpec: handleToggleSpecFilter,
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
                  onSearchChange={handleSearchChange}
                  onFiltersClick={() => {
                    ensureFullCatalog();
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
                    onChange={(e) => handleSearchChange(e.target.value)}
                    onFocus={ensureFullCatalog}
                    className="w-full rounded-xl border border-white/20 bg-white/10 px-3.5 py-2.5 text-sm text-[var(--brand-cream)] placeholder-[var(--brand-cream)]/55 backdrop-blur-sm transition duration-200 focus:border-[var(--brand-gold-300)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand-gold-300)]/55"
                  />
                  <span aria-hidden className="absolute right-3 top-1/2 -translate-y-1/2 text-[var(--brand-gold-300)]/90">🔍</span>
                </div>
                <div className="flex items-center justify-end gap-2">
                  <span className="text-xs text-[var(--brand-cream)]/70 shrink-0">Ordenar:</span>
                  <div className="relative flex-1">
                    <select
                      value={filters.sortBy}
                      onChange={(e) => handleSortChange(e.target.value as typeof filters.sortBy)}
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
                  onQuickView={handleOpenQuickView}
                  catalogComplete={catalogComplete}
                  catalogRefreshing={catalogRefreshing}
                  onLoadMoreApproach={ensureFullCatalog}
                />
              )}
            </div>
          </div>
        </section>

        {filtersShouldRender && (
          <div className="fixed inset-0 z-[250] md:hidden">
            <FiltersSidebar
              categories={availableCategories}
              availableSpecifications={availableSpecifications}
              filters={filters}
              onFilterChange={{
                departament: handleDepartamentChange,
                category: handleCategoryChange,
                search: handleSearchChange,
                sort: handleSortChange,
                togglePromo: handleTogglePromoFilter,
                toggleKit: handleToggleKitFilter,
                toggleSpec: handleToggleSpecFilter,
              }}
              onClearFilters={clearFilters}
              isOpen={!filtersClosing}
              onClose={() => setFiltersOpen(false)}
              showSortSection={false}
              showDepartamentSection={false}
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
                          handleSortChange(option.value);
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

        <BackToTopButton
          hidden={filtersShouldRender || sortShouldRender || isQuickViewOpen}
        />
      </div>
    </main>
  );
}
