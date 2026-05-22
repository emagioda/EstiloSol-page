import { describe, expect, it } from "vitest";
import { buildPreferencePayload, buildPreferenceUrls } from "@/src/server/payments/preferencePayload";
import type { OrderItem } from "@/src/server/orders/types";

const items: OrderItem[] = [
  {
    productId: "p1",
    title: "Producto 1",
    unitPrice: 1200,
    qty: 2,
    currency: "ARS",
  },
];

describe("preferencePayload", () => {
  it("builds default preference urls and replaces external reference", () => {
    const urls = buildPreferenceUrls({
      appBaseUrl: "https://example.com",
      externalReference: "es-123",
    });

    expect(urls.success).toBe("https://example.com/tienda/success?ref=es-123");
    expect(urls.failure).toBe("https://example.com/tienda");
    expect(urls.pending).toBe("https://example.com/tienda");
    expect(urls.webhook).toBe("https://example.com/api/mp/webhook");
    expect(urls.shouldUseAutoReturn).toBe(true);
  });

  it("enables auto_return only for https success urls", () => {
    const local = buildPreferenceUrls({
      appBaseUrl: "http://localhost:3000",
      externalReference: "es-123",
      successUrl: "http://localhost:3000/tienda/success?ref={EXTERNAL_REFERENCE}",
    });
    expect(local.shouldUseAutoReturn).toBe(false);
    expect(local.isHttpsSuccessUrl).toBe(false);

    const customNonHttps = buildPreferenceUrls({
      appBaseUrl: "https://example.com",
      externalReference: "es-123",
      successUrl: "http://my-internal-host/tienda/success?ref={EXTERNAL_REFERENCE}",
    });
    expect(customNonHttps.shouldUseAutoReturn).toBe(false);
  });

  it("normalizes https localhost back urls to http for local development", () => {
    const urls = buildPreferenceUrls({
      appBaseUrl: "https://localhost:3000",
      externalReference: "es-local",
      successUrl: "https://localhost:3000/tienda/success?ref={EXTERNAL_REFERENCE}",
      failureUrl: "https://localhost:3000/tienda",
      pendingUrl: "https://localhost:3000/tienda",
      webhookUrl: "https://localhost:3000/api/mp/webhook",
    });

    expect(urls.success).toBe("http://localhost:3000/tienda/success?ref=es-local");
    expect(urls.failure).toBe("http://localhost:3000/tienda");
    expect(urls.pending).toBe("http://localhost:3000/tienda");
    expect(urls.webhook).toBe("http://localhost:3000/api/mp/webhook");
    expect(urls.shouldUseAutoReturn).toBe(false);
  });

  it("injects ref when success url does not include placeholder", () => {
    const urls = buildPreferenceUrls({
      appBaseUrl: "https://example.com",
      externalReference: "es-456",
      successUrl: "https://example.com/tienda/success",
    });

    expect(urls.success).toBe("https://example.com/tienda/success?ref=es-456");
  });

  it("injects summaryToken only into the success url", () => {
    const urls = buildPreferenceUrls({
      appBaseUrl: "https://example.com",
      externalReference: "es-456",
      summaryToken: "summary-token",
    });

    expect(urls.success).toBe("https://example.com/tienda/success?ref=es-456&summaryToken=summary-token");
    expect(urls.failure).toBe("https://example.com/tienda");
    expect(urls.pending).toBe("https://example.com/tienda");
    expect(urls.webhook).toBe("https://example.com/api/mp/webhook");
  });

  it("replaces lowercase external reference placeholder", () => {
    const urls = buildPreferenceUrls({
      appBaseUrl: "https://example.com",
      externalReference: "es-789",
      successUrl: "https://example.com/tienda/success?ref={external_reference}",
    });

    expect(urls.success).toBe("https://example.com/tienda/success?ref=es-789");
  });

  it("builds preference payload with and without auto_return", () => {
    const urls = buildPreferenceUrls({
      appBaseUrl: "https://example.com",
      externalReference: "es-123",
    });

    const withAutoReturn = buildPreferencePayload({
      items,
      customerName: "Ana",
      customerPhone: "+5491112345678",
      notes: "Entregar por la tarde",
      deliveryMethod: "pickup",
      fulfillment: {
        subtotalProducts: 2400,
        discountAmount: 0,
        shippingFee: 0,
        finalTotal: 2400,
        pickupPoint: {
          id: "santa-fe-mitre",
          name: "Santa Fe y Mitre",
          address: "Santa Fe y Mitre",
          reference: "Coordinamos día y horario por WhatsApp",
        },
        summary: "Punto de encuentro: Santa Fe y Mitre",
      },
      externalReference: "es-123",
      urls,
      includeAutoReturn: true,
    });

    expect(withAutoReturn.items).toHaveLength(1);
    expect(withAutoReturn.items[0]).toMatchObject({
      id: "p1",
      quantity: 2,
      unit_price: 1200,
      currency_id: "ARS",
    });
    expect(withAutoReturn.payer).toEqual({
      name: "Ana",
      phone: { number: "+5491112345678" },
    });
    expect(withAutoReturn.auto_return).toBe("approved");
    expect(withAutoReturn.metadata).toEqual({
      store: "estilo-sol",
      delivery_method: "pickup",
      fulfillment_summary: "Punto de encuentro: Santa Fe y Mitre",
      shipping_fee: 0,
    });

    const withoutAutoReturn = buildPreferencePayload({
      items,
      customerName: "",
      customerPhone: "",
      notes: "",
      externalReference: "es-123",
      urls,
      includeAutoReturn: false,
    });

    expect(withoutAutoReturn).not.toHaveProperty("auto_return");
    expect(withoutAutoReturn.payer).toEqual({});
    expect(withoutAutoReturn.metadata).toEqual({ store: "estilo-sol" });
  });

  it("sends shipping through Mercado Pago shipments", () => {
    const urls = buildPreferenceUrls({
      appBaseUrl: "https://example.com",
      externalReference: "es-123",
    });

    const payload = buildPreferencePayload({
      items,
      customerName: "Ana",
      customerPhone: "+5491112345678",
      notes: "",
      deliveryMethod: "delivery",
      fulfillment: {
        subtotalProducts: 2400,
        discountAmount: 0,
        shippingFee: 4000,
        finalTotal: 6400,
        deliveryZone: {
          id: "rosario-zona-habilitada",
          name: "Rosario - zona de envío",
          insideZoneConfirmed: true,
        },
        deliveryAddress: {
          street: "San Lorenzo",
          number: "1234",
          betweenStreets: "Mitre y Entre Rios",
        },
        summary: "Envío a domicilio: San Lorenzo 1234, entre Mitre y Entre Rios",
      },
      externalReference: "es-123",
      urls,
      includeAutoReturn: true,
    });

    expect(payload.items).toHaveLength(1);
    expect(payload.shipments).toEqual({
      cost: 4000,
      mode: "not_specified",
    });
    expect(payload.metadata).toMatchObject({
      delivery_method: "delivery",
      shipping_fee: 4000,
    });
  });
});
