import type { OrderDeliveryMethod, OrderPaymentMethod } from "@/src/server/orders/types";

type CheckoutItemInput = {
  productId?: unknown;
  qty?: unknown;
  name?: unknown;
};

type CheckoutBodyInput = {
  items?: unknown;
  paymentMethod?: unknown;
  deliveryMethod?: unknown;
  payer?: {
    name?: unknown;
    phone?: unknown;
    email?: unknown;
  };
  notes?: unknown;
};

export type ParsedCheckoutItem = {
  productId: string;
  qty: number;
  name?: string;
};

export type ParsedCheckoutBody = {
  items: ParsedCheckoutItem[];
  paymentMethod: OrderPaymentMethod | null;
  deliveryMethod: OrderDeliveryMethod | null;
  payerName: string;
  payerPhone: string;
  payerEmail: string;
  notes: string;
};

export type ValidationResult<T> =
  | { ok: true; value: T }
  | { ok: false; message: string };

type ParseCheckoutOptions = {
  requirePayer?: boolean;
};

const MAX_ITEMS = 30;

const sanitizeText = (value: unknown, maxLength: number) => {
  if (typeof value !== "string") return "";

  return value
    .replace(/[\u0000-\u001F\u007F]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxLength);
};

const normalizeQuantity = (value: unknown) => {
  const quantity = Number(value);
  if (!Number.isInteger(quantity)) return null;
  if (quantity < 1 || quantity > 50) return null;
  return quantity;
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

  if (!Array.isArray(body.items) || body.items.length === 0 || body.items.length > MAX_ITEMS) {
    return { ok: false, message: "Invalid cart items" };
  }

  const parsedItems = body.items
    .map((item): CheckoutItemInput => (item && typeof item === "object" ? item : {}))
    .map((item) => {
      const productId = sanitizeText(item.productId, 120);
      const qty = normalizeQuantity(item.qty);
      const name = sanitizeText(item.name, 120);
      if (!productId || !qty) return null;
      return {
        productId,
        qty,
        ...(name ? { name } : {}),
      };
    })
    .filter((item): item is ParsedCheckoutItem => item !== null);

  if (parsedItems.length === 0) {
    return { ok: false, message: "Invalid cart items" };
  }

  const payerName = sanitizeText(body.payer?.name, 100);
  const payerPhone = sanitizeText(body.payer?.phone, 30).replace(/[^\d+]/g, "");
  const payerEmail = sanitizeText(body.payer?.email, 120).toLowerCase();
  const notes = sanitizeText(body.notes, 250);
  const paymentMethod = parsePaymentMethod(body.paymentMethod);
  const deliveryMethod = parseDeliveryMethod(body.deliveryMethod);

  if (body.paymentMethod !== undefined && !paymentMethod) {
    return { ok: false, message: "Metodo de pago invalido" };
  }

  if (body.deliveryMethod !== undefined && !deliveryMethod) {
    return { ok: false, message: "Metodo de entrega invalido" };
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
      items: parsedItems,
      paymentMethod,
      deliveryMethod,
      payerName,
      payerPhone,
      payerEmail,
      notes,
    },
  };
};
