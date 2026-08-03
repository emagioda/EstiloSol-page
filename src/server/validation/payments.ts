import type { OrderDeliveryMethod, OrderPaymentMethod } from "@/src/server/orders/types";
import type { InventoryErrorCode } from "@/src/server/inventory/errors";
import {
  aggregateInventoryItems,
  isValidProductId,
  MAX_CHECKOUT_LINES,
  MAX_QUANTITY_PER_PRODUCT,
  normalizeProductId,
  type InventoryDemandItem,
  type ParsedInventoryItem,
} from "@/src/server/inventory/items";

type CheckoutBodyInput = {
  items?: unknown;
  paymentMethod?: unknown;
  deliveryMethod?: unknown;
  fulfillment?: unknown;
  checkoutAttemptId?: unknown;
  payer?: {
    name?: unknown;
    phone?: unknown;
    email?: unknown;
  };
  notes?: unknown;
};

export type ParsedCheckoutItem = InventoryDemandItem;

export type ParsedDeliveryAddress = {
  street: string;
  number: string;
  floor: string;
  betweenStreets: string;
  notes: string;
  insideZoneConfirmed: boolean;
};

export type ParsedCheckoutFulfillment = {
  deliveryAddress?: ParsedDeliveryAddress;
  pickupPointId?: string;
};

export type ParsedCheckoutBody = {
  items: ParsedCheckoutItem[];
  paymentMethod: OrderPaymentMethod | null;
  deliveryMethod: OrderDeliveryMethod | null;
  fulfillment: ParsedCheckoutFulfillment;
  payerName: string;
  payerPhone: string;
  payerEmail: string;
  notes: string;
  checkoutAttemptId?: string;
};

export type ValidationResult<T> =
  | { ok: true; value: T }
  | {
      ok: false;
      message: string;
      code?: InventoryErrorCode;
      itemIndex?: number;
      productId?: string;
    };

type ParseCheckoutOptions = {
  requirePayer?: boolean;
  requireFulfillment?: boolean;
};

const CHECKOUT_ITEM_KEYS = new Set(["productId", "qty", "name", "unitPrice"]);

const sanitizeText = (value: unknown, maxLength: number) => {
  if (typeof value !== "string") return "";

  return value
    .replace(/[\u0000-\u001F\u007F]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxLength);
};

const normalizePrice = (value: unknown) => {
  if (value === undefined || value === null || value === "") return undefined;
  if (typeof value !== "number") return null;
  const price = value;
  if (!Number.isFinite(price) || price < 0) return null;
  return Number(price.toFixed(2));
};

const parseCheckoutItems = (items: unknown): ValidationResult<ParsedCheckoutItem[]> => {
  if (!Array.isArray(items) || items.length === 0) {
    return { ok: false, code: "INVALID_ITEMS", message: "El carrito no contiene productos válidos." };
  }

  if (items.length > MAX_CHECKOUT_LINES) {
    return {
      ok: false,
      code: "TOO_MANY_ITEMS",
      message: `El carrito no puede superar las ${MAX_CHECKOUT_LINES} líneas.`,
    };
  }

  const parsedItems: ParsedInventoryItem[] = [];

  for (let itemIndex = 0; itemIndex < items.length; itemIndex += 1) {
    const rawItem = items[itemIndex];
    if (!rawItem || typeof rawItem !== "object" || Array.isArray(rawItem)) {
      return {
        ok: false,
        code: "INVALID_ITEMS",
        itemIndex,
        message: `La línea ${itemIndex + 1} del carrito tiene una estructura inválida.`,
      };
    }

    const item = rawItem as Record<string, unknown>;
    if (Object.keys(item).some((key) => !CHECKOUT_ITEM_KEYS.has(key))) {
      return {
        ok: false,
        code: "INVALID_ITEMS",
        itemIndex,
        message: `La línea ${itemIndex + 1} del carrito tiene una estructura inválida.`,
      };
    }

    const productId = typeof item.productId === "string"
      ? normalizeProductId(sanitizeText(item.productId, 120))
      : "";
    const safeProductId = isValidProductId(productId) ? productId : undefined;

    if (!safeProductId) {
      return {
        ok: false,
        code: "INVALID_ITEMS",
        itemIndex,
        message: `La línea ${itemIndex + 1} no tiene un identificador de producto válido.`,
      };
    }

    const qty = item.qty;
    if (
      typeof qty !== "number" ||
      !Number.isFinite(qty) ||
      !Number.isInteger(qty) ||
      qty < 1 ||
      qty > MAX_QUANTITY_PER_PRODUCT
    ) {
      return {
        ok: false,
        code: "INVALID_QUANTITY",
        itemIndex,
        productId: safeProductId,
        message: `La cantidad de la línea ${itemIndex + 1} es inválida.`,
      };
    }

    if (item.name !== undefined && typeof item.name !== "string") {
      return {
        ok: false,
        code: "INVALID_ITEMS",
        itemIndex,
        productId: safeProductId,
        message: `La línea ${itemIndex + 1} del carrito tiene una estructura inválida.`,
      };
    }

    const unitPrice = normalizePrice(item.unitPrice);
    if (unitPrice === null) {
      return {
        ok: false,
        code: "INVALID_ITEMS",
        itemIndex,
        productId: safeProductId,
        message: `El precio informado en la línea ${itemIndex + 1} es inválido.`,
      };
    }

    parsedItems.push({
      productId: safeProductId,
      qty,
      ...(unitPrice !== undefined ? { unitPrice } : {}),
    });
  }

  const aggregated = aggregateInventoryItems(parsedItems);
  if (!aggregated.ok) {
    return { ok: false, ...aggregated.error };
  }

  return { ok: true, value: aggregated.items };
};

