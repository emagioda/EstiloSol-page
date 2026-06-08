import { describe, expect, it } from "vitest";
import { getCheckoutTotals } from "./checkoutUtils";

describe("getCheckoutTotals", () => {
  it("does not add delivery shipping when the cart is empty", () => {
    expect(
      getCheckoutTotals({
        subtotalProducts: 0,
        paymentMethod: "mercadopago",
        deliveryMethod: "delivery",
      })
    ).toMatchObject({
      subtotalProducts: 0,
      discountAmount: 0,
      shippingFee: 0,
      finalTotal: 0,
    });
  });

  it("adds delivery shipping only when there are products", () => {
    expect(
      getCheckoutTotals({
        subtotalProducts: 9000,
        paymentMethod: "mercadopago",
        deliveryMethod: "delivery",
      })
    ).toMatchObject({
      subtotalProducts: 9000,
      discountAmount: 0,
      shippingFee: 3500,
      finalTotal: 12500,
    });
  });

  it("uses the selected pickup point shipping fee", () => {
    expect(
      getCheckoutTotals({
        subtotalProducts: 9000,
        paymentMethod: "transfer",
        deliveryMethod: "pickup",
        pickupPointId: "alto-rosario-junin",
      })
    ).toMatchObject({
      subtotalProducts: 9000,
      discountAmount: 900,
      shippingFee: 4000,
      finalTotal: 12100,
    });
  });

  it("rounds cash/transfer discounted totals to hundreds before adding shipping", () => {
    expect(
      getCheckoutTotals({
        subtotalProducts: 12300,
        paymentMethod: "cash",
        deliveryMethod: "pickup",
        pickupPointId: "santa-fe-mitre",
      })
    ).toMatchObject({
      subtotalProducts: 12300,
      discountAmount: 1200,
      shippingFee: 3000,
      finalTotal: 14100,
    });
  });
});
