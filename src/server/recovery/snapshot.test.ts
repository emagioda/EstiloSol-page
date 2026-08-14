import { describe, expect, it } from "vitest";
import type { Order } from "@/src/server/orders/types";
import {
  buildRecoveryOrderSnapshot,
  canonicalJson,
  hashRecoverySnapshot,
  parseStoredRecoverySnapshot,
  recoverySnapshotMatchesOrder,
  recoverySnapshotToOrder,
  serializeRecoverySnapshot,
} from "./snapshot";

const order = (): Order => ({
  externalReference: "es-recovery-snapshot-000001",
  status: "created",
  paymentStatus: "pending",
  shippingStatus: "in_process",
  inventoryStatus: "pending",
  paymentMethod: "mercadopago",
  deliveryMethod: "delivery",
  items: [{ productId: "p1", title: "Producto", unitPrice: 1000, qty: 1, currency: "ARS" }],
  total: 1200,
  currency: "ARS",
  customer: { name: "Ana", email: "ana@example.test", phone: "+5491100000000" },
  fulfillment: {
    subtotalProducts: 1000,
    discountAmount: 0,
    shippingFee: 200,
    finalTotal: 1200,
    deliveryAddress: { street: "Calle", number: "1", betweenStreets: "A y B" },
    summary: "Entrega a domicilio",
  },
  createdAt: 1_786_600_000_000,
  updatedAt: 1_786_600_000_000,
});

const build = () => buildRecoveryOrderSnapshot({
  order: order(),
  checkoutAttemptId: "attempt-recovery-000001",
  preferenceValidFrom: 1_786_600_000_000,
  preferenceExpiresAt: 1_786_772_800_000,
});

describe("AUD3-H06 recovery snapshot contract", () => {
  it("creates a deterministic canonical hash independent of object key order", () => {
    expect(canonicalJson({ z: 1, a: { y: 2, x: 3 } })).toBe('{"a":{"x":3,"y":2},"z":1}');
    expect(hashRecoverySnapshot(build())).toBe(hashRecoverySnapshot(build()));
  });

  it("captures the complete trusted checkout data and exact 48h preference window", () => {
    const snapshot = build();
    expect(snapshot).toMatchObject({
      schemaVersion: 1,
      externalReference: order().externalReference,
      checkoutAttemptId: "attempt-recovery-000001",
      subtotal: 1000,
      total: 1200,
      currency: "ARS",
      paymentMethod: "mercadopago",
      deliveryMethod: "delivery",
    });
    expect(snapshot.preferenceExpiresAt - snapshot.preferenceValidFrom).toBe(48 * 60 * 60 * 1000);
  });

  it("round trips a stored snapshot into an independently reconstructable order", () => {
    const snapshot = build();
    const serialized = serializeRecoverySnapshot(snapshot);
    const parsed = parseStoredRecoverySnapshot({
      externalReference: snapshot.externalReference,
      checkoutAttemptId: snapshot.checkoutAttemptId,
      schemaVersion: 1,
      snapshotHash: serialized.snapshotHash,
      snapshotJson: serialized.snapshotJson,
      createdAt: new Date(snapshot.createdAt).toISOString(),
      preferenceValidFrom: new Date(snapshot.preferenceValidFrom).toISOString(),
      preferenceExpiresAt: new Date(snapshot.preferenceExpiresAt).toISOString(),
      recoveryState: "pending_payment",
      updatedAt: new Date(snapshot.createdAt).toISOString(),
    });
    const reconstructed = recoverySnapshotToOrder(parsed);
    expect(recoverySnapshotMatchesOrder(parsed, reconstructed)).toBe(true);
    expect(reconstructed).toMatchObject({
      externalReference: snapshot.externalReference,
      paymentStatus: "pending",
      salesSheetDeferredUntilApprovedAt: snapshot.createdAt,
    });
  });

  it("fails closed when immutable snapshot JSON is modified", () => {
    const snapshot = build();
    const serialized = serializeRecoverySnapshot(snapshot);
    expect(() => parseStoredRecoverySnapshot({
      externalReference: snapshot.externalReference,
      checkoutAttemptId: snapshot.checkoutAttemptId,
      schemaVersion: 1,
      snapshotHash: serialized.snapshotHash,
      snapshotJson: serialized.snapshotJson.replace('"total":1200', '"total":999'),
      createdAt: new Date(snapshot.createdAt).toISOString(),
      preferenceValidFrom: new Date(snapshot.preferenceValidFrom).toISOString(),
      preferenceExpiresAt: new Date(snapshot.preferenceExpiresAt).toISOString(),
      recoveryState: "pending_payment",
      updatedAt: new Date(snapshot.createdAt).toISOString(),
    })).toThrow(/integrity/i);
  });

  it("fails closed when a stored hash is missing after redaction", () => {
    const snapshot = build();
    expect(() => parseStoredRecoverySnapshot({
      externalReference: snapshot.externalReference,
      checkoutAttemptId: snapshot.checkoutAttemptId,
      schemaVersion: 1,
      snapshotHash: hashRecoverySnapshot(snapshot),
      snapshotJson: "",
      createdAt: new Date(snapshot.createdAt).toISOString(),
      preferenceValidFrom: new Date(snapshot.preferenceValidFrom).toISOString(),
      preferenceExpiresAt: new Date(snapshot.preferenceExpiresAt).toISOString(),
      recoveryState: "completed",
      updatedAt: new Date(snapshot.createdAt).toISOString(),
    })).toThrow(/unavailable/i);
  });

  it("rejects a non-Mercado-Pago order before any durable write", () => {
    expect(() => buildRecoveryOrderSnapshot({
      order: { ...order(), paymentMethod: "cash" },
      checkoutAttemptId: "attempt-recovery-000002",
      preferenceValidFrom: 1_786_600_000_000,
      preferenceExpiresAt: 1_786_772_800_000,
    })).toThrow(/Mercado Pago/i);
  });
});
