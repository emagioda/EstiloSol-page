import { describe, expect, it } from "vitest";
import {
  evaluateFulfillmentCompletion,
  FULFILLMENT_COMPLETION_BLOCK_REASONS,
  getFulfillmentCompletionBlockMessage,
  isTrustedHistoricalCompletion,
} from "./fulfillmentCompletion";
import type { Order } from "./types";

const pickupFulfillment: NonNullable<Order["fulfillment"]> = {
  subtotalProducts: 1000,
  discountAmount: 100,
  shippingFee: 100,
  finalTotal: 1000,
  pickupPoint: {
    id: "pickup-1",
    name: "Estilo Sol",
    address: "San Martín 123",
    reference: "Mostrador principal",
  },
  summary: "Retiro en Estilo Sol",
};

const deliveryFulfillment: NonNullable<Order["fulfillment"]> = {
  subtotalProducts: 1000,
  discountAmount: 0,
  shippingFee: 200,
  finalTotal: 1200,
  deliveryZone: { id: "zone-1", name: "Centro", insideZoneConfirmed: true },
  deliveryAddress: {
    street: "Belgrano",
    number: "456",
    floor: "2 B",
    betweenStreets: "Mitre y Sarmiento",
    notes: "Timbre azul",
  },
  summary: "Belgrano 456, Centro",
};

const makeOrder = (patch: Partial<Order> = {}): Order => ({
  externalReference: "policy-order",
  status: "approved",
  paymentStatus: "confirmed",
  shippingStatus: "in_process",
  paymentMethod: "cash",
  deliveryMethod: "pickup",
  inventoryStatus: "deducted",
  stockDeductedAt: 10,
  items: [{ productId: "p1", title: "Producto", qty: 1, unitPrice: 1000, currency: "ARS" }],
  total: 1000,
  currency: "ARS",
  fulfillment: pickupFulfillment,
  createdAt: 1,
  updatedAt: 1,
  ...patch,
});

describe("AUD3 H07 fulfillment completion policy", () => {
  it("POLICY-01 allows a coherent frozen delivery snapshot", () => {
    expect(evaluateFulfillmentCompletion(makeOrder({
      deliveryMethod: "delivery",
      fulfillment: deliveryFulfillment,
      total: 1200,
    }))).toEqual({ allowed: true });
  });

  it("POLICY-02 allows a coherent frozen pickup snapshot", () => {
    expect(evaluateFulfillmentCompletion(makeOrder())).toEqual({ allowed: true });
  });

  it("POLICY-03 requires paymentStatus exactly confirmed", () => {
    for (const paymentStatus of ["pending", "cancelled", "refunded", "charged_back"] as const) {
      expect(evaluateFulfillmentCompletion(makeOrder({ paymentStatus }))).toEqual({
        allowed: false,
        reason: FULFILLMENT_COMPLETION_BLOCK_REASONS.paymentNotConfirmed,
      });
    }
  });

  it("POLICY-04 requires authoritative deducted inventory evidence", () => {
    for (const inventoryStatus of ["pending", undefined] as const) {
      expect(evaluateFulfillmentCompletion(makeOrder({
        inventoryStatus,
        stockDeductedAt: undefined,
      }))).toEqual({
        allowed: false,
        reason: FULFILLMENT_COMPLETION_BLOCK_REASONS.inventoryNotDeducted,
      });
    }
  });

  it("POLICY-05 distinguishes conflict/error inventory from pending/legacy", () => {
    for (const inventoryStatus of ["conflict", "error"] as const) {
      expect(evaluateFulfillmentCompletion(makeOrder({ inventoryStatus }))).toEqual({
        allowed: false,
        reason: FULFILLMENT_COMPLETION_BLOCK_REASONS.inventoryRequiresAttention,
      });
    }
  });

  it("POLICY-06 rejects a missing fulfillment snapshot", () => {
    expect(evaluateFulfillmentCompletion(makeOrder({ fulfillment: undefined }))).toEqual({
      allowed: false,
      reason: FULFILLMENT_COMPLETION_BLOCK_REASONS.pickupIncomplete,
    });
  });

  it("POLICY-07 rejects malformed, negative, incoherent, and mismatched totals", () => {
    for (const fulfillment of [
      { ...pickupFulfillment, finalTotal: Number.NaN },
      { ...pickupFulfillment, discountAmount: -1 },
      { ...pickupFulfillment, finalTotal: 999 },
      { ...pickupFulfillment, subtotalProducts: 500 },
    ]) {
      expect(evaluateFulfillmentCompletion(makeOrder({ fulfillment }))).toEqual({
        allowed: false,
        reason: FULFILLMENT_COMPLETION_BLOCK_REASONS.totalsInvalid,
      });
    }
  });

  it("POLICY-08 validates required delivery zone and address fields", () => {
    const fulfillment = {
      ...deliveryFulfillment,
      deliveryZone: { ...deliveryFulfillment.deliveryZone!, insideZoneConfirmed: false },
    };
    expect(evaluateFulfillmentCompletion(makeOrder({
      deliveryMethod: "delivery",
      fulfillment,
      total: 1200,
    }))).toEqual({
      allowed: false,
      reason: FULFILLMENT_COMPLETION_BLOCK_REASONS.deliveryIncomplete,
    });
  });

  it("POLICY-09 validates the currently-required pickup reference", () => {
    expect(evaluateFulfillmentCompletion(makeOrder({
      fulfillment: {
        ...pickupFulfillment,
        pickupPoint: { ...pickupFulfillment.pickupPoint!, reference: "" },
      },
    }))).toEqual({
      allowed: false,
      reason: FULFILLMENT_COMPLETION_BLOCK_REASONS.pickupIncomplete,
    });
  });

  it("POLICY-10 fails closed for missing/unknown delivery method without treating MP attention as a blocker", () => {
    expect(evaluateFulfillmentCompletion(makeOrder({
      deliveryMethod: undefined,
      mpPaymentAttentionCode: "MULTIPLE_APPROVED_MP_PAYMENTS",
    }))).toEqual({
      allowed: false,
      reason: FULFILLMENT_COMPLETION_BLOCK_REASONS.deliveryMethodInvalid,
    });
    expect(evaluateFulfillmentCompletion(makeOrder({
      mpPaymentAttentionCode: "MULTIPLE_APPROVED_MP_PAYMENTS",
    }))).toEqual({ allowed: true });
  });

  it("HISTORY-01 trusts a valid completed order after an authoritative refund/chargeback", () => {
    expect(isTrustedHistoricalCompletion(makeOrder({
      paymentStatus: "refunded",
      shippingStatus: "completed",
    }))).toBe(true);
    expect(isTrustedHistoricalCompletion(makeOrder({
      paymentStatus: "charged_back",
      shippingStatus: "completed",
    }))).toBe(true);
  });

  it("UI-REASON-01 exposes stable safe Spanish operator messages", () => {
    expect(getFulfillmentCompletionBlockMessage(
      FULFILLMENT_COMPLETION_BLOCK_REASONS.inventoryNotDeducted
    )).toBe("Stock todavía no descontado.");
    expect(getFulfillmentCompletionBlockMessage(
      FULFILLMENT_COMPLETION_BLOCK_REASONS.totalsInvalid
    )).toBe("Datos/totales históricos incompletos.");
  });
});
