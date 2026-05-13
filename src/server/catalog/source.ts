import "server-only";

import { env } from "@/src/config/env";
import type { Product } from "@/src/features/shop/domain/entities/Product";
import { adaptSheetRowsToProducts } from "@/src/features/shop/infrastructure/data/productAdapter";

type FetchCatalogSourceOptions = {
  includeInactive?: boolean;
  forceFresh?: boolean;
  allowMockFallback?: boolean;
};

const PRODUCTS_SHEET = "products";
const CATALOG_DISPLAY_REVALIDATE_SECONDS = 180;

const loadMockProducts = async (includeInactive = false): Promise<Product[]> => {
  const mock: unknown = (await import("@/src/features/shop/infrastructure/data/products.mock.json")).default;
  const rows = Array.isArray(mock)
    ? mock.filter((row): row is Record<string, unknown> => row !== null && typeof row === "object")
    : [];
  return adaptSheetRowsToProducts(rows, { includeInactive });
};

const buildSheetsUrl = (options: Required<Pick<FetchCatalogSourceOptions, "includeInactive" | "forceFresh">>) => {
  const endpoint = env.getOptionalServer("SHEETS_ENDPOINT");
  if (!endpoint) return null;

  const token = env.getOptionalServer("SHEETS_API_TOKEN");
  if (!token) {
    throw new Error("SHEETS_API_TOKEN missing");
  }

  const url = new URL(endpoint);
  url.searchParams.set("sheet", PRODUCTS_SHEET);
  url.searchParams.set("token", token);

  if (options.includeInactive) {
    url.searchParams.set("includeInactive", "1");
  }

  if (options.forceFresh) {
    url.searchParams.set("force", "1");
    url.searchParams.set("_ts", String(Date.now()));
  }

  return url.toString();
};

export async function fetchProductsFromCatalogSource(
  options: FetchCatalogSourceOptions = {},
): Promise<Product[]> {
  const includeInactive = options.includeInactive === true;
  const forceFresh = options.forceFresh === true;
  const allowMockFallback = options.allowMockFallback !== false;
  let requestUrl: string | null;
  try {
    requestUrl = buildSheetsUrl({ includeInactive, forceFresh });
  } catch (error) {
    if (allowMockFallback) {
      if (process.env.NODE_ENV !== "production") {
        console.warn("Falling back to mock catalog:", error instanceof Error ? error.message : error);
      }
      return loadMockProducts(includeInactive);
    }
    throw error;
  }

  if (!requestUrl) {
    if (allowMockFallback) return loadMockProducts(includeInactive);
    throw new Error("SHEETS_ENDPOINT missing");
  }

  const response = await fetch(requestUrl, {
    cache: forceFresh ? "no-store" : "force-cache",
    next: forceFresh
      ? undefined
      : {
          revalidate: CATALOG_DISPLAY_REVALIDATE_SECONDS,
          tags: ["catalog"],
        },
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch products catalog: ${response.status}`);
  }

  const payload: unknown = await response.json().catch(() => null);
  if (payload && typeof payload === "object" && (payload as { ok?: unknown }).ok === false) {
    const message = (payload as { error?: unknown }).error;
    throw new Error(typeof message === "string" ? message : "Sheets endpoint error");
  }

  const rows = Array.isArray(payload)
    ? payload
    : payload && typeof payload === "object" && Array.isArray((payload as { items?: unknown }).items)
      ? (payload as { items: unknown[] }).items
      : [];

  return adaptSheetRowsToProducts(
    rows.filter((row): row is Record<string, unknown> => row !== null && typeof row === "object"),
    { includeInactive },
  );
}
