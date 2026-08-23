import { describe, expect, it } from "vitest";
import {
  assertValidAdminOrderStatusIntent,
  evaluateAdminStatusIntent,
  type AdminOrderStatusIntent,
} from "./adminIntent";

const current = { paymentStatus: "pending", shippingStatus: "in_process" } as const;

describe("AUD3 H07-C1 Admin status intent", () => {
  it("H07C1-INTENT-01 evaluates only the shipping field", () => {
    expect(evaluateAdminStatusIntent(current, {
      changedFields: ["shippingStatus"],
      expectedShippingStatus: "in_process",
      requestedShippingStatus: "completed",
    })).toEqual({ outcome: "allow" });
  });

  it("H07C1-INTENT-02 evaluates only the payment field", () => {
    expect(evaluateAdminStatusIntent(current, {
      changedFields: ["paymentStatus"],
      expectedPaymentStatus: "pending",
      requestedPaymentStatus: "confirmed",
    })).toEqual({ outcome: "allow" });
  });

  it("H07C1-INTENT-03 rejects a multi-field intent when one target conflicts", () => {
    const intent: AdminOrderStatusIntent = {
      changedFields: ["paymentStatus", "shippingStatus"],
      expectedPaymentStatus: "pending",
      requestedPaymentStatus: "confirmed",
      expectedShippingStatus: "in_process",
      requestedShippingStatus: "completed",
    };
    expect(evaluateAdminStatusIntent(
      { paymentStatus: "confirmed", shippingStatus: "completed" },
      intent
    )).toEqual({ outcome: "idempotent_replay" });
    expect(evaluateAdminStatusIntent(
      { paymentStatus: "cancelled", shippingStatus: "in_process" },
      intent
    )).toEqual({
      outcome: "conflict",
      current: { paymentStatus: "cancelled", shippingStatus: "in_process" },
    });
  });

  it("H07C1-INTENT-04 fails closed for duplicate, unknown, or incomplete fields", () => {
    expect(() => assertValidAdminOrderStatusIntent({
      changedFields: ["paymentStatus", "paymentStatus"],
      expectedPaymentStatus: "pending",
      requestedPaymentStatus: "confirmed",
    })).toThrow("Invalid Admin order status intent");
    expect(() => assertValidAdminOrderStatusIntent({
      changedFields: ["unknown" as "paymentStatus"],
    })).toThrow("Invalid Admin order status intent");
    expect(() => assertValidAdminOrderStatusIntent({
      changedFields: ["shippingStatus"],
      requestedShippingStatus: "completed",
    })).toThrow("Invalid Admin order status intent");
  });

  it("H07C1-KV-04 treats a response-loss retry as a whole-intent replay", () => {
    expect(evaluateAdminStatusIntent(
      { paymentStatus: "pending", shippingStatus: "completed" },
      {
        changedFields: ["shippingStatus"],
        expectedShippingStatus: "in_process",
        requestedShippingStatus: "completed",
      }
    )).toEqual({ outcome: "idempotent_replay" });
  });
});
