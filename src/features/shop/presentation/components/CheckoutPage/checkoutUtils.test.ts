import { describe, expect, it } from "vitest";
import type { CartItem } from "../../view-models/useCartStore";
import { buildCheckoutDemandItems, getCheckoutTotals } from "./checkoutUtils";

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

describe("checkout demand payload", () => {
  const lines: CartItem[] = [
    {
      lineId: "visual-line-a",
      productId: "P1",
      name: "Producto 1",
      unitPrice: 1000,
      qty: 1,
      stockStatus: "in_stock",
      stockQty: 3,
    },
    {
      lineId: "visual-line-b",
      productId: "P1",
      name: "Producto 1",
      unitPrice: 1000,
      qty: 2,
      stockStatus: "in_stock",
      stockQty: 3,
    },
  ];

  it("PR3-CHECKOUT-05 defensively aggregates manipulated or legacy lines by productId", () => {
    expect(buildCheckoutDemandItems(lines)).toEqual([
      { productId: "P1", qty: 3, name: "Producto 1", unitPrice: 1000 },
    ]);
  });

  it("PR3-CHECKOUT-06 never substitutes lineId for productId", () => {
    expect(buildCheckoutDemandItems(lines)[0].productId).toBe("P1");
    expect(buildCheckoutDemandItems(lines)[0].productId).not.toBe("visual-line-a");
  });

  it("PR3-CHECKOUT-07 omits lineId from authoritative stock data", () => {
    expect(buildCheckoutDemandItems(lines)[0]).not.toHaveProperty("lineId");
  });

  it("PR3-CHECKOUT-09 validates qty1 plus qty2 as demand qty3", () => {
    expect(buildCheckoutDemandItems(lines)).toMatchObject([{ productId: "P1", qty: 3 }]);
  });
});
