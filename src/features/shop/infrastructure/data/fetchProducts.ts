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
  layer?: "catalog" | "detail" | "checkout-validation" | "client-refresh";
  cacheBust?: boolean;
};

const withCacheBust = (endpoint: string) => {
  const url = new URL(endpoint, window.location.origin);
  url.searchParams.set("force", "1");
  url.searchParams.set("_ts", String(Date.now()));
  return `${url.pathname}${url.search}`;
};

async function fetchLocalMock(): Promise<Product[]> {
  try {
    const mock: unknown = (await import("./products.mock.json")).default;
    if (Array.isArray(mock)) {
      return adaptSheetRowsToProducts(
        mock.filter((row): row is Record<string, unknown> => row !== null && typeof row === "object"),
      );
    }
  } catch (err) {
    console.warn("could not load local mock products:", err);
  }

  return [];
}

export const fetchProductsFromSheets = async ({
  cacheMode,
  cacheBust = false,
}: FetchProductsOptions = {}): Promise<Product[]> => {
  if (typeof window === "undefined") {
    return fetchLocalMock();
  }

  const endpoint = cacheBust ? withCacheBust("/api/catalog") : "/api/catalog";
  const response = await fetch(endpoint, { cache: cacheMode ?? "no-store" });

  if (!response.ok) {
    throw new Error(`Failed to fetch products: ${response.status}`);
  }

  const payload: unknown = await response.json();
  const rows = Array.isArray(payload)
    ? payload.filter((row): row is Record<string, unknown> => row !== null && typeof row === "object")
    : [];

  return adaptSheetRowsToProducts(rows);
};
