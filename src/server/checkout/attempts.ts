import { createHash, randomUUID } from "node:crypto";
import { delIfValue, getJson, setJson, setJsonIfNotExists } from "@/src/server/kv";
import { logEvent } from "@/src/server/observability/log";
import {
  createCheckoutOrderIdentity,
  type CheckoutOrderIdentity,
} from "@/src/server/orders/createFromCheckout";
import type { Order, OrderFulfillment } from "@/src/server/orders/types";
import type { ParsedCheckoutBody } from "@/src/server/validation/payments";

const DAY_SECONDS = 24 * 60 * 60;

// Pending orders are retained for seven days. The attempt must live for the
// same recovery horizon so a lost response does not become a new purchase.
export const CHECKOUT_ATTEMPT_TTL_SECONDS = 7 * DAY_SECONDS;
export const CHECKOUT_ATTEMPT_ALIAS_TTL_SECONDS = CHECKOUT_ATTEMPT_TTL_SECONDS;
export const CHECKOUT_ATTEMPT_LEASE_TTL_SECONDS = 90;
// Equivalent attempts only share an identity while creation is active. The
// fallback TTL bounds coordination after a crash without turning the
// fingerprint into a durable idempotency key.
export const CHECKOUT_ATTEMPT_COORDINATION_TTL_SECONDS = 120;
export const MERCADO_PAGO_PREFERENCE_TTL_MS = 48 * 60 * 60 * 1000;

export const CHECKOUT_ATTEMPT_REQUIRED = "CHECKOUT_ATTEMPT_REQUIRED";
export const CHECKOUT_ATTEMPT_CONFLICT = "CHECKOUT_ATTEMPT_CONFLICT";
export const CHECKOUT_ATTEMPT_IN_PROGRESS = "CHECKOUT_ATTEMPT_IN_PROGRESS";

export type CheckoutAttemptState = "created" | "prepared" | "completed";

type CheckoutAttemptFulfillmentSnapshot = Omit<
  OrderFulfillment,
  "deliveryAddress" | "summary"
>;

export type CheckoutAttemptSnapshot = Pick<
  Order,
  | "status"
  | "paymentStatus"
  | "shippingStatus"
  | "items"
  | "total"
  | "currency"
  | "createdAt"
  | "updatedAt"
  | "paymentMethod"
  | "deliveryMethod"
> & {
  fulfillment?: CheckoutAttemptFulfillmentSnapshot;
};

export type ManualCheckoutResult = {
  kind: "manual";
  response: {
    checkoutAttemptId: string;
    externalReference: string;
    summaryToken?: string;
    total: number;
    currency: "ARS";
    paymentMethod: "cash" | "transfer";
    deliveryMethod: "delivery" | "pickup";
  };
};

export type MpCheckoutResult = {
  kind: "mercadopago";
  response: {
    checkoutAttemptId: string;
    id: string | number;
    initPoint?: string;
    sandboxInitPoint?: string;
    externalReference: string;
    summaryToken?: string;
  };
};

export type CheckoutAttemptResult = ManualCheckoutResult | MpCheckoutResult;

export type CheckoutAttemptRecord = CheckoutOrderIdentity & {
  checkoutAttemptId: string;
  fingerprint: string;
  mpIdempotencyKey: string;
  state: CheckoutAttemptState;
  createdAt: number;
  updatedAt: number;
  preferenceValidFrom?: number;
  preferenceExpiresAt?: number;
  snapshot?: CheckoutAttemptSnapshot;
  result?: CheckoutAttemptResult;
};

export type CheckoutAttemptAlias = {
  canonicalCheckoutAttemptId: string;
  fingerprint: string;
};

export class CheckoutAttemptConflictError extends Error {
  readonly code = CHECKOUT_ATTEMPT_CONFLICT;

  constructor() {
    super("El intento de checkout ya pertenece a otra operacion.");
    this.name = "CheckoutAttemptConflictError";
  }
}

