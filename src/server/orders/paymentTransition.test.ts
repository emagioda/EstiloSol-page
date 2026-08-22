import { describe, expect, it } from "vitest";
import {
  evaluateAdminPaymentTransitionRequest,
  evaluatePaymentTransition,
  isAdminPaymentStatusSelectable,
  PAYMENT_TRANSITION_BLOCK_REASONS,
} from "./paymentTransition";
import type { OrderPaymentMethod, OrderPaymentStatus } from "./types";

const manual = (
  paymentMethod: OrderPaymentMethod,
  current: OrderPaymentStatus,
  requested: OrderPaymentStatus
) => evaluatePaymentTransition({
  authority: "admin_manual",
  paymentMethod,
  current,
  requested,
});

describe("AUD3 H07-B payment transition policy", () => {
  it.each(["cash", "transfer"] as const)(
    "AUD3-H07B-POLICY-01/02 allows %s pending to confirmed",
    (paymentMethod) => {
      expect(manual(paymentMethod, "pending", "confirmed")).toEqual({
        allowed: true,
        replay: false,
      });
    }
  );

  it.each(["cash", "transfer", "mercadopago"] as const)(
    "AUD3-H07B-POLICY-03 blocks confirmed to pending for %s",
    (paymentMethod) => {
      expect(manual(paymentMethod, "confirmed", "pending")).toEqual({
        allowed: false,
        reason: PAYMENT_TRANSITION_BLOCK_REASONS.confirmedCannotBeDowngraded,
      });
    }
  );

  it.each(["cancelled", "refunded", "charged_back"] as const)(
    "AUD3-H07B-POLICY-04 blocks confirmed to %s",
    (requested) => {
      expect(manual("cash", "confirmed", requested)).toMatchObject({
        allowed: false,
        reason: PAYMENT_TRANSITION_BLOCK_REASONS.confirmedCannotBeDowngraded,
      });
    }
  );

  it.each([
    ["cancelled", "pending"],
    ["refunded", "confirmed"],
    ["charged_back", "cancelled"],
  ] as const)("AUD3-H07B-POLICY-05/07 blocks terminal %s to %s", (current, requested) => {
    expect(manual("transfer", current, requested)).toEqual({
      allowed: false,
      reason: PAYMENT_TRANSITION_BLOCK_REASONS.terminalRequiresCorrection,
    });
  });

  it.each(["pending", "confirmed", "cancelled", "refunded", "charged_back"] as const)(
    "AUD3-H07B-POLICY-08 allows %s replay",
    (status) => {
      expect(manual("mercadopago", status, status)).toEqual({ allowed: true, replay: true });
    }
  );

  it("AUD3-H07B-POLICY-09 requires provider authority for direct MP confirmation", () => {
    expect(manual("mercadopago", "pending", "confirmed")).toEqual({
      allowed: false,
      reason: PAYMENT_TRANSITION_BLOCK_REASONS.providerAuthorityRequired,
    });
    expect(evaluateAdminPaymentTransitionRequest({
      paymentMethod: "mercadopago",
      current: "pending",
      requested: "confirmed",
    })).toEqual({
      allowed: true,
      replay: false,
      authority: "mp_authoritative",
    });
  });

  it.each([
    ["confirmed", "refunded"],
    ["confirmed", "charged_back"],
    ["refunded", "charged_back"],
    ["charged_back", "confirmed"],
  ] as const)(
    "AUD3-H07B-POLICY-10 allows authoritative %s to %s",
    (current, requested) => {
      expect(evaluatePaymentTransition({
        authority: "mp_authoritative",
        paymentMethod: "mercadopago",
        current,
        requested,
      })).toEqual({ allowed: true, replay: false });
    }
  );

  it("AUD3-H07B-UI-01 exposes only the normal pending confirmation target", () => {
    expect(isAdminPaymentStatusSelectable({
      current: "pending",
      requested: "confirmed",
      paymentMethod: "cash",
    })).toBe(true);
    expect(isAdminPaymentStatusSelectable({
      current: "pending",
      requested: "refunded",
      paymentMethod: "cash",
    })).toBe(false);
  });
});
