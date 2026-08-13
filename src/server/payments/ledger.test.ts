import { describe, expect, it } from "vitest";
import type { Order } from "@/src/server/orders/types";
import {
  applyMercadoPagoPaymentObservation,
  MAX_MERCADO_PAGO_PAYMENT_LEDGER_ENTRIES,
  MercadoPagoPaymentLedgerCapacityError,
  MULTIPLE_APPROVED_MP_PAYMENTS,
  type MercadoPagoPaymentObservation,
} from "./ledger";

const baseOrder = (overrides: Partial<Order> = {}): Order => ({
  externalReference: "es-ledger-test",
  status: "created",
  paymentStatus: "pending",
  shippingStatus: "in_process",
  paymentMethod: "mercadopago",
  items: [{ productId: "p1", title: "Producto", unitPrice: 1000, qty: 1, currency: "ARS" }],
  total: 1000,
  currency: "ARS",
  createdAt: 1,
  updatedAt: 1,
  ...overrides,
});

const observation = (
  paymentId: string,
  status: string,
  observedAt: number
): MercadoPagoPaymentObservation => ({
  paymentId,
  status,
  statusDetail: `${status}_detail`,
  amount: 1000,
  currency: "ARS",
  observedAt,
});

const apply = (order: Order, paymentId: string, status: string, observedAt: number): Order => ({
  ...order,
  ...applyMercadoPagoPaymentObservation(order, observation(paymentId, status, observedAt)).patch,
  updatedAt: observedAt,
});

describe("AUD3 Mercado Pago payment ledger aggregation", () => {
  it("AUD3-PAY-01 and PAY-20 keep one entry for duplicate approval", () => {
    const first = apply(baseOrder(), "A", "approved", 10);
    const secondResult = applyMercadoPagoPaymentObservation(first, observation("A", "approved", 20));
    const second = { ...first, ...secondResult.patch };

    expect(Object.keys(second.mpPaymentLedger ?? {})).toEqual(["A"]);
    expect(second.mpPaymentLedger?.A.firstSeenAt).toBe(10);
    expect(second.mpPaymentLedger?.A.lastSeenAt).toBe(20);
    expect(second.paymentStatus).toBe("confirmed");
    expect(secondResult.duplicate).toBe(true);
    expect(secondResult.firstEffectiveApproval).toBe(false);
  });

  it("AUD3-PAY-03 approved A then rejected B remains confirmed", () => {
    const result = apply(apply(baseOrder(), "A", "approved", 10), "B", "rejected", 20);
    expect(result.paymentStatus).toBe("confirmed");
    expect(Object.keys(result.mpPaymentLedger ?? {})).toEqual(["A", "B"]);
  });

  it("AUD3-PAY-04 rejected B then approved A becomes confirmed", () => {
    const result = apply(apply(baseOrder(), "B", "rejected", 10), "A", "approved", 20);
    expect(result.paymentStatus).toBe("confirmed");
    expect(result.mpPaymentId).toBe("A");
  });

  it.each(["cancelled", "pending"])(
    "AUD3-PAY-05/06 approved A plus %s B remains confirmed",
    (status) => {
      const result = apply(apply(baseOrder(), "A", "approved", 10), "B", status, 20);
      expect(result.paymentStatus).toBe("confirmed");
    }
  );

  it("AUD3-PAY-07 preserves two approvals and raises a stable alert", () => {
    const result = apply(apply(baseOrder(), "A", "approved", 10), "B", "approved", 20);
    expect(result.paymentStatus).toBe("confirmed");
    expect(Object.keys(result.mpPaymentLedger ?? {})).toEqual(["A", "B"]);
    expect(result.mpPaymentAttentionCode).toBe(MULTIPLE_APPROVED_MP_PAYMENTS);
    expect(result.mpPaymentId).toBe("A");
  });

  it.each([
    ["refunded", "refunded"],
    ["charged_back", "charged_back"],
  ] as const)("AUD3-PAY-08/09 same approved payment can become %s", (status, expected) => {
    const result = apply(apply(baseOrder(), "A", "approved", 10), "A", status, 20);
    expect(result.paymentStatus).toBe(expected);
    expect(result.mpPaymentLedger?.A.approvedAt).toBe(10);
    expect(result.mpPaymentLedger?.A.status).toBe(status);
  });

  it("AUD3-PAY-10 a refunded A does not hide approved B", () => {
    let result = apply(baseOrder(), "A", "approved", 10);
    result = apply(result, "A", "refunded", 20);
    result = apply(result, "B", "approved", 30);
    expect(result.paymentStatus).toBe("confirmed");
    expect(result.mpPaymentId).toBe("B");
  });

  it("keeps an explicit refund durable against a stale later pending observation", () => {
    let result = apply(baseOrder(), "A", "approved", 10);
    result = apply(result, "A", "refunded", 20);
    result = apply(result, "A", "pending", 30);
    expect(result.paymentStatus).toBe("refunded");
    expect(result.mpPaymentLedger?.A.status).toBe("refunded");
    expect(result.mpPaymentLedger?.A.lastSeenAt).toBe(30);
  });

  it("AUD3-PAY-11 an old rejected B cannot overwrite approved A", () => {
    let result = apply(baseOrder(), "B", "pending", 5);
    result = apply(result, "A", "approved", 20);
    result = apply(result, "B", "rejected", 10);
    expect(result.paymentStatus).toBe("confirmed");
    expect(result.mpPaymentLedger?.B.lastSeenAt).toBe(10);
  });

  it("AUD3-PAY-17 preserves a legacy confirmed order without backfill", () => {
    const legacy = baseOrder({
      status: "approved",
      paymentStatus: "confirmed",
      mpPaymentId: "A",
      mpStatus: "approved",
      approvedAt: 5,
    });
    const result = apply(legacy, "B", "rejected", 20);
    expect(result.paymentStatus).toBe("confirmed");
    expect(result.mpPaymentId).toBe("A");
    expect(result.mpPaymentLedger).not.toHaveProperty("A");
  });

  it("AUD3-PAY-18 stores no payer or customer PII", () => {
    const result = apply(baseOrder(), "A", "approved", 10);
    const serialized = JSON.stringify(result.mpPaymentLedger);
    expect(serialized).not.toMatch(/customer|payer|email|phone|address|dni|token/i);
    expect(result.mpPaymentLedger?.A).toEqual({
      paymentId: "A",
      status: "approved",
      statusDetail: "approved_detail",
      amount: 1000,
      currency: "ARS",
      firstSeenAt: 10,
      lastSeenAt: 10,
      approvedAt: 10,
    });
  });

  it("fails closed at the defensive ledger bound without discarding evidence", () => {
    let order = baseOrder();
    for (let index = 0; index < MAX_MERCADO_PAGO_PAYMENT_LEDGER_ENTRIES; index += 1) {
      order = apply(order, `P${index}`, index === 0 ? "approved" : "rejected", index + 1);
    }
    expect(() => apply(order, "OVERFLOW", "pending", 100)).toThrow(
      MercadoPagoPaymentLedgerCapacityError
    );
    expect(Object.keys(order.mpPaymentLedger ?? {})).toHaveLength(
      MAX_MERCADO_PAGO_PAYMENT_LEDGER_ENTRIES
    );
    expect(order.mpPaymentLedger?.P0.status).toBe("approved");
  });
});
