import "server-only";

import { env } from "@/src/config/env";
import { fetchWithPolicy } from "@/src/server/http/fetchWithPolicy";
import { logEvent } from "@/src/server/observability/log";
import { getSheetsToken } from "@/src/server/sheets/tokens";
import {
  RECOVERY_SCHEMA_VERSION,
  type RecoveryAttentionItem,
  type RecoveryFinancialStatus,
  type RecoveryOrderSnapshotV1,
  type RecoveryPaymentEvent,
  type RecoveryPaymentSource,
  type RecoveryProcessingState,
  type RecoverySnapshotState,
  type RecoveryValidationState,
  type RecoveryWorkClaim,
  type StoredRecoverySnapshot,
} from "./types";
import { serializeRecoverySnapshot } from "./snapshot";

const RECOVERY_REQUEST_POLICY = {
  timeoutMs: 12_000,
  retries: 1,
  retryDelayMs: 400,
} as const;

const PROCESSING_STATES = new Set<RecoveryProcessingState>([
  "pending",
  "processing",
  "retryable",
  "attention",
  "completed",
]);
const SNAPSHOT_STATES = new Set<RecoverySnapshotState>([
  "pending_payment",
  "payment_observed",
  "attention",
  "completed",
  "expired_unpaid",
]);
const FINANCIAL_STATUSES = new Set<RecoveryFinancialStatus>([
  "approved",
  "refunded",
  "charged_back",
]);
const VALIDATION_STATES = new Set<RecoveryValidationState>([
  "validated",
  "missing_snapshot",
  "conflict",
]);
const PAYMENT_SOURCES = new Set<RecoveryPaymentSource>([
  "webhook",
  "verify_payment_id",
  "verify_search",
  "snapshot_scan",
]);

type RecoveryResponse = {
  ok?: boolean;
  result?: string;
  code?: string;
  error?: string;
  snapshot?: unknown;
  event?: unknown;
  events?: unknown;
  snapshots?: unknown;
  items?: unknown;
};

export class RecoveryStoreError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "RecoveryStoreError";
    this.code = code;
  }
}

const requiredString = (value: unknown, field: string): string => {
  if (typeof value !== "string" || !value.trim()) {
    throw new RecoveryStoreError("RECOVERY_RESPONSE_INVALID", `Missing ${field}`);
  }
  return value;
};

const optionalString = (value: unknown): string | undefined =>
  typeof value === "string" && value.trim() ? value : undefined;

const requiredNumber = (value: unknown, field: string): number => {
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(parsed)) {
    throw new RecoveryStoreError("RECOVERY_RESPONSE_INVALID", `Invalid ${field}`);
  }
  return parsed;
};

const recordFrom = (value: unknown, field: string): Record<string, unknown> => {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new RecoveryStoreError("RECOVERY_RESPONSE_INVALID", `Invalid ${field}`);
  }
  return value as Record<string, unknown>;
};

const parseSnapshot = (input: unknown): StoredRecoverySnapshot => {
  const row = recordFrom(input, "snapshot");
  const schemaVersion = requiredNumber(row.schema_version, "snapshot schema_version");
  const state = requiredString(row.recovery_state, "snapshot recovery_state");
  if (schemaVersion !== RECOVERY_SCHEMA_VERSION || !SNAPSHOT_STATES.has(state as RecoverySnapshotState)) {
    throw new RecoveryStoreError("RECOVERY_RESPONSE_INVALID", "Invalid snapshot schema/state");
  }
  return {
    externalReference: requiredString(row.external_reference, "snapshot external_reference"),
    checkoutAttemptId: requiredString(row.checkout_attempt_id, "snapshot checkout_attempt_id"),
    schemaVersion: RECOVERY_SCHEMA_VERSION,
    snapshotHash: requiredString(row.snapshot_hash, "snapshot snapshot_hash"),
    snapshotJson: typeof row.snapshot_json === "string" ? row.snapshot_json : "",
    createdAt: requiredString(row.created_at, "snapshot created_at"),
    preferenceValidFrom: requiredString(
      row.preference_valid_from,
      "snapshot preference_valid_from",
    ),
    preferenceExpiresAt: requiredString(
      row.preference_expires_at,
      "snapshot preference_expires_at",
    ),
    recoveryState: state as RecoverySnapshotState,
    lastCheckedAt: optionalString(row.last_checked_at),
    lastErrorCode: optionalString(row.last_error_code),
    updatedAt: requiredString(row.updated_at, "snapshot updated_at"),
    completedAt: optionalString(row.completed_at),
  };
};

