import type { AuthoritativeCatalogProduct } from "./getProducts";
import type { InventoryErrorCode } from "@/src/server/inventory/errors";
import {
  inventoryProductKey,
  isValidProductId,
  normalizeProductId,
  type InventoryDemandItem,
} from "@/src/server/inventory/items";

export type InvalidCheckoutProduct = {
  code: InventoryErrorCode;
  productId: string;
  name: string;
  requestedQty: number;
  availableQty: number | null;
  requestedPrice?: number;
  currentPrice?: number;
  stockStatus?: string;
  reason: "missing" | "out_of_stock" | "insufficient_stock" | "price_changed";
};

export type AuthoritativeCheckoutItem = {
  productId: string;
  title: string;
  unitPrice: number;
  qty: number;
  currency: "ARS";
};

export type AuthoritativeInventoryResult =
  | { ok: true; items: AuthoritativeCheckoutItem[] }
  | { ok: false; errors: InvalidCheckoutProduct[] };

const catalogProductId = (value: unknown) => {
  if (typeof value !== "string" && typeof value !== "number") return "";
  const normalized = normalizeProductId(String(value));
  return isValidProductId(normalized) ? normalized : "";
};

const catalogName = (value: unknown) =>
  typeof value === "string" && value.trim() ? value.trim() : "";

const catalogPrice = (value: unknown) =>
  typeof value === "number" && Number.isFinite(value) && value >= 0
    ? Number(value.toFixed(2))
    : null;

const catalogCurrency = (value: unknown) =>
  typeof value === "string" ? value.trim().toUpperCase() : "";

const safeStockStatus = (value: unknown) =>
  typeof value === "string" ? value.trim().toLowerCase() : undefined;

const safeAvailableQty = (value: unknown) =>
  typeof value === "number" && Number.isFinite(value) ? value : null;

const invalidProduct = (
  item: InventoryDemandItem,
  code: InventoryErrorCode,
  options: Partial<Omit<InvalidCheckoutProduct, "code" | "productId" | "requestedQty" | "reason">> & {
    reason: InvalidCheckoutProduct["reason"];
  },
): InvalidCheckoutProduct => ({
  code,
  productId: item.productId,
  name: options.name || item.productId,
  requestedQty: item.qty,
  availableQty: options.availableQty ?? null,
  reason: options.reason,
  ...(options.requestedPrice !== undefined ? { requestedPrice: options.requestedPrice } : {}),
  ...(options.currentPrice !== undefined ? { currentPrice: options.currentPrice } : {}),
  ...(options.stockStatus !== undefined ? { stockStatus: options.stockStatus } : {}),
});

