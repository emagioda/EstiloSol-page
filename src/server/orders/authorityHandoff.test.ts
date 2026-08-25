import { describe, expect, it } from "vitest";
import type { RecoveryPaymentEvent } from "@/src/server/recovery/types";
import type { AdminOrderSheetRow } from "@/src/server/sheets/repository";
import { evaluateFulfillmentCompletion } from "./fulfillmentCompletion";
import type { InventoryAttemptResult } from "./inventory";
import type { Order } from "./types";
import {
  buildRecoveryAuthorityCandidate,
  ORDER_AUTHORITY_HANDOFF_ERRORS,
  parseCanonicalManualPaymentEvidence,
} from "./authorityHandoff";

const NOW = Date.parse("2026-08-25T12:00:00.000Z");

const snapshotOrder = (patch: Partial<Order> = {}): Order => ({
  externalReference: "h07d2-order-000001",
  status: "preference_created",
  paymentStatus: "pending",
  shippingStatus: "in_process",
  inventoryStatus: "pending",
  paymentMethod: "mercadopago",
  deliveryMethod: "pickup",
  items: [{ productId: "p1", title: "Producto", unitPrice: 1000, qty: 1, currency: "ARS" }],
  total: 1000,
  currency: "ARS",
  fulfillment: {
    subtotalProducts: 1000,
    discountAmount: 0,
    shippingFee: 0,
    finalTotal: 1000,
    pickupPoint: {
      id: "pickup-1",
      name: "Estilo Sol",
      address: "San Martín 123",
      reference: "Mostrador",
    },
    summary: "Retiro",
  },
  customer: { name: "Snapshot", email: "snapshot@example.com" },
  createdAt: NOW - 60_000,
  updatedAt: NOW - 60_000,
  ...patch,
});

const salesRow = (patch: Partial<AdminOrderSheetRow> = {}): AdminOrderSheetRow => ({
  orderId: "h07d2-order-000001",
  createdAt: new Date(NOW - 60_000).toISOString(),
  createdAtMs: NOW - 60_000,
  customerName: "Stale Sheet Customer",
  whatsapp: "",
  email: "stale@example.com",
  total: 1000,
  currency: "ARS",
  paymentStatus: "confirmed",
  shippingStatus: "in_process",
  inventoryStatus: "deducted",
  inventoryIssueCode: "",
  inventoryIssueAt: "",
  stockDeductedAt: new Date(NOW - 30_000).toISOString(),
  paymentMethod: "mercadopago",
  deliveryMethod: "pickup",
  items: [{ productId: "p1", title: "Producto", unitPrice: 1000, qty: 1 }],
  itemsSummary: "1x Producto",
  notes: "stale",
  receiptEmailSentAt: "",
  ...patch,
  raw: {
    nro_de_compra: "h07d2-order-000001",
    fecha: new Date(NOW - 60_000).toISOString(),
    total: 1000,
    currency: "ARS",
    estado_de_pago:
      patch.paymentStatus === "refunded"
        ? "Reintegrado"
        : patch.paymentStatus === "charged_back"
          ? "Contracargo"
          : patch.paymentStatus === "cancelled"
            ? "Cancelado"
            : patch.paymentStatus === "pending"
              ? "Pendiente"
              : "Confirmado",
    estado_de_envio: patch.shippingStatus === "completed" ? "Finalizado" : "En proceso",
    payment_method_code: patch.paymentMethod ?? "mercadopago",
    delivery_method_code: patch.deliveryMethod ?? "pickup",
    mp_status: "approved",
    mp_payment_id: "stale-sheet-payment",
    receipt_outbox_version: 1,
    ...(patch.raw ?? {}),
  },
});

const event = (
  financialStatus: RecoveryPaymentEvent["financialStatus"],
  patch: Partial<RecoveryPaymentEvent> = {},
): RecoveryPaymentEvent => ({
  eventKey: `${financialStatus}-${"e".repeat(64)}`,
  paymentId: "mp-payment-1",
  externalReference: "h07d2-order-000001",
  financialStatus,
  amount: 1000,
  currency: "ARS",
  observedAt: new Date(
    NOW + (financialStatus === "approved" ? 0 : financialStatus === "refunded" ? 1000 : 2000),
  ).toISOString(),
  source: "webhook",
  schemaVersion: 1,
  snapshotHash: "a".repeat(64),
  validationState: "validated",
  processingState: "pending",
  attemptCount: 0,
  updatedAt: new Date(NOW).toISOString(),
  ...patch,
});

