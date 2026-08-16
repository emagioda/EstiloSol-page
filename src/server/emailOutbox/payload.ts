import "server-only";

import { createHash } from "node:crypto";
import brandConfig from "@/src/config/brand";
import { env } from "@/src/config/env";
import type { Order } from "@/src/server/orders/types";
import {
  PURCHASE_RECEIPT_TEMPLATE_VERSION,
  type MissingReceiptCandidate,
  type PurchaseReceiptPayloadV1,
} from "./types";

const canonicalize = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") {
    return Object.keys(value as Record<string, unknown>)
      .sort()
      .reduce<Record<string, unknown>>((result, key) => {
        result[key] = canonicalize((value as Record<string, unknown>)[key]);
        return result;
      }, {});
  }
  return value;
};

export const canonicalEmailPayloadJson = (payload: PurchaseReceiptPayloadV1): string =>
  JSON.stringify(canonicalize(payload));

export const hashEmailPayload = (payloadJson: string): string =>
  createHash("sha256").update(payloadJson, "utf8").digest("hex");

export const buildPurchaseReceiptEventKey = (externalReference: string): string => {
  const key = `purchase-receipt/${externalReference}/v1`;
  if (!externalReference || key.length > 256) throw new Error("EMAIL_OUTBOX_EVENT_ID_INVALID");
  return key;
};

const receiptBrandFields = (externalReference: string) => {
  const appBaseUrl = env.getOptionalServer("APP_BASE_URL")?.replace(/\/$/, "") ?? "";
  return {
    brandName: brandConfig.brandName,
    supportEmail: brandConfig.contactInfo.email,
    supportWhatsappLabel:
      brandConfig.contactInfo.socialNetworks.find((network) => network.icon === "whatsapp")?.label ?? "",
    logoUrl:
      appBaseUrl && brandConfig.logo.isAvailable
        ? `${appBaseUrl}${brandConfig.logo.src}`
        : "",
    logoAlt: brandConfig.logo.alt || brandConfig.brandName,
    orderDetailUrl: appBaseUrl
      ? `${appBaseUrl}/tienda/success?ref=${encodeURIComponent(externalReference)}`
      : "",
  };
};

export const buildPurchaseReceiptPayload = (input: {
  order: Order;
  paymentId: string;
  approvedAt: number;
}): PurchaseReceiptPayloadV1 => ({
  externalReference: input.order.externalReference,
  recipientEmail: input.order.customer?.email?.trim().toLowerCase() ?? "",
  customerName: input.order.customer?.name?.trim() ?? "",
  paymentId: input.paymentId,
  approvedAt: input.approvedAt,
  items: input.order.items.map((item) => ({
    title: item.title,
    qty: item.qty,
    unitPrice: item.unitPrice,
    currency: item.currency,
  })),
  total: input.order.total,
  currency: input.order.currency,
  fromEmail:
    env.getOptionalServer("CONTACT_FROM_EMAIL") || "Estilo Sol <onboarding@resend.dev>",
  ...receiptBrandFields(input.order.externalReference),
  templateVersion: PURCHASE_RECEIPT_TEMPLATE_VERSION,
});

const candidateItems = (itemsJson: string): PurchaseReceiptPayloadV1["items"] => {
  const parsed = JSON.parse(itemsJson) as unknown;
  if (!Array.isArray(parsed) || parsed.length === 0) throw new Error("EMAIL_OUTBOX_PAYLOAD_INVALID");
  return parsed.map((value) => {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      throw new Error("EMAIL_OUTBOX_PAYLOAD_INVALID");
    }
    const item = value as Record<string, unknown>;
    const title = typeof item.title === "string" ? item.title.trim() : "";
    const qty = Number(item.qty);
    const unitPrice = Number(item.unitPrice ?? item.unit_price);
    if (!title || !Number.isInteger(qty) || qty <= 0 || !Number.isFinite(unitPrice) || unitPrice < 0) {
      throw new Error("EMAIL_OUTBOX_PAYLOAD_INVALID");
    }
    return { title, qty, unitPrice, currency: "ARS" as const };
  });
};

