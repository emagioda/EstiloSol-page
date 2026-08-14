import "server-only";

import { createHash } from "node:crypto";
import type { Order, OrderFulfillment, OrderItem } from "@/src/server/orders/types";
import { parseExternalReference } from "@/src/server/validation/payments";
import {
  RECOVERY_SCHEMA_VERSION,
  type RecoveryOrderSnapshotV1,
  type StoredRecoverySnapshot,
} from "./types";

const MAX_CHECKOUT_ATTEMPT_ID_LENGTH = 160;
const MAX_SNAPSHOT_ITEMS = 30;
const MAX_TEXT_LENGTH = 500;
const HASH_PATTERN = /^[a-f0-9]{64}$/;

export class RecoverySnapshotValidationError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "RecoverySnapshotValidationError";
    this.code = code;
  }
}

export const canonicalJson = (value: unknown): string => {
  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalJson(item)).join(",")}]`;
  }
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record)
      .filter((key) => record[key] !== undefined)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
};

export const hashRecoverySnapshot = (snapshot: RecoveryOrderSnapshotV1): string =>
  createHash("sha256").update(canonicalJson(snapshot), "utf8").digest("hex");

const cloneFulfillment = (fulfillment: OrderFulfillment | undefined) =>
  fulfillment
    ? {
        ...fulfillment,
        ...(fulfillment.deliveryZone
          ? { deliveryZone: { ...fulfillment.deliveryZone } }
          : {}),
        ...(fulfillment.deliveryAddress
          ? { deliveryAddress: { ...fulfillment.deliveryAddress } }
          : {}),
        ...(fulfillment.pickupPoint
          ? { pickupPoint: { ...fulfillment.pickupPoint } }
          : {}),
      }
    : undefined;

export const buildRecoveryOrderSnapshot = (input: {
  order: Order;
  checkoutAttemptId: string;
  preferenceValidFrom: number;
  preferenceExpiresAt: number;
}): RecoveryOrderSnapshotV1 => {
  const { order } = input;
  if (order.paymentMethod !== "mercadopago" || !order.deliveryMethod) {
    throw new RecoverySnapshotValidationError(
      "RECOVERY_SNAPSHOT_INVALID",
      "Only complete Mercado Pago orders can be snapshotted",
    );
  }

  const snapshot: RecoveryOrderSnapshotV1 = {
    schemaVersion: RECOVERY_SCHEMA_VERSION,
    externalReference: order.externalReference,
    checkoutAttemptId: input.checkoutAttemptId,
    ...(order.summaryToken ? { summaryToken: order.summaryToken } : {}),
    items: order.items.map((item) => ({ ...item })),
    subtotal: order.fulfillment?.subtotalProducts ?? order.total,
    total: order.total,
    currency: order.currency,
    paymentMethod: "mercadopago",
    deliveryMethod: order.deliveryMethod,
    ...(order.fulfillment ? { fulfillment: cloneFulfillment(order.fulfillment) } : {}),
    ...(order.customer
      ? {
          customer: {
            ...(order.customer.name ? { name: order.customer.name } : {}),
            ...(order.customer.email ? { email: order.customer.email } : {}),
            ...(order.customer.phone ? { phone: order.customer.phone } : {}),
          },
        }
      : {}),
    ...(order.notes ? { notes: order.notes } : {}),
    createdAt: order.createdAt,
    preferenceValidFrom: input.preferenceValidFrom,
    preferenceExpiresAt: input.preferenceExpiresAt,
  };
  assertRecoveryOrderSnapshot(snapshot);
  return snapshot;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value && typeof value === "object" && !Array.isArray(value));

const isFiniteNonNegative = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value) && value >= 0;

const assertText = (value: unknown, field: string, max = MAX_TEXT_LENGTH) => {
  if (typeof value !== "string" || value.length > max) {
    throw new RecoverySnapshotValidationError(
      "RECOVERY_SNAPSHOT_INVALID",
      `Invalid recovery snapshot field: ${field}`,
    );
  }
};

const assertItems: (items: unknown) => asserts items is OrderItem[] = (items) => {
  if (!Array.isArray(items) || items.length === 0 || items.length > MAX_SNAPSHOT_ITEMS) {
    throw new RecoverySnapshotValidationError(
      "RECOVERY_SNAPSHOT_INVALID",
      "Invalid recovery snapshot items",
    );
  }
  items.forEach((item, index) => {
    if (!isRecord(item)) {
      throw new RecoverySnapshotValidationError(
        "RECOVERY_SNAPSHOT_INVALID",
        `Invalid recovery snapshot item: ${index}`,
      );
    }
    assertText(item.productId, `items.${index}.productId`, 120);
    assertText(item.title, `items.${index}.title`, 200);
    if (!isFiniteNonNegative(item.unitPrice) || item.unitPrice <= 0) {
      throw new RecoverySnapshotValidationError(
        "RECOVERY_SNAPSHOT_INVALID",
        `Invalid recovery snapshot item price: ${index}`,
      );
    }
    if (
      typeof item.qty !== "number" ||
      !Number.isInteger(item.qty) ||
      item.qty <= 0 ||
      item.qty > 50 ||
      item.currency !== "ARS"
    ) {
      throw new RecoverySnapshotValidationError(
        "RECOVERY_SNAPSHOT_INVALID",
        `Invalid recovery snapshot item quantity/currency: ${index}`,
      );
    }
  });
};

export const assertRecoveryOrderSnapshot: (
  value: unknown,
) => asserts value is RecoveryOrderSnapshotV1 = (value) => {
  if (!isRecord(value) || value.schemaVersion !== RECOVERY_SCHEMA_VERSION) {
    throw new RecoverySnapshotValidationError(
      "RECOVERY_SNAPSHOT_INVALID",
      "Unsupported recovery snapshot schema",
    );
  }
  const parsedReference = parseExternalReference(
    typeof value.externalReference === "string" ? value.externalReference : null,
  );
  if (!parsedReference.ok) {
    throw new RecoverySnapshotValidationError(
      "RECOVERY_SNAPSHOT_INVALID",
      "Invalid recovery snapshot external reference",
    );
  }
  assertText(value.checkoutAttemptId, "checkoutAttemptId", MAX_CHECKOUT_ATTEMPT_ID_LENGTH);
  if (!value.checkoutAttemptId) {
    throw new RecoverySnapshotValidationError(
      "RECOVERY_SNAPSHOT_INVALID",
      "Recovery snapshot checkout attempt is required",
    );
  }
  if (value.summaryToken !== undefined) assertText(value.summaryToken, "summaryToken", 160);
  assertItems(value.items);
  if (
    !isFiniteNonNegative(value.subtotal) ||
    !isFiniteNonNegative(value.total) ||
    value.currency !== "ARS" ||
    value.paymentMethod !== "mercadopago" ||
    (value.deliveryMethod !== "delivery" && value.deliveryMethod !== "pickup")
  ) {
    throw new RecoverySnapshotValidationError(
      "RECOVERY_SNAPSHOT_INVALID",
      "Invalid recovery snapshot totals or methods",
    );
  }
  if (
    typeof value.createdAt !== "number" ||
    typeof value.preferenceValidFrom !== "number" ||
    typeof value.preferenceExpiresAt !== "number" ||
    !Number.isSafeInteger(value.createdAt) ||
    !Number.isSafeInteger(value.preferenceValidFrom) ||
    !Number.isSafeInteger(value.preferenceExpiresAt) ||
    value.preferenceExpiresAt <= value.preferenceValidFrom
  ) {
    throw new RecoverySnapshotValidationError(
      "RECOVERY_SNAPSHOT_INVALID",
      "Invalid recovery snapshot timestamps",
    );
  }
  if (value.customer !== undefined) {
    if (!isRecord(value.customer)) {
      throw new RecoverySnapshotValidationError(
        "RECOVERY_SNAPSHOT_INVALID",
        "Invalid recovery snapshot customer",
      );
    }
    if (value.customer.name !== undefined) assertText(value.customer.name, "customer.name", 100);
    if (value.customer.email !== undefined) assertText(value.customer.email, "customer.email", 120);
    if (value.customer.phone !== undefined) assertText(value.customer.phone, "customer.phone", 30);
  }
  if (value.notes !== undefined) assertText(value.notes, "notes", 250);
  if (value.fulfillment !== undefined && !isRecord(value.fulfillment)) {
    throw new RecoverySnapshotValidationError(
      "RECOVERY_SNAPSHOT_INVALID",
      "Invalid recovery snapshot fulfillment",
    );
  }
};

export const serializeRecoverySnapshot = (snapshot: RecoveryOrderSnapshotV1) => {
  assertRecoveryOrderSnapshot(snapshot);
  const snapshotJson = canonicalJson(snapshot);
  return {
    snapshotJson,
    snapshotHash: createHash("sha256").update(snapshotJson, "utf8").digest("hex"),
  };
};

export const parseStoredRecoverySnapshot = (
  stored: StoredRecoverySnapshot,
): RecoveryOrderSnapshotV1 => {
  if (!stored.snapshotJson || !HASH_PATTERN.test(stored.snapshotHash)) {
    throw new RecoverySnapshotValidationError(
      "RECOVERY_SNAPSHOT_REDACTED",
      "Recovery snapshot content is unavailable",
    );
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(stored.snapshotJson);
  } catch {
    throw new RecoverySnapshotValidationError(
      "RECOVERY_SNAPSHOT_INVALID",
      "Recovery snapshot JSON is malformed",
    );
  }
  assertRecoveryOrderSnapshot(parsed);
  if (
    parsed.externalReference !== stored.externalReference ||
    parsed.checkoutAttemptId !== stored.checkoutAttemptId ||
    hashRecoverySnapshot(parsed) !== stored.snapshotHash
  ) {
    throw new RecoverySnapshotValidationError(
      "RECOVERY_SNAPSHOT_CONFLICT",
      "Recovery snapshot integrity check failed",
    );
  }
  return parsed;
};

export const recoverySnapshotToOrder = (snapshot: RecoveryOrderSnapshotV1): Order => ({
  externalReference: snapshot.externalReference,
  ...(snapshot.summaryToken ? { summaryToken: snapshot.summaryToken } : {}),
  status: "preference_created",
  paymentStatus: "pending",
  shippingStatus: "in_process",
  inventoryStatus: "pending",
  paymentMethod: snapshot.paymentMethod,
  deliveryMethod: snapshot.deliveryMethod,
  items: snapshot.items.map((item) => ({ ...item })),
  total: snapshot.total,
  currency: snapshot.currency,
  createdAt: snapshot.createdAt,
  updatedAt: snapshot.createdAt,
  ...(snapshot.fulfillment ? { fulfillment: cloneFulfillment(snapshot.fulfillment) } : {}),
  ...(snapshot.customer ? { customer: { ...snapshot.customer } } : {}),
  ...(snapshot.notes ? { notes: snapshot.notes } : {}),
  salesSheetDeferredUntilApprovedAt: snapshot.createdAt,
});

export const recoverySnapshotMatchesOrder = (
  snapshot: RecoveryOrderSnapshotV1,
  order: Order,
): boolean =>
  snapshot.externalReference === order.externalReference &&
  snapshot.total === order.total &&
  snapshot.currency === order.currency &&
  canonicalJson(snapshot.items) === canonicalJson(order.items);
