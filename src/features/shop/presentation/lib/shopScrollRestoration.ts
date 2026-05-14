const SHOP_SCROLL_CACHE_KEY = "es:shop:scroll:v1";
const SHOP_SCROLL_NEXT_RESTORE_KEY = "es:shop:scroll:next-restore:v1";
const SHOP_HISTORY_RESTORE_STATE_KEY = "__estiloSolShopRestoreScroll";

type ShopScrollCache = {
  locationKey: string;
  scrollY: number;
  productId?: string;
  productHandle?: string;
  restoreOnNextShopVisit?: boolean;
  updatedAt: number;
};

const isShopListingLocation = (locationKey: string) =>
  locationKey === "/tienda" || locationKey.startsWith("/tienda?");

const getRubroFromLocationKey = (locationKey: string) => {
  const [, query = ""] = locationKey.split("?");
  if (!query) return null;

  try {
    return new URLSearchParams(query).get("rubro");
  } catch {
    return null;
  }
};

export const isMatchingShopListingCache = (cachedKey: string, currentKey: string) => {
  if (cachedKey === currentKey) return true;
  if (!isShopListingLocation(cachedKey) || !isShopListingLocation(currentKey)) return false;

  const cachedRubro = getRubroFromLocationKey(cachedKey);
  const currentRubro = getRubroFromLocationKey(currentKey);

  return !cachedRubro || !currentRubro || cachedRubro === currentRubro;
};

export const getCurrentShopLocationKey = () => {
  if (typeof window === "undefined") return "/tienda";

  const { pathname, search } = window.location;
  return `${pathname}${search}`;
};

export const readShopScrollCache = (): ShopScrollCache | null => {
  if (typeof window === "undefined") return null;

  try {
    const raw = window.sessionStorage.getItem(SHOP_SCROLL_CACHE_KEY);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return null;

    const cache = parsed as Partial<ShopScrollCache>;
    if (
      typeof cache.locationKey !== "string" ||
      typeof cache.scrollY !== "number" ||
      !Number.isFinite(cache.scrollY)
    ) {
      return null;
    }

    return {
      locationKey: cache.locationKey,
      scrollY: cache.scrollY,
      productId: typeof cache.productId === "string" ? cache.productId : undefined,
      productHandle: typeof cache.productHandle === "string" ? cache.productHandle : undefined,
      restoreOnNextShopVisit: cache.restoreOnNextShopVisit === true,
      updatedAt: typeof cache.updatedAt === "number" ? cache.updatedAt : 0,
    };
  } catch {
    return null;
  }
};

export const writeShopScrollCache = (
  locationKey: string,
  scrollY: number,
  product?: { id?: string; handle?: string },
  { restoreOnNextShopVisit = false }: { restoreOnNextShopVisit?: boolean } = {},
) => {
  if (typeof window === "undefined" || !isShopListingLocation(locationKey)) return null;

  const cache = {
    locationKey,
    scrollY: Math.max(0, Math.round(scrollY)),
    productId: product?.id,
    productHandle: product?.handle,
    restoreOnNextShopVisit,
    updatedAt: Date.now(),
  } satisfies ShopScrollCache;

  try {
    window.sessionStorage.setItem(SHOP_SCROLL_CACHE_KEY, JSON.stringify(cache));
    return cache;
  } catch {
    return null;
  }
};

const getSafeHistoryState = () =>
  window.history.state && typeof window.history.state === "object"
    ? window.history.state
    : {};

const markCurrentShopHistoryEntryForRestore = () => {
  if (typeof window === "undefined" || !isShopListingLocation(getCurrentShopLocationKey())) return;

  window.history.replaceState(
    {
      ...getSafeHistoryState(),
      [SHOP_HISTORY_RESTORE_STATE_KEY]: true,
    },
    "",
    window.location.href,
  );
};

export const requestShopScrollRestoreForNextVisit = (cache = readShopScrollCache()) => {
  if (typeof window === "undefined" || !cache) return;

  try {
    window.sessionStorage.setItem(
      SHOP_SCROLL_NEXT_RESTORE_KEY,
      getShopScrollCacheRestoreKey(cache),
    );
  } catch {
    return;
  }
};

export const rememberCurrentShopScroll = (product?: { id?: string; handle?: string }) => {
  if (typeof window === "undefined") return;

  const locationKey = getCurrentShopLocationKey();
  const cache = writeShopScrollCache(locationKey, window.scrollY, product, {
    restoreOnNextShopVisit: true,
  });

  if (cache) {
    markCurrentShopHistoryEntryForRestore();
  }
};