export const buildPurchaseReceiptPayloadFromCandidate = (
  candidate: MissingReceiptCandidate,
): PurchaseReceiptPayloadV1 => {
  const approvedAt = Date.parse(candidate.approvedAt);
  if (!Number.isFinite(approvedAt)) throw new Error("EMAIL_OUTBOX_PAYLOAD_INVALID");
  return {
    externalReference: candidate.externalReference,
    recipientEmail: candidate.recipientEmail.trim().toLowerCase(),
    customerName: candidate.customerName.trim(),
    paymentId: candidate.paymentId,
    approvedAt,
    items: candidateItems(candidate.itemsJson),
    total: candidate.total,
    currency: candidate.currency,
    fromEmail:
      env.getOptionalServer("CONTACT_FROM_EMAIL") || "Estilo Sol <onboarding@resend.dev>",
    ...receiptBrandFields(candidate.externalReference),
    templateVersion: PURCHASE_RECEIPT_TEMPLATE_VERSION,
  };
};

const isPayloadItem = (value: unknown): value is PurchaseReceiptPayloadV1["items"][number] => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const item = value as Record<string, unknown>;
  return (
    typeof item.title === "string" &&
    item.title.trim().length > 0 &&
    Number.isInteger(item.qty) &&
    Number(item.qty) > 0 &&
    Number.isFinite(item.unitPrice) &&
    Number(item.unitPrice) >= 0 &&
    item.currency === "ARS"
  );
};

export const parsePurchaseReceiptPayload = (
  payloadJson: string,
  expectedHash: string,
): PurchaseReceiptPayloadV1 => {
  if (!payloadJson || hashEmailPayload(payloadJson) !== expectedHash) {
    throw new Error("EMAIL_OUTBOX_EVENT_CONFLICT");
  }
  const parsed = JSON.parse(payloadJson) as unknown;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("EMAIL_OUTBOX_EVENT_CONFLICT");
  }
  const payload = parsed as Record<string, unknown>;
  if (
    typeof payload.externalReference !== "string" ||
    !payload.externalReference ||
    typeof payload.recipientEmail !== "string" ||
    typeof payload.customerName !== "string" ||
    typeof payload.paymentId !== "string" ||
    !payload.paymentId ||
    typeof payload.approvedAt !== "number" ||
    !Number.isFinite(payload.approvedAt) ||
    payload.approvedAt <= 0 ||
    !Array.isArray(payload.items) ||
    !payload.items.every(isPayloadItem) ||
    typeof payload.total !== "number" ||
    !Number.isFinite(payload.total) ||
    payload.total < 0 ||
    payload.currency !== "ARS" ||
    typeof payload.fromEmail !== "string" ||
    !payload.fromEmail ||
    typeof payload.brandName !== "string" ||
    !payload.brandName ||
    typeof payload.supportEmail !== "string" ||
    !payload.supportEmail ||
    typeof payload.supportWhatsappLabel !== "string" ||
    typeof payload.logoUrl !== "string" ||
    typeof payload.logoAlt !== "string" ||
    !payload.logoAlt ||
    typeof payload.orderDetailUrl !== "string" ||
    payload.templateVersion !== PURCHASE_RECEIPT_TEMPLATE_VERSION
  ) {
    throw new Error("EMAIL_OUTBOX_EVENT_CONFLICT");
  }
  return parsed as PurchaseReceiptPayloadV1;
};

const escapeHtml = (value: string) =>
  value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#39;");

const formatMoney = (value: number) =>
  new Intl.NumberFormat("es-AR", {
    style: "currency",
    currency: "ARS",
    maximumFractionDigits: 0,
  }).format(value);

