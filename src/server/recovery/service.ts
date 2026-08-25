import "server-only";

import { logEvent } from "@/src/server/observability/log";
import { getOrder, reconstructOrderFromAuthorityEvidence } from "@/src/server/orders/store";
import type { Order } from "@/src/server/orders/types";
import type { MpPaymentResponse, MpSearchPayment } from "@/src/server/payments/shared";
import { getOrderRowById } from "@/src/server/sheets/repository";
import { buildPurchaseReceiptEventKey } from "@/src/server/emailOutbox/payload";
import { getEmailOutboxEvent } from "@/src/server/emailOutbox/repository";
import {
  buildRecoveryPaymentEvent,
  normalizeProtectedPaymentObservation,
  validateProtectedPaymentAgainstOrder,
  validateProtectedPaymentAgainstSnapshot,
} from "./paymentEvent";
import {
  buildRecoveryOrderSnapshot,
  parseStoredRecoverySnapshot,
  recoverySnapshotMatchesOrder,
  recoverySnapshotToOrder,
  serializeRecoverySnapshot,
  type RecoverySnapshotValidationError,
} from "./snapshot";
import {
  appendRecoveryPaymentEvent,
  getRecoverySnapshot,
  listRecoveryPaymentEvents,
  markRecoveryEventState,
  markRecoverySnapshotState,
  upsertRecoverySnapshot,
} from "./repository";
import type {
  RecoveryOrderSnapshotV1,
  RecoveryPaymentEvent,
  RecoveryPaymentSource,
  StoredRecoverySnapshot,
} from "./types";

const LEGACY_PREFERENCE_WINDOW_MS = 48 * 60 * 60 * 1000;

export const loadRecoveryAuthorityEvidence = async (input: {
  externalReference: string;
  snapshotHash?: string;
  currentEvent?: RecoveryPaymentEvent;
}) => {
  const listed = await listRecoveryPaymentEvents(50);
  const byKey = new Map<string, RecoveryPaymentEvent>();
  for (const event of [...listed, ...(input.currentEvent ? [input.currentEvent] : [])]) {
    if (
      event.validationState !== "validated" ||
      event.externalReference !== input.externalReference ||
      (input.snapshotHash && event.snapshotHash !== input.snapshotHash)
    ) {
      continue;
    }
    byKey.set(event.eventKey, event);
  }
  const receiptEventKey = buildPurchaseReceiptEventKey(input.externalReference);
  const receiptEvent = await getEmailOutboxEvent(receiptEventKey);
  if (
    receiptEvent &&
    (receiptEvent.eventKey !== receiptEventKey ||
      receiptEvent.externalReference !== input.externalReference)
  ) {
    throw new Error("EMAIL_OUTBOX_AUTHORITY_MISMATCH");
  }
  return {
    paymentEvents: [...byKey.values()],
    receiptEventExists: receiptEvent !== null,
  };
};

export const reconstructOrderAuthorityFromDurableEvidence = async (
  externalReference: string,
  currentEvent?: RecoveryPaymentEvent,
): Promise<Order | null> => {
  const storedSnapshot = await getRecoverySnapshot(externalReference);
  if (!storedSnapshot?.snapshotJson) return null;
  const snapshot = parseStoredRecoverySnapshot(storedSnapshot);
  const authorityEvidence = await loadRecoveryAuthorityEvidence({
    externalReference,
    snapshotHash: storedSnapshot.snapshotHash,
    currentEvent,
  });
  return (
    await reconstructOrderFromAuthorityEvidence(
      recoverySnapshotToOrder(snapshot),
      authorityEvidence,
    )
  ).order;
};

export type PreparedProtectedPayment =
  | { protected: false }
  | {
      protected: true;
      outcome: "reference_mismatch";
    }
  | {
      protected: true;
      outcome: "attention";
      event: RecoveryPaymentEvent;
      order: Order | null;
    }
  | {
      protected: true;
      outcome: "ready";
      event: RecoveryPaymentEvent;
      order: Order;
    }
  | {
      protected: true;
      outcome: "deferred";
      event: RecoveryPaymentEvent;
      order: null;
    };

export const persistCheckoutRecoverySnapshot = async (input: {
  order: Order;
  checkoutAttemptId: string;
  preferenceValidFrom: number;
  preferenceExpiresAt: number;
}) => {
  const snapshot = buildRecoveryOrderSnapshot(input);
  const result = await upsertRecoverySnapshot(snapshot);
  logEvent(
    "info",
    result.outcome === "stored" ? "recovery.snapshot.persisted" : "recovery.snapshot.replayed",
    {
      orderId: snapshot.externalReference,
      checkoutAttemptId: snapshot.checkoutAttemptId,
    },
  );
  return { ...result, recoverySnapshot: snapshot };
};

const legacyCheckoutAttemptId = (externalReference: string) =>
  `legacy_${externalReference}`.slice(0, 160);

