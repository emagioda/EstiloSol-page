import { createHash } from "node:crypto";
import { beforeEach, describe, expect, it } from "vitest";
import type { Order } from "@/src/server/orders/types";
import {
  buildPurchaseReceiptEventKey,
  buildPurchaseReceiptPayload,
  canonicalEmailPayloadJson,
  hashEmailPayload,
  parsePurchaseReceiptPayload,
  renderPurchaseReceiptV1,
} from "./payload";

const order = (patch: Partial<Order> = {}): Order => ({
  externalReference: "es-email-payload-000001",
  status: "approved",
  paymentStatus: "confirmed",
  shippingStatus: "in_process",
  paymentMethod: "mercadopago",
  items: [
    { productId: "private-product-id", title: "Aro <Sol>", qty: 2, unitPrice: 1500, currency: "ARS" },
  ],
  total: 3000,
  currency: "ARS",
  createdAt: 1,
  updatedAt: 2,
  customer: { name: "Ana & Luz", email: " ANA@EXAMPLE.TEST " },
  notes: "must not enter the receipt payload",
  ...patch,
});

describe("AUD3-H06-E purchase receipt payload v1", () => {
  beforeEach(() => {
    process.env.CONTACT_FROM_EMAIL = "Estilo Sol <ventas@example.test>";
    process.env.APP_BASE_URL = "https://estilosol.example.test";
  });

  it("uses one stable order-level event and provider idempotency identity", () => {
    expect(buildPurchaseReceiptEventKey("es-email-payload-000001")).toBe(
      "purchase-receipt/es-email-payload-000001/v1",
    );
    expect(buildPurchaseReceiptEventKey("es-email-payload-000001").length).toBeLessThanOrEqual(256);
  });

  it("rejects an identity that cannot be used as a Resend idempotency key", () => {
    expect(() => buildPurchaseReceiptEventKey(`es-${"x".repeat(240)}`)).toThrow(
      "EMAIL_OUTBOX_EVENT_ID_INVALID",
    );
  });

  it("captures only immutable data required by template v1", () => {
    const payload = buildPurchaseReceiptPayload({
      order: order(),
      paymentId: "pay-123",
      approvedAt: 1_765_843_200_000,
    });
    expect(payload).toEqual({
      externalReference: "es-email-payload-000001",
      recipientEmail: "ana@example.test",
      customerName: "Ana & Luz",
      paymentId: "pay-123",
      approvedAt: 1_765_843_200_000,
      items: [{ title: "Aro <Sol>", qty: 2, unitPrice: 1500, currency: "ARS" }],
      total: 3000,
      currency: "ARS",
      fromEmail: "Estilo Sol <ventas@example.test>",
      brandName: "Estilo Sol",
      supportEmail: "estilosol.ms@gmail.com",
      supportWhatsappLabel: "+54 9 341 688-8926",
      logoUrl: "",
      logoAlt: "Logo Estilo Sol",
      orderDetailUrl: "https://estilosol.example.test/tienda/success?ref=es-email-payload-000001",
      templateVersion: 1,
    });
    expect(JSON.stringify(payload)).not.toContain("private-product-id");
    expect(JSON.stringify(payload)).not.toContain("must not enter");
  });

  it("canonicalizes recursively and hashes with SHA-256", () => {
    const payload = buildPurchaseReceiptPayload({ order: order(), paymentId: "pay-123", approvedAt: 10 });
    const canonical = canonicalEmailPayloadJson(payload);
    expect(hashEmailPayload(canonical)).toBe(
      createHash("sha256").update(canonical, "utf8").digest("hex"),
    );
    expect(canonicalEmailPayloadJson({ ...payload })).toBe(canonical);
  });

  it("detects payload tampering before rendering", () => {
    const payload = buildPurchaseReceiptPayload({ order: order(), paymentId: "pay-123", approvedAt: 10 });
    const canonical = canonicalEmailPayloadJson(payload);
    expect(parsePurchaseReceiptPayload(canonical, hashEmailPayload(canonical))).toEqual(payload);
    expect(() => parsePurchaseReceiptPayload(`${canonical} `, hashEmailPayload(canonical))).toThrow(
      "EMAIL_OUTBOX_EVENT_CONFLICT",
    );
  });

  it("renders the frozen v1 template and escapes customer-controlled HTML", () => {
    const payload = buildPurchaseReceiptPayload({ order: order(), paymentId: "pay-123", approvedAt: 10 });
    const rendered = renderPurchaseReceiptV1(payload);
    expect(rendered.to).toEqual(["ana@example.test"]);
    expect(rendered.subject).toContain("es-email-payload-000001");
    expect(rendered.html).toContain("Ana &amp; Luz");
    expect(rendered.html).toContain("Aro &lt;Sol&gt;");
    expect(rendered.html).toContain("Unitario");
    expect(rendered.html).toContain("Ver detalle en la tienda");
    expect(rendered.html).toContain("Soporte: <strong>estilosol.ms@gmail.com</strong>");
    expect(rendered.html).toContain("WhatsApp: <strong>+54 9 341 688-8926</strong>");
    expect(rendered.html).toContain("display: none; max-height: 0");
    expect(rendered.html).not.toContain("private-product-id");
  });

  it("preserves the existing empty-item fallback in both receipt formats", () => {
    const rendered = renderPurchaseReceiptV1(buildPurchaseReceiptPayload({
      order: order({ items: [] }),
      paymentId: "payment-1",
      approvedAt: Date.UTC(2026, 7, 15, 12, 30, 0),
    }));
    expect(rendered.text).toContain("- Sin items");
    expect(rendered.html).toContain("Sin items");
  });
});