const normalizeCheckoutAttemptId = (value: unknown) => {
  if (value === undefined || value === null || value === "") return undefined;
  const attemptId = sanitizeText(value, 120);
  if (!/^[a-zA-Z0-9_-]{8,120}$/.test(attemptId)) return null;
  return attemptId;
};

const isValidEmail = (value: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);

const parsePaymentMethod = (value: unknown): OrderPaymentMethod | null => {
  if (typeof value !== "string") return null;
  const normalized = value.trim().toLowerCase();
  if (normalized === "mercadopago" || normalized === "cash" || normalized === "transfer") {
    return normalized;
  }
  return null;
};

const parseDeliveryMethod = (value: unknown): OrderDeliveryMethod | null => {
  if (typeof value !== "string") return null;
  const normalized = value.trim().toLowerCase();
  if (normalized === "delivery" || normalized === "pickup") {
    return normalized;
  }
  return null;
};

const parseFulfillment = (
  value: unknown,
  deliveryMethod: OrderDeliveryMethod | null,
  requireFulfillment: boolean
): ValidationResult<ParsedCheckoutFulfillment> => {
  const body = value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};

  if (!deliveryMethod) {
    if (requireFulfillment) return { ok: false, message: "Metodo de entrega invalido" };
    return { ok: true, value: {} };
  }

  if (deliveryMethod === "delivery") {
    const rawAddress =
      body.deliveryAddress && typeof body.deliveryAddress === "object" && !Array.isArray(body.deliveryAddress)
        ? (body.deliveryAddress as Record<string, unknown>)
        : {};

    const deliveryAddress: ParsedDeliveryAddress = {
      street: sanitizeText(rawAddress.street, 80),
      number: sanitizeText(rawAddress.number, 20),
      floor: sanitizeText(rawAddress.floor, 30),
      betweenStreets: sanitizeText(rawAddress.betweenStreets, 120),
      notes: sanitizeText(rawAddress.notes, 180),
      insideZoneConfirmed: rawAddress.insideZoneConfirmed === true,
    };

    if (requireFulfillment) {
      if (!deliveryAddress.street) return { ok: false, message: "Ingresá la calle." };
      if (!deliveryAddress.number) return { ok: false, message: "Ingresá el número." };
      if (!deliveryAddress.betweenStreets) return { ok: false, message: "Ingresá las calles de referencia." };
      if (!deliveryAddress.insideZoneConfirmed) {
        return { ok: false, message: "Confirmá que la dirección está dentro de la zona de envío." };
      }
    }

    return { ok: true, value: { deliveryAddress } };
  }

  const pickupPointId = sanitizeText(body.pickupPointId, 80);
  if (!pickupPointId) {
    return requireFulfillment
      ? { ok: false, message: "Elegí un punto de encuentro." }
      : { ok: true, value: {} };
  }

  return { ok: true, value: { pickupPointId } };
};

export const parseExternalReference = (value: string | null): ValidationResult<string> => {
  const ref = typeof value === "string" ? value.trim() : "";
  if (!ref) return { ok: false, message: "Missing ref parameter" };
  if (!/^es-[a-z0-9-]{6,80}$/i.test(ref)) {
    return { ok: false, message: "Invalid ref parameter" };
  }
  return { ok: true, value: ref };
};

export const parseCheckoutBody = (
  rawBody: unknown,
  options: ParseCheckoutOptions = {}
): ValidationResult<ParsedCheckoutBody> => {
  if (!rawBody || typeof rawBody !== "object") {
    return { ok: false, message: "Invalid JSON body" };
  }

  const body = rawBody as CheckoutBodyInput;

  const parsedItems = parseCheckoutItems(body.items);
  if (!parsedItems.ok) return parsedItems;

  const payerName = sanitizeText(body.payer?.name, 100);
  const payerPhone = sanitizeText(body.payer?.phone, 30).replace(/[^\d+]/g, "");
  const payerEmail = sanitizeText(body.payer?.email, 120).toLowerCase();
  const notes = sanitizeText(body.notes, 250);
  const paymentMethod = parsePaymentMethod(body.paymentMethod);
  const deliveryMethod = parseDeliveryMethod(body.deliveryMethod);
  const checkoutAttemptId = normalizeCheckoutAttemptId(body.checkoutAttemptId);

  if (body.paymentMethod !== undefined && !paymentMethod) {
    return { ok: false, message: "Metodo de pago invalido" };
  }

  if (body.deliveryMethod !== undefined && !deliveryMethod) {
    return { ok: false, message: "Metodo de entrega invalido" };
  }

  if (checkoutAttemptId === null) {
    return { ok: false, message: "Intento de checkout invalido" };
  }

  const parsedFulfillment = parseFulfillment(
    body.fulfillment,
    deliveryMethod,
    Boolean(options.requireFulfillment)
  );
  if (!parsedFulfillment.ok) {
    return { ok: false, message: parsedFulfillment.message };
  }

  if (options.requirePayer && (!payerName || payerPhone.replace(/\D/g, "").length < 8)) {
    return { ok: false, message: "Completa nombre y WhatsApp para continuar" };
  }

  if (payerEmail && !isValidEmail(payerEmail)) {
    return { ok: false, message: "Ingresa un email valido para recibir el comprobante." };
  }

  return {
    ok: true,
    value: {
      items: parsedItems.value,
      paymentMethod,
      deliveryMethod,
      fulfillment: parsedFulfillment.value,
      payerName,
      payerPhone,
      payerEmail,
      notes,
      ...(checkoutAttemptId ? { checkoutAttemptId } : {}),
    },
  };
};