const parseEvent = (input: unknown): RecoveryPaymentEvent => {
  const row = recordFrom(input, "event");
  const schemaVersion = requiredNumber(row.schema_version, "event schema_version");
  const financialStatus = requiredString(row.financial_status, "event financial_status");
  const validationState = requiredString(row.validation_state, "event validation_state");
  const processingState = requiredString(row.processing_state, "event processing_state");
  const source = requiredString(row.source, "event source");
  const currency = requiredString(row.currency, "event currency");
  if (
    schemaVersion !== RECOVERY_SCHEMA_VERSION ||
    !FINANCIAL_STATUSES.has(financialStatus as RecoveryFinancialStatus) ||
    !VALIDATION_STATES.has(validationState as RecoveryValidationState) ||
    !PROCESSING_STATES.has(processingState as RecoveryProcessingState) ||
    !PAYMENT_SOURCES.has(source as RecoveryPaymentSource) ||
    !/^[A-Z]{3}$/.test(currency)
  ) {
    throw new RecoveryStoreError("RECOVERY_RESPONSE_INVALID", "Invalid event contract");
  }
  return {
    eventKey: requiredString(row.event_key, "event event_key"),
    paymentId: requiredString(row.payment_id, "event payment_id"),
    externalReference: typeof row.external_reference === "string" ? row.external_reference : "",
    financialStatus: financialStatus as RecoveryFinancialStatus,
    statusDetail: optionalString(row.status_detail),
    amount: requiredNumber(row.amount, "event amount"),
    currency,
    mpUpdatedAt: optionalString(row.mp_updated_at),
    observedAt: requiredString(row.observed_at, "event observed_at"),
    source: source as RecoveryPaymentSource,
    schemaVersion: RECOVERY_SCHEMA_VERSION,
    snapshotHash: optionalString(row.snapshot_hash),
    validationState: validationState as RecoveryValidationState,
    processingState: processingState as RecoveryProcessingState,
    attemptCount: requiredNumber(row.attempt_count, "event attempt_count"),
    leaseOwner: optionalString(row.lease_owner),
    leaseExpiresAt: optionalString(row.lease_expires_at),
    lastAttemptAt: optionalString(row.last_attempt_at),
    lastErrorCode: optionalString(row.last_error_code),
    updatedAt: requiredString(row.updated_at, "event updated_at"),
    completedAt: optionalString(row.completed_at),
  };
};

const postRecoveryAction = async (
  payload: Record<string, unknown>,
): Promise<RecoveryResponse> => {
  const action = requiredString(payload.action, "recovery action");
  const startedAt = Date.now();
  let status: number | undefined;
  try {
    const response = await fetchWithPolicy(
      env.getRequiredServer("SHEETS_ENDPOINT"),
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        cache: "no-store",
        body: JSON.stringify({
          ...payload,
          token: getSheetsToken("admin"),
        }),
      },
      RECOVERY_REQUEST_POLICY,
    );
    status = response.status;
    const data = (await response.json().catch(() => null)) as RecoveryResponse | null;
    if (!response.ok || !data || data.ok !== true || typeof data.result !== "string") {
      throw new RecoveryStoreError(
        data?.code || "RECOVERY_STORE_UNAVAILABLE",
        data?.error || `Recovery store request failed with status ${response.status}`,
      );
    }
    logEvent("info", "recovery.store.timing", {
      action,
      status,
      ok: true,
      durationMs: Date.now() - startedAt,
    });
    return data;
  } catch (error) {
    logEvent("warn", "recovery.store.timing", {
      action,
      status,
      ok: false,
      durationMs: Date.now() - startedAt,
      errorName: error instanceof Error ? error.name : "unknown",
    });
    throw error;
  }
};

export const ensureRecoverySchema = async (): Promise<void> => {
  const response = await postRecoveryAction({ action: "ensureRecoverySchema" });
  if (response.result !== "RECOVERY_SCHEMA_READY") {
    throw new RecoveryStoreError("RECOVERY_RESPONSE_INVALID", "Unexpected schema result");
  }
};

