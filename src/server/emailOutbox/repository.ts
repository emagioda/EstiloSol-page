import "server-only";

import { env } from "@/src/config/env";
import { fetchWithPolicy } from "@/src/server/http/fetchWithPolicy";
import { logEvent } from "@/src/server/observability/log";
import { getSheetsToken } from "@/src/server/sheets/tokens";
import {
  EMAIL_OUTBOX_SCHEMA_VERSION,
  PURCHASE_RECEIPT_NOTIFICATION_TYPE,
  PURCHASE_RECEIPT_TEMPLATE_VERSION,
  type AcceptedMarkerRepair,
  type EmailOutboxAttentionItem,
  type EmailOutboxEvent,
  type EmailOutboxState,
  type MissingReceiptCandidate,
  type MissingReceiptDiscovery,
} from "./types";

const EMAIL_OUTBOX_REQUEST_POLICY = {
  timeoutMs: 12_000,
  retries: 1,
  retryDelayMs: 400,
} as const;

const EMAIL_STATES = new Set<EmailOutboxState>([
  "pending",
  "processing",
  "retryable",
  "accepted",
  "attention",
  "skipped",
]);

type EmailOutboxResponse = {
  ok?: boolean;
  result?: string;
  code?: string;
  error?: string;
  event?: unknown;
  events?: unknown;
  items?: unknown;
  candidates?: unknown;
  marker_repairs?: unknown;
  rollout_at?: unknown;
};

export class EmailOutboxStoreError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "EmailOutboxStoreError";
    this.code = code;
  }
}

const recordFrom = (value: unknown, field: string): Record<string, unknown> => {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new EmailOutboxStoreError("EMAIL_OUTBOX_RESPONSE_INVALID", `Invalid ${field}`);
  }
  return value as Record<string, unknown>;
};

const requiredString = (value: unknown, field: string): string => {
  if (typeof value !== "string" || !value.trim()) {
    throw new EmailOutboxStoreError("EMAIL_OUTBOX_RESPONSE_INVALID", `Missing ${field}`);
  }
  return value;
};

const optionalString = (value: unknown): string | undefined =>
  typeof value === "string" && value.trim() ? value : undefined;

const requiredNumber = (value: unknown, field: string): number => {
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(parsed)) {
    throw new EmailOutboxStoreError("EMAIL_OUTBOX_RESPONSE_INVALID", `Invalid ${field}`);
  }
  return parsed;
};

const parseEvent = (input: unknown): EmailOutboxEvent => {
  const row = recordFrom(input, "email event");
  const state = requiredString(row.state, "email state") as EmailOutboxState;
  const schemaVersion = requiredNumber(row.schema_version, "email schema_version");
  const templateVersion = requiredNumber(row.template_version, "email template_version");
  if (
    !EMAIL_STATES.has(state) ||
    schemaVersion !== EMAIL_OUTBOX_SCHEMA_VERSION ||
    templateVersion !== PURCHASE_RECEIPT_TEMPLATE_VERSION ||
    row.notification_type !== PURCHASE_RECEIPT_NOTIFICATION_TYPE
  ) {
    throw new EmailOutboxStoreError("EMAIL_OUTBOX_RESPONSE_INVALID", "Invalid email event contract");
  }
  const event: EmailOutboxEvent = {
    eventKey: requiredString(row.event_key, "email event_key"),
    externalReference: requiredString(row.external_reference, "email external_reference"),
    notificationType: PURCHASE_RECEIPT_NOTIFICATION_TYPE,
    schemaVersion: EMAIL_OUTBOX_SCHEMA_VERSION,
    templateVersion: PURCHASE_RECEIPT_TEMPLATE_VERSION,
    payloadHash: requiredString(row.payload_hash, "email payload_hash"),
    payloadJson: typeof row.payload_json === "string" ? row.payload_json : "",
    idempotencyKey: requiredString(row.idempotency_key, "email idempotency_key"),
    state,
    attemptCount: requiredNumber(row.attempt_count, "email attempt_count"),
    leaseOwner: optionalString(row.lease_owner),
    leaseExpiresAt: optionalString(row.lease_expires_at),
    nextAttemptAt: optionalString(row.next_attempt_at),
    providerFirstAttemptAt: optionalString(row.provider_first_attempt_at),
    providerOutcomeUnknownSince: optionalString(row.provider_outcome_unknown_since),
    lastAttemptAt: optionalString(row.last_attempt_at),
    lastErrorCode: optionalString(row.last_error_code),
    providerMessageId: optionalString(row.provider_message_id),
    acceptedAt: optionalString(row.accepted_at),
    createdAt: requiredString(row.created_at, "email created_at"),
    updatedAt: requiredString(row.updated_at, "email updated_at"),
    completedAt: optionalString(row.completed_at),
  };
  if (
    event.eventKey !== `purchase-receipt/${event.externalReference}/v1` ||
    event.idempotencyKey !== event.eventKey ||
    event.idempotencyKey.length > 256 ||
    !/^[a-f0-9]{64}$/.test(event.payloadHash) ||
    !Number.isInteger(event.attemptCount) ||
    event.attemptCount < 0
  ) {
    throw new EmailOutboxStoreError("EMAIL_OUTBOX_RESPONSE_INVALID", "Invalid email event identity");
  }
  if (
    event.state === "accepted" &&
    (!event.providerMessageId ||
      !/^[A-Za-z0-9_-]{8,160}$/.test(event.providerMessageId) ||
      !event.acceptedAt ||
      !event.completedAt)
  ) {
    throw new EmailOutboxStoreError("EMAIL_OUTBOX_RESPONSE_INVALID", "Invalid accepted email event");
  }
  return event;
};