export class CheckoutAttemptLeaseLostError extends Error {
  constructor() {
    super("Checkout attempt lease ownership was lost");
    this.name = "CheckoutAttemptLeaseLostError";
  }
}

const attemptKey = (checkoutAttemptId: string) => `es:checkout-attempt:v1:${checkoutAttemptId}`;
const leaseKey = (checkoutAttemptId: string) => `es:checkout-attempt:v1:${checkoutAttemptId}:lease`;
const aliasKey = (checkoutAttemptId: string) =>
  `es:checkout-attempt:v1:alias:${checkoutAttemptId}`;
const coordinationKey = (fingerprint: string) =>
  `es:checkout-attempt-canonical:v1:${fingerprint}`;

const CHECKOUT_ATTEMPT_ID_PATTERN = /^[a-zA-Z0-9_-]{8,120}$/;
const CHECKOUT_FINGERPRINT_PATTERN = /^[a-f0-9]{64}$/;

const stableStringify = (value: unknown): string => {
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(",")}]`;
  }
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
};

export const buildCheckoutAttemptFingerprint = (body: ParsedCheckoutBody) => {
  const canonicalPayload = {
    items: body.items
      .map((item) => ({
        productId: item.productId,
        qty: item.qty,
        requestedUnitPrices: [...item.requestedUnitPrices].sort((left, right) => left - right),
      }))
      .sort((left, right) => left.productId.localeCompare(right.productId)),
    paymentMethod: body.paymentMethod,
    deliveryMethod: body.deliveryMethod,
    fulfillment: body.fulfillment,
    payer: {
      name: body.payerName,
      phone: body.payerPhone,
      email: body.payerEmail,
    },
    notes: body.notes,
  };

  return createHash("sha256").update(stableStringify(canonicalPayload)).digest("hex");
};

const buildMpIdempotencyKey = (checkoutAttemptId: string, externalReference: string) =>
  createHash("sha256")
    .update(`es-checkout-v1:${checkoutAttemptId}:${externalReference}`)
    .digest("hex");

const assertMatchingFingerprint = (attempt: CheckoutAttemptRecord, fingerprint: string) => {
  if (attempt.fingerprint !== fingerprint) {
    logEvent("warn", "checkout.attempt.conflict", {
      checkoutAttemptId: attempt.checkoutAttemptId,
      externalReference: attempt.externalReference,
    });
    throw new CheckoutAttemptConflictError();
  }
};

export const getCheckoutAttempt = (checkoutAttemptId: string) =>
  getJson<CheckoutAttemptRecord>(attemptKey(checkoutAttemptId));

export const getCheckoutAttemptAlias = (checkoutAttemptId: string) =>
  getJson<CheckoutAttemptAlias>(aliasKey(checkoutAttemptId));

const assertValidAlias = (
  requestedCheckoutAttemptId: string,
  alias: CheckoutAttemptAlias,
  fingerprint: string
) => {
  if (
    !alias ||
    typeof alias !== "object" ||
    !CHECKOUT_ATTEMPT_ID_PATTERN.test(alias.canonicalCheckoutAttemptId) ||
    !CHECKOUT_FINGERPRINT_PATTERN.test(alias.fingerprint) ||
    alias.canonicalCheckoutAttemptId === requestedCheckoutAttemptId
  ) {
    throw new Error("Checkout attempt alias is malformed");
  }
  if (alias.fingerprint !== fingerprint) {
    logEvent("warn", "checkout.attempt.alias_conflict", {
      requestedCheckoutAttemptId,
      checkoutAttemptId: alias.canonicalCheckoutAttemptId,
    });
    throw new CheckoutAttemptConflictError();
  }
};

async function readCheckoutAttemptAlias(
  requestedCheckoutAttemptId: string,
  fingerprint: string
): Promise<CheckoutAttemptAlias | null> {
  const alias = await getCheckoutAttemptAlias(requestedCheckoutAttemptId);
  if (!alias) return null;
  assertValidAlias(requestedCheckoutAttemptId, alias, fingerprint);

  const chainedAlias = await getCheckoutAttemptAlias(alias.canonicalCheckoutAttemptId);
  if (chainedAlias) {
    throw new Error("Checkout attempt alias chains are not allowed");
  }
  return alias;
}

async function persistCheckoutAttemptAlias(
  requestedCheckoutAttemptId: string,
  canonicalCheckoutAttemptId: string,
  fingerprint: string
) {
  if (requestedCheckoutAttemptId === canonicalCheckoutAttemptId) return;

  // A durable canonical attempt is the authority that prevents this target
  // from later becoming an alias source. Wait for the coordination winner to
  // publish it before making the requested-ID mapping durable.
  const canonicalAttempt = await waitForCheckoutAttemptRecord(
    canonicalCheckoutAttemptId,
    fingerprint
  );
  if (!canonicalAttempt) {
    throw new Error("Canonical checkout attempt is unavailable for alias creation");
  }

  const canonicalAlias = await getCheckoutAttemptAlias(canonicalCheckoutAttemptId);
  if (canonicalAlias) {
    throw new Error("Checkout attempt alias chains are not allowed");
  }

  const candidate: CheckoutAttemptAlias = { canonicalCheckoutAttemptId, fingerprint };
  const created = await setJsonIfNotExists(
    aliasKey(requestedCheckoutAttemptId),
    candidate,
    CHECKOUT_ATTEMPT_ALIAS_TTL_SECONDS
  );
  if (created) {
    logEvent("info", "checkout.attempt.alias_created", {
      requestedCheckoutAttemptId,
      checkoutAttemptId: canonicalCheckoutAttemptId,
    });
    return;
  }

  const existing = await readCheckoutAttemptAlias(requestedCheckoutAttemptId, fingerprint);
  if (!existing) throw new Error("Checkout attempt alias claim could not be recovered");
  if (existing.canonicalCheckoutAttemptId !== canonicalCheckoutAttemptId) {
    throw new CheckoutAttemptConflictError();
  }
}

type CheckoutAttemptResolution = {
  checkoutAttemptId: string;
  source: "alias" | "coordination" | "existing";
};

async function resolveCanonicalCheckoutAttemptId(
  requestedCheckoutAttemptId: string,
  fingerprint: string
): Promise<CheckoutAttemptResolution> {
  const alias = await readCheckoutAttemptAlias(requestedCheckoutAttemptId, fingerprint);
  if (alias) {
    logEvent("info", "checkout.attempt.alias_resolved", {
      requestedCheckoutAttemptId,
      checkoutAttemptId: alias.canonicalCheckoutAttemptId,
    });
    return { checkoutAttemptId: alias.canonicalCheckoutAttemptId, source: "alias" };
  }

  const requestedAttempt = await getCheckoutAttempt(requestedCheckoutAttemptId);
  if (requestedAttempt) {
    assertMatchingFingerprint(requestedAttempt, fingerprint);
    return { checkoutAttemptId: requestedCheckoutAttemptId, source: "existing" };
  }

  const key = coordinationKey(fingerprint);
  const claimed = await setJsonIfNotExists(
    key,
    requestedCheckoutAttemptId,
    CHECKOUT_ATTEMPT_COORDINATION_TTL_SECONDS
  );
  if (claimed) {
    logEvent("info", "checkout.attempt.coordination_claimed", {
      checkoutAttemptId: requestedCheckoutAttemptId,
    });
    return { checkoutAttemptId: requestedCheckoutAttemptId, source: "coordination" };
  }

  const canonicalCheckoutAttemptId = await getJson<string>(key);
  if (!canonicalCheckoutAttemptId) {
    throw new Error("Checkout attempt coordination claim could not be recovered");
  }

  if (canonicalCheckoutAttemptId !== requestedCheckoutAttemptId) {
    await persistCheckoutAttemptAlias(
      requestedCheckoutAttemptId,
      canonicalCheckoutAttemptId,
      fingerprint
    );
    logEvent("info", "checkout.attempt.canonicalized", {
      requestedCheckoutAttemptId,
      checkoutAttemptId: canonicalCheckoutAttemptId,
    });
  }
  return { checkoutAttemptId: canonicalCheckoutAttemptId, source: "coordination" };
}

async function releaseCheckoutAttemptCoordination(attempt: CheckoutAttemptRecord) {
  return delIfValue(coordinationKey(attempt.fingerprint), attempt.checkoutAttemptId);
}

export async function getOrCreateCheckoutAttempt(
  checkoutAttemptId: string,
  fingerprint: string
): Promise<{ attempt: CheckoutAttemptRecord; created: boolean }> {
  const existing = await getCheckoutAttempt(checkoutAttemptId);
  if (existing) {
    assertMatchingFingerprint(existing, fingerprint);
    logEvent("info", "checkout.attempt.retry", {
      checkoutAttemptId,
      externalReference: existing.externalReference,
      state: existing.state,
    });
    return { attempt: existing, created: false };
  }

  const identity = createCheckoutOrderIdentity();
  const now = Date.now();
  const candidate: CheckoutAttemptRecord = {
    checkoutAttemptId,
    fingerprint,
    ...identity,
    mpIdempotencyKey: buildMpIdempotencyKey(checkoutAttemptId, identity.externalReference),
    state: "created",
    createdAt: now,
    updatedAt: now,
  };

  const created = await setJsonIfNotExists(
    attemptKey(checkoutAttemptId),
    candidate,
    CHECKOUT_ATTEMPT_TTL_SECONDS
  );
  if (created) {
    logEvent("info", "checkout.attempt.created", {
      checkoutAttemptId,
      externalReference: candidate.externalReference,
    });
    return { attempt: candidate, created: true };
  }

  const winner = await getCheckoutAttempt(checkoutAttemptId);
  if (!winner) {
    throw new Error("Checkout attempt claim could not be recovered");
  }
  assertMatchingFingerprint(winner, fingerprint);
  logEvent("info", "checkout.attempt.retry", {
    checkoutAttemptId,
    externalReference: winner.externalReference,
    state: winner.state,
  });
  return { attempt: winner, created: false };
}

export async function acquireCheckoutAttemptLease(
  checkoutAttemptId: string,
  options: { ttlSeconds?: number; ownerToken?: string } = {}
): Promise<string | null> {
  const ownerToken = options.ownerToken ?? randomUUID();
  const acquired = await setJsonIfNotExists(
    leaseKey(checkoutAttemptId),
    ownerToken,
    options.ttlSeconds ?? CHECKOUT_ATTEMPT_LEASE_TTL_SECONDS
  );
  if (!acquired) return null;

  logEvent("info", "checkout.attempt.claimed", { checkoutAttemptId });
  return ownerToken;
}

export async function releaseCheckoutAttemptLease(checkoutAttemptId: string, ownerToken: string) {
  const released = await delIfValue(leaseKey(checkoutAttemptId), ownerToken);
  if (!released) {
    logEvent("warn", "checkout.attempt.lease_release_skipped", { checkoutAttemptId });
  }
  return released;
}

export async function assertCheckoutAttemptLeaseOwner(checkoutAttemptId: string, ownerToken: string) {
  const currentOwner = await getJson<string>(leaseKey(checkoutAttemptId));
  if (currentOwner !== ownerToken) throw new CheckoutAttemptLeaseLostError();
}

export const snapshotCheckoutOrder = (order: Order): CheckoutAttemptSnapshot => ({
  status: order.status,
  paymentStatus: order.paymentStatus,
  shippingStatus: order.shippingStatus,
  items: order.items.map((item) => ({ ...item })),
  total: order.total,
  currency: order.currency,
  createdAt: order.createdAt,
  updatedAt: order.updatedAt,
  paymentMethod: order.paymentMethod,
  deliveryMethod: order.deliveryMethod,
  fulfillment: order.fulfillment
    ? {
        subtotalProducts: order.fulfillment.subtotalProducts,
        discountAmount: order.fulfillment.discountAmount,
        shippingFee: order.fulfillment.shippingFee,
        finalTotal: order.fulfillment.finalTotal,
        ...(order.fulfillment.deliveryZone
          ? { deliveryZone: { ...order.fulfillment.deliveryZone } }
          : {}),
        ...(order.fulfillment.pickupPoint
          ? { pickupPoint: { ...order.fulfillment.pickupPoint } }
          : {}),
      }
    : undefined,
});

const restoreCheckoutFulfillment = (
  snapshot: CheckoutAttemptFulfillmentSnapshot | undefined,
  body: ParsedCheckoutBody
): OrderFulfillment | undefined => {
  if (!snapshot) return undefined;

  if (body.deliveryMethod === "delivery") {
    const address = body.fulfillment.deliveryAddress;
    if (!address) return undefined;
    const floorSuffix = address.floor ? `, ${address.floor}` : "";
    return {
      ...snapshot,
      deliveryAddress: {
        street: address.street,
        number: address.number,
        ...(address.floor ? { floor: address.floor } : {}),
        betweenStreets: address.betweenStreets,
        ...(address.notes ? { notes: address.notes } : {}),
      },
      summary: `Envío a domicilio: ${address.street} ${address.number}${floorSuffix}, entre ${address.betweenStreets}`,
    };
  }

  if (!snapshot.pickupPoint) return undefined;
  return {
    ...snapshot,
    pickupPoint: { ...snapshot.pickupPoint },
    summary: `Punto de encuentro: ${snapshot.pickupPoint.name}`,
  };
};

export const restoreCheckoutOrder = (
  attempt: CheckoutAttemptRecord,
  body: ParsedCheckoutBody
): Order | null => {
  const snapshot = attempt.snapshot;
  if (!snapshot) return null;
  const fulfillment = restoreCheckoutFulfillment(snapshot.fulfillment, body);
  if (snapshot.fulfillment && !fulfillment) return null;

  return {
    externalReference: attempt.externalReference,
    summaryToken: attempt.summaryToken,
    status: snapshot.status,
    paymentStatus: snapshot.paymentStatus,
    shippingStatus: snapshot.shippingStatus,
    total: snapshot.total,
    currency: snapshot.currency,
    createdAt: snapshot.createdAt,
    updatedAt: snapshot.updatedAt,
    paymentMethod: snapshot.paymentMethod,
    deliveryMethod: snapshot.deliveryMethod,
    items: snapshot.items.map((item) => ({ ...item })),
    ...(fulfillment ? { fulfillment } : {}),
    ...(body.payerName || body.payerPhone || body.payerEmail
      ? {
          customer: {
            ...(body.payerName ? { name: body.payerName } : {}),
            ...(body.payerPhone ? { phone: body.payerPhone } : {}),
            ...(body.payerEmail ? { email: body.payerEmail } : {}),
          },
        }
      : {}),
    ...(body.notes ? { notes: body.notes } : {}),
  };
};

export async function prepareCheckoutAttempt(
  attempt: CheckoutAttemptRecord,
  order: Order,
  ownerToken: string
): Promise<CheckoutAttemptRecord> {
  await assertCheckoutAttemptLeaseOwner(attempt.checkoutAttemptId, ownerToken);
  const prepared: CheckoutAttemptRecord = {
    ...attempt,
    state: "prepared",
    snapshot: snapshotCheckoutOrder(order),
    updatedAt: Date.now(),
  };
  await setJson(attemptKey(attempt.checkoutAttemptId), prepared, CHECKOUT_ATTEMPT_TTL_SECONDS);
  return prepared;
}

export async function ensureMercadoPagoPreferenceWindow(
  attempt: CheckoutAttemptRecord,
  ownerToken: string,
  now = Date.now()
): Promise<CheckoutAttemptRecord> {
  await assertCheckoutAttemptLeaseOwner(attempt.checkoutAttemptId, ownerToken);
  const hasStart = attempt.preferenceValidFrom !== undefined;
  const hasEnd = attempt.preferenceExpiresAt !== undefined;

  if (hasStart !== hasEnd) {
    throw new Error("Checkout attempt has an incomplete Mercado Pago preference window");
  }
  if (hasStart && hasEnd) {
    if (
      !Number.isSafeInteger(attempt.preferenceValidFrom) ||
      !Number.isSafeInteger(attempt.preferenceExpiresAt) ||
      attempt.preferenceExpiresAt! - attempt.preferenceValidFrom! !== MERCADO_PAGO_PREFERENCE_TTL_MS
    ) {
      throw new Error("Checkout attempt has an invalid Mercado Pago preference window");
    }
    return attempt;
  }

  if (!Number.isSafeInteger(now)) {
    throw new Error("Invalid server timestamp for Mercado Pago preference window");
  }
  const withWindow: CheckoutAttemptRecord = {
    ...attempt,
    preferenceValidFrom: now,
    preferenceExpiresAt: now + MERCADO_PAGO_PREFERENCE_TTL_MS,
    updatedAt: now,
  };
  await setJson(attemptKey(attempt.checkoutAttemptId), withWindow, CHECKOUT_ATTEMPT_TTL_SECONDS);
  logEvent("info", "payments.mp.preference_window_created", {
    checkoutAttemptId: attempt.checkoutAttemptId,
    externalReference: attempt.externalReference,
    validForMs: MERCADO_PAGO_PREFERENCE_TTL_MS,
  });
  return withWindow;
}

export async function completeCheckoutAttempt(
  attempt: CheckoutAttemptRecord,
  result: CheckoutAttemptResult,
  ownerToken: string
): Promise<CheckoutAttemptRecord> {
  await assertCheckoutAttemptLeaseOwner(attempt.checkoutAttemptId, ownerToken);
  const completed: CheckoutAttemptRecord = {
    ...attempt,
    state: "completed",
    result,
    updatedAt: Date.now(),
  };
  await setJson(attemptKey(attempt.checkoutAttemptId), completed, CHECKOUT_ATTEMPT_TTL_SECONDS);
  await releaseCheckoutAttemptCoordination(completed).catch((error) => {
    logEvent("warn", "checkout.attempt.coordination_release_failed", {
      checkoutAttemptId: completed.checkoutAttemptId,
      errorName: error instanceof Error ? error.name : "unknown",
    });
  });
  logEvent("info", "checkout.attempt.completed", {
    checkoutAttemptId: attempt.checkoutAttemptId,
    externalReference: attempt.externalReference,
    paymentMethod: result.kind,
  });
  return completed;
}

const sleep = (milliseconds: number) => new Promise((resolve) => setTimeout(resolve, milliseconds));

async function waitForCheckoutAttemptRecord(
  checkoutAttemptId: string,
  fingerprint: string,
  options: { timeoutMs?: number; pollMs?: number } = {}
): Promise<CheckoutAttemptRecord | null> {
  const timeoutMs = options.timeoutMs ?? 1_500;
  const pollMs = options.pollMs ?? 50;
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    const attempt = await getCheckoutAttempt(checkoutAttemptId);
    if (attempt) {
      assertMatchingFingerprint(attempt, fingerprint);
      return attempt;
    }
    await sleep(pollMs);
  }
  return null;
}

export async function waitForCompletedCheckoutAttempt(
  checkoutAttemptId: string,
  fingerprint: string,
  options: { timeoutMs?: number; pollMs?: number } = {}
): Promise<CheckoutAttemptRecord | null> {
  const timeoutMs = options.timeoutMs ?? 1_500;
  const pollMs = options.pollMs ?? 50;
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    const attempt = await getCheckoutAttempt(checkoutAttemptId);
    if (attempt) {
      assertMatchingFingerprint(attempt, fingerprint);
      if (attempt.state === "completed" && attempt.result) return attempt;
    }
    await sleep(pollMs);
  }

  return null;
}

export type BeginCheckoutAttemptResult =
  | { outcome: "replay"; attempt: CheckoutAttemptRecord }
  | { outcome: "in_progress"; attempt: CheckoutAttemptRecord }
  | {
      outcome: "claimed";
      attempt: CheckoutAttemptRecord;
      ownerToken: string;
      recovered: boolean;
    };

export async function beginCheckoutAttempt(
  requestedCheckoutAttemptId: string,
  fingerprint: string
): Promise<BeginCheckoutAttemptResult> {
  const resolution = await resolveCanonicalCheckoutAttemptId(
    requestedCheckoutAttemptId,
    fingerprint
  );
  const { checkoutAttemptId } = resolution;
  let initial: Awaited<ReturnType<typeof getOrCreateCheckoutAttempt>>;
  try {
    if (resolution.source === "alias") {
      const aliasedAttempt = await waitForCheckoutAttemptRecord(checkoutAttemptId, fingerprint);
      if (!aliasedAttempt) {
        throw new Error("Canonical checkout attempt for alias is unavailable");
      }
      initial = { attempt: aliasedAttempt, created: false };
    } else {
      initial = await getOrCreateCheckoutAttempt(checkoutAttemptId, fingerprint);
    }
  } catch (error) {
    if (
      error instanceof CheckoutAttemptConflictError &&
      resolution.source === "coordination"
    ) {
      await delIfValue(coordinationKey(fingerprint), checkoutAttemptId).catch(() => false);
    }
    throw error;
  }
  if (initial.attempt.state === "completed" && initial.attempt.result) {
    await releaseCheckoutAttemptCoordination(initial.attempt).catch(() => false);
    logEvent("info", "checkout.attempt.replayed", {
      checkoutAttemptId,
      externalReference: initial.attempt.externalReference,
    });
    return { outcome: "replay", attempt: initial.attempt };
  }

  const ownerToken = await acquireCheckoutAttemptLease(checkoutAttemptId);
  if (!ownerToken) {
    const completed = await waitForCompletedCheckoutAttempt(checkoutAttemptId, fingerprint);
    if (completed) {
      await releaseCheckoutAttemptCoordination(completed).catch(() => false);
      logEvent("info", "checkout.attempt.replayed", {
        checkoutAttemptId,
        externalReference: completed.externalReference,
      });
      return { outcome: "replay", attempt: completed };
    }
    logEvent("info", "checkout.attempt.in_progress", {
      checkoutAttemptId,
      externalReference: initial.attempt.externalReference,
    });
    return { outcome: "in_progress", attempt: initial.attempt };
  }

  try {
    const current = await getCheckoutAttempt(checkoutAttemptId);
    if (!current) throw new Error("Checkout attempt disappeared after lease acquisition");
    assertMatchingFingerprint(current, fingerprint);
    if (current.state === "completed" && current.result) {
      await releaseCheckoutAttemptLease(checkoutAttemptId, ownerToken);
      await releaseCheckoutAttemptCoordination(current).catch(() => false);
      logEvent("info", "checkout.attempt.replayed", {
        checkoutAttemptId,
        externalReference: current.externalReference,
      });
      return { outcome: "replay", attempt: current };
    }

    const recovered = !initial.created || current.state === "prepared";
    if (recovered) {
      logEvent("info", "checkout.attempt.recovered", {
        checkoutAttemptId,
        externalReference: current.externalReference,
        state: current.state,
      });
    }
    return { outcome: "claimed", attempt: current, ownerToken, recovered };
  } catch (error) {
    await releaseCheckoutAttemptLease(checkoutAttemptId, ownerToken).catch(() => false);
    throw error;
  }
}
