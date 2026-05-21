import { describe, expect, it } from "vitest";
import { buildSalesSheetRow } from "@/src/server/sheets/repository";
import type { Order } from "@/src/server/orders/types";

const baseOrder: Order = {
  externalReference: "es-20260101-000000-test",
  status: "pending",
  paymentStatus: "pending",
  shippingStatus: "in_process",
  paymentMethod: "transfer",
  deliveryMethod: "delivery",
  items: [
    {
      productId: "p1",
      title: "Producto 1",
      unitPrice: 20000,
      qty: 1,
      currency: "ARS",
    },
  ],
  total: 22000,
  currency: "ARS",
  createdAt: Date.UTC(2026, 0, 1),
  updatedAt: Date.UTC(2026, 0, 1),
};

describe("buildSalesSheetRow", () => {
  it("maps fulfillment fields for new ventas columns", () => {
    const row = buildSalesSheetRow({
      ...baseOrder,
      fulfillment: {
        subtotalProducts: 20000,
        discountAmount: 2000,
        shippingFee: 4000,
        finalTotal: 22000,
        deliveryZone: {
          id: "rosario-zona-habilitada",
          name: "Rosario zona habilitada",
          insideZoneConfirmed: true,
        },
        deliveryAddress: {
          street: "San Lorenzo",
          number: "1234",
          floor: "2 A",
          betweenStreets: "Mitre y Entre Rios",
          notes: "Timbre Estilo",
        },
        summary: "Envío a domicilio: San Lorenzo 1234, 2 A, entre Mitre y Entre Rios",
      },
    });

    expect(row.total).toBe(22000);
    expect(row.total_final).toBe(22000);
    expect(row.subtotal_productos).toBe(20000);
    expect(row.descuento).toBe(2000);
    expect(row.costo_envio).toBe(4000);
    expect(row.delivery_zone_id).toBe("rosario-zona-habilitada");
    expect(row.delivery_inside_zone_confirmed).toBe("TRUE");
    expect(row.delivery_address_street).toBe("San Lorenzo");
    expect(row.fulfillment_summary).toContain("Envío a domicilio");
  });

  it("maps pickup point fulfillment fields", () => {
    const row = buildSalesSheetRow({
      ...baseOrder,
      deliveryMethod: "pickup",
      total: 18000,
      fulfillment: {
        subtotalProducts: 20000,
        discountAmount: 2000,
        shippingFee: 0,
        finalTotal: 18000,
        pickupPoint: {
          id: "santa-fe-mitre",
          name: "Santa Fe y Mitre",
          address: "Santa Fe y Mitre",
          reference: "Coordinamos día y horario por WhatsApp",
        },
        summary: "Punto de encuentro: Santa Fe y Mitre",
      },
    });

    expect(row.total).toBe(18000);
    expect(row.total_final).toBe(18000);
    expect(row.costo_envio).toBe(0);
    expect(row.pickup_point_id).toBe("santa-fe-mitre");
    expect(row.pickup_point_name).toBe("Santa Fe y Mitre");
    expect(row.fulfillment_summary).toBe("Punto de encuentro: Santa Fe y Mitre");
  });
});
