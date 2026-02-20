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
  cacheBust?: boolean;
};

const withCacheBust = (endpoint: string) => {
  const separator = endpoint.includes("?") ? "&" : "?";
  return `${endpoint}${separator}_ts=${Date.now()}`;
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

const getFirstDefinedValue = (row: Record<string, unknown>, keys: string[]) => {
  for (const key of keys) {
    if (key in row) {
      return row[key];
    }
  }
  return undefined;
};

const toTagsArray = (rawTags: unknown): string[] => {
  if (Array.isArray(rawTags)) {
    return rawTags
      .filter((tag): tag is string => typeof tag === "string")
      .map((tag) => tag.trim())
      .filter(Boolean);
  }

  if (typeof rawTags !== "string") {
    return [];
  }

  return rawTags
    .split(",")
    .map((tag) => tag.trim())
    .filter(Boolean);
};

// --- ADAPTADOR: Convierte datos "sucios" del Excel a "limpios" para la App ---
const adaptSheetRowToProduct = (row: Record<string, unknown>): Product | null => {
  const id = getValidProductId(row);
  if (!id) {
    console.warn("Skipping product row without valid ID", row);
    return null;
  }

  const rawImages = row.images ?? row.images_csv;
  const rawActive = getFirstDefinedValue(row, ["active", "Active", "activo"]);
  const hasExplicitActive =
    rawActive !== undefined && !(typeof rawActive === "string" && rawActive.trim().length === 0);

  if (hasExplicitActive && !toBoolean(rawActive)) {
    return null;
  }

  const rawDepartment = getFirstDefinedValue(row, [
    "department",
    "Department",
    "departament",
    "Departament",
  ]);
  const department =
    typeof rawDepartment === "string" && rawDepartment.trim().length > 0
      ? rawDepartment.trim()
      : undefined;

  const rawProductType = getFirstDefinedValue(row, ["product_type", "ProductType", "productType"]);
  const rawIncludes = getFirstDefinedValue(row, ["includes", "Includes"]);

  const priceRaw = row.price ?? row.Precio ?? "0";
  const price =
    typeof priceRaw === "number"
      ? priceRaw
      : Number(String(priceRaw).replace(/[^0-9.-]+/g, ""));

  return {
    id,
    name: String(row.name ?? row.Nombre ?? "Producto sin nombre"),
    slug: row.slug ? String(row.slug) : undefined,
    active: hasExplicitActive ? toBoolean(rawActive) : undefined,
    department,
    description: String(row.description ?? row.Descripcion ?? ""),
    short_description: String(
      row.short_description ?? row.ShortDescription ?? row.shortDescription ?? ""
    ),
    category: String(row.category ?? row.Categoria ?? "General"),
    product_type:
      typeof rawProductType === "string" && rawProductType.trim().length > 0
        ? rawProductType.trim()
        : undefined,
    includes:
      typeof rawIncludes === "string" && rawIncludes.trim().length > 0
        ? rawIncludes
        : null,
    tags: toTagsArray(getFirstDefinedValue(row, ["tags_csv", "tags", "Tags"])),
    price: Number.isFinite(price) ? price : 0,
    currency: String(row.currency ?? row.Moneda ?? "ARS"),
    images: toImagesArray(rawImages),
    is_new: toBoolean(row.is_new ?? row.Nuevo),
    is_sale: toBoolean(row.is_sale ?? row.Oferta),
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
  cacheMode = "force-cache",
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
  const res = await fetch(requestUrl, {
    cache: cacheMode ?? "force-cache",
  });

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
