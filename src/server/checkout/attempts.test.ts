import { afterEach, describe, expect, it, vi } from "vitest";
import { getJson } from "@/src/server/kv";
import type { Order } from "@/src/server/orders/types";
import type { ParsedCheckoutBody } from "@/src/server/validation/payments";
import {
  CheckoutAttemptConflictError,
  acquireCheckoutAttemptLease,
  beginCheckoutAttempt,
  buildCheckoutAttemptFingerprint,
  completeCheckoutAttempt,
  getCheckoutAttempt,
  getOrCreateCheckoutAttempt,
  prepareCheckoutAttempt,
  releaseCheckoutAttemptLease,
} from "./attempts";

let sequence = 0;
const attemptId = (label: string) => `attempt-${label}-${Date.now()}-${++sequence}`;

const checkoutBody = (overrides: Partial<ParsedCheckoutBody> = {}): ParsedCheckoutBody => ({
  items: [{ productId: "p-1", qty: 1, requestedUnitPrices: [1_000] }],
  paymentMethod: "mercadopago",
  deliveryMethod: "pickup",
  fulfillment: { pickupPointId: "pickup-1" },
  payerName: "Ana Perez",
  payerPhone: "+5491112345678",
  payerEmail: "ana@example.com",
  notes: "nota",
  ...overrides,
});

const orderForAttempt = (
  attempt: Awaited<ReturnType<typeof getOrCreateCheckoutAttempt>>["attempt"]
): Order => ({
  externalReference: attempt.externalReference,
  summaryToken: attempt.summaryToken,
  status: "created",
  paymentStatus: "pending",
  shippingStatus: "in_process",
  paymentMethod: "mercadopago",
  deliveryMethod: "pickup",
  items: [{ productId: "p-1", title: "Producto", unitPrice: 1_000, qty: 1, currency: "ARS" }],
  total: 1_000,
  currency: "ARS",
  createdAt: Date.now(),
  updatedAt: Date.now(),
  fulfillment: {
    subtotalProducts: 1_000,
    discountAmount: 0,
    shippingFee: 0,
    finalTotal: 1_000,
    summary: "Retiro",
  },
});

afterEach(() => {
  vi.useRealTimers();
});

