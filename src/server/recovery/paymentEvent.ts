import "server-only";

import { createHash } from "node:crypto";
import type { Order } from "@/src/server/orders/types";
import { amountMatches } from "@/src/server/payments/shared";
import type { MpPaymentResponse, MpSearchPayment } from "@/src/server/payments/shared";
import { canonicalJson } from "./snapshot";
import {
  RECOVERY_SCHEMA_VERSION,
  type RecoveryFinancialStatus,
  type RecoveryOrderSnapshotV1,
  type RecoveryPaymentSource,
  type RecoveryValidationState,
} from "./types";
import type { NewRecoveryPaymentEvent } from "./repository";

export const PROTECTED_RECOVERY_PAYMENT_STATUSES = new Set<RecoveryFinancialStatus>([
  "approved",
  "refunded",
  "charged_back",
]);

export type ProtectedPaymentObservation = {
  paymentId: string;
  externalReference: string;
  financialStatus: RecoveryFinancialStatus;
  statusDetail?: string;
  amount: number;
  currency: string;
  mpUpdatedAt?: string;
};

const normalizeMpUpdatedAt = (value: unknown): string | undefined => {
  if (typeof value !== "string" || !value.trim()) return undefined;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : undefined;
};

export const normalizeProtectedPaymentObservation = (input: {
  payment: MpPaymentResponse | MpSearchPayment;
  fallbackPaymentId?: string;
}): ProtectedPaymentObservation | null => {
  const financialStatus = String(input.payment.status ?? "").trim().toLowerCase();
  if (!PROTECTED_RECOVERY_PAYMENT_STATUSES.has(financialStatus as RecoveryFinancialStatus)) {
    return null;
  }
  const paymentId = String(input.payment.id ?? input.fallbackPaymentId ?? "").trim();
  if (!/^[a-zA-Z0-9_-]{1,64}$/.test(paymentId)) {
    throw new Error("Protected Mercado Pago payment has an invalid payment id");
  }
  const amount = Number(input.payment.transaction_amount);
  if (!Number.isFinite(amount) || amount < 0) {
    throw new Error("Protected Mercado Pago payment has an invalid amount");
  }
  const currency = String(input.payment.currency_id ?? "").trim().toUpperCase();
  if (!/^[A-Z]{3}$/.test(currency)) {
    throw new Error("Protected Mercado Pago payment has an invalid currency");
  }
  const externalReference = String(input.payment.external_reference ?? "").trim().slice(0, 160);
  return {
    paymentId,
    externalReference,
    financialStatus: financialStatus as RecoveryFinancialStatus,
    ...(input.payment.status_detail
      ? { statusDetail: String(input.payment.status_detail).trim().slice(0, 120) }
      : {}),
    amount,
    currency,
    ...(normalizeMpUpdatedAt(input.payment.date_last_updated)
      ? { mpUpdatedAt: normalizeMpUpdatedAt(input.payment.date_last_updated) }
      : {}),
  };
};

export const buildRecoveryPaymentEventKey = (
  observation: Pick<
    ProtectedPaymentObservation,
    "paymentId" | "financialStatus" | "mpUpdatedAt"
  >,
): string =>
  createHash("sha256")
    .update(
      canonicalJson({
        paymentId: observation.paymentId,
        financialStatus: observation.financialStatus,
        mpUpdatedAt: observation.mpUpdatedAt ?? "unversioned",
      }),
      "utf8",
    )
    .digest("hex");

export const validateProtectedPaymentAgainstOrder = (
  observation: ProtectedPaymentObservation,
  order: Pick<Order, "externalReference" | "total" | "currency">,
): { valid: true } | { valid: false; errorCode: string } => {
  if (observation.externalReference !== order.externalReference) {
    return { valid: false, errorCode: "RECOVERY_PAYMENT_REFERENCE_MISMATCH" };
  }
  if (!amountMatches(observation.amount, order.total)) {
    return { valid: false, errorCode: "RECOVERY_PAYMENT_AMOUNT_MISMATCH" };
  }
  if (observation.currency !== order.currency) {
    return { valid: false, errorCode: "RECOVERY_PAYMENT_CURRENCY_MISMATCH" };
  }
  return { valid: true };
};

export const validateProtectedPaymentAgainstSnapshot = (
  observation: ProtectedPaymentObservation,
  snapshot: RecoveryOrderSnapshotV1,
) => validateProtectedPaymentAgainstOrder(observation, snapshot);

export const buildRecoveryPaymentEvent = (input: {
  observation: ProtectedPaymentObservation;
  source: RecoveryPaymentSource;
  observedAt?: number;
  snapshotHash?: string;
  validationState: RecoveryValidationState;
  attentionCode?: string;
}): NewRecoveryPaymentEvent => {
  const observedAt = input.observedAt ?? Date.now();
  if (!Number.isSafeInteger(observedAt)) {
    throw new Error("Invalid recovery payment observation timestamp");
  }
  return {
    eventKey: buildRecoveryPaymentEventKey(input.observation),
    paymentId: input.observation.paymentId,
    externalReference: input.observation.externalReference,
    financialStatus: input.observation.financialStatus,
    ...(input.observation.statusDetail
      ? { statusDetail: input.observation.statusDetail }
      : {}),
    amount: input.observation.amount,
    currency: input.observation.currency,
    ...(input.observation.mpUpdatedAt
      ? { mpUpdatedAt: input.observation.mpUpdatedAt }
      : {}),
    observedAt: new Date(observedAt).toISOString(),
    source: input.source,
    schemaVersion: RECOVERY_SCHEMA_VERSION,
    ...(input.snapshotHash ? { snapshotHash: input.snapshotHash } : {}),
    validationState: input.validationState,
    processingState: input.validationState === "validated" ? "pending" : "attention",
    ...(input.attentionCode ? { lastErrorCode: input.attentionCode } : {}),
  };
};
