import type { Product } from "@/src/features/shop/domain/entities/Product";

export const MISSING_SHEETS_ENDPOINT_ERROR =
  "NEXT_PUBLIC_SHEETS_ENDPOINT no está configurado. Definí la variable para cargar el catálogo en tiempo real.";

const getSheetsEndpoint = () => {
  const endpoint = process.env.NEXT_PUBLIC_SHEETS_ENDPOINT?.trim();

  if (!endpoint) {
    const error = new Error(MISSING_SHEETS_ENDPOINT_ERROR);
    error.name = "MissingSheetsEndpointError";
    throw error;
  }

  return endpoint;
};

export const isMissingSheetsEndpointError = (error: unknown) =>
  error instanceof Error &&
  (error.name === "MissingSheetsEndpointError" ||
    error.message === MISSING_SHEETS_ENDPOINT_ERROR);

type FetchProductsOptions = {
  cacheMode?: RequestCache;
  layer?: "catalog" | "detail" | "checkout-validation" | "client-refresh";
  cacheBust?: boolean;
};

// NOTE: we switch default cacheMode to `no-store`. with a very short
// CACHE_TTL on the Apps Script side the browser will still make a
// request on every navigation, but the script itself will only run at
// most once per minute. this mimics an "always‑fresh" catalog while
// keeping the endpoint under control.

const withCacheBust = (endpoint: string) => {
  const url = new URL(endpoint);
  url.searchParams.set("force", "1");
  url.searchParams.set("_ts", String(Date.now()));
  return url.toString();
};

const getValidProductId = (row: Record<string, unknown>): string | null => {
  const rawId = row.id ?? row.ID ?? row.Id;

  if (typeof rawId === "number" && Number.isFinite(rawId)) {
    return String(rawId);
  }

  if (typeof rawId !== "string") {
    return null;
  }

  const normalizedId = rawId.trim();
  return normalizedId.length > 0 ? normalizedId : null;
};

const toBoolean = (value: unknown): boolean => {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value !== 0;
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    return ["true", "1", "si", "sí", "yes", "y"].includes(normalized);
  }
  return false;
};

const toNumberOrNull = (value: unknown): number | null => {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }

  if (typeof value === "string") {
    const normalized = value.trim();
    if (!normalized) return null;
    const parsed = Number(normalized.replace(/[^0-9.-]+/g, ""));
    return Number.isFinite(parsed) ? parsed : null;
  }

  return null;
};

const toSpecifications = (value: unknown): Record<string, string> => {
  const toRecord = (input: unknown): Record<string, string> => {
    if (!input || typeof input !== "object" || Array.isArray(input)) {
      return {};
    }

    const entries = Object.entries(input as Record<string, unknown>).reduce<Record<string, string>>(
      (acc, [key, rawValue]) => {
        const normalizedKey = key.trim();
        if (!normalizedKey) return acc;
        if (typeof rawValue !== "string") return acc;

        const normalizedValue = rawValue.trim();
        if (!normalizedValue) return acc;

        acc[normalizedKey] = normalizedValue;
        return acc;
      },
      {}
    );

    return entries;
  };

  if (typeof value === "string") {
    const normalized = value.trim();
    if (!normalized) return {};

    try {
      const parsed: unknown = JSON.parse(normalized);
      return toRecord(parsed);
    } catch {
      return {};
    }
  }

  return toRecord(value);
};

const toImagesArray = (rawImages: unknown): string[] => {
  if (Array.isArray(rawImages)) {
    return rawImages
      .filter((image): image is string => typeof image === "string")
      .map((image) => image.trim())
      .filter(Boolean);
  }

  if (typeof rawImages === "string") {
    return rawImages
      .split(",")
      .map((image) => image.trim())
      .filter(Boolean);
  }

  return [];
};

// --- ADAPTADOR: Convierte datos "sucios" del Excel a "limpios" para la App ---
const toStringArray = (raw: unknown): string[] => {
  if (Array.isArray(raw)) {
    return raw
      .filter((item): item is string => typeof item === "string")
      .map((s) => s.trim())
      .filter(Boolean);
  }
  if (typeof raw === "string") {
    return raw
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
  }
  return [];
};

