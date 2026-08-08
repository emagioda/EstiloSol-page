import type { AdminOrderItem } from "@/src/server/sheets/repository";
import type { OrderItem } from "./types";

export const parseFallbackOrderItems = (
  raw: Record<string, unknown>,
  sheetItems: AdminOrderItem[]
): OrderItem[] => {
  const itemsRaw = raw.items_json;
  if (typeof itemsRaw === "string" && itemsRaw.trim()) {
    try {
      const parsed = JSON.parse(itemsRaw) as Array<Record<string, unknown>>;
      if (Array.isArray(parsed)) {
        return parsed.map((item) => ({
          productId: String(item.productId ?? item.product_id ?? "").trim(),
          title: String(item.title ?? item.name ?? "").trim(),
          qty: Number(item.qty),
          unitPrice: Number(item.unitPrice ?? item.unit_price),
          currency: "ARS" as const,
        }));
      }
    } catch {
      // Fall through to the visible Sheet items. Missing ids remain missing and fail closed later.
    }
  }

  return sheetItems.map((item) => ({
    productId: item.productId,
    title: item.title,
    qty: item.qty,
    unitPrice: typeof item.unitPrice === "number" ? item.unitPrice : 0,
    currency: "ARS" as const,
  }));
};
