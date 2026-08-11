import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  CHECKOUT_ATTEMPT_STORAGE_KEY,
  bindCheckoutAttemptExternalReference,
  buildBrowserCheckoutFingerprint,
  clearBrowserCheckoutAttempt,
  clearBrowserCheckoutAttemptForOrder,
  getOrCreateBrowserCheckoutAttempt,
  readStoredCheckoutAttempt,
  submitCheckoutAttempt,
} from "./checkoutAttempt";

const checkoutPayload = (qty = 1) => ({
  items: [{ productId: "p-1", qty }],
  paymentMethod: "cash",
  deliveryMethod: "pickup",
  fulfillment: { pickupPointId: "pickup-1" },
  payer: { name: "Ana Perez", phone: "+5491112345678", email: "ana@example.com" },
  notes: "tocar timbre",
});

beforeEach(() => {
  window.localStorage.clear();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("AUD3 browser checkout attempts", () => {
  it("AUD3-CLIENT-IDEM-01 reuses an attempt across rerenders", async () => {
    const first = await getOrCreateBrowserCheckoutAttempt(checkoutPayload());
    const second = await getOrCreateBrowserCheckoutAttempt(checkoutPayload());
    expect(second.attemptId).toBe(first.attemptId);
  });

  it("AUD3-CLIENT-IDEM-02 keeps an attempt in localStorage across refresh semantics", async () => {
    const first = await getOrCreateBrowserCheckoutAttempt(checkoutPayload());
    const raw = window.localStorage.getItem(CHECKOUT_ATTEMPT_STORAGE_KEY);
    expect(raw).toBeTruthy();
    expect(readStoredCheckoutAttempt()?.attemptId).toBe(first.attemptId);
  });

  it("AUD3-CLIENT-IDEM-03 keeps an attempt across remount semantics", async () => {
    const first = await getOrCreateBrowserCheckoutAttempt(checkoutPayload());
    const second = await getOrCreateBrowserCheckoutAttempt({ ...checkoutPayload() });
    expect(second).toEqual(first);
  });

  it("AUD3-CLIENT-IDEM-04 rotates when the material payload changes", async () => {
    const first = await getOrCreateBrowserCheckoutAttempt(checkoutPayload(1));
    const second = await getOrCreateBrowserCheckoutAttempt(checkoutPayload(2));
    expect(second.attemptId).not.toBe(first.attemptId);
    expect(second.fingerprint).not.toBe(first.fingerprint);
  });

  it("AUD3-CLIENT-IDEM-05 closes a successful manual attempt", async () => {
    const attempt = await getOrCreateBrowserCheckoutAttempt(checkoutPayload());
    clearBrowserCheckoutAttempt(attempt.attemptId);
    expect(readStoredCheckoutAttempt()).toBeNull();
  });

  it("AUD3-CLIENT-IDEM-06 keeps the attempt after a lost response", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => {
      throw new TypeError("network lost");
    }));
    await expect(submitCheckoutAttempt("/api/orders/create", checkoutPayload())).rejects.toThrow("network lost");
    expect(readStoredCheckoutAttempt()).not.toBeNull();
  });

  it("AUD3-CLIENT-IDEM-07 keeps MP attempts until the matching order completes", async () => {
    const attempt = await getOrCreateBrowserCheckoutAttempt({
      ...checkoutPayload(),
      paymentMethod: "mercadopago",
    });
    bindCheckoutAttemptExternalReference(attempt.attemptId, "es-20260811-order-a");
    clearBrowserCheckoutAttemptForOrder("es-20260811-order-b");
    expect(readStoredCheckoutAttempt()?.attemptId).toBe(attempt.attemptId);
    clearBrowserCheckoutAttemptForOrder("es-20260811-order-a");
    expect(readStoredCheckoutAttempt()).toBeNull();
  });

  it("AUD3-CLIENT-IDEM-08 converges same-payload tab calls on one stored attempt", async () => {
    const [left, right] = await Promise.all([
      getOrCreateBrowserCheckoutAttempt(checkoutPayload()),
      getOrCreateBrowserCheckoutAttempt(checkoutPayload()),
    ]);
    expect(left.attemptId).toBe(right.attemptId);
  });

  it("AUD3-CLIENT-IDEM-09 recovers from corrupt localStorage", async () => {
    window.localStorage.setItem(CHECKOUT_ATTEMPT_STORAGE_KEY, "{broken");
    const attempt = await getOrCreateBrowserCheckoutAttempt(checkoutPayload());
    expect(attempt.attemptId).toMatch(/^ca_/);
    expect(readStoredCheckoutAttempt()).toEqual(attempt);
  });

  it("AUD3-CLIENT-IDEM-10 persists only hashes and non-PII identifiers", async () => {
    const payload = checkoutPayload();
    const fingerprint = await buildBrowserCheckoutFingerprint(payload);
    await getOrCreateBrowserCheckoutAttempt(payload);
    const raw = window.localStorage.getItem(CHECKOUT_ATTEMPT_STORAGE_KEY) || "";
    expect(raw).toContain(fingerprint);
    expect(raw).not.toContain(payload.payer.name);
    expect(raw).not.toContain(payload.payer.phone);
    expect(raw).not.toContain(payload.payer.email);
    expect(raw).not.toContain(payload.notes);
  });

  it("silently retries in-progress responses with the same attempt", async () => {
    const requestBodies: Array<Record<string, unknown>> = [];
    const fetchMock = vi
      .fn()
      .mockImplementationOnce(async (_url: string, init: RequestInit) => {
        requestBodies.push(JSON.parse(String(init.body)) as Record<string, unknown>);
        return new Response(JSON.stringify({ code: "CHECKOUT_ATTEMPT_IN_PROGRESS" }), { status: 409 });
      })
      .mockImplementationOnce(async (_url: string, init: RequestInit) => {
        requestBodies.push(JSON.parse(String(init.body)) as Record<string, unknown>);
        return new Response(JSON.stringify({ externalReference: "es-20260811-order-a" }), { status: 200 });
      });
    vi.stubGlobal("fetch", fetchMock);

    const result = await submitCheckoutAttempt<{ externalReference?: string; code?: string }>(
      "/api/orders/create",
      checkoutPayload(),
      { retryDelaysMs: [0] }
    );

    expect(result.response.status).toBe(200);
    expect(requestBodies).toHaveLength(2);
    expect(requestBodies[0].checkoutAttemptId).toBe(requestBodies[1].checkoutAttemptId);
  });
});
