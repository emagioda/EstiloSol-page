import { describe, expect, it } from "vitest";
import {
  buildRecoveryPaymentEvent,
  buildRecoveryPaymentEventKey,
  normalizeProtectedPaymentObservation,
  validateProtectedPaymentAgainstOrder,
} from "./paymentEvent";

const payment = (status = "approved", patch: Record<string, unknown> = {}) => ({
  id: "pay_123",
  status,
  status_detail: "accredited",
  external_reference: "es-recovery-event-000001",
  transaction_amount: 1000,
  currency_id: "ARS",
  date_last_updated: "2026-08-13T12:00:00.000Z",
  ...patch,
});

describe("AUD3-H06 protected payment event contract", () => {
  it("protects approved, refunded, and charged_back but ignores transient states", () => {
    expect(normalizeProtectedPaymentObservation({ payment: payment("approved") })?.financialStatus).toBe("approved");
    expect(normalizeProtectedPaymentObservation({ payment: payment("refunded") })?.financialStatus).toBe("refunded");
    expect(normalizeProtectedPaymentObservation({ payment: payment("charged_back") })?.financialStatus).toBe("charged_back");
    expect(normalizeProtectedPaymentObservation({ payment: payment("pending") })).toBeNull();
  });

  it("derives deterministic event identity without wall-clock or random input", () => {
    const observation = normalizeProtectedPaymentObservation({ payment: payment() })!;
    expect(buildRecoveryPaymentEventKey(observation)).toBe(buildRecoveryPaymentEventKey(observation));
    expect(buildRecoveryPaymentEventKey(observation)).toMatch(/^[a-f0-9]{64}$/);
  });

  it("distinguishes approved, refunded, and charged_back evidence for one payment", () => {
    const keys = ["approved", "refunded", "charged_back"].map((status) =>
      buildRecoveryPaymentEventKey(normalizeProtectedPaymentObservation({ payment: payment(status) })!),
    );
    expect(new Set(keys).size).toBe(3);
  });

  it("distinguishes authoritative update versions of the same financial status", () => {
    const first = normalizeProtectedPaymentObservation({ payment: payment() })!;
    const second = normalizeProtectedPaymentObservation({
      payment: payment("approved", { date_last_updated: "2026-08-13T12:01:00.000Z" }),
    })!;
    expect(buildRecoveryPaymentEventKey(first)).not.toBe(buildRecoveryPaymentEventKey(second));
  });

  it("validates reference, amount, and currency against trusted local truth", () => {
    const observation = normalizeProtectedPaymentObservation({ payment: payment() })!;
    expect(validateProtectedPaymentAgainstOrder(observation, {
      externalReference: "es-recovery-event-000001",
      total: 1000,
      currency: "ARS",
    })).toEqual({ valid: true });
    expect(validateProtectedPaymentAgainstOrder(observation, {
      externalReference: "es-other-000001",
      total: 1000,
      currency: "ARS",
    })).toEqual({ valid: false, errorCode: "RECOVERY_PAYMENT_REFERENCE_MISMATCH" });
  });

  it("persists financial evidence only and excludes payer/card/token/customer data", () => {
    const observation = normalizeProtectedPaymentObservation({
      payment: payment("approved", {
        payer: { email: "secret@example.test" },
        card: { last_four_digits: "1234" },
        token: "secret-token",
      }),
    })!;
    const event = buildRecoveryPaymentEvent({
      observation,
      source: "webhook",
      observedAt: Date.parse("2026-08-13T12:00:01.000Z"),
      snapshotHash: "a".repeat(64),
      validationState: "validated",
    });
    const serialized = JSON.stringify(event).toLowerCase();
    expect(event).toMatchObject({ processingState: "pending", validationState: "validated" });
    for (const forbidden of ["email", "phone", "address", "payer", "card", "token", "customer"]) {
      expect(serialized).not.toContain(forbidden);
    }
  });
});
