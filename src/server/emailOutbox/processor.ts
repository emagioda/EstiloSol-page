import "server-only";

import { randomUUID } from "node:crypto";
import { logEvent } from "@/src/server/observability/log";
import { updateOrderRowInSalesSheet } from "@/src/server/sheets/repository";
import { updateOrder } from "@/src/server/orders/store";
import { buildPurchaseReceiptEventKey, parsePurchaseReceiptPayload } from "./payload";
import { sendPurchaseReceiptToResend } from "./provider";
import {
  claimEmailOutboxWork,
  getEmailOutboxEvent,
  markEmailOutboxAccepted,
  markEmailOutboxAttention,
  markEmailOutboxRetryable,
  markEmailOutboxSkipped,
} from "./repository";
import type { EmailOutboxEvent } from "./types";

export const MAX_EMAIL_ATTEMPTS = 5;
export const EMAIL_WORK_LEASE_MS = 5 * 60 * 1000;
export const RESEND_IDEMPOTENCY_WINDOW_MS = 24 * 60 * 60 * 1000;
export const EMAIL_RETRY_BACKOFF_MS = [
  5 * 60 * 1000,
  30 * 60 * 1000,
  2 * 60 * 60 * 1000,
  6 * 60 * 60 * 1000,
  12 * 60 * 60 * 1000,
] as const;

const isValidEmail = (value: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);

type ProcessorDependencies = {
  now: () => number;
  owner: () => string;
  claim: typeof claimEmailOutboxWork;
  getEvent: typeof getEmailOutboxEvent;
  send: typeof sendPurchaseReceiptToResend;
  markAccepted: typeof markEmailOutboxAccepted;
  markRetryable: typeof markEmailOutboxRetryable;
  markAttention: typeof markEmailOutboxAttention;
  markSkipped: typeof markEmailOutboxSkipped;
  projectMarker: typeof projectAcceptedReceiptMarker;
};

export type EmailProcessOutcome =
  | "not_found"
  | "not_claimed"
  | "accepted"
  | "retryable"
  | "attention"
  | "skipped"
  | "marker_repaired";

export const projectAcceptedReceiptMarker = async (
  externalReference: string,
  acceptedAt: string,
): Promise<boolean> => {
  const timestamp = Date.parse(acceptedAt);
  if (!Number.isFinite(timestamp)) return false;
  let projected = true;
  try {
    await updateOrder(externalReference, { receiptEmailSentAt: timestamp }, { syncSheet: false });
  } catch (error) {
    projected = false;
    logEvent("warn", "email.outbox.marker_kv_failed", {
      externalReference,
      errorName: error instanceof Error ? error.name : "unknown",
    });
  }
  try {
    await updateOrderRowInSalesSheet(externalReference, { receiptEmailSentAt: timestamp });
  } catch (error) {
    projected = false;
    logEvent("warn", "email.outbox.marker_sheet_failed", {
      externalReference,
      errorName: error instanceof Error ? error.name : "unknown",
    });
  }
  if (projected) {
    logEvent("info", "email.outbox.marker_repaired", { externalReference });
  }
  return projected;
};

const productionDependencies: ProcessorDependencies = {
  now: Date.now,
  owner: randomUUID,
  claim: claimEmailOutboxWork,
  getEvent: getEmailOutboxEvent,
  send: sendPurchaseReceiptToResend,
  markAccepted: markEmailOutboxAccepted,
  markRetryable: markEmailOutboxRetryable,
  markAttention: markEmailOutboxAttention,
  markSkipped: markEmailOutboxSkipped,
  projectMarker: projectAcceptedReceiptMarker,
};

const acceptedReplay = async (
  event: EmailOutboxEvent,
  dependencies: ProcessorDependencies,
): Promise<EmailProcessOutcome> => {
  if (event.state !== "accepted" || !event.acceptedAt) return "not_claimed";
  const repaired = await dependencies.projectMarker(event.externalReference, event.acceptedAt);
  return repaired ? "marker_repaired" : "accepted";
};

