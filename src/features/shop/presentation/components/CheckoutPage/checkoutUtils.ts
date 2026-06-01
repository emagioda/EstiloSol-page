"use client";

import type { CartItem, PaymentMethod } from "../../view-models/useCartStore";
import { fallbackFulfillmentConfig, getShippingFeeForDeliveryMethod, type FulfillmentConfig } from "@/src/config/fulfillment";

export type DeliveryMethod = "delivery" | "pickup";

export type DeliveryAddress = {
  street: string;
  number: string;
  floor?: string;
  betweenStreets: string;
  notes?: string;
  insideZoneConfirmed: boolean;
};

export type CheckoutFulfillmentDraft = {
  deliveryAddress?: DeliveryAddress;
  pickupPointId?: string;
};

export type CheckoutContactDraft = {
  firstName: string;
  lastName: string;
  whatsapp: string;
  email: string;
  notes: string;
  deliveryMethod: DeliveryMethod;
  deliveryAddress?: DeliveryAddress;
  pickupPointId?: string;
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

export const getPaymentDiscountAmount = (subtotalProducts: number, paymentMethod: PaymentMethod) => {
  if (!isDiscountPaymentMethod(paymentMethod)) return 0;
  return Math.round(subtotalProducts * 0.1);
};

export const getCheckoutTotals = ({
  subtotalProducts,
  paymentMethod,
  deliveryMethod,
  fulfillmentConfig,
  pickupPointId,
}: {
  subtotalProducts: number;
  paymentMethod: PaymentMethod;
  deliveryMethod: DeliveryMethod;
  fulfillmentConfig?: FulfillmentConfig;
  pickupPointId?: string;
}) => {
  const discountAmount = getPaymentDiscountAmount(subtotalProducts, paymentMethod);
  const shippingFee =
    subtotalProducts > 0
      ? getShippingFeeForDeliveryMethod(
          deliveryMethod,
          fulfillmentConfig ?? fallbackFulfillmentConfig,
          pickupPointId
        )
      : 0;
  const finalTotal = Math.max(0, subtotalProducts - discountAmount + shippingFee);

  return {
    subtotalProducts,
    discountAmount,
    shippingFee,
    finalTotal,
  };
};

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
  deliveryMethod === "delivery" ? "Envío a domicilio" : "Punto de encuentro coordinado";

export const fulfillmentFeeLabel = (_deliveryMethod: DeliveryMethod, shippingFee: number) => {
  if (shippingFee > 0) return formatMoney(shippingFee);
  return "Gratis";
};

export const buildWhatsappMessage = ({
  items,
  paymentMethod,
  finalTotal,
  fullName,
  whatsapp,
  email,
  deliveryMethod,
  notes,
  externalReference,
}: {
  items: CartItem[];
  paymentMethod: PaymentMethod;
  finalTotal: number;
  fullName: string;
  whatsapp: string;
  email: string;
  deliveryMethod: DeliveryMethod;
  notes: string;
  externalReference?: string;
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
    externalReference ? `Pedido: ${externalReference}` : "",
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
