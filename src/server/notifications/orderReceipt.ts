import { env } from "@/src/config/env";
import brandConfig from "@/src/config/brand";
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
  const brandName = brandConfig.brandName;
  const supportEmail = brandConfig.contactInfo.email;
  const supportWhatsappLabel =
    brandConfig.contactInfo.socialNetworks.find((network) => network.icon === "whatsapp")?.label || "";
  const emailTheme = {
    textPrimary: "#2f1f45",
    textSecondary: "#5f4a78",
    textMuted: "#6c5a84",
    textSubtle: "#8a7aa1",
    bgPage: brandConfig.palette.cream,
    bgCard: brandConfig.palette.white,
    bgSoft: "#fbf8ff",
    border: "#ece1f5",
    borderSoft: brandConfig.palette.violet.light,
    heading: brandConfig.palette.violet.strong,
    headerFrom: brandConfig.palette.violet.strong,
    headerTo: brandConfig.palette.violet.deep,
    headerText: brandConfig.palette.cream,
    headerBadge: brandConfig.palette.gold.glow,
    ctaBg: brandConfig.palette.gold.base,
    ctaText: "#24172f",
  };
  const appBaseUrl = env.getOptionalServer("APP_BASE_URL")?.replace(/\/$/, "");
  const logoUrl =
    appBaseUrl && brandConfig.logo.isAvailable
      ? `${appBaseUrl}${brandConfig.logo.src}`
      : null;
  const orderDetailUrl = appBaseUrl
    ? `${appBaseUrl}/tienda/success?ref=${encodeURIComponent(input.order.externalReference)}`
    : null;
  const itemsText = input.order.items
    .map((item) => `- ${item.qty} x ${item.title} (${formatMoney(item.unitPrice)} c/u)`)
    .join("\n");
  const orderTotal = formatMoney(input.order.total);

  const subject = `Comprobante de compra ${brandName} - ${input.order.externalReference}`;
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

  const itemRowsHtml = input.order.items
    .map((item) => {
      const qtyText = String(item.qty);
      const unitPriceText = formatMoney(item.unitPrice);
      const lineTotalText = formatMoney(item.unitPrice * item.qty);
      return `
        <tr>
          <td style="padding: 10px 12px; border-bottom: 1px solid ${emailTheme.border}; color: ${emailTheme.textPrimary}; font-size: 14px;">
            ${escapeHtml(item.title)}
          </td>
          <td style="padding: 10px 12px; border-bottom: 1px solid ${emailTheme.border}; color: ${emailTheme.textSecondary}; font-size: 13px; text-align: center;">
            ${escapeHtml(qtyText)}
          </td>
          <td style="padding: 10px 12px; border-bottom: 1px solid ${emailTheme.border}; color: ${emailTheme.textSecondary}; font-size: 13px; text-align: right;">
            ${escapeHtml(unitPriceText)}
          </td>
          <td style="padding: 10px 12px; border-bottom: 1px solid ${emailTheme.border}; color: ${emailTheme.textPrimary}; font-size: 13px; font-weight: 600; text-align: right;">
            ${escapeHtml(lineTotalText)}
          </td>
        </tr>
      `;
    })
    .join("");

  const logoOrBrandHtml = logoUrl
    ? `<img src="${escapeHtml(logoUrl)}" alt="${escapeHtml(
        brandConfig.logo.alt || brandName
      )}" width="124" style="display: block; border: 0; max-width: 124px;" />`
    : `<span style="display: inline-block; color: ${emailTheme.headerBadge}; font-size: 28px; font-weight: 700; letter-spacing: 0.4px;">${escapeHtml(
        brandName
      )}</span>`;

  const html = `
    <div style="display: none; max-height: 0; overflow: hidden; opacity: 0; color: transparent;">
      Pago confirmado en ${escapeHtml(brandName)}. Referencia ${escapeHtml(input.order.externalReference)}.
    </div>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background: ${emailTheme.bgPage}; padding: 20px 0; font-family: Arial, sans-serif;">
      <tr>
        <td align="center">
          <table role="presentation" width="620" cellpadding="0" cellspacing="0" style="width: 620px; max-width: 620px; background: ${emailTheme.bgCard}; border-radius: 16px; overflow: hidden; border: 1px solid ${emailTheme.borderSoft};">
            <tr>
              <td style="background: linear-gradient(135deg, ${emailTheme.headerFrom} 0%, ${emailTheme.headerTo} 100%); padding: 28px 30px 24px;">
                ${logoOrBrandHtml}
                <p style="margin: 14px 0 0; color: ${emailTheme.headerText}; font-size: 13px; letter-spacing: 0.4px;">Comprobante de compra</p>
              </td>
            </tr>
            <tr>
              <td style="padding: 26px 30px 12px;">
                <p style="margin: 0 0 10px; color: ${emailTheme.textPrimary}; font-size: 16px; font-weight: 700;">
                  Hola ${escapeHtml(customerName)}, tu pago fue confirmado.
                </p>
                <p style="margin: 0; color: ${emailTheme.textMuted}; font-size: 14px; line-height: 1.55;">
                  Gracias por elegir ${escapeHtml(brandName)}. Te compartimos el comprobante y el resumen de tu compra.
                </p>
              </td>
            </tr>
            <tr>
              <td style="padding: 12px 30px 0;">
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background: ${emailTheme.bgSoft}; border: 1px solid ${emailTheme.borderSoft}; border-radius: 12px;">
                  <tr>
                    <td style="padding: 14px 16px; color: ${emailTheme.textSecondary}; font-size: 12px; width: 42%;">Referencia</td>
                    <td style="padding: 14px 16px; color: ${emailTheme.textPrimary}; font-size: 13px; font-weight: 700;">${escapeHtml(input.order.externalReference)}</td>
                  </tr>
                  <tr>
                    <td style="padding: 14px 16px; color: ${emailTheme.textSecondary}; font-size: 12px; border-top: 1px solid ${emailTheme.borderSoft};">ID de pago</td>
                    <td style="padding: 14px 16px; color: ${emailTheme.textPrimary}; font-size: 13px; border-top: 1px solid ${emailTheme.borderSoft};">${escapeHtml(paymentIdText)}</td>
                  </tr>
                  <tr>
                    <td style="padding: 14px 16px; color: ${emailTheme.textSecondary}; font-size: 12px; border-top: 1px solid ${emailTheme.borderSoft};">Fecha</td>
                    <td style="padding: 14px 16px; color: ${emailTheme.textPrimary}; font-size: 13px; border-top: 1px solid ${emailTheme.borderSoft};">${escapeHtml(paymentDateText)}</td>
                  </tr>
                  <tr>
                    <td style="padding: 14px 16px; color: ${emailTheme.textSecondary}; font-size: 12px; border-top: 1px solid ${emailTheme.borderSoft};">Total</td>
                    <td style="padding: 14px 16px; color: ${emailTheme.heading}; font-size: 18px; font-weight: 800; border-top: 1px solid ${emailTheme.borderSoft};">${escapeHtml(orderTotal)}</td>
                  </tr>
                </table>
              </td>
            </tr>
            <tr>
              <td style="padding: 20px 30px 8px;">
                <p style="margin: 0 0 10px; color: ${emailTheme.heading}; font-size: 14px; font-weight: 700;">
                  Resumen del pedido
                </p>
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border: 1px solid ${emailTheme.border}; border-radius: 10px; overflow: hidden;">
                  <tr style="background: ${emailTheme.bgSoft};">
                    <th align="left" style="padding: 10px 12px; color: ${emailTheme.textSecondary}; font-size: 11px; text-transform: uppercase; letter-spacing: 0.4px;">Producto</th>
                    <th align="center" style="padding: 10px 12px; color: ${emailTheme.textSecondary}; font-size: 11px; text-transform: uppercase; letter-spacing: 0.4px;">Cant.</th>
                    <th align="right" style="padding: 10px 12px; color: ${emailTheme.textSecondary}; font-size: 11px; text-transform: uppercase; letter-spacing: 0.4px;">Unitario</th>
                    <th align="right" style="padding: 10px 12px; color: ${emailTheme.textSecondary}; font-size: 11px; text-transform: uppercase; letter-spacing: 0.4px;">Subtotal</th>
                  </tr>
                  ${itemRowsHtml || `<tr><td colspan="4" style="padding: 12px; color: ${emailTheme.textMuted}; font-size: 13px;">Sin items</td></tr>`}
                </table>
              </td>
            </tr>
            <tr>
              <td style="padding: 18px 30px 28px;">
                ${
                  orderDetailUrl
                    ? `<a href="${escapeHtml(
                        orderDetailUrl
                      )}" style="display: inline-block; background: ${emailTheme.ctaBg}; color: ${emailTheme.ctaText}; text-decoration: none; font-weight: 700; font-size: 13px; padding: 11px 16px; border-radius: 10px;">Ver detalle en la tienda</a>`
                    : ""
                }
                <p style="margin: 14px 0 0; color: ${emailTheme.textMuted}; font-size: 12px; line-height: 1.5;">
                  Soporte: <strong>${escapeHtml(supportEmail)}</strong>
                  ${
                    supportWhatsappLabel
                      ? `<br />WhatsApp: <strong>${escapeHtml(supportWhatsappLabel)}</strong>`
                      : ""
                  }
                </p>
                <p style="margin: 10px 0 0; color: ${emailTheme.textSubtle}; font-size: 11px;">
                  Conserva este email como comprobante de compra.
                </p>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
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