const ensureLegacyRecoverySnapshot = async (
  order: Order,
): Promise<{ stored: StoredRecoverySnapshot; snapshot: RecoveryOrderSnapshotV1 }> => {
  const existing = await getRecoverySnapshot(order.externalReference);
  if (existing) {
    const parsed = parseStoredRecoverySnapshot(existing);
    if (!recoverySnapshotMatchesOrder(parsed, order)) {
      throw new Error("Existing recovery snapshot conflicts with the trusted order");
    }
    return { stored: existing, snapshot: parsed };
  }

  const preferenceValidFrom = order.createdAt;
  const preferenceExpiresAt = preferenceValidFrom + LEGACY_PREFERENCE_WINDOW_MS;
  const snapshot = buildRecoveryOrderSnapshot({
    order,
    checkoutAttemptId: legacyCheckoutAttemptId(order.externalReference),
    preferenceValidFrom,
    preferenceExpiresAt,
  });
  const persisted = await upsertRecoverySnapshot(snapshot);
  logEvent("info", "recovery.snapshot.persisted", {
    orderId: order.externalReference,
    legacy: true,
  });
  return { stored: persisted.snapshot, snapshot };
};

const safeReadOrder = async (externalReference: string): Promise<Order | null> => {
  if (!externalReference) return null;
  try {
    return await getOrder(externalReference);
  } catch (error) {
    logEvent("warn", "recovery.order_read_unavailable", {
      orderId: externalReference,
      errorName: error instanceof Error ? error.name : "unknown",
    });
    return null;
  }
};

const persistAttentionEvent = async (input: {
  payment: MpPaymentResponse | MpSearchPayment;
  fallbackPaymentId?: string;
  source: RecoveryPaymentSource;
  observedAt?: number;
  snapshotHash?: string;
  validationState: "missing_snapshot" | "conflict";
  errorCode: string;
  order: Order | null;
}): Promise<PreparedProtectedPayment> => {
  const observation = normalizeProtectedPaymentObservation(input);
  if (!observation) return { protected: false };
  const persisted = await appendRecoveryPaymentEvent(
    buildRecoveryPaymentEvent({
      observation,
      source: input.source,
      observedAt: input.observedAt,
      snapshotHash: input.snapshotHash,
      validationState: input.validationState,
      attentionCode: input.errorCode,
    }),
  );
  if (observation.externalReference && input.snapshotHash) {
    await markRecoverySnapshotState({
      externalReference: observation.externalReference,
      state: "attention",
      errorCode: input.errorCode,
    }).catch(() => undefined);
  }
  logEvent("warn", "recovery.worker.attention", {
    orderId: observation.externalReference,
    paymentId: observation.paymentId,
    errorCode: input.errorCode,
  });
  return { protected: true, outcome: "attention", event: persisted.event, order: input.order };
};

const persistValidatedEvent = async (input: {
  observation: NonNullable<ReturnType<typeof normalizeProtectedPaymentObservation>>;
  source: RecoveryPaymentSource;
  observedAt?: number;
  snapshotHash?: string;
}) => {
  const persisted = await appendRecoveryPaymentEvent(
    buildRecoveryPaymentEvent({
      observation: input.observation,
      source: input.source,
      observedAt: input.observedAt,
      snapshotHash: input.snapshotHash,
      validationState: "validated",
    }),
  );
  logEvent(
    "info",
    persisted.outcome === "stored"
      ? "recovery.payment_event.persisted"
      : "recovery.payment_event.replayed",
    {
      orderId: input.observation.externalReference,
      paymentId: input.observation.paymentId,
      state: persisted.event.processingState,
    },
  );
  return persisted;
};

