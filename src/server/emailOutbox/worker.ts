import "server-only";

import { randomUUID } from "node:crypto";
import { logEvent } from "@/src/server/observability/log";
import {
  buildPurchaseReceiptEventKey,
  buildPurchaseReceiptPayloadFromCandidate,
  canonicalEmailPayloadJson,
  hashEmailPayload,
} from "./payload";
import {
  EMAIL_WORK_LEASE_MS,
  processClaimedEmailOutboxEvent,
  projectAcceptedReceiptMarker,
} from "./processor";
import {
  claimEmailOutboxWork,
  listMissingReceiptCandidates,
  upsertEmailOutboxEvent,
} from "./repository";

export const MAX_EMAIL_EVENTS_PER_RUN = 20;
export const MAX_MISSING_RECEIPT_CANDIDATES_PER_RUN = 20;

type EmailWorkerDependencies = {
  now: () => number;
  owner: () => string;
  discover: typeof listMissingReceiptCandidates;
  upsert: typeof upsertEmailOutboxEvent;
  claim: typeof claimEmailOutboxWork;
  processClaimed: typeof processClaimedEmailOutboxEvent;
  projectMarker: typeof projectAcceptedReceiptMarker;
};
const productionDependencies: EmailWorkerDependencies = {
  now: Date.now,
  owner: randomUUID,
  discover: listMissingReceiptCandidates,
  upsert: upsertEmailOutboxEvent,
  claim: claimEmailOutboxWork,
  processClaimed: processClaimedEmailOutboxEvent,
  projectMarker: projectAcceptedReceiptMarker,
};

export type EmailOutboxWorkerResult = {
  ok: true;
  rolloutAt: string;
  candidatesFound: number;
  eventsCreated: number;
  markerRepairs: number;
  claimed: number;
  accepted: number;
  retryable: number;
  attention: number;
  skipped: number;
  durationMs: number;
};

export const runEmailOutboxWorker = async (
  dependencyOverrides: Partial<EmailWorkerDependencies> = {},
): Promise<EmailOutboxWorkerResult> => {
  const dependencies = { ...productionDependencies, ...dependencyOverrides };
  const startedAt = dependencies.now();
  const discovery = await dependencies.discover(MAX_MISSING_RECEIPT_CANDIDATES_PER_RUN);
  let eventsCreated = 0;
  let markerRepairs = 0;

  for (const repair of discovery.markerRepairs) {
    if (await dependencies.projectMarker(repair.externalReference, repair.acceptedAt)) {
      markerRepairs += 1;
    }
  }

  for (const candidate of discovery.candidates) {
    try {
      const payload = buildPurchaseReceiptPayloadFromCandidate(candidate);
      const payloadJson = canonicalEmailPayloadJson(payload);
      const eventKey = buildPurchaseReceiptEventKey(candidate.externalReference);
      const result = await dependencies.upsert({
        eventKey,
        externalReference: candidate.externalReference,
        payloadHash: hashEmailPayload(payloadJson),
        payloadJson,
        idempotencyKey: eventKey,
      });
      if (result.outcome === "stored") eventsCreated += 1;
    } catch (error) {
      logEvent("warn", "email.outbox.discovery_candidate_failed", {
        externalReference: candidate.externalReference,
        errorName: error instanceof Error ? error.name : "unknown",
      });
    }
  }

  const leaseOwner = dependencies.owner();
  const claimedAt = new Date(startedAt).toISOString();
  const claimed = await dependencies.claim({
    leaseOwner,
    claimedAt,
    leaseExpiresAt: new Date(startedAt + EMAIL_WORK_LEASE_MS).toISOString(),
    maxEvents: MAX_EMAIL_EVENTS_PER_RUN,
  });
  logEvent("info", "email.outbox.claimed", {
    attemptCount: claimed.length,
    state: "processing",
  });

  let accepted = 0;
  let retryable = 0;
  let attention = 0;
  let skipped = 0;
  for (const event of claimed) {
    try {
      const outcome = await dependencies.processClaimed(event, leaseOwner);
      if (outcome === "accepted" || outcome === "marker_repaired") accepted += 1;
      else if (outcome === "retryable") retryable += 1;
      else if (outcome === "attention") attention += 1;
      else if (outcome === "skipped") skipped += 1;
    } catch {
      retryable += 1;
    }
  }

  return {
    ok: true,
    rolloutAt: discovery.rolloutAt,
    candidatesFound: discovery.candidates.length,
    eventsCreated,
    markerRepairs,
    claimed: claimed.length,
    accepted,
    retryable,
    attention,
    skipped,
    durationMs: Math.max(0, dependencies.now() - startedAt),
  };
};
