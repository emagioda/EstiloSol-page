"use client";

import type { CartItem, PaymentMethod } from "../../view-models/useCartStore";

export type DeliveryMethod = "delivery" | "pickup";

export type CheckoutContactDraft = {
  firstName: string;
  lastName: string;
  whatsapp: string;
  email: string;
  notes: string;
  deliveryMethod: DeliveryMethod;
  step1Completed: boolean;
  paymentMethod: PaymentMethod;
};

const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export const formatMoney = (value: number) =>
  new Intl.NumberFormat("es-AR", {
    style: "currency",
    currency: "ARS",
    maximumFractionDigits: 0,
  }).format(Math.round(value));

export const isDiscountPaymentMethod = (paymentMethod: PaymentMethod) =>
  paymentMethod === "cash" || paymentMethod === "transfer";

export const sanitizeText = (value: unknown, maxLength: number) => {
  if (typeof value !== "string") return "";

  return value
    .replace(/[\u0000-\u001F\u007F]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxLength);
};

export const normalizePhoneDigits = (value: string) => value.replace(/\D/g, "");

export const isValidWhatsapp = (value: string) => {
  const digits = normalizePhoneDigits(value);
  return digits.length >= 10 && digits.length <= 15;
};

export const isValidEmail = (value: string) => emailPattern.test(value.trim());

export const paymentMethodLabel = (paymentMethod: PaymentMethod) => {
  if (paymentMethod === "cash") return "Efectivo";
  if (paymentMethod === "transfer") return "Transferencia bancaria";
  return "Mercado Pago / Tarjetas";
};

export const deliveryMethodLabel = (deliveryMethod: DeliveryMethod) =>
  deliveryMethod === "delivery" ? "Envio a domicilio" : "Punto de retiro";

export const buildWhatsappMessage = ({
  items,
  paymentMethod,
  finalTotal,
  fullName,
  whatsapp,
  email,
  deliveryMethod,
  notes,
}: {
  items: CartItem[];
  paymentMethod: PaymentMethod;
  finalTotal: number;
  fullName: string;
  whatsapp: string;
  email: string;
  deliveryMethod: DeliveryMethod;
  notes: string;
}) => {
  const orderLines = items.map((item) => `- ${item.qty}x ${item.name}`).join("\n");
  const paymentText = paymentMethodLabel(paymentMethod).toLowerCase();
  const closingLine =
    paymentMethod === "transfer"
      ? "Adjunto el comprobante."
      : paymentMethod === "cash"
      ? "Quiero coordinar el pago en efectivo."
      : "Quiero continuar con el pago.";

  return [
    `Hola, quiero finalizar mi pedido con pago por ${paymentText}.`,
    "",
    `Total: ${formatMoney(finalTotal)}`,
    "",
    "Detalle del pedido:",
    orderLines || "- Sin productos",
    fullName ? `Nombre: ${fullName}` : "",
    whatsapp ? `WhatsApp: ${whatsapp}` : "",
    email ? `Email: ${email}` : "",
    `Entrega: ${deliveryMethodLabel(deliveryMethod)}`,
    notes ? `Notas: ${notes}` : "",
    "",
    closingLine,
  ]
    .filter((line, index, all) => !(line === "" && all[index - 1] === ""))
    .join("\n");
};
