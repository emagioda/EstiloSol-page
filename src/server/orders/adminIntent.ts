import type { OrderPaymentStatus, OrderShippingStatus } from "./types";

export const ADMIN_ORDER_STATE_CHANGED = "ORDER_STATE_CHANGED" as const;
export const ADMIN_ORDER_STATE_CHANGED_MESSAGE =
  "Este pedido cambió desde que abriste la pantalla. Revisá el estado actual antes de guardar nuevamente.";

export type AdminStatusField = "paymentStatus" | "shippingStatus";

export type AdminOrderStatusIntent = {
  changedFields: AdminStatusField[];
  expectedPaymentStatus?: OrderPaymentStatus;
  expectedShippingStatus?: OrderShippingStatus;
  requestedPaymentStatus?: OrderPaymentStatus;
  requestedShippingStatus?: OrderShippingStatus;
};

export type AdminOrderCurrentState = {
  paymentStatus: OrderPaymentStatus;
  shippingStatus: OrderShippingStatus;
};

export type AdminStatusIntentDecision =
  | { outcome: "allow" }
  | { outcome: "idempotent_replay" }
  | { outcome: "conflict"; current: AdminOrderCurrentState };

const hasOwn = (value: object, key: string) =>
  Object.prototype.hasOwnProperty.call(value, key);

export const assertValidAdminOrderStatusIntent = (
  intent: AdminOrderStatusIntent
): AdminOrderStatusIntent => {
  if (!Array.isArray(intent.changedFields) || intent.changedFields.length === 0) {
    throw new Error("Invalid Admin order status intent");
  }

  const uniqueFields = new Set<AdminStatusField>();
  for (const field of intent.changedFields) {
    if (field !== "paymentStatus" && field !== "shippingStatus") {
      throw new Error("Invalid Admin order status intent");
    }
    if (uniqueFields.has(field)) {
      throw new Error("Invalid Admin order status intent");
    }
    uniqueFields.add(field);
  }

  const paymentChanged = uniqueFields.has("paymentStatus");
  const shippingChanged = uniqueFields.has("shippingStatus");
  if (
    paymentChanged !==
      (hasOwn(intent, "expectedPaymentStatus") && hasOwn(intent, "requestedPaymentStatus")) ||
    shippingChanged !==
      (hasOwn(intent, "expectedShippingStatus") && hasOwn(intent, "requestedShippingStatus"))
  ) {
    throw new Error("Invalid Admin order status intent");
  }

  return intent;
};

export const evaluateAdminStatusIntent = (
  current: AdminOrderCurrentState,
  intent: AdminOrderStatusIntent
): AdminStatusIntentDecision => {
  assertValidAdminOrderStatusIntent(intent);

  let everyTargetAlreadySatisfied = true;
  for (const field of intent.changedFields) {
    const currentValue = current[field];
    const expectedValue =
      field === "paymentStatus"
        ? intent.expectedPaymentStatus
        : intent.expectedShippingStatus;
    const requestedValue =
      field === "paymentStatus"
        ? intent.requestedPaymentStatus
        : intent.requestedShippingStatus;

    if (currentValue === expectedValue) {
      everyTargetAlreadySatisfied = everyTargetAlreadySatisfied && currentValue === requestedValue;
      continue;
    }
    if (currentValue === requestedValue) continue;
    return { outcome: "conflict", current };
  }

  return everyTargetAlreadySatisfied
    ? { outcome: "idempotent_replay" }
    : { outcome: "allow" };
};

export class AdminOrderStateChangedError extends Error {
  readonly code = ADMIN_ORDER_STATE_CHANGED;

  constructor(readonly orderId: string, readonly current: AdminOrderCurrentState) {
    super(ADMIN_ORDER_STATE_CHANGED_MESSAGE);
    this.name = "AdminOrderStateChangedError";
  }
}
