import { env } from "@/src/config/env";
import type { Order } from "@/src/server/orders/types";

type SendOrderReceiptEmailInput = {
  order: Order;
  paymentId?: string | number;
  approvedAt: number;
};

export type SendOrderReceiptEmailResult =
  | { sent: true }
  | {
      sent: false;
      reason: "missing_customer_email" | "invalid_customer_email" | "resend_not_configured" | "send_failed";
      detail?: string;
    };

const RECEIPT_DATE_TIME_FORMATTER = new Intl.DateTimeFormat("es-AR", {
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hour12: false,
});

const formatMoney = (value: number) =>
  new Intl.NumberFormat("es-AR", {
    style: "currency",
    currency: "ARS",
    maximumFractionDigits: 0,
  }).format(value);

const escapeHtml = (value: string) =>
  value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");

const isValidEmail = (value: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);

export const formatDateTime24h = (timestamp: number) => RECEIPT_DATE_TIME_FORMATTER.format(new Date(timestamp));

export const sendOrderReceiptEmail = async (
  input: SendOrderReceiptEmailInput
): Promise<SendOrderReceiptEmailResult> => {
  const customerEmail = input.order.customer?.email?.trim().toLowerCase() || "";
  if (!customerEmail) {
    return { sent: false, reason: "missing_customer_email" };
  }

  if (!isValidEmail(customerEmail)) {
    return { sent: false, reason: "invalid_customer_email" };
  }

  const resendApiKey = env.getOptionalServer("RESEND_API_KEY");
  const fromEmail = env.getOptionalServer("CONTACT_FROM_EMAIL") || "Estilo Sol <onboarding@resend.dev>";
  if (!resendApiKey) {
    return { sent: false, reason: "resend_not_configured" };
  }

  const paymentDateText = formatDateTime24h(input.approvedAt);
  const paymentIdText = String(input.paymentId || input.order.mpPaymentId || "N/A");
  const customerName = input.order.customer?.name?.trim() || "cliente";
  const itemsText = input.order.items
    .map((item) => `- ${item.qty} x ${item.title} (${formatMoney(item.unitPrice)} c/u)`)
    .join("\n");
  const orderTotal = formatMoney(input.order.total);

  const subject = `Comprobante de compra Estilo Sol - ${input.order.externalReference}`;
  const text = [
    `Hola ${customerName},`,
    "",
    "Gracias por tu compra. Tu pago fue confirmado.",
    "",
    `Referencia: ${input.order.externalReference}`,
    `ID de pago: ${paymentIdText}`,
    `Fecha: ${paymentDateText}`,
    `Total: ${orderTotal}`,
    "",
    "Resumen del pedido:",
    itemsText || "- Sin items",
    "",
    "Conserva este email como comprobante de compra.",
  ].join("\n");

  const itemsHtml = input.order.items
    .map(
      (item) =>
        `<li>${escapeHtml(`${item.qty} x ${item.title}`)} (${escapeHtml(formatMoney(item.unitPrice))} c/u)</li>`
    )
    .join("");

  const html = `
    <div style="font-family: Arial, sans-serif; color: #1f2937; line-height: 1.45;">
      <h2 style="margin: 0 0 12px;">Comprobante de compra - Estilo Sol</h2>
      <p style="margin: 0 0 12px;">Hola ${escapeHtml(customerName)}, tu pago fue confirmado.</p>
      <p style="margin: 0 0 6px;"><strong>Referencia:</strong> ${escapeHtml(input.order.externalReference)}</p>
      <p style="margin: 0 0 6px;"><strong>ID de pago:</strong> ${escapeHtml(paymentIdText)}</p>
      <p style="margin: 0 0 6px;"><strong>Fecha:</strong> ${escapeHtml(paymentDateText)}</p>
      <p style="margin: 0 0 14px;"><strong>Total:</strong> ${escapeHtml(orderTotal)}</p>
      <h3 style="margin: 0 0 8px;">Resumen del pedido</h3>
      <ul style="margin: 0 0 14px; padding-left: 18px;">
        ${itemsHtml || "<li>Sin items</li>"}
      </ul>
      <p style="margin: 0; color: #4b5563;">Conserva este email como comprobante de compra.</p>
    </div>
  `;

  const resendResponse = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${resendApiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: fromEmail,
      to: [customerEmail],
      subject,
      text,
      html,
    }),
  });

  if (!resendResponse.ok) {
    return {
      sent: false,
      reason: "send_failed",
      detail: await resendResponse.text().catch(() => undefined),
    };
  }

  return { sent: true };
};