const postEmailAction = async (
  payload: Record<string, unknown>,
): Promise<EmailOutboxResponse> => {
  const action = requiredString(payload.action, "email action");
  const startedAt = Date.now();
  let status: number | undefined;
  try {
    const response = await fetchWithPolicy(
      env.getRequiredServer("SHEETS_ENDPOINT"),
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        cache: "no-store",
        body: JSON.stringify({ ...payload, token: getSheetsToken("admin") }),
      },
      EMAIL_OUTBOX_REQUEST_POLICY,
    );
    status = response.status;
    const data = (await response.json().catch(() => null)) as EmailOutboxResponse | null;
    if (!response.ok || !data || data.ok !== true || typeof data.result !== "string") {
      throw new EmailOutboxStoreError(
        data?.code || "EMAIL_OUTBOX_STORE_UNAVAILABLE",
        data?.error || `Email outbox request failed with status ${response.status}`,
      );
    }
    logEvent("info", "email.outbox.store_timing", {
      action,
      status,
      ok: true,
      durationMs: Date.now() - startedAt,
    });
    return data;
  } catch (error) {
    logEvent("warn", "email.outbox.store_timing", {
      action,
      status,
      ok: false,
      durationMs: Date.now() - startedAt,
      errorName: error instanceof Error ? error.name : "unknown",
    });
    throw error;
  }
};

export const upsertEmailOutboxEvent = async (input: {
  eventKey: string;
  externalReference: string;
  payloadHash: string;
  payloadJson: string;
  idempotencyKey: string;
}): Promise<{ outcome: "stored" | "already_exists"; event: EmailOutboxEvent }> => {
  const now = new Date().toISOString();
  const response = await postEmailAction({
    action: "upsertEmailOutboxEvent",
    event: {
      event_key: input.eventKey,
      external_reference: input.externalReference,
      notification_type: PURCHASE_RECEIPT_NOTIFICATION_TYPE,
      schema_version: EMAIL_OUTBOX_SCHEMA_VERSION,
      template_version: PURCHASE_RECEIPT_TEMPLATE_VERSION,
      payload_hash: input.payloadHash,
      payload_json: input.payloadJson,
      idempotency_key: input.idempotencyKey,
      state: "pending",
      attempt_count: 0,
      lease_owner: "",
      lease_expires_at: "",
      next_attempt_at: "",
      provider_first_attempt_at: "",
      provider_outcome_unknown_since: "",
      last_attempt_at: "",
      last_error_code: "",
      provider_message_id: "",
      accepted_at: "",
      created_at: now,
      updated_at: now,
      completed_at: "",
    },
  });
  const outcome =
    response.result === "EMAIL_EVENT_STORED"
      ? "stored"
      : response.result === "EMAIL_EVENT_ALREADY_EXISTS"
        ? "already_exists"
        : null;
  if (!outcome) {
    throw new EmailOutboxStoreError("EMAIL_OUTBOX_RESPONSE_INVALID", "Unexpected upsert result");
  }
  return { outcome, event: parseEvent(response.event) };
};