const adaptSheetRowToProduct = (row: Record<string, unknown>): Product | null => {
  const id = getValidProductId(row);
  if (!id) {
    console.warn("Skipping product row without valid ID", row);
    return null;
  }

  // columna active: si no existe, el producto se considera activo para
  // mantener compatibilidad con catálogos que no incluyen ese campo.
  const activeField = row.active ?? row.Activo;
  const active = activeField === undefined ? true : toBoolean(activeField);
  if (!active) {
    return null;
  }

  const rawImages = row.images ?? row.images_csv;

  const priceRaw = row.price ?? row.Precio ?? "0";
  const price =
    typeof priceRaw === "number"
      ? priceRaw
      : Number(String(priceRaw).replace(/[^0-9.-]+/g, ""));
  const safePrice = Number.isFinite(price) ? price : 0;

  const oldPriceRaw = row.old_price ?? row.oldPrice ?? row.PrecioAnterior ?? null;
  const oldPrice = toNumberOrNull(oldPriceRaw);

  const departamentRaw = row.departament ?? row.Departamento ?? "";
  const departament =
    typeof departamentRaw === "string" ? departamentRaw.toUpperCase() : "";

  const productTypeRaw = row.product_type ?? row.Tipo ?? "UNICO";
  const productType =
    typeof productTypeRaw === "string" ? String(productTypeRaw).toUpperCase() : "UNICO";

  const maybeSlug = row.slug ?? row.Slug ?? row.slug ?? null;
  const slugStr =
    typeof maybeSlug === "string" && maybeSlug.trim().length > 0
      ? maybeSlug.trim()
      : id; // fallback a id cuando no hay slug explícito

  const explicitSaleFlag = toBoolean(row.is_sale ?? row.Oferta);
  const hasPriceDiscount = oldPrice !== null && oldPrice > safePrice;
  const specifications = toSpecifications(
    row.specifications ?? row.Specifications ?? row.specs ?? row.especificaciones
  );

  return {
    id,
    name: String(row.name ?? row.Nombre ?? "Producto sin nombre"),
    slug: slugStr,
    departament: departament === "PELUQUERIA" || departament === "BIJOUTERIE" ? departament : undefined,
    category: String(row.category ?? row.Categoria ?? "General"),
    price: safePrice,
    old_price: oldPrice,
    currency: String(row.currency ?? row.Moneda ?? "ARS"),
    short_description: String(
      row.short_description ?? row.ShortDescription ?? row.shortDescription ?? ""
    ),
    description: String(row.description ?? row.Descripcion ?? ""),
    images: toImagesArray(rawImages),
    tags: toStringArray(row.tags_csv ?? row.Tags ?? ""),
    specifications,
    product_type: productType === "KIT" ? "KIT" : "UNICO",
    includes: productType === "KIT" ? toStringArray(row.includes ?? row.Includes ?? "") : [],
    is_new: toBoolean(row.is_new ?? row.Nuevo),
    is_sale: explicitSaleFlag || hasPriceDiscount,
    active: true, // ya filtramos arriba
  };
};

async function fetchLocalMock(): Promise<Product[]> {
  try {
    // dynamic import so webpack/nextjs can tree‑shake when not needed
    const mock: unknown = (await import("./products.mock.json")).default;
    if (Array.isArray(mock)) {
      return mock
        .map((row) =>
          row && typeof row === "object"
            ? adaptSheetRowToProduct(row as Record<string, unknown>)
            : null
        )
        .filter((p): p is Product => p !== null);
    }
  } catch (err) {
    // fall through to empty array
    console.warn("could not load local mock products:", err);
  }
  return [];
}

export const fetchProductsFromSheets = async ({
  cacheMode,
  layer,
  cacheBust = false,
}: FetchProductsOptions = {}): Promise<Product[]> => {
  // if the environment variable is not defined we fall back to a bundled
  // json file. this is useful for GitHub Pages or offline builds where we
  // cannot hit the Apps Script endpoint at runtime. the `scripts/update-*
  //` task (see package.json) can be used to refresh the file.
  let endpoint: string | null = null;
  try {
    endpoint = getSheetsEndpoint();
  } catch {
    endpoint = null;
  }

  if (!endpoint) {
    return fetchLocalMock();
  }

  const requestUrl = cacheBust ? withCacheBust(endpoint) : endpoint;

  const resolvedLayer =
    layer ??
    (typeof window === "undefined" ? "catalog" : "client-refresh");

  const profileByLayer: Record<
    NonNullable<FetchProductsOptions["layer"]>,
    { cache: RequestCache; revalidate?: number; tags?: string[] }
  > = {
    catalog: { cache: "force-cache", revalidate: 60, tags: ["catalog"] },
    detail: { cache: "force-cache", revalidate: 60, tags: ["catalog", "catalog-detail"] },
    "checkout-validation": { cache: "no-store" },
    "client-refresh": { cache: "no-store" },
  };

  const profile = profileByLayer[resolvedLayer];

  const init: RequestInit & {
    next?: {
      revalidate?: number;
      tags?: string[];
    };
  } = {
    cache: cacheMode ?? profile.cache,
  };

  if (typeof window === "undefined" && profile.revalidate) {
    init.next = {
      revalidate: profile.revalidate,
      tags: profile.tags,
    };
  }

  const res = await fetch(requestUrl, init);

  if (!res.ok) {
    throw new Error(`Failed to fetch products: ${res.status}`);
  }

  const rawData: unknown = await res.json();

  if (!Array.isArray(rawData)) {
    return [];
  }

  return rawData
    .map((row) =>
      row && typeof row === "object"
        ? adaptSheetRowToProduct(row as Record<string, unknown>)
        : null
    )
    .filter((product): product is Product => product !== null);
};