const formatDateTime = (timestamp: number) =>
  new Intl.DateTimeFormat("es-AR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).format(new Date(timestamp));

export type RenderedPurchaseReceiptV1 = {
  from: string;
  to: string[];
  subject: string;
  text: string;
  html: string;
};

// Template v1 is immutable. Future receipt changes must introduce a new template version.
export const renderPurchaseReceiptV1 = (
  payload: PurchaseReceiptPayloadV1,
): RenderedPurchaseReceiptV1 => {
  const customerName = payload.customerName || "cliente";
  const itemsText = payload.items
    .map((item) => `- ${item.qty} x ${item.title} (${formatMoney(item.unitPrice)} c/u)`)
    .join("\n");
  const itemRows = payload.items.map((item) => {
    const qtyText = String(item.qty);
    const unitPriceText = formatMoney(item.unitPrice);
    const lineTotalText = formatMoney(item.unitPrice * item.qty);
    return `
        <tr>
          <td style="padding: 10px 12px; border-bottom: 1px solid #ece1f5; color: #2f1f45; font-size: 14px;">
            ${escapeHtml(item.title)}
          </td>
          <td style="padding: 10px 12px; border-bottom: 1px solid #ece1f5; color: #5f4a78; font-size: 13px; text-align: center;">
            ${escapeHtml(qtyText)}
          </td>
          <td style="padding: 10px 12px; border-bottom: 1px solid #ece1f5; color: #5f4a78; font-size: 13px; text-align: right;">
            ${escapeHtml(unitPriceText)}
          </td>
          <td style="padding: 10px 12px; border-bottom: 1px solid #ece1f5; color: #2f1f45; font-size: 13px; font-weight: 600; text-align: right;">
            ${escapeHtml(lineTotalText)}
          </td>
        </tr>
      `;
  }).join("");
  const logoOrBrandHtml = payload.logoUrl
    ? `<img src="${escapeHtml(payload.logoUrl)}" alt="${escapeHtml(
        payload.logoAlt,
      )}" width="124" style="display: block; border: 0; max-width: 124px;" />`
    : `<span style="display: inline-block; color: #f8e3b0; font-size: 28px; font-weight: 700; letter-spacing: 0.4px;">${escapeHtml(
        payload.brandName,
      )}</span>`;
  const subject = `Comprobante de compra ${payload.brandName} - ${payload.externalReference}`;
  const text = [
    `Hola ${customerName},`,
    "",
    "Gracias por tu compra. Tu pago fue confirmado.",
    "",
    `Referencia: ${payload.externalReference}`,
    `ID de pago: ${payload.paymentId}`,
    `Fecha: ${formatDateTime(payload.approvedAt)}`,
    `Total: ${formatMoney(payload.total)}`,
    "",
    "Resumen del pedido:",
    itemsText || "- Sin items",
    "",
    "Conserva este email como comprobante de compra.",
  ].join("\n");
  const html = `
    <div style="display: none; max-height: 0; overflow: hidden; opacity: 0; color: transparent;">
      Pago confirmado en ${escapeHtml(payload.brandName)}. Referencia ${escapeHtml(payload.externalReference)}.
    </div>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background: #f8f1ff; padding: 20px 0; font-family: Arial, sans-serif;">
      <tr>
        <td align="center">
          <table role="presentation" width="620" cellpadding="0" cellspacing="0" style="width: 620px; max-width: 620px; background: #ffffff; border-radius: 16px; overflow: hidden; border: 1px solid #e0d5f0;">
            <tr>
              <td style="background: linear-gradient(135deg, #6b4fa5 0%, #b8a3d8 100%); padding: 28px 30px 24px;">
                ${logoOrBrandHtml}
                <p style="margin: 14px 0 0; color: #f8f1ff; font-size: 13px; letter-spacing: 0.4px;">Comprobante de compra</p>
              </td>
            </tr>
            <tr>
              <td style="padding: 26px 30px 12px;">
                <p style="margin: 0 0 10px; color: #2f1f45; font-size: 16px; font-weight: 700;">
                  Hola ${escapeHtml(customerName)}, tu pago fue confirmado.
                </p>
                <p style="margin: 0; color: #6c5a84; font-size: 14px; line-height: 1.55;">
                  Gracias por elegir ${escapeHtml(payload.brandName)}. Te compartimos el comprobante y el resumen de tu compra.
                </p>
              </td>
            </tr>
            <tr>
              <td style="padding: 12px 30px 0;">
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background: #fbf8ff; border: 1px solid #e0d5f0; border-radius: 12px;">
                  <tr><td style="padding: 14px 16px; color: #5f4a78; font-size: 12px; width: 42%;">Referencia</td><td style="padding: 14px 16px; color: #2f1f45; font-size: 13px; font-weight: 700;">${escapeHtml(payload.externalReference)}</td></tr>
                  <tr><td style="padding: 14px 16px; color: #5f4a78; font-size: 12px; border-top: 1px solid #e0d5f0;">ID de pago</td><td style="padding: 14px 16px; color: #2f1f45; font-size: 13px; border-top: 1px solid #e0d5f0;">${escapeHtml(payload.paymentId)}</td></tr>
                  <tr><td style="padding: 14px 16px; color: #5f4a78; font-size: 12px; border-top: 1px solid #e0d5f0;">Fecha</td><td style="padding: 14px 16px; color: #2f1f45; font-size: 13px; border-top: 1px solid #e0d5f0;">${escapeHtml(formatDateTime(payload.approvedAt))}</td></tr>
                  <tr><td style="padding: 14px 16px; color: #5f4a78; font-size: 12px; border-top: 1px solid #e0d5f0;">Total</td><td style="padding: 14px 16px; color: #6b4fa5; font-size: 18px; font-weight: 800; border-top: 1px solid #e0d5f0;">${escapeHtml(formatMoney(payload.total))}</td></tr>
                </table>
              </td>
            </tr>
            <tr>
              <td style="padding: 20px 30px 8px;">
                <p style="margin: 0 0 10px; color: #6b4fa5; font-size: 14px; font-weight: 700;">Resumen del pedido</p>
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border: 1px solid #ece1f5; border-radius: 10px; overflow: hidden;">
                  <tr style="background: #fbf8ff;">
                    <th align="left" style="padding: 10px 12px; color: #5f4a78; font-size: 11px; text-transform: uppercase; letter-spacing: 0.4px;">Producto</th>
                    <th align="center" style="padding: 10px 12px; color: #5f4a78; font-size: 11px; text-transform: uppercase; letter-spacing: 0.4px;">Cant.</th>
                    <th align="right" style="padding: 10px 12px; color: #5f4a78; font-size: 11px; text-transform: uppercase; letter-spacing: 0.4px;">Unitario</th>
                    <th align="right" style="padding: 10px 12px; color: #5f4a78; font-size: 11px; text-transform: uppercase; letter-spacing: 0.4px;">Subtotal</th>
                  </tr>
                  ${itemRows || '<tr><td colspan="4" style="padding: 12px; color: #6c5a84; font-size: 13px;">Sin items</td></tr>'}
                </table>
              </td>
            </tr>
            <tr>
              <td style="padding: 18px 30px 28px;">
                ${payload.orderDetailUrl ? `<a href="${escapeHtml(payload.orderDetailUrl)}" style="display: inline-block; background: #d6a64b; color: #24172f; text-decoration: none; font-weight: 700; font-size: 13px; padding: 11px 16px; border-radius: 10px;">Ver detalle en la tienda</a>` : ""}
                <p style="margin: 14px 0 0; color: #6c5a84; font-size: 12px; line-height: 1.5;">
                  Soporte: <strong>${escapeHtml(payload.supportEmail)}</strong>
                  ${payload.supportWhatsappLabel ? `<br />WhatsApp: <strong>${escapeHtml(payload.supportWhatsappLabel)}</strong>` : ""}
                </p>
                <p style="margin: 10px 0 0; color: #8a7aa1; font-size: 11px;">Conserva este email como comprobante de compra.</p>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  `;
  return { from: payload.fromEmail, to: [payload.recipientEmail], subject, text, html };
};
