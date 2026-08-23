import { describe, expect, it } from "vitest";
import { buildAdminOrderStatusUpdate, summarizeAdminOrderOutcomes } from "./statusIntentUi";

const order = {
  orderId: "order-ui-1",
  paymentStatus: "pending" as const,
  shippingStatus: "in_process" as const,
};

describe("AUD3 H07-C1 Admin UI intent", () => {
  it("H07C1-INTENT-01 does not submit an unchanged payment dimension", () => {
    expect(buildAdminOrderStatusUpdate(order, {
      paymentStatus: "pending",
      shippingStatus: "completed",
    })).toEqual({
      orderId: "order-ui-1",
      changedFields: ["shippingStatus"],
      expectedShippingStatus: "in_process",
      requestedShippingStatus: "completed",
    });
  });

  it("H07C1-INTENT-02 does not submit an unchanged shipping dimension", () => {
    expect(buildAdminOrderStatusUpdate(order, {
      paymentStatus: "confirmed",
      shippingStatus: "in_process",
    })).toEqual({
      orderId: "order-ui-1",
      changedFields: ["paymentStatus"],
      expectedPaymentStatus: "pending",
      requestedPaymentStatus: "confirmed",
    });
  });

  it("H07C1-INTENT-03 submits both expected states when both fields changed", () => {
    expect(buildAdminOrderStatusUpdate(order, {
      paymentStatus: "confirmed",
      shippingStatus: "completed",
    })?.changedFields).toEqual(["paymentStatus", "shippingStatus"]);
  });

  it("H07C1-BATCH-02 reports every outcome with its Order", () => {
    const base = {
      paymentStatus: "pending" as const,
      shippingStatus: "in_process" as const,
      shippingBlocked: false,
    };
    expect(summarizeAdminOrderOutcomes([
      { ...base, orderId: "ok", status: "success" },
      { ...base, orderId: "blocked", status: "business_block" },
      { ...base, orderId: "stale", status: "conflict" },
      { ...base, orderId: "failed", status: "failure" },
    ])).toContain("Guardados: ok.");
    expect(summarizeAdminOrderOutcomes([
      { ...base, orderId: "stale", status: "conflict" },
    ])).toContain("Cambiaron desde que abriste la pantalla: stale.");
  });
});