export const prepareProtectedPaymentDurability = async (input: {
  expectedExternalReference: string;
  payment: MpPaymentResponse | MpSearchPayment;
  fallbackPaymentId?: string;
  source: RecoveryPaymentSource;
  observedAt?: number;
}): Promise<PreparedProtectedPayment> => {
  const observation = normalizeProtectedPaymentObservation(input);
  if (!observation) return { protected: false };
  if (observation.externalReference !== input.expectedExternalReference) {
    return { protected: true, outcome: "reference_mismatch" };
  }

  let order = await safeReadOrder(observation.externalReference);
  let storedSnapshot: StoredRecoverySnapshot | null = null;
  let snapshot: RecoveryOrderSnapshotV1 | null = null;

  if (observation.externalReference) {
    storedSnapshot = await getRecoverySnapshot(observation.externalReference);
  }
  if (!storedSnapshot && order) {
    const legacy = await ensureLegacyRecoverySnapshot(order);
    storedSnapshot = legacy.stored;
    snapshot = legacy.snapshot;
  } else if (storedSnapshot?.snapshotJson) {
    try {
      snapshot = parseStoredRecoverySnapshot(storedSnapshot);
    } catch (error) {
      return persistAttentionEvent({
        ...input,
        snapshotHash: storedSnapshot.snapshotHash,
        validationState: "conflict",
        errorCode:
          (error as RecoverySnapshotValidationError).code || "RECOVERY_SNAPSHOT_INVALID",
        order,
      });
    }
  }

  if (
    !order &&
    !snapshot &&
    storedSnapshot &&
    !storedSnapshot.snapshotJson &&
    (observation.financialStatus === "refunded" ||
      observation.financialStatus === "charged_back")
  ) {
    const salesOrder = await getOrderRowById(observation.externalReference);
    if (
      salesOrder &&
      salesOrder.orderId === observation.externalReference &&
      Math.abs(salesOrder.total - observation.amount) <= 0.01 &&
      salesOrder.currency === observation.currency
    ) {
      const persisted = await persistValidatedEvent({
        observation,
        source: input.source,
        observedAt: input.observedAt,
        snapshotHash: storedSnapshot.snapshotHash,
      });
      return { protected: true, outcome: "deferred", event: persisted.event, order: null };
    }
  }

  if (!order && !snapshot) {
    return persistAttentionEvent({
      ...input,
      snapshotHash: storedSnapshot?.snapshotHash,
      validationState: "missing_snapshot",
      errorCode: storedSnapshot
        ? "RECOVERY_SNAPSHOT_REDACTED"
        : "RECOVERY_SNAPSHOT_NOT_FOUND",
      order: null,
    });
  }
  if (order && snapshot && !recoverySnapshotMatchesOrder(snapshot, order)) {
    return persistAttentionEvent({
      ...input,
      snapshotHash: storedSnapshot?.snapshotHash,
      validationState: "conflict",
      errorCode: "RECOVERY_ORDER_SNAPSHOT_CONFLICT",
      order,
    });
  }

  const validation = order
    ? validateProtectedPaymentAgainstOrder(observation, order)
    : validateProtectedPaymentAgainstSnapshot(observation, snapshot!);
  if (!validation.valid) {
    return persistAttentionEvent({
      ...input,
      snapshotHash: storedSnapshot?.snapshotHash,
      validationState: "conflict",
      errorCode: validation.errorCode,
      order,
    });
  }

  const persisted = await persistValidatedEvent({
    observation,
    source: input.source,
    observedAt: input.observedAt,
    snapshotHash:
      storedSnapshot?.snapshotHash ??
      (snapshot ? serializeRecoverySnapshot(snapshot).snapshotHash : undefined),
  });

  if (storedSnapshot) {
    await markRecoverySnapshotState({
      externalReference: storedSnapshot.externalReference,
      state: "payment_observed",
    }).catch((error) => {
      logEvent("warn", "recovery.snapshot_state_update_failed", {
        orderId: storedSnapshot!.externalReference,
        errorName: error instanceof Error ? error.name : "unknown",
      });
    });
  }

  if (!order) {
    const authorityEvidence = await loadRecoveryAuthorityEvidence({
      externalReference: snapshot!.externalReference,
      snapshotHash: storedSnapshot?.snapshotHash,
      currentEvent: persisted.event,
    });
    const ensured = await reconstructOrderFromAuthorityEvidence(
      recoverySnapshotToOrder(snapshot!),
      authorityEvidence,
    );
    order = ensured.order;
  }
  return { protected: true, outcome: "ready", event: persisted.event, order };
};

export const markRecoveryEventRetryableSafely = async (
  event: RecoveryPaymentEvent,
  errorCode: string,
  leaseOwner?: string,
) => {
  const safeErrorCode = /^[A-Z0-9_]{3,120}$/.test(errorCode)
    ? errorCode
    : "RECOVERY_RECONCILIATION_FAILED";
  try {
    await markRecoveryEventState({
      eventKey: event.eventKey,
      state: "retryable",
      leaseOwner,
      errorCode: safeErrorCode,
    });
    logEvent("warn", "recovery.worker.retryable", {
      orderId: event.externalReference,
      paymentId: event.paymentId,
      errorCode: safeErrorCode,
    });
  } catch (error) {
    logEvent("error", "recovery.event_state_update_failed", {
      orderId: event.externalReference,
      paymentId: event.paymentId,
      errorName: error instanceof Error ? error.name : "unknown",
    });
  }
};

export const completeRecoveryEvent = async (
  event: RecoveryPaymentEvent,
  leaseOwner?: string,
) => {
  await markRecoveryEventState({
    eventKey: event.eventKey,
    state: "completed",
    leaseOwner,
  });
  if (event.externalReference && event.snapshotHash) {
    await markRecoverySnapshotState({
      externalReference: event.externalReference,
      state: "completed",
      redactSnapshot: true,
    });
  }
  logEvent("info", "recovery.worker.completed", {
    orderId: event.externalReference,
    paymentId: event.paymentId,
  });
};
