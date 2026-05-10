import type { CatalogProduct } from "./getProducts";
import type { ParsedCheckoutItem } from "@/src/server/validation/payments";

export type InvalidCheckoutProduct = {
  productId: string;
  name: string;
  requestedQty: number;
  availableQty: number | null;
  reason: "missing" | "out_of_stock" | "insufficient_stock";
};

const labelForMissing = (item: ParsedCheckoutItem) => item.name || item.productId;

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
      reason: "missing",
    };
  }

  if (product.stock_status === "out_of_stock") {
    return {
      productId: product.id,
      name: product.name,
      requestedQty: item.qty,
      availableQty: 0,
      reason: "out_of_stock",
    };
  }

  if (typeof product.stock_qty === "number" && item.qty > product.stock_qty) {
    return {
      productId: product.id,
      name: product.name,
      requestedQty: item.qty,
      availableQty: product.stock_qty,
      reason: "insufficient_stock",
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

  if (hasStockProblem) {
    return "Algunos productos no tienen stock suficiente. Ajusta el carrito para continuar.";
  }

  return "Estos productos ya no estan disponibles. Quitalos del carrito para continuar.";
}
