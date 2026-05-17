import type { Product } from "@/src/features/shop/domain/entities/Product";
import { adaptSheetRowsToProducts } from "./productAdapter";

export const MISSING_SHEETS_ENDPOINT_ERROR =
  "El endpoint publico /api/catalog no esta disponible para cargar el catalogo.";

export const isMissingSheetsEndpointError = (error: unknown) =>
  error instanceof Error &&
  (error.name === "MissingCatalogEndpointError" ||
    error.name === "MissingSheetsEndpointError" ||
    error.message === MISSING_SHEETS_ENDPOINT_ERROR);

type FetchProductsOptions = {
  cacheMode?: RequestCache;
  cacheBust?: boolean;
};

const withCacheBust = (endpoint: string) => {
  const url = new URL(endpoint, window.location.origin);
  url.searchParams.set("force", "1");
  url.searchParams.set("_ts", String(Date.now()));
  return `${url.pathname}${url.search}`;
};

export const fetchProductsFromSheets = async ({
  cacheMode,
  cacheBust = false,
}: FetchProductsOptions = {}): Promise<Product[]> => {
  if (typeof window === "undefined") {
    throw new Error(MISSING_SHEETS_ENDPOINT_ERROR);
  }

  const endpoint = cacheBust ? withCacheBust("/api/catalog") : "/api/catalog";
  const response = await fetch(endpoint, { cache: cacheMode ?? "no-store" });

  if (!response.ok) {
    const errorPayload = (await response.json().catch(() => null)) as { error?: unknown } | null;
    const message =
      typeof errorPayload?.error === "string"
        ? errorPayload.error
        : `No se pudo cargar el catalogo. Codigo ${response.status}.`;
    throw new Error(message);
  }

  const payload: unknown = await response.json();
  const rows = Array.isArray(payload)
    ? payload.filter((row): row is Record<string, unknown> => row !== null && typeof row === "object")
    : [];

  return adaptSheetRowsToProducts(rows);
};