export const getLastShopListingHref = (fallback = "/tienda") => {
  const cachedScroll = readShopScrollCache();
  return cachedScroll && isShopListingLocation(cachedScroll.locationKey)
    ? cachedScroll.locationKey
    : fallback;
};

type RestoreWindowScrollOptions = {
  cancelOnUserInput?: boolean;
  retryDelays?: number[];
};

const scrollKeys = new Set([
  "ArrowDown",
  "ArrowUp",
  "End",
  "Home",
  "PageDown",
  "PageUp",
  " ",
]);

export const getShopScrollCacheRestoreKey = (cache: ShopScrollCache) =>
  [
    cache.locationKey,
    cache.scrollY,
    cache.productId ?? "",
    cache.productHandle ?? "",
    cache.updatedAt,
  ].join("|");

export const isShopScrollRestoreRequested = (cache: ShopScrollCache) => {
  if (typeof window === "undefined" || cache.restoreOnNextShopVisit !== true) return false;

  const historyState = getSafeHistoryState();
  if (historyState[SHOP_HISTORY_RESTORE_STATE_KEY] === true) return true;

  try {
    return (
      window.sessionStorage.getItem(SHOP_SCROLL_NEXT_RESTORE_KEY) ===
      getShopScrollCacheRestoreKey(cache)
    );
  } catch {
    return false;
  }
};

export const clearShopScrollRestoreRequest = () => {
  if (typeof window === "undefined") return;

  try {
    window.sessionStorage.removeItem(SHOP_SCROLL_NEXT_RESTORE_KEY);

    const currentCache = readShopScrollCache();
    if (currentCache) {
      window.sessionStorage.setItem(
        SHOP_SCROLL_CACHE_KEY,
        JSON.stringify({
          ...currentCache,
          restoreOnNextShopVisit: false,
        } satisfies ShopScrollCache),
      );
    }
  } catch {
    return;
  }

  const historyState = getSafeHistoryState();
  if (historyState[SHOP_HISTORY_RESTORE_STATE_KEY] === undefined) return;

  const nextState = { ...historyState };
  delete nextState[SHOP_HISTORY_RESTORE_STATE_KEY];
  window.history.replaceState(nextState, "", window.location.href);
};

export const restoreWindowScroll = (
  scrollY: number,
  {
    cancelOnUserInput = true,
    retryDelays = [80, 180, 320],
  }: RestoreWindowScrollOptions = {},
) => {
  if (typeof window === "undefined") return () => {};

  let cancelled = false;
  const timeoutIds: number[] = [];
  const frameIds: number[] = [];

  const removeCancelListeners = () => {
    window.removeEventListener("wheel", cancelRestore, true);
    window.removeEventListener("touchstart", cancelRestore, true);
    window.removeEventListener("pointerdown", cancelRestore, true);
    window.removeEventListener("keydown", cancelRestoreOnKey, true);
  };

  const clearScheduledWork = () => {
    timeoutIds.forEach((id) => window.clearTimeout(id));
    frameIds.forEach((id) => window.cancelAnimationFrame(id));
    timeoutIds.length = 0;
    frameIds.length = 0;
  };

  function cancelRestore() {
    cancelled = true;
    clearScheduledWork();
    removeCancelListeners();
  }

  function cancelRestoreOnKey(event: KeyboardEvent) {
    if (scrollKeys.has(event.key)) {
      cancelRestore();
    }
  }

  const restore = () => {
    if (cancelled) return;
    window.scrollTo({ top: Math.max(0, scrollY), left: 0, behavior: "auto" });
  };

  if (cancelOnUserInput) {
    window.addEventListener("wheel", cancelRestore, { capture: true, passive: true });
    window.addEventListener("touchstart", cancelRestore, { capture: true, passive: true });
    window.addEventListener("pointerdown", cancelRestore, { capture: true, passive: true });
    window.addEventListener("keydown", cancelRestoreOnKey, true);
  }

  restore();
  const firstFrameId = window.requestAnimationFrame(() => {
    restore();
    const secondFrameId = window.requestAnimationFrame(restore);
    frameIds.push(secondFrameId);
  });
  frameIds.push(firstFrameId);

  retryDelays.forEach((delay) => {
    timeoutIds.push(window.setTimeout(restore, delay));
  });

  const cleanupDelay = Math.max(...retryDelays, 0) + 100;
  timeoutIds.push(window.setTimeout(removeCancelListeners, cleanupDelay));

  return cancelRestore;
};