export const processClaimedEmailOutboxEvent = async (
  event: EmailOutboxEvent,
  leaseOwner: string,
  dependencyOverrides: Partial<ProcessorDependencies> = {},
): Promise<EmailProcessOutcome> => {
  const dependencies = { ...productionDependencies, ...dependencyOverrides };
  if (event.state !== "processing" || event.leaseOwner !== leaseOwner) return acceptedReplay(event, dependencies);

  let payload;
  try {
    payload = parsePurchaseReceiptPayload(event.payloadJson, event.payloadHash);
    if (
      payload.externalReference !== event.externalReference ||
      event.eventKey !== buildPurchaseReceiptEventKey(event.externalReference) ||
      event.idempotencyKey !== event.eventKey
    ) {
      throw new Error("EMAIL_OUTBOX_EVENT_CONFLICT");
    }
  } catch {
    await dependencies.markAttention({
      eventKey: event.eventKey,
      leaseOwner,
      errorCode: "EMAIL_OUTBOX_EVENT_CONFLICT",
    });
    logEvent("warn", "email.outbox.conflict", {
      externalReference: event.externalReference,
      eventKey: event.eventKey,
      attemptCount: event.attemptCount,
      state: "attention",
      errorCode: "EMAIL_OUTBOX_EVENT_CONFLICT",
    });
    return "attention";
  }

  if (!payload.recipientEmail) {
    await dependencies.markSkipped({
      eventKey: event.eventKey,
      leaseOwner,
      errorCode: "MISSING_CUSTOMER_EMAIL",
    });
    logEvent("info", "email.outbox.skipped", {
      externalReference: event.externalReference,
      eventKey: event.eventKey,
      attemptCount: event.attemptCount,
      state: "skipped",
      errorCode: "MISSING_CUSTOMER_EMAIL",
    });
    return "skipped";
  }
  if (!isValidEmail(payload.recipientEmail)) {
    await dependencies.markAttention({
      eventKey: event.eventKey,
      leaseOwner,
      errorCode: "CUSTOMER_EMAIL_INVALID",
    });
    logEvent("warn", "email.outbox.attention", {
      externalReference: event.externalReference,
      eventKey: event.eventKey,
      attemptCount: event.attemptCount,
      state: "attention",
      errorCode: "CUSTOMER_EMAIL_INVALID",
    });
    return "attention";
  }

  const firstAttemptAt = Date.parse(event.providerFirstAttemptAt ?? "");
  if (
    Number.isFinite(firstAttemptAt) &&
    dependencies.now() - firstAttemptAt >= RESEND_IDEMPOTENCY_WINDOW_MS
  ) {
    await dependencies.markAttention({
      eventKey: event.eventKey,
      leaseOwner,
      errorCode: "RESEND_OUTCOME_UNKNOWN",
    });
    logEvent("warn", "email.outbox.attention", {
      externalReference: event.externalReference,
      eventKey: event.eventKey,
      attemptCount: event.attemptCount,
      state: "attention",
      errorCode: "RESEND_OUTCOME_UNKNOWN",
    });
    return "attention";
  }

  const provider = await dependencies.send({ payload, idempotencyKey: event.idempotencyKey });
  const now = dependencies.now();
  if (provider.accepted) {
    let accepted: EmailOutboxEvent;
    try {
      accepted = await dependencies.markAccepted({
        eventKey: event.eventKey,
        leaseOwner,
        providerMessageId: provider.providerMessageId,
        acceptedAt: new Date(now).toISOString(),
      });
    } catch (error) {
      const replay = await dependencies.getEvent(event.eventKey).catch(() => null);
      if (replay?.state === "accepted" && replay.acceptedAt) {
        await dependencies.projectMarker(replay.externalReference, replay.acceptedAt);
        return "accepted";
      }
      throw error;
    }
    await dependencies.projectMarker(accepted.externalReference, accepted.acceptedAt!);
    logEvent("info", "email.outbox.accepted", {
      externalReference: accepted.externalReference,
      eventKey: accepted.eventKey,
      providerMessageId: accepted.providerMessageId,
      attemptCount: accepted.attemptCount,
      state: accepted.state,
    });
    return "accepted";
  }

  const outsideUnknownWindow =
    provider.outcomeUnknown &&
    Number.isFinite(firstAttemptAt) &&
    now - firstAttemptAt >= RESEND_IDEMPOTENCY_WINDOW_MS;
  const exhausted = event.attemptCount >= MAX_EMAIL_ATTEMPTS;
  if (provider.disposition === "attention" || outsideUnknownWindow || exhausted) {
    const errorCode = outsideUnknownWindow ? "RESEND_OUTCOME_UNKNOWN" : provider.errorCode;
    await dependencies.markAttention({ eventKey: event.eventKey, leaseOwner, errorCode });
    logEvent("warn", "email.outbox.attention", {
      externalReference: event.externalReference,
      eventKey: event.eventKey,
      attemptCount: event.attemptCount,
      state: "attention",
      errorCode,
    });
    return "attention";
  }

  const backoff = EMAIL_RETRY_BACKOFF_MS[Math.min(event.attemptCount - 1, EMAIL_RETRY_BACKOFF_MS.length - 1)];
  await dependencies.markRetryable({
    eventKey: event.eventKey,
    leaseOwner,
    errorCode: provider.errorCode,
    nextAttemptAt: new Date(now + backoff).toISOString(),
  });
  logEvent("warn", "email.outbox.retryable", {
    externalReference: event.externalReference,
    eventKey: event.eventKey,
    attemptCount: event.attemptCount,
    state: "retryable",
    errorCode: provider.errorCode,
  });
  return "retryable";
};

export const processEmailOutboxEvent = async (
  eventKey: string,
  dependencyOverrides: Partial<ProcessorDependencies> = {},
): Promise<EmailProcessOutcome> => {
  const dependencies = { ...productionDependencies, ...dependencyOverrides };
  const existing = await dependencies.getEvent(eventKey);
  if (!existing) return "not_found";
  if (existing.state === "accepted") return acceptedReplay(existing, dependencies);
  if (existing.state === "attention" || existing.state === "skipped") return existing.state;

  const now = dependencies.now();
  const leaseOwner = dependencies.owner();
  const claimed = await dependencies.claim({
    leaseOwner,
    claimedAt: new Date(now).toISOString(),
    leaseExpiresAt: new Date(now + EMAIL_WORK_LEASE_MS).toISOString(),
    maxEvents: 1,
    eventKey,
  });
  if (claimed.length === 0) {
    const replay = await dependencies.getEvent(eventKey);
    return replay ? acceptedReplay(replay, dependencies) : "not_found";
  }
  return processClaimedEmailOutboxEvent(claimed[0], leaseOwner, dependencies);
};
