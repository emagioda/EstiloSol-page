import "server-only";

import { env } from "@/src/config/env";
import type { Product } from "@/src/features/shop/domain/entities/Product";
import { adaptSheetRowsToProducts } from "@/src/features/shop/infrastructure/data/productAdapter";
import { logEvent } from "@/src/server/observability/log";
import { getSheetsToken } from "@/src/server/sheets/tokens";

type FetchCatalogSourceOptions = {
  authoritative?: boolean;
  includeInactive?: boolean;
  forceFresh?: boolean;
};

export type AuthoritativeCatalogProduct = {
  id: unknown;
  name: unknown;
  price: unknown;
  currency: unknown;
  active: unknown;
  stock_status: unknown;
  stock_qty: unknown;
};

const PRODUCTS_SHEET = "products";
const CATALOG_DISPLAY_REVALIDATE_SECONDS = 180;

const buildSheetsUrl = (
  options: Required<Pick<FetchCatalogSourceOptions, "authoritative" | "includeInactive" | "forceFresh">>,
) => {
  const endpoint = env.getOptionalServer("SHEETS_ENDPOINT");
  if (!endpoint) return null;

  const url = new URL(endpoint);
  url.searchParams.set("sheet", PRODUCTS_SHEET);
  url.searchParams.set("token", getSheetsToken(options.includeInactive || options.authoritative ? "admin" : "read"));

  if (options.authoritative) {
    url.searchParams.set("authoritative", "1");
  }

  if (options.includeInactive) {
    url.searchParams.set("includeInactive", "1");
  }

  if (options.forceFresh) {
    url.searchParams.set("force", "1");
    url.searchParams.set("_ts", String(Date.now()));
  }

  return url.toString();
};

const fetchCatalogRows = async (
  options: FetchCatalogSourceOptions = {},
): Promise<Record<string, unknown>[]> => {
  const includeInactive = options.includeInactive === true;
  const authoritative = options.authoritative === true;
  const forceFresh = options.forceFresh === true;
  const requestUrl = buildSheetsUrl({ authoritative, includeInactive, forceFresh });

  if (!requestUrl) {
    throw new Error("SHEETS_ENDPOINT missing");
  }

  const startedAt = Date.now();
  let status: number | undefined;

  try {
    const response = await fetch(requestUrl, {
      cache: forceFresh ? "no-store" : "force-cache",
      next: forceFresh
        ? undefined
        : {
            revalidate: CATALOG_DISPLAY_REVALIDATE_SECONDS,
            tags: ["catalog"],
          },
    });
    status = response.status;

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

    logEvent("info", "sheets.read.timing", {
      sheet: PRODUCTS_SHEET,
      authoritative,
      includeInactive,
      forceFresh,
      status,
      ok: true,
      durationMs: Date.now() - startedAt,
      rowCount: rows.length,
    });

    return rows.filter(
      (row): row is Record<string, unknown> => row !== null && typeof row === "object" && !Array.isArray(row),
    );
  } catch (error) {
    logEvent("warn", "sheets.read.timing", {
      sheet: PRODUCTS_SHEET,
      authoritative,
      includeInactive,
      forceFresh,
      status,
      ok: false,
      durationMs: Date.now() - startedAt,
      errorName: error instanceof Error ? error.name : "unknown",
    });
    throw error;
  }
};

export async function fetchProductsFromCatalogSource(
  options: FetchCatalogSourceOptions = {},
): Promise<Product[]> {
  const rows = await fetchCatalogRows(options);
  return adaptSheetRowsToProducts(rows, { includeInactive: options.includeInactive === true });
}

export const adaptAuthoritativeCatalogRows = (
  rows: readonly Record<string, unknown>[],
): AuthoritativeCatalogProduct[] =>
  rows.map((row) => ({
    id: row.id,
    name: row.name,
    price: row.authoritative_price,
    currency: row.authoritative_currency,
    active: row.authoritative_active,
    stock_status: row.authoritative_stock_status,
    stock_qty: row.authoritative_stock_qty,
  }));

export async function fetchAuthoritativeProductsFromCatalogSource(): Promise<AuthoritativeCatalogProduct[]> {
  const rows = await fetchCatalogRows({ authoritative: true, includeInactive: true, forceFresh: true });
  return adaptAuthoritativeCatalogRows(rows);
}