const journalApplied: InventoryAttemptResult = {
  status: "deducted",
  stockDeductedAt: NOW - 500,
  deduped: true,
};

describe("AUD3 H07-D2A authority merge policy", () => {
  it("H07D2-KVABS-01 publishes completed in the first candidate when cross-domain history is proven", () => {
    const candidate = buildRecoveryAuthorityCandidate({
      snapshotOrder: snapshotOrder(),
      paymentEvents: [event("approved")],
      salesRow: salesRow({ shippingStatus: "completed" }),
      inventoryResult: journalApplied,
      receiptEventExists: true,
      now: NOW,
    });

    expect(candidate).toMatchObject({
      paymentStatus: "confirmed",
      inventoryStatus: "deducted",
      shippingStatus: "completed",
      receiptOutboxVersion: 1,
      mpPaymentId: "mp-payment-1",
    });
  });

  it("H07D2-TERM-01 keeps valid physical completion after provider refund and chargeback", () => {
    for (const terminal of ["refunded", "charged_back"] as const) {
      const candidate = buildRecoveryAuthorityCandidate({
        snapshotOrder: snapshotOrder(),
        paymentEvents: [event("approved"), event(terminal)],
        salesRow: salesRow({ shippingStatus: "completed" }),
        inventoryResult: journalApplied,
        receiptEventExists: true,
        now: NOW,
      });
      expect(candidate).toMatchObject({
        paymentStatus: terminal,
        inventoryStatus: "deducted",
        shippingStatus: "completed",
      });
    }
  });

  it("H07D2-KVABS-03 lets the journal override a pending ventas inventory projection", () => {
    const candidate = buildRecoveryAuthorityCandidate({
      snapshotOrder: snapshotOrder(),
      paymentEvents: [event("approved")],
      salesRow: salesRow({ inventoryStatus: "pending", stockDeductedAt: "" }),
      inventoryResult: journalApplied,
      receiptEventExists: false,
    });
    expect(candidate.inventoryStatus).toBe("deducted");
  });

  it("H07D2-KVABS-04 repairs only the outbox-backed receipt marker", () => {
    const withEvent = buildRecoveryAuthorityCandidate({
      snapshotOrder: snapshotOrder(),
      paymentEvents: [event("approved")],
      salesRow: salesRow(),
      inventoryResult: journalApplied,
      receiptEventExists: true,
    });
    const withoutEvent = buildRecoveryAuthorityCandidate({
      snapshotOrder: snapshotOrder(),
      paymentEvents: [event("approved")],
      salesRow: salesRow(),
      inventoryResult: journalApplied,
      receiptEventExists: false,
    });
    expect(withEvent.receiptOutboxVersion).toBe(1);
    expect(withoutEvent.receiptOutboxVersion).toBeUndefined();
  });

  it("H07D2-KVABS-05/FALLBACK-AUTH-01 never imports stale MP financial truth", () => {
    const candidate = buildRecoveryAuthorityCandidate({
      snapshotOrder: snapshotOrder(),
      paymentEvents: [event("refunded")],
      salesRow: salesRow({ paymentStatus: "confirmed", shippingStatus: "in_process" }),
      receiptEventExists: false,
    });
    expect(candidate).toMatchObject({
      paymentStatus: "refunded",
      inventoryStatus: "pending",
      shippingStatus: "in_process",
    });
    expect(evaluateFulfillmentCompletion({ ...candidate, shippingStatus: "completed" })).toEqual({
      allowed: false,
      reason: "PAYMENT_NOT_CONFIRMED",
    });
  });

  it("H07D2-FALLBACK-AUTH-02 accepts lagging ventas after canonical payment and journal proof", () => {
    const candidate = buildRecoveryAuthorityCandidate({
      snapshotOrder: snapshotOrder(),
      paymentEvents: [event("approved")],
      salesRow: salesRow({ inventoryStatus: "pending", stockDeductedAt: "" }),
      inventoryResult: journalApplied,
      receiptEventExists: false,
    });
    expect(evaluateFulfillmentCompletion({ ...candidate, shippingStatus: "completed" })).toEqual({
      allowed: true,
    });
  });

  it("H07D2-FALLBACK-AUTH-03 rejects a completed cell without journal proof", () => {
    expect(() => buildRecoveryAuthorityCandidate({
      snapshotOrder: snapshotOrder(),
      paymentEvents: [event("approved")],
      salesRow: salesRow({ shippingStatus: "completed" }),
      inventoryResult: {
        status: "conflict",
        issueCode: "INVENTORY_IDEMPOTENCY_CONFLICT",
        issueAt: NOW,
      },
      receiptEventExists: false,
    })).toThrow(expect.objectContaining({
      code: ORDER_AUTHORITY_HANDOFF_ERRORS.untrustedHistoricalCompletion,
    }));
  });

  it("H07D2-EVIDENCE-ABSENT-01 keeps missing durable provider evidence unknown", () => {
    expect(() => buildRecoveryAuthorityCandidate({
      snapshotOrder: snapshotOrder(),
      paymentEvents: [],
      salesRow: null,
      receiptEventExists: false,
    })).toThrow(expect.objectContaining({
      code: ORDER_AUTHORITY_HANDOFF_ERRORS.invalidCandidate,
    }));
  });

  it("H07D2-NOROWIMPORT-01 copies immutable customer facts only from the snapshot", () => {
    const candidate = buildRecoveryAuthorityCandidate({
      snapshotOrder: snapshotOrder(),
      paymentEvents: [event("approved"), event("refunded")],
      salesRow: salesRow({
        customerName: "Injected",
        email: "injected@example.com",
        raw: { mp_status: "approved", mp_payment_id: "forged" },
      }),
      inventoryResult: journalApplied,
      receiptEventExists: false,
    });
    expect(candidate.customer).toEqual({ name: "Snapshot", email: "snapshot@example.com" });
    expect(candidate.paymentStatus).toBe("refunded");
    expect(candidate.mpPaymentId).toBe("mp-payment-1");
  });
});

