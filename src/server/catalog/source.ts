import "server-only";

import { env } from "@/src/config/env";
import type { Product } from "@/src/features/shop/domain/entities/Product";
import { adaptSheetRowsToProducts } from "@/src/features/shop/infrastructure/data/productAdapter";
import { getSheetsToken } from "@/src/server/sheets/tokens";

type FetchCatalogSourceOptions = {
  includeInactive?: boolean;
  forceFresh?: boolean;
};

const PRODUCTS_SHEET = "products";
const CATALOG_DISPLAY_REVALIDATE_SECONDS = 180;

const buildSheetsUrl = (options: Required<Pick<FetchCatalogSourceOptions, "includeInactive" | "forceFresh">>) => {
  const endpoint = env.getOptionalServer("SHEETS_ENDPOINT");
  if (!endpoint) return null;

  const url = new URL(endpoint);
  url.searchParams.set("sheet", PRODUCTS_SHEET);
  url.searchParams.set("token", getSheetsToken("read"));

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
  const requestUrl = buildSheetsUrl({ includeInactive, forceFresh });

  if (!requestUrl) {
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