export const upsertRecoverySnapshot = async (
  snapshot: RecoveryOrderSnapshotV1,
): Promise<{ outcome: "stored" | "already_exists"; snapshot: StoredRecoverySnapshot }> => {
  const serialized = serializeRecoverySnapshot(snapshot);
  const now = new Date().toISOString();
  const response = await postRecoveryAction({
    action: "upsertRecoverySnapshot",
    snapshot: {
      external_reference: snapshot.externalReference,
      checkout_attempt_id: snapshot.checkoutAttemptId,
      schema_version: snapshot.schemaVersion,
      snapshot_hash: serialized.snapshotHash,
      snapshot_json: serialized.snapshotJson,
      created_at: new Date(snapshot.createdAt).toISOString(),
      preference_valid_from: new Date(snapshot.preferenceValidFrom).toISOString(),
      preference_expires_at: new Date(snapshot.preferenceExpiresAt).toISOString(),
      recovery_state: "pending_payment",
      last_checked_at: "",
      last_error_code: "",
      updated_at: now,
      completed_at: "",
    },
  });
  const outcome =
    response.result === "SNAPSHOT_STORED"
      ? "stored"
      : response.result === "SNAPSHOT_ALREADY_EXISTS"
        ? "already_exists"
        : null;
  if (!outcome) {
    throw new RecoveryStoreError("RECOVERY_RESPONSE_INVALID", "Unexpected snapshot result");
  }
  return { outcome, snapshot: parseSnapshot(response.snapshot) };
};

export const getRecoverySnapshot = async (
  externalReference: string,
): Promise<StoredRecoverySnapshot | null> => {
  const response = await postRecoveryAction({
    action: "getRecoverySnapshot",
    externalReference,
  });
  if (response.result === "RECOVERY_SNAPSHOT_NOT_FOUND") return null;
  if (response.result !== "RECOVERY_SNAPSHOT_FOUND") {
    throw new RecoveryStoreError("RECOVERY_RESPONSE_INVALID", "Unexpected get snapshot result");
  }
  return parseSnapshot(response.snapshot);
};

export type NewRecoveryPaymentEvent = Omit<
  RecoveryPaymentEvent,
  | "processingState"
  | "attemptCount"
  | "leaseOwner"
  | "leaseExpiresAt"
  | "lastAttemptAt"
  | "lastErrorCode"
  | "updatedAt"
  | "completedAt"
> & {
  processingState?: Extract<RecoveryProcessingState, "pending" | "attention">;
  lastErrorCode?: string;
};

export const appendRecoveryPaymentEvent = async (
  event: NewRecoveryPaymentEvent,
): Promise<{ outcome: "stored" | "already_stored"; event: RecoveryPaymentEvent }> => {
  const now = new Date().toISOString();
  const response = await postRecoveryAction({
    action: "appendRecoveryPaymentEvent",
    event: {
      event_key: event.eventKey,
      payment_id: event.paymentId,
      external_reference: event.externalReference,
      financial_status: event.financialStatus,
      status_detail: event.statusDetail ?? "",
      amount: event.amount,
      currency: event.currency,
      mp_updated_at: event.mpUpdatedAt ?? "",
      observed_at: event.observedAt,
      source: event.source,
      schema_version: event.schemaVersion,
      snapshot_hash: event.snapshotHash ?? "",
      validation_state: event.validationState,
      processing_state: event.processingState ?? "pending",
      attempt_count: 0,
      lease_owner: "",
      lease_expires_at: "",
      last_attempt_at: "",
      last_error_code: event.lastErrorCode ?? "",
      updated_at: now,
      completed_at: "",
    },
  });
  const outcome =
    response.result === "EVENT_STORED"
      ? "stored"
      : response.result === "EVENT_ALREADY_STORED"
        ? "already_stored"
        : null;
  if (!outcome) {
    throw new RecoveryStoreError("RECOVERY_RESPONSE_INVALID", "Unexpected event result");
  }
  return { outcome, event: parseEvent(response.event) };
};

export const getRecoveryPaymentEvent = async (
  eventKey: string,
): Promise<RecoveryPaymentEvent | null> => {
  const response = await postRecoveryAction({
    action: "getRecoveryPaymentEvent",
    eventKey,
  });
  if (response.result === "RECOVERY_EVENT_NOT_FOUND") return null;
  if (response.result !== "RECOVERY_EVENT_FOUND") {
    throw new RecoveryStoreError("RECOVERY_RESPONSE_INVALID", "Unexpected get event result");
  }
  return parseEvent(response.event);
};

