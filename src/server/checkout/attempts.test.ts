import { afterEach, describe, expect, it, vi } from "vitest";
import { getJson } from "@/src/server/kv";
import type { Order } from "@/src/server/orders/types";
import type { ParsedCheckoutBody } from "@/src/server/validation/payments";
import { privacyPolicy } from "@/src/server/privacy/policy";
import {
  CheckoutAttemptConflictError,
  CHECKOUT_ATTEMPT_ALIAS_TTL_SECONDS,
  CHECKOUT_ATTEMPT_COORDINATION_TTL_SECONDS,
  CHECKOUT_ATTEMPT_TTL_SECONDS,
  MERCADO_PAGO_PREFERENCE_TTL_MS,
  acquireCheckoutAttemptLease,
  beginCheckoutAttempt,
  buildCheckoutAttemptFingerprint,
  completeCheckoutAttempt,
  ensureMercadoPagoPreferenceWindow,
  getCheckoutAttempt,
  getCheckoutAttemptAlias,
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
  it("AUD3-PAY-17 persists and reuses one exact 48-hour Mercado Pago window", async () => {
    const id = attemptId("preference-window");
    const fingerprint = buildCheckoutAttemptFingerprint(checkoutBody());
    const beginning = await beginCheckoutAttempt(id, fingerprint);
    expect(beginning.outcome).toBe("claimed");
    if (beginning.outcome !== "claimed") throw new Error("attempt was not claimed");

    const now = Date.UTC(2026, 7, 12, 15, 0, 0);
    const first = await ensureMercadoPagoPreferenceWindow(beginning.attempt, beginning.ownerToken, now);
    const replay = await ensureMercadoPagoPreferenceWindow(
      first,
      beginning.ownerToken,
      now + 60_000
    );

    expect(first.preferenceValidFrom).toBe(now);
    expect(first.preferenceExpiresAt).toBe(now + MERCADO_PAGO_PREFERENCE_TTL_MS);
    expect(replay.preferenceValidFrom).toBe(first.preferenceValidFrom);
    expect(replay.preferenceExpiresAt).toBe(first.preferenceExpiresAt);
    expect(CHECKOUT_ATTEMPT_TTL_SECONDS * 1000).toBeGreaterThan(
      MERCADO_PAGO_PREFERENCE_TTL_MS
    );
    expect(privacyPolicy.ttlSecondsForStatus("preference_created") * 1000).toBeGreaterThan(
      MERCADO_PAGO_PREFERENCE_TTL_MS
    );
    await completeCheckoutAttempt(
      replay,
      {
        kind: "mercadopago",
        response: {
          checkoutAttemptId: id,
          id: "preference-window-test",
          externalReference: replay.externalReference,
        },
      },
      beginning.ownerToken
    );
    await releaseCheckoutAttemptLease(id, beginning.ownerToken);
  });

  it("AUD3-PREF-08 gives a new intentional attempt its own 48-hour window", async () => {
    const firstId = attemptId("window-first");
    const secondId = attemptId("window-second");
    const first = await getOrCreateCheckoutAttempt(
      firstId,
      buildCheckoutAttemptFingerprint(checkoutBody({ notes: "first purchase" }))
    );
    const second = await getOrCreateCheckoutAttempt(
      secondId,
      buildCheckoutAttemptFingerprint(checkoutBody({ notes: "second purchase" }))
    );
    const firstOwner = await acquireCheckoutAttemptLease(firstId);
    const secondOwner = await acquireCheckoutAttemptLease(secondId);
    expect(firstOwner).toBeTruthy();
    expect(secondOwner).toBeTruthy();

    const firstWindow = await ensureMercadoPagoPreferenceWindow(first.attempt, firstOwner!, 1_000_000);
    const secondWindow = await ensureMercadoPagoPreferenceWindow(second.attempt, secondOwner!, 1_060_000);

    expect(secondWindow.preferenceValidFrom).not.toBe(firstWindow.preferenceValidFrom);
    expect(firstWindow.preferenceExpiresAt! - firstWindow.preferenceValidFrom!).toBe(
      MERCADO_PAGO_PREFERENCE_TTL_MS
    );
    expect(secondWindow.preferenceExpiresAt! - secondWindow.preferenceValidFrom!).toBe(
      MERCADO_PAGO_PREFERENCE_TTL_MS
    );
    await releaseCheckoutAttemptLease(firstId, firstOwner!);
    await releaseCheckoutAttemptLease(secondId, secondOwner!);
  });

  it("fails closed instead of renewing an incomplete stored preference window", async () => {
    const id = attemptId("window-corrupt");
    const created = await getOrCreateCheckoutAttempt(
      id,
      buildCheckoutAttemptFingerprint(checkoutBody({ notes: "corrupt window" }))
    );
    const owner = await acquireCheckoutAttemptLease(id);
    expect(owner).toBeTruthy();
    await expect(
      ensureMercadoPagoPreferenceWindow(
        { ...created.attempt, preferenceValidFrom: 1_000_000 },
        owner!,
        2_000_000
      )
    ).rejects.toThrow("incomplete Mercado Pago preference window");
    await releaseCheckoutAttemptLease(id, owner!);
  });

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
          checkoutAttemptId: prepared.checkoutAttemptId,
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

  it("AUD3-IDM-006 allows a new identical purchase after the canonical attempt completes", async () => {
    const fingerprint = buildCheckoutAttemptFingerprint(checkoutBody());
    const firstId = attemptId("intentional-first");
    const secondId = attemptId("intentional-second");
    const first = await beginCheckoutAttempt(firstId, fingerprint);
    expect(first).toMatchObject({ outcome: "claimed" });
    if (first.outcome !== "claimed") throw new Error("Expected first attempt claim");

    const prepared = await prepareCheckoutAttempt(
      first.attempt,
      orderForAttempt(first.attempt),
      first.ownerToken
    );
    await completeCheckoutAttempt(
      prepared,
      {
        kind: "mercadopago",
        response: {
          checkoutAttemptId: prepared.checkoutAttemptId,
          id: "pref-intentional-first",
          initPoint: "https://mp.example/intentional-first",
          externalReference: prepared.externalReference,
          summaryToken: prepared.summaryToken,
        },
      },
      first.ownerToken
    );
    await releaseCheckoutAttemptLease(first.attempt.checkoutAttemptId, first.ownerToken);

    const second = await beginCheckoutAttempt(secondId, fingerprint);
    expect(second).toMatchObject({ outcome: "claimed" });
    expect(second.attempt.checkoutAttemptId).toBe(secondId);
    expect(second.attempt.externalReference).not.toBe(first.attempt.externalReference);
    if (second.outcome === "claimed") {
      await releaseCheckoutAttemptLease(second.attempt.checkoutAttemptId, second.ownerToken);
    }
  });

  it("P1 keeps a durable B-to-A alias after completion and a lost response", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-11T12:00:00Z"));
    const fingerprint = buildCheckoutAttemptFingerprint(checkoutBody({ notes: "alias-replay" }));
    const attemptA = attemptId("alias-a");
    const attemptB = attemptId("alias-b");
    const first = await beginCheckoutAttempt(attemptA, fingerprint);
    expect(first).toMatchObject({ outcome: "claimed" });
    if (first.outcome !== "claimed") throw new Error("Expected canonical attempt claim");

    const secondPromise = beginCheckoutAttempt(attemptB, fingerprint);
    await vi.advanceTimersByTimeAsync(1_501);
    const second = await secondPromise;
    expect(second).toMatchObject({
      outcome: "in_progress",
      attempt: { checkoutAttemptId: attemptA },
    });
    await expect(getCheckoutAttemptAlias(attemptB)).resolves.toEqual({
      canonicalCheckoutAttemptId: attemptA,
      fingerprint,
    });
    expect(CHECKOUT_ATTEMPT_ALIAS_TTL_SECONDS).toBe(CHECKOUT_ATTEMPT_TTL_SECONDS);

    const prepared = await prepareCheckoutAttempt(
      first.attempt,
      orderForAttempt(first.attempt),
      first.ownerToken
    );
    const completed = await completeCheckoutAttempt(
      prepared,
      {
        kind: "mercadopago",
        response: {
          checkoutAttemptId: attemptA,
          id: "pref-alias-replay",
          initPoint: "https://mp.example/alias-replay",
          externalReference: prepared.externalReference,
          summaryToken: prepared.summaryToken,
        },
      },
      first.ownerToken
    );
    await releaseCheckoutAttemptLease(attemptA, first.ownerToken);

    const retryWithoutClientRebind = await beginCheckoutAttempt(attemptB, fingerprint);
    expect(retryWithoutClientRebind).toMatchObject({
      outcome: "replay",
      attempt: {
        checkoutAttemptId: attemptA,
        externalReference: completed.externalReference,
        summaryToken: completed.summaryToken,
      },
    });
    await expect(getCheckoutAttempt(attemptB)).resolves.toBeNull();

    const attemptC = attemptId("alias-c");
    const intentionalNextPurchase = await beginCheckoutAttempt(attemptC, fingerprint);
    expect(intentionalNextPurchase).toMatchObject({
      outcome: "claimed",
      attempt: { checkoutAttemptId: attemptC },
    });
    expect(intentionalNextPurchase.attempt.externalReference).not.toBe(completed.externalReference);
    await expect(getCheckoutAttemptAlias(attemptB)).resolves.toEqual({
      canonicalCheckoutAttemptId: attemptA,
      fingerprint,
    });
    if (intentionalNextPurchase.outcome === "claimed") {
      await releaseCheckoutAttemptLease(attemptC, intentionalNextPurchase.ownerToken);
    }
  });

  it("fails closed when an aliased requested attempt retries with another fingerprint", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-11T13:00:00Z"));
    const fingerprint = buildCheckoutAttemptFingerprint(checkoutBody({ notes: "alias-conflict" }));
    const mismatch = buildCheckoutAttemptFingerprint(checkoutBody({ notes: "alias-mismatch" }));
    const attemptA = attemptId("alias-conflict-a");
    const attemptB = attemptId("alias-conflict-b");
    const first = await beginCheckoutAttempt(attemptA, fingerprint);
    expect(first).toMatchObject({ outcome: "claimed" });
    if (first.outcome !== "claimed") throw new Error("Expected canonical attempt claim");

    const secondPromise = beginCheckoutAttempt(attemptB, fingerprint);
    await vi.advanceTimersByTimeAsync(1_501);
    await expect(secondPromise).resolves.toMatchObject({ outcome: "in_progress" });
    await expect(beginCheckoutAttempt(attemptB, mismatch)).rejects.toBeInstanceOf(
      CheckoutAttemptConflictError
    );
    await expect(getCheckoutAttempt(attemptB)).resolves.toBeNull();
    await releaseCheckoutAttemptLease(attemptA, first.ownerToken);
  });

  it("bounds abandoned cross-tab coordination to its short TTL", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-11T12:00:00Z"));
    const fingerprint = buildCheckoutAttemptFingerprint(checkoutBody({ notes: "ttl-window" }));
    const firstId = attemptId("coordination-ttl-first");
    const secondId = attemptId("coordination-ttl-second");
    const first = await beginCheckoutAttempt(firstId, fingerprint);
    expect(first).toMatchObject({ outcome: "claimed" });
    if (first.outcome !== "claimed") throw new Error("Expected first attempt claim");
    await releaseCheckoutAttemptLease(first.attempt.checkoutAttemptId, first.ownerToken);

    vi.advanceTimersByTime((CHECKOUT_ATTEMPT_COORDINATION_TTL_SECONDS + 1) * 1_000);
    const second = await beginCheckoutAttempt(secondId, fingerprint);

    expect(second).toMatchObject({ outcome: "claimed" });
    expect(second.attempt.checkoutAttemptId).toBe(secondId);
    expect(second.attempt.externalReference).not.toBe(first.attempt.externalReference);
    if (second.outcome === "claimed") {
      await releaseCheckoutAttemptLease(second.attempt.checkoutAttemptId, second.ownerToken);
    }
  });
});