export const getEmailOutboxEvent = async (eventKey: string): Promise<EmailOutboxEvent | null> => {
  const response = await postEmailAction({ action: "getEmailOutboxEvent", eventKey });
  if (response.result === "EMAIL_EVENT_NOT_FOUND") return null;
  if (response.result !== "EMAIL_EVENT_FOUND") {
    throw new EmailOutboxStoreError("EMAIL_OUTBOX_RESPONSE_INVALID", "Unexpected get result");
  }
  return parseEvent(response.event);
};

export const claimEmailOutboxWork = async (input: {
  leaseOwner: string;
  claimedAt: string;
  leaseExpiresAt: string;
  maxEvents: number;
  eventKey?: string;
}): Promise<EmailOutboxEvent[]> => {
  const response = await postEmailAction({
    action: "claimEmailOutboxWork",
    ...input,
    eventKey: input.eventKey ?? "",
  });
  if (response.result !== "EMAIL_WORK_CLAIMED" || !Array.isArray(response.events)) {
    throw new EmailOutboxStoreError("EMAIL_OUTBOX_RESPONSE_INVALID", "Unexpected claim result");
  }
  return response.events.map(parseEvent);
};

type StateMutationInput = {
  eventKey: string;
  leaseOwner: string;
};

export const markEmailOutboxProviderOutcomeUnknown = async (
  input: StateMutationInput & { unknownSince: string },
): Promise<EmailOutboxEvent> => {
  const response = await postEmailAction({ action: "markEmailOutboxProviderOutcomeUnknown", ...input });
  if (response.result !== "EMAIL_PROVIDER_OUTCOME_UNKNOWN") {
    throw new EmailOutboxStoreError("EMAIL_OUTBOX_RESPONSE_INVALID", "Unexpected provider uncertainty result");
  }
  return parseEvent(response.event);
};

export const clearEmailOutboxProviderOutcomeUnknown = async (
  input: StateMutationInput,
): Promise<EmailOutboxEvent> => {
  const response = await postEmailAction({ action: "clearEmailOutboxProviderOutcomeUnknown", ...input });
  if (response.result !== "EMAIL_PROVIDER_OUTCOME_KNOWN") {
    throw new EmailOutboxStoreError("EMAIL_OUTBOX_RESPONSE_INVALID", "Unexpected provider certainty result");
  }
  return parseEvent(response.event);
};

export const markEmailOutboxAccepted = async (
  input: StateMutationInput & { providerMessageId: string; acceptedAt: string },
): Promise<EmailOutboxEvent> => {
  const response = await postEmailAction({ action: "markEmailOutboxAccepted", ...input });
  if (response.result !== "EMAIL_EVENT_ACCEPTED") {
    throw new EmailOutboxStoreError("EMAIL_OUTBOX_RESPONSE_INVALID", "Unexpected accepted result");
  }
  return parseEvent(response.event);
};

export const markEmailOutboxRetryable = async (
  input: StateMutationInput & { errorCode: string; nextAttemptAt: string },
): Promise<EmailOutboxEvent> => {
  const response = await postEmailAction({ action: "markEmailOutboxRetryable", ...input });
  if (response.result !== "EMAIL_EVENT_RETRYABLE") {
    throw new EmailOutboxStoreError("EMAIL_OUTBOX_RESPONSE_INVALID", "Unexpected retryable result");
  }
  return parseEvent(response.event);
};