/** Existing bounded durable-event read; callers must treat a missing match as unknown. */
export const listRecoveryPaymentEvents = async (
  limit = 50,
): Promise<RecoveryPaymentEvent[]> => {
  const response = await postRecoveryAction({
    action: "listRecoveryPaymentEvents",
    limit: Math.max(1, Math.min(50, Math.trunc(limit))),
  });
  if (response.result !== "RECOVERY_EVENTS_LISTED" || !Array.isArray(response.events)) {
    throw new RecoveryStoreError("RECOVERY_RESPONSE_INVALID", "Unexpected event list result");
  }
  return response.events.map(parseEvent);
};

export const claimRecoveryWork = async (input: {
  leaseOwner: string;
  claimedAt: string;
  leaseExpiresAt: string;
  maxEvents: number;
  maxSnapshots: number;
}): Promise<RecoveryWorkClaim> => {
  const response = await postRecoveryAction({
    action: "claimRecoveryWork",
    ...input,
  });
  if (response.result !== "WORK_CLAIMED") {
    throw new RecoveryStoreError("RECOVERY_RESPONSE_INVALID", "Unexpected work claim result");
  }
  if (!Array.isArray(response.events) || !Array.isArray(response.snapshots)) {
    throw new RecoveryStoreError("RECOVERY_RESPONSE_INVALID", "Malformed work claim");
  }
  return {
    events: response.events.map(parseEvent),
    snapshots: response.snapshots.map(parseSnapshot),
  };
};

export const markRecoveryEventState = async (input: {
  eventKey: string;
  state: Extract<RecoveryProcessingState, "retryable" | "attention" | "completed">;
  leaseOwner?: string;
  errorCode?: string;
}): Promise<RecoveryPaymentEvent> => {
  const response = await postRecoveryAction({
    action:
      input.state === "completed"
        ? "markRecoveryWorkCompleted"
        : input.state === "attention"
          ? "markRecoveryWorkAttention"
          : "markRecoveryWorkRetryable",
    eventKey: input.eventKey,
    leaseOwner: input.leaseOwner ?? "",
    errorCode: input.errorCode ?? "",
  });
  const expected =
    input.state === "completed"
      ? "WORK_COMPLETED"
      : input.state === "attention"
        ? "WORK_ATTENTION"
        : "WORK_RETRYABLE";
  if (response.result !== expected) {
    throw new RecoveryStoreError("RECOVERY_RESPONSE_INVALID", "Unexpected event state result");
  }
  return parseEvent(response.event);
};

export const markRecoverySnapshotState = async (input: {
  externalReference: string;
  state: RecoverySnapshotState;
  errorCode?: string;
  redactSnapshot?: boolean;
}): Promise<StoredRecoverySnapshot> => {
  const action =
    input.state === "completed"
      ? "markRecoverySnapshotCompleted"
      : input.state === "expired_unpaid"
        ? "markRecoverySnapshotExpiredUnpaid"
        : "markRecoverySnapshotChecked";
  const response = await postRecoveryAction({
    action,
    externalReference: input.externalReference,
    recoveryState: input.state,
    errorCode: input.errorCode ?? "",
    redactSnapshot: input.redactSnapshot === true,
  });
  if (response.result !== "RECOVERY_SNAPSHOT_UPDATED") {
    throw new RecoveryStoreError("RECOVERY_RESPONSE_INVALID", "Unexpected snapshot state result");
  }
  return parseSnapshot(response.snapshot);
};

export const listRecoveryAttention = async (limit = 100): Promise<RecoveryAttentionItem[]> => {
  const response = await postRecoveryAction({
    action: "listRecoveryAttention",
    limit,
  });
  if (response.result !== "RECOVERY_ATTENTION_LISTED" || !Array.isArray(response.items)) {
    throw new RecoveryStoreError("RECOVERY_RESPONSE_INVALID", "Unexpected attention result");
  }
  return response.items.map((input) => {
    const item = recordFrom(input, "attention item");
    const kind = requiredString(item.kind, "attention kind");
    if (kind !== "payment_event" && kind !== "snapshot") {
      throw new RecoveryStoreError("RECOVERY_RESPONSE_INVALID", "Invalid attention kind");
    }
    return {
      kind,
      externalReference:
        typeof item.external_reference === "string" ? item.external_reference : "",
      paymentId: optionalString(item.payment_id),
      financialStatus: optionalString(item.financial_status) as
        | RecoveryFinancialStatus
        | undefined,
      state: requiredString(item.state, "attention state") as RecoveryAttentionItem["state"],
      lastErrorCode: optionalString(item.last_error_code),
      updatedAt: requiredString(item.updated_at, "attention updated_at"),
    };
  });
};
