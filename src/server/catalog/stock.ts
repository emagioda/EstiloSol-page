import type { CatalogProduct } from "./getProducts";
import type { ParsedCheckoutItem } from "@/src/server/validation/payments";

export type InvalidCheckoutProduct = {
  productId: string;
  name: string;
  requestedQty: number;
  availableQty: number | null;
  requestedPrice?: number;
  currentPrice?: number;
  stockStatus?: string;
  reason: "missing" | "out_of_stock" | "insufficient_stock" | "price_changed";
};

const labelForMissing = (item: ParsedCheckoutItem) => item.name || item.productId;
const normalizePrice = (value: unknown) => {
  const price = Number(value);
  if (!Number.isFinite(price) || price < 0) return null;
  return Number(price.toFixed(2));
};

export function validateCatalogItem(
  catalog: Map<string, CatalogProduct>,
  item: ParsedCheckoutItem,
): InvalidCheckoutProduct | null {
  const product = catalog.get(item.productId);

  if (!product) {
    return {
      productId: item.productId,
      name: labelForMissing(item),
      requestedQty: item.qty,
      availableQty: null,
      requestedPrice: normalizePrice(item.unitPrice) ?? undefined,
      reason: "missing",
    };
  }

  if (product.stock_status === "out_of_stock") {
    return {
      productId: product.id,
      name: product.name,
      requestedQty: item.qty,
      availableQty: 0,
      requestedPrice: normalizePrice(item.unitPrice) ?? undefined,
      currentPrice: product.price,
      stockStatus: product.stock_status,
      reason: "out_of_stock",
    };
  }

  if (typeof product.stock_qty === "number" && item.qty > product.stock_qty) {
    return {
      productId: product.id,
      name: product.name,
      requestedQty: item.qty,
      availableQty: product.stock_qty,
      requestedPrice: normalizePrice(item.unitPrice) ?? undefined,
      currentPrice: product.price,
      stockStatus: product.stock_status,
      reason: "insufficient_stock",
    };
  }

  const requestedPrice = normalizePrice(item.unitPrice);
  if (requestedPrice !== null && requestedPrice !== product.price) {
    return {
      productId: product.id,
      name: product.name,
      requestedQty: item.qty,
      availableQty: product.stock_qty,
      requestedPrice,
      currentPrice: product.price,
      stockStatus: product.stock_status,
      reason: "price_changed",
    };
  }

  return null;
}

export function dedupeInvalidProducts(items: InvalidCheckoutProduct[]): InvalidCheckoutProduct[] {
  return Array.from(new Map(items.map((item) => [item.productId, item])).values());
}

export function invalidProductsMessage(items: InvalidCheckoutProduct[]) {
  const hasStockProblem = items.some(
    (item) => item.reason === "out_of_stock" || item.reason === "insufficient_stock",
  );
  const hasPriceChange = items.some((item) => item.reason === "price_changed");

  if (hasStockProblem && hasPriceChange) {
    return "Hay cambios en el carrito: algunos productos no tienen stock suficiente y otros cambiaron de precio.";
  }

  if (hasStockProblem) {
    return "Algunos productos no tienen stock suficiente. Ajusta el carrito para continuar.";
  }

  if (hasPriceChange) {
    return "El precio de algunos productos cambio. Revisa el carrito antes de continuar.";
  }

  return "Estos productos ya no estan disponibles. Quitalos del carrito para continuar.";
}
