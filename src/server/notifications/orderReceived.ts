import { env } from "@/src/config/env";
import brandConfig from "@/src/config/brand";
import type { Order, OrderPaymentMethod } from "@/src/server/orders/types";

type SendOrderReceivedEmailInput = {
  order: Order;
};

export type SendOrderReceivedEmailResult =
  | { sent: true }
  | {
      sent: false;
      reason: "missing_customer_email" | "invalid_customer_email" | "resend_not_configured" | "send_failed";
      detail?: string;
    };

const RECEIVED_DATE_TIME_FORMATTER = new Intl.DateTimeFormat("es-AR", {
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

const paymentMethodLabel = (method?: OrderPaymentMethod) => {
  if (method === "cash") return "Efectivo";
  if (method === "transfer") return "Transferencia bancaria";
  return "Pendiente";
};

const deliveryMethodLabel = (method: Order["deliveryMethod"]) =>
  method === "pickup" ? "Punto de encuentro coordinado" : "Envío a domicilio";

const shortOrderCode = (externalReference: string) =>
  externalReference.split("-").filter(Boolean).at(-1) || externalReference;

export const sendOrderReceivedEmail = async (
  input: SendOrderReceivedEmailInput
): Promise<SendOrderReceivedEmailResult> => {
  const customerEmail = input.order.customer?.email?.trim().toLowerCase() || "";
  if (!customerEmail) {
    return { sent: false, reason: "missing_customer_email" };
  }

  if (!isValidEmail(customerEmail)) {
    return { sent: false, reason: "invalid_customer_email" };
  }

  const resendApiKey = env.getOptionalServer("RESEND_API_KEY");
  const fromEmail = env.getOptionalServer("CONTACT_FROM_EMAIL") || "Estilo Sol <no-reply@estilosol.ar>";
  if (!resendApiKey) {
    return { sent: false, reason: "resend_not_configured" };
  }

  const customerName = input.order.customer?.name?.trim() || "cliente";
  const brandName = brandConfig.brandName;
  const supportEmail = brandConfig.contactInfo.email;
  const orderCode = shortOrderCode(input.order.externalReference);
  const supportWhatsappLabel =
    brandConfig.contactInfo.socialNetworks.find((network) => network.icon === "whatsapp")?.label || "";
  const orderDateText = RECEIVED_DATE_TIME_FORMATTER.format(new Date(input.order.createdAt));
  const paymentText = paymentMethodLabel(input.order.paymentMethod);
  const deliveryText = input.order.fulfillment?.summary || deliveryMethodLabel(input.order.deliveryMethod);
  const orderTotal = formatMoney(input.order.total);
  const appBaseUrl = env.getOptionalServer("APP_BASE_URL")?.replace(/\/$/, "");
  const orderDetailUrl = appBaseUrl
    ? `${appBaseUrl}/tienda/success?manual=1&pm=${encodeURIComponent(input.order.paymentMethod || "")}&ref=${encodeURIComponent(
        input.order.externalReference
      )}`
    : null;
  const itemsText = input.order.items
    .map((item) => `- ${item.qty} x ${item.title} (${formatMoney(item.unitPrice)} c/u)`)
    .join("\n");

  const subject = `Pedido recibido ${brandName} #${orderCode}`;
  const text = [
    `Hola ${customerName},`,
    "",
    `Recibimos tu pedido en ${brandName}. Queda pendiente de confirmacion de pago.`,
    "",
    `Pedido: #${orderCode}`,
    `Referencia: ${input.order.externalReference}`,
    `Fecha: ${orderDateText}`,
    `Forma de pago: ${paymentText}`,
    `Entrega: ${deliveryText}`,
    `Total: ${orderTotal}`,
    "",
    "Resumen del pedido:",
    itemsText || "- Sin items",
    "",
    "Este email confirma que recibimos tu pedido. No es un comprobante de pago.",
  ].join("\n");

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

  const html = `
    <div style="display: none; max-height: 0; overflow: hidden; opacity: 0; color: transparent;">
      Pedido recibido en ${escapeHtml(brandName)}. Referencia ${escapeHtml(input.order.externalReference)}.
    </div>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background: ${emailTheme.bgPage}; padding: 20px 0; font-family: Arial, sans-serif;">
      <tr>
        <td align="center">
          <table role="presentation" width="620" cellpadding="0" cellspacing="0" style="width: 620px; max-width: 620px; background: ${emailTheme.bgCard}; border-radius: 16px; overflow: hidden; border: 1px solid ${emailTheme.borderSoft};">
            <tr>
              <td style="background: linear-gradient(135deg, ${emailTheme.headerFrom} 0%, ${emailTheme.headerTo} 100%); padding: 28px 30px 24px;">
                <span style="display: inline-block; color: ${emailTheme.headerBadge}; font-size: 28px; font-weight: 700; letter-spacing: 0.4px;">${escapeHtml(
                  brandName
                )}</span>
                <p style="margin: 14px 0 0; color: ${emailTheme.headerText}; font-size: 13px; letter-spacing: 0.4px;">Pedido recibido</p>
              </td>
            </tr>
            <tr>
              <td style="padding: 26px 30px 12px;">
                <p style="margin: 0 0 10px; color: ${emailTheme.textPrimary}; font-size: 16px; font-weight: 700;">
                  Hola ${escapeHtml(customerName)}, recibimos tu pedido.
                </p>
                <p style="margin: 0; color: ${emailTheme.textMuted}; font-size: 14px; line-height: 1.55;">
                  Queda pendiente de confirmacion de pago. Te compartimos el detalle para que puedas revisarlo.
                </p>
              </td>
            </tr>
            <tr>
              <td style="padding: 12px 30px 0;">
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background: ${emailTheme.bgSoft}; border: 1px solid ${emailTheme.borderSoft}; border-radius: 12px;">
                  <tr>
                    <td style="padding: 14px 16px; color: ${emailTheme.textSecondary}; font-size: 12px; width: 42%;">Pedido</td>
                    <td style="padding: 14px 16px; color: ${emailTheme.textPrimary}; font-size: 13px; font-weight: 700;">#${escapeHtml(orderCode)}</td>
                  </tr>
                  <tr>
                    <td style="padding: 14px 16px; color: ${emailTheme.textSecondary}; font-size: 12px; border-top: 1px solid ${emailTheme.borderSoft};">Referencia</td>
                    <td style="padding: 14px 16px; color: ${emailTheme.textPrimary}; font-size: 12px; border-top: 1px solid ${emailTheme.borderSoft};">${escapeHtml(input.order.externalReference)}</td>
                  </tr>
                  <tr>
                    <td style="padding: 14px 16px; color: ${emailTheme.textSecondary}; font-size: 12px; border-top: 1px solid ${emailTheme.borderSoft};">Forma de pago</td>
                    <td style="padding: 14px 16px; color: ${emailTheme.textPrimary}; font-size: 13px; border-top: 1px solid ${emailTheme.borderSoft};">${escapeHtml(paymentText)}</td>
                  </tr>
                  <tr>
                    <td style="padding: 14px 16px; color: ${emailTheme.textSecondary}; font-size: 12px; border-top: 1px solid ${emailTheme.borderSoft};">Entrega</td>
                    <td style="padding: 14px 16px; color: ${emailTheme.textPrimary}; font-size: 13px; border-top: 1px solid ${emailTheme.borderSoft};">${escapeHtml(deliveryText)}</td>
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
                      )}" style="display: inline-block; background: ${emailTheme.ctaBg}; color: ${emailTheme.ctaText}; text-decoration: none; font-weight: 700; font-size: 13px; padding: 11px 16px; border-radius: 10px;">Ver pedido en la tienda</a>`
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
                  Este email confirma que recibimos tu pedido. No es un comprobante de pago.
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
      detail: `resend_status_${resendResponse.status}`,
    };
  }

  return { sent: true };
};
