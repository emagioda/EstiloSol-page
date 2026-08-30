import { describe, expect, it } from "vitest";
import {
  buildSalesSheetRow,
  parseAdminOrderRow,
  REQUIRED_SALES_FULFILLMENT_HEADERS,
} from "@/src/server/sheets/repository";
import { evaluateFulfillmentCompletion } from "./fulfillmentCompletion";
import type { Order } from "./types";

const makeOrder = (deliveryMethod: "delivery" | "pickup"): Order => {
  const monetary = {
    subtotalProducts: 20000,
    discountAmount: 2000,
    shippingFee: deliveryMethod === "delivery" ? 4000 : 0,
    finalTotal: deliveryMethod === "delivery" ? 22000 : 18000,
  };

  return {
    externalReference: `round-trip-${deliveryMethod}`,
    status: "approved",
    paymentStatus: "confirmed",
    shippingStatus: "in_process",
    inventoryStatus: "deducted",
    stockDeductedAt: Date.parse("2026-08-30T12:00:00.000Z"),
    paymentMethod: "transfer",
    deliveryMethod,
    items: [{ productId: "p-1", title: "Producto", unitPrice: 20000, qty: 1, currency: "ARS" }],
    total: monetary.finalTotal,
    currency: "ARS",
    createdAt: Date.parse("2026-08-30T11:00:00.000Z"),
    updatedAt: Date.parse("2026-08-30T12:00:00.000Z"),
    fulfillment: deliveryMethod === "delivery"
      ? {
          ...monetary,
          deliveryZone: {
            id: "rosario-zona-habilitada",
            name: "Rosario - zona de envío",
            insideZoneConfirmed: true,
          },
          deliveryAddress: {
            street: "San Lorenzo",
            number: "1234",
            floor: "2 A",
            betweenStreets: "Mitre y Entre Ríos",
            notes: "Timbre Estilo",
          },
          summary: "Envío a domicilio: San Lorenzo 1234",
        }
      : {
          ...monetary,
          pickupPoint: {
            id: "santa-fe-mitre",
            name: "Santa Fe y Mitre",
            address: "Santa Fe y Mitre",
            reference: "Zona centro",
          },
          summary: "Punto de encuentro: Santa Fe y Mitre",
        },
  };
};

describe("AUD3 H07-E2 fulfillment Ventas round trip", () => {
  it.each(["delivery", "pickup"] as const)(
    "EF-E-02-07 preserves %s from Order through Ventas and Admin with H07-A still valid",
    (deliveryMethod) => {
      const original = makeOrder(deliveryMethod);
      const ventasRow = buildSalesSheetRow(original);
      const admin = parseAdminOrderRow(ventasRow);

      expect(REQUIRED_SALES_FULFILLMENT_HEADERS.every((header) => header in ventasRow)).toBe(true);
      expect(admin).not.toBeNull();
      expect(admin?.deliveryMethod).toBe(deliveryMethod);
      expect(admin?.total).toBe(original.total);
      expect(admin?.fulfillment).toEqual(original.fulfillment);

      expect(evaluateFulfillmentCompletion({
        ...original,
        total: admin!.total,
        deliveryMethod: admin!.deliveryMethod,
        fulfillment: admin!.fulfillment,
      })).toEqual({ allowed: true });
    },
  );
});
