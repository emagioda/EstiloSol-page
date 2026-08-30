import { describe, expect, it } from "vitest";
import { fallbackFulfillmentConfig, type FulfillmentConfig } from "@/src/config/fulfillment";
import { evaluateFulfillmentCompletion } from "./fulfillmentCompletion";
import { buildOrderFromCheckout } from "./createFromCheckout";

const cloneConfig = (): FulfillmentConfig => structuredClone(fallbackFulfillmentConfig);

const baseInput = {
  items: [{ productId: "p-1", title: "Producto", unitPrice: 1000, qty: 1, currency: "ARS" as const }],
  customerName: "Ana Pérez",
  customerPhone: "3415550000",
  customerEmail: "ana@example.com",
  notes: "",
  paymentMethod: "cash" as const,
  identity: { externalReference: "order-fulfillment-test", summaryToken: "summary-token" },
};

describe("AUD3 H07-EF checkout Order creation", () => {
  it("EF-F-01A-01 cannot create a delivery Order when delivery is inactive", () => {
    const config = cloneConfig();
    config.delivery.active = false;

    const result = buildOrderFromCheckout({
      ...baseInput,
      deliveryMethod: "delivery",
      fulfillmentConfig: config,
      fulfillment: {
        deliveryAddress: {
          street: "San Juan",
          number: "1234",
          floor: "",
          betweenStreets: "Mitre y Entre Ríos",
          notes: "",
          insideZoneConfirmed: true,
        },
      },
    });

    expect(result.order).toBeNull();
  });

  it("EF-F-01A-02 creates active delivery only with the explicit zone confirmation", () => {
    const result = buildOrderFromCheckout({
      ...baseInput,
      deliveryMethod: "delivery",
      fulfillmentConfig: cloneConfig(),
      fulfillment: {
        deliveryAddress: {
          street: "San Juan",
          number: "1234",
          floor: "",
          betweenStreets: "Mitre y Entre Ríos",
          notes: "",
          insideZoneConfirmed: true,
        },
      },
    });

    expect(result.order).toMatchObject({
      deliveryMethod: "delivery",
      fulfillment: {
        deliveryZone: { insideZoneConfirmed: true },
        deliveryAddress: { street: "San Juan", number: "1234" },
      },
    });
  });

  it("EF-F-01A-03 cannot create pickup when the top-level pickup option is inactive", () => {
    const config = cloneConfig();
    config.pickup.active = false;

    const result = buildOrderFromCheckout({
      ...baseInput,
      deliveryMethod: "pickup",
      fulfillmentConfig: config,
      fulfillment: { pickupPointId: "santa-fe-mitre" },
    });

    expect(result.order).toBeNull();
  });

  it("EF-E-03 cannot create pickup from an incomplete active point", () => {
    const config = cloneConfig();
    config.pickupPoints[0] = { ...config.pickupPoints[0]!, subtitle: "" };

    const result = buildOrderFromCheckout({
      ...baseInput,
      deliveryMethod: "pickup",
      fulfillmentConfig: config,
      fulfillment: { pickupPointId: "santa-fe-mitre" },
    });

    expect(result.order).toBeNull();
  });

  it("EF-E-03-03 keeps an inactive pickup point rejected", () => {
    const config = cloneConfig();
    config.pickupPoints[0] = { ...config.pickupPoints[0]!, active: false };

    const result = buildOrderFromCheckout({
      ...baseInput,
      deliveryMethod: "pickup",
      fulfillmentConfig: config,
      fulfillment: { pickupPointId: "santa-fe-mitre" },
    });

    expect(result.order).toBeNull();
  });

  it.each([
    ["delivery", {
      deliveryAddress: {
        street: "San Juan",
        number: "1234",
        floor: "",
        betweenStreets: "Mitre y Entre Ríos",
        notes: "",
        insideZoneConfirmed: true,
      },
    }],
    ["pickup", { pickupPointId: "santa-fe-mitre" }],
  ] as const)("EF-E-02 preserves a valid %s snapshot for H07-A", (deliveryMethod, fulfillment) => {
    const { order } = buildOrderFromCheckout({
      ...baseInput,
      deliveryMethod,
      fulfillmentConfig: cloneConfig(),
      fulfillment,
    });
    expect(order).not.toBeNull();

    expect(evaluateFulfillmentCompletion({
      ...order!,
      status: "approved",
      paymentStatus: "confirmed",
      inventoryStatus: "deducted",
      stockDeductedAt: Date.now(),
    })).toEqual({ allowed: true });
  });
});