export function validateAuthoritativeInventory(
  catalog: readonly AuthoritativeCatalogProduct[],
  requestedItems: readonly InventoryDemandItem[],
): AuthoritativeInventoryResult {
  const rowsByProductId = new Map<string, AuthoritativeCatalogProduct[]>();

  for (const product of catalog) {
    const productId = catalogProductId(product.id);
    if (!productId) continue;
    const key = inventoryProductKey(productId);
    const matches = rowsByProductId.get(key) ?? [];
    matches.push(product);
    rowsByProductId.set(key, matches);
  }

  const items: AuthoritativeCheckoutItem[] = [];
  const errors: InvalidCheckoutProduct[] = [];

  for (const requestedItem of requestedItems) {
    const matches = rowsByProductId.get(inventoryProductKey(requestedItem.productId)) ?? [];

    if (matches.length === 0) {
      errors.push(invalidProduct(requestedItem, "PRODUCT_NOT_FOUND", { reason: "missing" }));
      continue;
    }

    if (matches.length > 1) {
      errors.push(invalidProduct(requestedItem, "DUPLICATE_PRODUCT_ID", { reason: "missing" }));
      continue;
    }

    const product = matches[0];
    const productId = catalogProductId(product.id);
    const name = catalogName(product.name);
    const price = catalogPrice(product.price);
    const currency = catalogCurrency(product.currency);
    const stockStatus = safeStockStatus(product.stock_status);
    const availableQty = safeAvailableQty(product.stock_qty);
    const requestedPrice = requestedItem.requestedUnitPrices[0];

    if (!productId || !name || price === null || currency !== "ARS") {
      errors.push(
        invalidProduct(requestedItem, "INVENTORY_VALIDATION_FAILED", {
          name: name || requestedItem.productId,
          reason: "missing",
          availableQty,
          requestedPrice,
          ...(price !== null ? { currentPrice: price } : {}),
          ...(stockStatus ? { stockStatus } : {}),
        }),
      );
      continue;
    }

    if (product.active !== true) {
      errors.push(
        invalidProduct(requestedItem, "PRODUCT_INACTIVE", {
          name,
          reason: "out_of_stock",
          availableQty,
          requestedPrice,
          currentPrice: price,
          ...(stockStatus ? { stockStatus } : {}),
        }),
      );
      continue;
    }

    if (stockStatus !== "in_stock") {
      errors.push(
        invalidProduct(requestedItem, "PRODUCT_NOT_AVAILABLE", {
          name,
          reason: "out_of_stock",
          availableQty,
          requestedPrice,
          currentPrice: price,
          ...(stockStatus ? { stockStatus } : {}),
        }),
      );
      continue;
    }

    if (availableQty === null || !Number.isInteger(availableQty) || availableQty <= 0) {
      errors.push(
        invalidProduct(requestedItem, "INVALID_STOCK_QTY", {
          name,
          reason: "out_of_stock",
          availableQty,
          requestedPrice,
          currentPrice: price,
          stockStatus,
        }),
      );
      continue;
    }

    if (requestedItem.qty > availableQty) {
      errors.push(
        invalidProduct(requestedItem, "INSUFFICIENT_STOCK", {
          name,
          reason: "insufficient_stock",
          availableQty,
          requestedPrice,
          currentPrice: price,
          stockStatus,
        }),
      );
      continue;
    }

    const changedRequestedPrice = requestedItem.requestedUnitPrices.find((itemPrice) => itemPrice !== price);
    if (changedRequestedPrice !== undefined) {
      errors.push(
        invalidProduct(requestedItem, "PRICE_CHANGED", {
          name,
          reason: "price_changed",
          availableQty,
          requestedPrice: changedRequestedPrice,
          currentPrice: price,
          stockStatus,
        }),
      );
      continue;
    }

    items.push({
      productId,
      title: name,
      unitPrice: price,
      qty: requestedItem.qty,
      currency: "ARS",
    });
  }

  return errors.length > 0 ? { ok: false, errors } : { ok: true, items };
}

export function invalidProductsMessage(items: readonly InvalidCheckoutProduct[]) {
  const codes = new Set(items.map((item) => item.code));
  const hasStockProblem = codes.has("PRODUCT_NOT_AVAILABLE") ||
    codes.has("INVALID_STOCK_QTY") ||
    codes.has("INSUFFICIENT_STOCK");
  const hasPriceChange = codes.has("PRICE_CHANGED");
  const hasIntegrityProblem = codes.has("DUPLICATE_PRODUCT_ID") ||
    codes.has("INVENTORY_VALIDATION_FAILED");

  if (hasIntegrityProblem) {
    return "No pudimos validar el inventario en este momento. Intenta nuevamente más tarde.";
  }

  if (hasStockProblem && hasPriceChange) {
    return "Hay cambios en el carrito: algunos productos no tienen stock suficiente y otros cambiaron de precio.";
  }

  if (hasStockProblem) {
    return "Algunos productos no tienen stock suficiente. Ajusta el carrito para continuar.";
  }

  if (hasPriceChange) {
    return "El precio de algunos productos cambió. Revisa el carrito antes de continuar.";
  }

  return "Estos productos ya no están disponibles. Quitalos del carrito para continuar.";
}