describe("AUD3 checkout attempt claims", () => {
  it("AUD3-IDEM-01 atomically creates the first attempt", async () => {
    const id = attemptId("create");
    const fingerprint = buildCheckoutAttemptFingerprint(checkoutBody());
    const result = await getOrCreateCheckoutAttempt(id, fingerprint);

    expect(result.created).toBe(true);
    expect(result.attempt).toMatchObject({
      checkoutAttemptId: id,
      fingerprint,
      state: "created",
    });
  });

  it("AUD3-IDEM-02 recovers the same attempt for the same fingerprint", async () => {
    const id = attemptId("recover");
    const fingerprint = buildCheckoutAttemptFingerprint(checkoutBody());
    const first = await getOrCreateCheckoutAttempt(id, fingerprint);
    const second = await getOrCreateCheckoutAttempt(id, fingerprint);

    expect(second.created).toBe(false);
    expect(second.attempt.externalReference).toBe(first.attempt.externalReference);
    expect(second.attempt.summaryToken).toBe(first.attempt.summaryToken);
  });

  it("AUD3-IDEM-03 gives concurrent atomic claims one identity", async () => {
    const id = attemptId("concurrent");
    const fingerprint = buildCheckoutAttemptFingerprint(checkoutBody());
    const [left, right] = await Promise.all([
      getOrCreateCheckoutAttempt(id, fingerprint),
      getOrCreateCheckoutAttempt(id, fingerprint),
    ]);

    expect([left.created, right.created].filter(Boolean)).toHaveLength(1);
    expect(left.attempt.externalReference).toBe(right.attempt.externalReference);
  });

  it("AUD3-IDEM-04 rejects the same key with a different fingerprint", async () => {
    const id = attemptId("conflict");
    const firstFingerprint = buildCheckoutAttemptFingerprint(checkoutBody());
    const secondFingerprint = buildCheckoutAttemptFingerprint(
      checkoutBody({ items: [{ productId: "p-1", qty: 2, requestedUnitPrices: [1_000] }] })
    );
    await getOrCreateCheckoutAttempt(id, firstFingerprint);

    await expect(getOrCreateCheckoutAttempt(id, secondFingerprint)).rejects.toBeInstanceOf(
      CheckoutAttemptConflictError
    );
  });

  it("AUD3-IDEM-05 keeps externalReference stable", async () => {
    const id = attemptId("reference");
    const fingerprint = buildCheckoutAttemptFingerprint(checkoutBody());
    const values = await Promise.all(
      Array.from({ length: 4 }, () => getOrCreateCheckoutAttempt(id, fingerprint))
    );

    expect(new Set(values.map((value) => value.attempt.externalReference))).toHaveLength(1);
  });

  it("AUD3-IDEM-06 keeps summaryToken stable", async () => {
    const id = attemptId("token");
    const fingerprint = buildCheckoutAttemptFingerprint(checkoutBody());
    const first = await getOrCreateCheckoutAttempt(id, fingerprint);
    const second = await getOrCreateCheckoutAttempt(id, fingerprint);

    expect(second.attempt.summaryToken).toBe(first.attempt.summaryToken);
    expect(second.attempt.summaryToken).toMatch(/^[a-f0-9]{32}$/);
  });

  it("AUD3-IDEM-07 lets a retry claim an expired lease", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-11T12:00:00Z"));
    const id = attemptId("lease-expiry");
    expect(await acquireCheckoutAttemptLease(id, { ownerToken: "owner-a", ttlSeconds: 1 })).toBe("owner-a");

    vi.advanceTimersByTime(1_001);
    expect(await acquireCheckoutAttemptLease(id, { ownerToken: "owner-b", ttlSeconds: 1 })).toBe("owner-b");
  });

  it("AUD3-IDEM-08 prevents an old owner from releasing a new lease", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-11T12:00:00Z"));
    const id = attemptId("lease-owner");
    await acquireCheckoutAttemptLease(id, { ownerToken: "owner-a", ttlSeconds: 1 });
    vi.advanceTimersByTime(1_001);
    await acquireCheckoutAttemptLease(id, { ownerToken: "owner-b", ttlSeconds: 60 });

    await expect(releaseCheckoutAttemptLease(id, "owner-a")).resolves.toBe(false);
    await expect(getJson(`es:checkout-attempt:v1:${id}:lease`)).resolves.toBe("owner-b");
    await expect(releaseCheckoutAttemptLease(id, "owner-b")).resolves.toBe(true);
  });

  it("AUD3-IDEM-09 stores no checkout PII after preparing the financial snapshot", async () => {
    const id = attemptId("no-pii");
    const body = checkoutBody();
    const fingerprint = buildCheckoutAttemptFingerprint(body);
    const created = await getOrCreateCheckoutAttempt(id, fingerprint);
    const owner = await acquireCheckoutAttemptLease(id);
    expect(owner).toBeTruthy();
    const order = orderForAttempt(created.attempt);
    order.customer = {
      name: body.payerName,
      phone: body.payerPhone,
      email: body.payerEmail,
    };
    order.notes = body.notes;
    order.fulfillment = {
      ...order.fulfillment!,
      deliveryAddress: {
        street: "Calle privada",
        number: "123",
        betweenStreets: "Uno y Dos",
      },
      summary: "Calle privada 123, entre Uno y Dos",
    };
    await prepareCheckoutAttempt(created.attempt, order, owner!);
    const stored = JSON.stringify(await getCheckoutAttempt(id));

    expect(stored).not.toContain(body.payerName);
    expect(stored).not.toContain(body.payerPhone);
    expect(stored).not.toContain(body.payerEmail);
    expect(stored).not.toContain(body.notes);
    expect(stored).not.toContain("Calle privada");
    expect(stored).not.toContain("Uno y Dos");
    await releaseCheckoutAttemptLease(id, owner!);
  });

  it("AUD3-IDEM-10 replays a completed result without a new claim", async () => {
    const id = attemptId("completed");
    const fingerprint = buildCheckoutAttemptFingerprint(checkoutBody());
    const created = await getOrCreateCheckoutAttempt(id, fingerprint);
    const owner = await acquireCheckoutAttemptLease(id);
    expect(owner).toBeTruthy();
    const prepared = await prepareCheckoutAttempt(created.attempt, orderForAttempt(created.attempt), owner!);
    await completeCheckoutAttempt(
      prepared,
      {
        kind: "mercadopago",
        response: {
          id: "pref-1",
          initPoint: "https://mp.example/init",
          externalReference: prepared.externalReference,
          summaryToken: prepared.summaryToken,
        },
      },
      owner!
    );
    await releaseCheckoutAttemptLease(id, owner!);

    await expect(beginCheckoutAttempt(id, fingerprint)).resolves.toMatchObject({ outcome: "replay" });
  });
});
