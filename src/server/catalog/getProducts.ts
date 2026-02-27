import { getJson, setJson } from "@/src/server/kv";
import { env } from "@/src/config/env";

type CatalogProduct = {
  id: string;
  name: string;
  price: number;
  currency: "ARS";
  active: boolean;
};

type RawProductRow = Record<string, unknown>;

const CATALOG_CACHE_KEY = "es:catalog:products";
const CATALOG_CACHE_TTL = 120;

const toBoolean = (value: unknown): boolean => {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value !== 0;
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    return ["true", "1", "si", "sí", "yes", "y"].includes(normalized);
  }
  return false;
};

const getStringField = (row: RawProductRow, keys: string[]): string => {
  for (const key of keys) {
    const value = row[key];
    if (typeof value === "string" && value.trim()) return value.trim();
    if (typeof value === "number" && Number.isFinite(value)) return String(value);
  }
  return "";
};

const getPrice = (row: RawProductRow): number => {
  const value = row.price ?? row.Precio;
  const num = typeof value === "number" ? value : Number(String(value ?? "").replace(/[^0-9.-]+/g, ""));
  if (!Number.isFinite(num) || num < 0) return Number.NaN;
  return Number(num.toFixed(2));
};

const rowToCatalogProduct = (row: RawProductRow): CatalogProduct | null => {
  const id = getStringField(row, ["id", "ID", "Id"]);
  const name = getStringField(row, ["name", "Nombre"]);
  const price = getPrice(row);

  if (!id || !name || !Number.isFinite(price) || price < 0) return null;

  const activeField = row.active ?? row.Activo;
  const active = activeField === undefined ? true : toBoolean(activeField);
  if (!active) return null;

  const currencyRaw = getStringField(row, ["currency", "Moneda"]).toUpperCase() || "ARS";
  const currency = "ARS" as const;

  if (currencyRaw !== "ARS") return null;

  return {
    id,
    name,
    price,
    currency,
    active,
  };
};

export async function getProductsCatalog(): Promise<Map<string, CatalogProduct>> {
  const cached = await getJson<CatalogProduct[]>(CATALOG_CACHE_KEY);
  if (cached && Array.isArray(cached)) {
    return new Map(cached.map((item) => [item.id, item]));
  }

  const endpoint = env.getPublic("NEXT_PUBLIC_SHEETS_ENDPOINT");
  if (!endpoint) {
    throw new Error("NEXT_PUBLIC_SHEETS_ENDPOINT missing");
  }

  const response = await fetch(endpoint, { cache: "no-store" });
  if (!response.ok) {
    throw new Error(`Failed to fetch products catalog: ${response.status}`);
  }

  const payload = (await response.json().catch(() => null)) as unknown;
  if (!Array.isArray(payload)) {
    throw new Error("Invalid sheets payload format");
  }

  const products = payload
    .map((row) => (row && typeof row === "object" ? rowToCatalogProduct(row as RawProductRow) : null))
    .filter((product): product is CatalogProduct => product !== null);

  await setJson(CATALOG_CACHE_KEY, products, CATALOG_CACHE_TTL);

  return new Map(products.map((item) => [item.id, item]));
}