export const markEmailOutboxAttention = async (
  input: StateMutationInput & { errorCode: string },
): Promise<EmailOutboxEvent> => {
  const response = await postEmailAction({ action: "markEmailOutboxAttention", ...input });
  if (response.result !== "EMAIL_EVENT_ATTENTION") {
    throw new EmailOutboxStoreError("EMAIL_OUTBOX_RESPONSE_INVALID", "Unexpected attention result");
  }
  return parseEvent(response.event);
};

export const markEmailOutboxSkipped = async (
  input: StateMutationInput & { errorCode: "MISSING_CUSTOMER_EMAIL" },
): Promise<EmailOutboxEvent> => {
  const response = await postEmailAction({ action: "markEmailOutboxSkipped", ...input });
  if (response.result !== "EMAIL_EVENT_SKIPPED") {
    throw new EmailOutboxStoreError("EMAIL_OUTBOX_RESPONSE_INVALID", "Unexpected skipped result");
  }
  return parseEvent(response.event);
};

export const listEmailOutboxAttention = async (
  limit = 100,
): Promise<EmailOutboxAttentionItem[]> => {
  const response = await postEmailAction({ action: "listEmailOutboxAttention", limit });
  if (response.result !== "EMAIL_ATTENTION_LISTED" || !Array.isArray(response.items)) {
    throw new EmailOutboxStoreError("EMAIL_OUTBOX_RESPONSE_INVALID", "Unexpected attention list");
  }
  return response.items.map((value) => {
    const item = recordFrom(value, "email attention item");
    const state = requiredString(item.state, "email attention state");
    if (state !== "retryable" && state !== "attention") {
      throw new EmailOutboxStoreError("EMAIL_OUTBOX_RESPONSE_INVALID", "Invalid attention state");
    }
    return {
      externalReference: requiredString(item.external_reference, "email attention reference"),
      state,
      attemptCount: requiredNumber(item.attempt_count, "email attention attempt_count"),
      lastErrorCode: optionalString(item.last_error_code),
      updatedAt: requiredString(item.updated_at, "email attention updated_at"),
    };
  });
};

const parseCandidate = (value: unknown): MissingReceiptCandidate => {
  const candidate = recordFrom(value, "missing receipt candidate");
  const currency = requiredString(candidate.currency, "candidate currency");
  if (currency !== "ARS") {
    throw new EmailOutboxStoreError("EMAIL_OUTBOX_RESPONSE_INVALID", "Invalid candidate currency");
  }
  return {
    externalReference: requiredString(candidate.external_reference, "candidate reference"),
    recipientEmail: typeof candidate.recipient_email === "string" ? candidate.recipient_email : "",
    customerName: typeof candidate.customer_name === "string" ? candidate.customer_name : "",
    paymentId: requiredString(candidate.payment_id, "candidate payment_id"),
    approvedAt: requiredString(candidate.approved_at, "candidate approved_at"),
    itemsJson: requiredString(candidate.items_json, "candidate items_json"),
    total: requiredNumber(candidate.total, "candidate total"),
    currency,
  };
};

const parseMarkerRepair = (value: unknown): AcceptedMarkerRepair => {
  const repair = recordFrom(value, "marker repair");
  return {
    externalReference: requiredString(repair.external_reference, "marker repair reference"),
    acceptedAt: requiredString(repair.accepted_at, "marker repair accepted_at"),
  };
};

export const listMissingReceiptCandidates = async (limit = 20): Promise<MissingReceiptDiscovery> => {
  const response = await postEmailAction({ action: "listMissingReceiptCandidates", limit });
  if (
    response.result !== "EMAIL_CANDIDATES_LISTED" ||
    !Array.isArray(response.candidates) ||
    !Array.isArray(response.marker_repairs)
  ) {
    throw new EmailOutboxStoreError("EMAIL_OUTBOX_RESPONSE_INVALID", "Unexpected candidate result");
  }
  return {
    rolloutAt: requiredString(response.rollout_at, "email rollout_at"),
    candidates: response.candidates.map(parseCandidate),
    markerRepairs: response.marker_repairs.map(parseMarkerRepair),
  };
};
