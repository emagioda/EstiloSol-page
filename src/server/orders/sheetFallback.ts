import type { AdminOrderItem } from "@/src/server/sheets/repository";
import type { OrderDeliveryMethod, OrderFulfillment, OrderItem } from "./types";

const normalizeKey = (value: string) =>
  value
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");

const normalizeRawRow = (raw: Record<string, unknown>): Record<string, unknown> =>
  Object.fromEntries(Object.entries(raw).map(([key, value]) => [normalizeKey(key), value]));

const toText = (value: unknown): string => {
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return "";
};

const toNumber = (value: unknown): number => {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const normalized = value.trim();
    if (normalized) {
      const numeric = normalized.replace(/[^0-9.-]+/g, "");
      if (!numeric || numeric === "-" || numeric === "." || numeric === "-.") {
        return Number.NaN;
      }
      const parsed = Number(numeric);
      if (Number.isFinite(parsed)) return parsed;
    }
  }
  return Number.NaN;
};

const toBoolean = (value: unknown): boolean => {
  if (value === true) return true;
  if (typeof value === "number") return value !== 0;
  const normalized = String(value ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim();
  return ["1", "true", "verdadero", "si", "yes", "active", "activo"].includes(normalized);
};

export const parseFallbackOrderFulfillment = (
  raw: Record<string, unknown>,
  deliveryMethod: OrderDeliveryMethod | undefined
): OrderFulfillment | undefined => {
  if (deliveryMethod !== "delivery" && deliveryMethod !== "pickup") return undefined;

  const row = normalizeRawRow(raw);
  const fulfillment: OrderFulfillment = {
    subtotalProducts: toNumber(row.subtotal_productos),
    discountAmount: toNumber(row.descuento),
    shippingFee: toNumber(row.costo_envio),
    finalTotal: toNumber(row.total_final),
    summary: toText(row.fulfillment_summary),
  };

  if (deliveryMethod === "delivery") {
    fulfillment.deliveryZone = {
      id: toText(row.delivery_zone_id),
      name: toText(row.delivery_zone_name),
      insideZoneConfirmed: toBoolean(row.delivery_inside_zone_confirmed),
    };
    fulfillment.deliveryAddress = {
      street: toText(row.delivery_address_street),
      number: toText(row.delivery_address_number),
      betweenStreets: toText(row.delivery_address_between_streets),
      ...(toText(row.delivery_address_floor) ? { floor: toText(row.delivery_address_floor) } : {}),
      ...(toText(row.delivery_address_notes) ? { notes: toText(row.delivery_address_notes) } : {}),
    };
    return fulfillment;
  }

  fulfillment.pickupPoint = {
    id: toText(row.pickup_point_id),
    name: toText(row.pickup_point_name),
    address: toText(row.pickup_point_address),
    reference: toText(row.pickup_point_reference),
  };
  return fulfillment;
};

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
