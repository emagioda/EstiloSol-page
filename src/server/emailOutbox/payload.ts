import "server-only";

import { createHash } from "node:crypto";
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
  const itemRows = payload.items
    .map(
      (item) => `<tr><td style="padding:10px 12px;border-bottom:1px solid #ece1f5">${escapeHtml(
        item.title,
      )}</td><td style="padding:10px 12px;border-bottom:1px solid #ece1f5;text-align:center">${
        item.qty
      }</td><td style="padding:10px 12px;border-bottom:1px solid #ece1f5;text-align:right">${escapeHtml(
        formatMoney(item.unitPrice * item.qty),
      )}</td></tr>`,
    )
    .join("");
  const subject = `Comprobante de compra Estilo Sol - ${payload.externalReference}`;
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
    itemsText,
    "",
    "Conserva este email como comprobante de compra.",
  ].join("\n");
  const html = `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#fff8eb;padding:24px 0;font-family:Arial,sans-serif;color:#2f1f45"><tr><td align="center"><table role="presentation" width="620" cellpadding="0" cellspacing="0" style="width:620px;max-width:620px;background:#ffffff;border:1px solid #e5d6ef;border-radius:16px;overflow:hidden"><tr><td style="background:#603d82;padding:26px 30px;color:#fff8eb"><div style="font-size:27px;font-weight:700;color:#f1c65a">Estilo Sol</div><p style="margin:8px 0 0;font-size:13px">Comprobante de compra</p></td></tr><tr><td style="padding:26px 30px"><p style="margin:0 0 8px;font-size:17px;font-weight:700">Hola ${escapeHtml(
    customerName,
  )}, tu pago fue confirmado.</p><p style="margin:0 0 20px;color:#6c5a84">Gracias por elegir Estilo Sol. Conserva este email como comprobante.</p><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#fbf8ff;border:1px solid #ece1f5;border-radius:12px"><tr><td style="padding:10px 12px"><b>Referencia</b><br>${escapeHtml(
    payload.externalReference,
  )}</td><td style="padding:10px 12px"><b>ID de pago</b><br>${escapeHtml(
    payload.paymentId,
  )}</td></tr><tr><td style="padding:10px 12px"><b>Fecha</b><br>${escapeHtml(
    formatDateTime(payload.approvedAt),
  )}</td><td style="padding:10px 12px"><b>Total</b><br>${escapeHtml(
    formatMoney(payload.total),
  )}</td></tr></table><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:20px;border-collapse:collapse"><thead><tr><th align="left" style="padding:10px 12px;background:#f3ecf8">Producto</th><th style="padding:10px 12px;background:#f3ecf8">Cant.</th><th align="right" style="padding:10px 12px;background:#f3ecf8">Subtotal</th></tr></thead><tbody>${itemRows}</tbody></table></td></tr></table></td></tr></table>`;
  return { from: payload.fromEmail, to: [payload.recipientEmail], subject, text, html };
};
