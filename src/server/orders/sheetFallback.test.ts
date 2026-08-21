import { describe, expect, it } from "vitest";
import { parseFallbackOrderFulfillment } from "./sheetFallback";

const moneySnapshot = {
  subtotal_productos: 1000,
  descuento: 100,
  costo_envio: 100,
  total_final: 1000,
  fulfillment_summary: "Snapshot congelado",
};

describe("AUD3 H07 Google Sheets fulfillment fallback parser", () => {
  it("FALLBACK-01 parses the existing pickup projection fields", () => {
    expect(parseFallbackOrderFulfillment({
      ...moneySnapshot,
      pickup_point_id: "pickup-1",
      pickup_point_name: "Local",
      pickup_point_address: "San Martín 123",
      pickup_point_reference: "Mostrador",
    }, "pickup")).toMatchObject({
      subtotalProducts: 1000,
      discountAmount: 100,
      shippingFee: 100,
      finalTotal: 1000,
      pickupPoint: { id: "pickup-1", reference: "Mostrador" },
    });
  });

  it("FALLBACK-02 parses the existing delivery projection fields", () => {
    expect(parseFallbackOrderFulfillment({
      ...moneySnapshot,
      delivery_zone_id: "zone-1",
      delivery_zone_name: "Centro",
      delivery_inside_zone_confirmed: "TRUE",
      delivery_address_street: "Belgrano",
      delivery_address_number: "456",
      delivery_address_between_streets: "Mitre y Sarmiento",
    }, "delivery")).toMatchObject({
      deliveryZone: { id: "zone-1", insideZoneConfirmed: true },
      deliveryAddress: { street: "Belgrano", number: "456" },
    });
  });

  it("FALLBACK-03 preserves malformed money as invalid instead of fabricating totals", () => {
    const parsed = parseFallbackOrderFulfillment({
      ...moneySnapshot,
      total_final: "no disponible",
    }, "pickup");
    expect(Number.isNaN(parsed?.finalTotal)).toBe(true);
  });

  it("FALLBACK-04 normalizes actual camelCase Apps Script keys", () => {
    expect(parseFallbackOrderFulfillment({
      subtotalProductos: 1000,
      descuento: 0,
      costoEnvio: 0,
      totalFinal: 1000,
      fulfillmentSummary: "Retiro",
      pickupPointId: "p1",
      pickupPointName: "Local",
      pickupPointAddress: "Dirección",
      pickupPointReference: "Referencia",
    }, "pickup")?.pickupPoint?.id).toBe("p1");
  });

  it("FALLBACK-05 refuses to infer an unknown delivery method", () => {
    expect(parseFallbackOrderFulfillment(moneySnapshot, undefined)).toBeUndefined();
  });
});