describe("AUD3 H07-D2A manual evidence parser", () => {
  const manualRow = (patch: Partial<AdminOrderSheetRow> = {}) => salesRow({
    paymentMethod: "cash",
    paymentStatus: "confirmed",
    raw: {
      order_status: "approved",
      mp_status: "manual_confirmed",
      mp_payment_id: "manual-h07d2-order-000001",
      approved_at: new Date(NOW).toISOString(),
      receipt_outbox_version: 1,
    },
    ...patch,
  });

  it("accepts only the exact cash/transfer H07-C1 signature", () => {
    expect(parseCanonicalManualPaymentEvidence(manualRow(), "cash")).toEqual({
      paymentMethod: "cash",
      paymentId: "manual-h07d2-order-000001",
      approvedAt: NOW,
    });
    expect(parseCanonicalManualPaymentEvidence(manualRow({
      paymentMethod: "transfer",
    }), "transfer")?.paymentMethod).toBe("transfer");
  });

  it("H07D2-MANUAL-01 reconstructs only the exact durable manual signature", () => {
    const candidate = buildRecoveryAuthorityCandidate({
      snapshotOrder: snapshotOrder({ paymentMethod: "cash" }),
      paymentEvents: [],
      salesRow: manualRow(),
      inventoryResult: journalApplied,
      receiptEventExists: false,
      now: NOW,
    });
    expect(candidate).toMatchObject({
      status: "approved",
      paymentStatus: "confirmed",
      mpStatus: "manual_confirmed",
      mpPaymentId: "manual-h07d2-order-000001",
      approvedAt: NOW,
      inventoryStatus: "deducted",
      receiptOutboxVersion: 1,
    });
  });

  it.each([
    ["wrong id", { raw: { ...manualRow().raw, mp_payment_id: "manual-wrong" } }],
    ["missing approvedAt", { raw: { ...manualRow().raw, approved_at: "" } }],
    ["missing receipt version", { raw: { ...manualRow().raw, receipt_outbox_version: "" } }],
    ["method mismatch", { paymentMethod: "transfer" }],
    ["partial legacy", { raw: { mp_status: "manual_confirmed" } }],
  ] as const)("rejects %s", (_name, patch) => {
    expect(parseCanonicalManualPaymentEvidence(
      manualRow(patch as Partial<AdminOrderSheetRow>),
      "cash",
    )).toBeNull();
  });
});
