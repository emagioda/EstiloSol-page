import type { Product, ProductType, StockStatus } from "../../domain/entities/Product";

type RawProductRow = Record<string, unknown>;

const DEFAULT_CURRENCY = "ARS";

export function normalizeKey(key: unknown): string {
  return String(key ?? "")
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function normalizeRow(row: RawProductRow): RawProductRow {
  return Object.entries(row).reduce<RawProductRow>((acc, [key, value]) => {
    acc[normalizeKey(key)] = value;
    return acc;
  }, {});
}

function pick(row: RawProductRow, keys: string[]): unknown {
  for (const key of keys) {
    const normalized = normalizeKey(key);
    if (Object.prototype.hasOwnProperty.call(row, normalized)) {
      return row[normalized];
    }
  }

  return undefined;
}

export function toBoolean(value: unknown, fallback = false): boolean {
  if (value === undefined || value === null || value === "") return fallback;
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value === 1;

  const normalized = String(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase();

  if (["true", "verdadero", "si", "yes", "1", "activo", "active"].includes(normalized)) {
    return true;
  }

  if (["false", "falso", "no", "0", "inactivo", "inactive"].includes(normalized)) {
    return false;
  }

  return fallback;
}

export function toNumberOrNull(value: unknown): number | null {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;

  const compact = String(value).trim().replace(/\s/g, "").replace(/[^0-9,.-]/g, "");
  const normalized = compact.includes(",") ? compact.replace(/\./g, "").replace(",", ".") : compact;
  const parsed = Number(normalized);

  return Number.isFinite(parsed) ? parsed : null;
}

function toStringOrNull(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  const text = String(value).trim();
  return text.length > 0 ? text : null;
}

export function toProductType(value: unknown): ProductType {
  const normalized = normalizeKey(value).replace(/_/g, "");
  if (normalized === "kit" || normalized === "combo") return "KIT";
  return "UNICO";
}

export function toStockStatus(value: unknown, stockQty?: number | null): StockStatus {
  const normalized = normalizeKey(value).replace(/_/g, "");

  if (["outofstock", "sinstock", "agotado", "nohaystock"].includes(normalized)) {
    return "out_of_stock";
  }

  if (["preorder", "preventa", "preventas", "reserva", "areserva"].includes(normalized)) {
    return "preorder";
  }

  if (typeof stockQty === "number" && stockQty <= 0) {
    return "out_of_stock";
  }

  return "in_stock";
}

export function toImagesArray(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.flatMap((item) => toImagesArray(item)).filter(Boolean);
  }

  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return [];

    if (trimmed.startsWith("[") && trimmed.endsWith("]")) {
      try {
        return toImagesArray(JSON.parse(trimmed));
      } catch {
        return [];
      }
    }

    return trimmed
      .split(/[,;\n]/)
      .map((item) => item.trim())
      .filter(Boolean);
  }

  return [];
}

export function toSpecifications(value: unknown): Record<string, string> {
  if (!value) return {};

  if (typeof value === "object" && !Array.isArray(value)) {
    return Object.entries(value as Record<string, unknown>).reduce<Record<string, string>>(
      (acc, [key, rawValue]) => {
        const label = String(key).trim();
        const text = toStringOrNull(rawValue);
        if (label && text) acc[label] = text;
        return acc;
      },
      {},
    );
  }

  const text = String(value).trim();
  if (!text) return {};

  if (text.startsWith("{") && text.endsWith("}")) {
    try {
      return toSpecifications(JSON.parse(text));
    } catch {
      return {};
    }
  }

  return text.split(",").reduce<Record<string, string>>((acc, item) => {
    const separatorIndex = item.indexOf(":");
    if (separatorIndex <= 0) return acc;

    const key = item.slice(0, separatorIndex).trim();
    const specValue = item.slice(separatorIndex + 1).trim();
    if (key && specValue) acc[key] = specValue;

    return acc;
  }, {});
}

export function adaptSheetRowToProduct(rawRow: RawProductRow): Product | null {
  const row = normalizeRow(rawRow);
  const id = toStringOrNull(pick(row, ["id", "product_id", "id_producto"]));
  const name = toStringOrNull(pick(row, ["name", "nombre", "product_name", "nombre_producto"]));
  const price = toNumberOrNull(pick(row, ["price", "precio"]));

  if (!id || !name || price === null) return null;

  const oldPrice = toNumberOrNull(pick(row, ["old_price", "precio_anterior"]));
  const stockQty = toNumberOrNull(pick(row, ["stock_qty", "stock", "cantidad_stock"]));
  const stockStatus = toStockStatus(pick(row, ["stock_status", "estado_stock"]), stockQty);
  const slug = toStringOrNull(pick(row, ["slug"])) ?? id;
  const images = toImagesArray(pick(row, ["images", "images_csv", "imagenes", "imagenes_csv"]));
  const departament = normalizeKey(pick(row, ["departament", "department", "rubro"])).toUpperCase();

  return {
    id,
    name,
    slug,
    departament:
      departament === "PELUQUERIA" || departament === "BIJOUTERIE" ? departament : undefined,
    category: toStringOrNull(pick(row, ["category", "categoria"])) ?? undefined,
    price,
    old_price: oldPrice,
    currency: toStringOrNull(pick(row, ["currency", "moneda"])) ?? DEFAULT_CURRENCY,
    short_description: toStringOrNull(pick(row, ["short_description", "descripcion_corta"])) ?? undefined,
    description: toStringOrNull(pick(row, ["description", "descripcion"])) ?? undefined,
    product_type: toProductType(pick(row, ["product_type", "tipo_producto"])),
    images,
    specifications: toSpecifications(pick(row, ["specifications", "specs", "specs_csv"])),
    is_featured: toBoolean(pick(row, ["is_featured", "destacado"]), false),
    is_new: toBoolean(pick(row, ["is_new", "nuevo"]), false),
    is_sale:
      toBoolean(pick(row, ["is_sale", "oferta"]), false) ||
      (typeof oldPrice === "number" && oldPrice > price),
    stock_status: stockStatus,
    stock_qty: stockQty,
    active: toBoolean(pick(row, ["active", "activo"]), true),
    created_at: toStringOrNull(pick(row, ["created_at", "creado_en", "fecha_creacion"])),
    updated_at: toStringOrNull(pick(row, ["updated_at", "actualizado_en", "fecha_actualizacion"])),
  };
}

export function adaptSheetRowsToProducts(rows: RawProductRow[], options?: { includeInactive?: boolean }): Product[] {
  return rows
    .map(adaptSheetRowToProduct)
    .filter((product): product is Product => Boolean(product))
    .filter((product) => (options?.includeInactive ? true : product.active !== false));
}

export function getStockLabel(product: Pick<Product, "stock_status" | "stock_qty">): string {
  if (product.stock_status === "out_of_stock") return "Sin stock";
  if (typeof product.stock_qty === "number") {
    return product.stock_qty === 1 ? "Última unidad" : `${product.stock_qty} disponibles`;
  }
  if (product.stock_status === "preorder") return "Preventa";
  return "Disponible";
}

export function isProductPurchasable(product: Pick<Product, "stock_status" | "stock_qty">): boolean {
  if (product.stock_status === "out_of_stock") return false;
  if (typeof product.stock_qty === "number") return product.stock_qty > 0;
  return true;
}
