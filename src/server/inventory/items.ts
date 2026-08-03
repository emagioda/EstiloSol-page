import type { InventoryErrorDetail } from "./errors";

export const MAX_CHECKOUT_LINES = 30;
export const MAX_QUANTITY_PER_PRODUCT = 50;
export const MAX_PRODUCT_ID_LENGTH = 120;

export type ParsedInventoryItem = {
  productId: string;
  qty: number;
  unitPrice?: number;
};

export type InventoryDemandItem = {
  productId: string;
  qty: number;
  requestedUnitPrices: number[];
};

export type AggregateInventoryResult =
  | { ok: true; items: InventoryDemandItem[] }
  | { ok: false; error: InventoryErrorDetail };

export const normalizeProductId = (value: string) => value.trim();

export const inventoryProductKey = (value: string) => normalizeProductId(value).toLowerCase();

export const isValidProductId = (value: string) =>
  value.length > 0 &&
  value.length <= MAX_PRODUCT_ID_LENGTH &&
  /^[a-zA-Z0-9][a-zA-Z0-9._:-]*$/.test(value);

const normalizedPrice = (price: number) => Number(price.toFixed(2));

export function aggregateInventoryItems(
  items: readonly ParsedInventoryItem[],
  maxQuantity = MAX_QUANTITY_PER_PRODUCT,
): AggregateInventoryResult {
  const demandsByKey = new Map<string, InventoryDemandItem>();

  for (const item of items) {
    const productId = normalizeProductId(item.productId);
    const key = inventoryProductKey(productId);
    const existing = demandsByKey.get(key);
    const nextQty = (existing?.qty ?? 0) + item.qty;

    if (!Number.isSafeInteger(nextQty) || nextQty > maxQuantity) {
      return {
        ok: false,
        error: {
          code: "AGGREGATED_QUANTITY_LIMIT",
          message: `La cantidad total solicitada para ${productId} supera el máximo permitido.`,
          productId,
        },
      };
    }

    const requestedUnitPrices = existing?.requestedUnitPrices ?? [];
    if (item.unitPrice !== undefined) {
      const price = normalizedPrice(item.unitPrice);
      if (!requestedUnitPrices.includes(price)) requestedUnitPrices.push(price);
    }

    if (existing) {
      existing.qty = nextQty;
      continue;
    }

    demandsByKey.set(key, {
      productId,
      qty: nextQty,
      requestedUnitPrices,
    });
  }

  return { ok: true, items: Array.from(demandsByKey.values()) };
}
