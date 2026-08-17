import "server-only";

import { randomUUID } from "node:crypto";
import { logEvent } from "@/src/server/observability/log";
import { recoverPendingSalesSheetOrder } from "@/src/server/orders/salesSheetRecovery";
import { listPendingSalesSheetOrderIds } from "@/src/server/orders/salesSheetSync";
import { getOrderRowById } from "@/src/server/sheets/repository";
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
export const MAX_PENDING_SALES_RECOVERIES_PER_RUN = 20;
export const MAX_MISSING_RECEIPT_CANDIDATES_PER_RUN = 20;

type EmailWorkerDependencies = {
  now: () => number;
  owner: () => string;
  discover: typeof listMissingReceiptCandidates;
  upsert: typeof upsertEmailOutboxEvent;
  claim: typeof claimEmailOutboxWork;
  processClaimed: typeof processClaimedEmailOutboxEvent;
  projectMarker: typeof projectAcceptedReceiptMarker;
  listPendingSales: typeof listPendingSalesSheetOrderIds;
  getSalesRow: typeof getOrderRowById;
  recoverPendingSales: typeof recoverPendingSalesSheetOrder;
};
const productionDependencies: EmailWorkerDependencies = {
  now: Date.now,
  owner: randomUUID,
  discover: listMissingReceiptCandidates,
  upsert: upsertEmailOutboxEvent,
  claim: claimEmailOutboxWork,
  processClaimed: processClaimedEmailOutboxEvent,
  projectMarker: projectAcceptedReceiptMarker,
  listPendingSales: listPendingSalesSheetOrderIds,
  getSalesRow: getOrderRowById,
  recoverPendingSales: recoverPendingSalesSheetOrder,
};

export type EmailOutboxWorkerResult = {
  ok: boolean;
  existingWork: {
    ok: boolean;
    claimed: number;
    accepted: number;
    retryable: number;
    attention: number;
    skipped: number;
    errorCode?: "EMAIL_OUTBOX_EXISTING_WORK_FAILED";
  };
  salesRecovery: {
    ok: boolean;
    attempted: number;
    recovered: number;
    pending: number;
    busy: number;
    attention: number;
    errorCode?: "EMAIL_OUTBOX_SALES_RECOVERY_FAILED";
  };
  discovery: {
    ok: boolean;
    rolloutAt?: string;
    candidatesFound: number;
    eventsCreated: number;
    markerRepairs: number;
    errorCode?: "EMAIL_OUTBOX_DISCOVERY_FAILED";
  };
  durationMs: number;
};

export const runEmailOutboxWorker = async (
  dependencyOverrides: Partial<EmailWorkerDependencies> = {},
): Promise<EmailOutboxWorkerResult> => {
  const dependencies = { ...productionDependencies, ...dependencyOverrides };
  const startedAt = dependencies.now();
  const existingWork: EmailOutboxWorkerResult["existingWork"] = {
    ok: true,
    claimed: 0,
    accepted: 0,
    retryable: 0,
    attention: 0,
    skipped: 0,
  };

  try {
    const leaseOwner = dependencies.owner();
    const claimedAt = new Date(startedAt).toISOString();
    const claimed = await dependencies.claim({
      leaseOwner,
      claimedAt,
      leaseExpiresAt: new Date(startedAt + EMAIL_WORK_LEASE_MS).toISOString(),
      maxEvents: MAX_EMAIL_EVENTS_PER_RUN,
    });
    existingWork.claimed = claimed.length;
    logEvent("info", "email.outbox.claimed", {
      attemptCount: claimed.length,
      state: "processing",
    });

    for (const event of claimed) {
      try {
        const outcome = await dependencies.processClaimed(event, leaseOwner);
        if (outcome === "accepted" || outcome === "marker_repaired") existingWork.accepted += 1;
        else if (outcome === "retryable") existingWork.retryable += 1;
        else if (outcome === "attention") existingWork.attention += 1;
        else if (outcome === "skipped") existingWork.skipped += 1;
      } catch {
        existingWork.retryable += 1;
      }
    }
  } catch (error) {
    existingWork.ok = false;
    existingWork.errorCode = "EMAIL_OUTBOX_EXISTING_WORK_FAILED";
    logEvent("error", "email.outbox.existing_work_failed", {
      errorName: error instanceof Error ? error.name : "unknown",
    });
  }

  const salesRecovery: EmailOutboxWorkerResult["salesRecovery"] = {
    ok: true,
    attempted: 0,
    recovered: 0,
    pending: 0,
    busy: 0,
    attention: 0,
  };

  try {
    const pendingOrderIds = await dependencies.listPendingSales(
      MAX_PENDING_SALES_RECOVERIES_PER_RUN,
    );
    salesRecovery.attempted = pendingOrderIds.length;

    for (const orderId of pendingOrderIds) {
      try {
        const row = await dependencies.getSalesRow(orderId);
        const result = await dependencies.recoverPendingSales(orderId, {
          rowExists: row !== null,
        });
        if (
          result.outcome === "appended" ||
          result.outcome === "reconciled" ||
          result.outcome === "already_synced"
        ) {
          salesRecovery.recovered += 1;
        } else if (result.outcome === "pending") {
          salesRecovery.pending += 1;
        } else if (result.outcome === "busy") {
          salesRecovery.busy += 1;
        } else {
          salesRecovery.attention += 1;
        }
      } catch (error) {
        salesRecovery.ok = false;
        salesRecovery.pending += 1;
        salesRecovery.errorCode = "EMAIL_OUTBOX_SALES_RECOVERY_FAILED";
        logEvent("warn", "email.outbox.sales_recovery_order_failed", {
          externalReference: orderId,
          errorName: error instanceof Error ? error.name : "unknown",
        });
      }
    }
  } catch (error) {
    salesRecovery.ok = false;
    salesRecovery.errorCode = "EMAIL_OUTBOX_SALES_RECOVERY_FAILED";
    logEvent("error", "email.outbox.sales_recovery_failed", {
      errorName: error instanceof Error ? error.name : "unknown",
    });
  }

  const discoveryResult: EmailOutboxWorkerResult["discovery"] = {
    ok: true,
    candidatesFound: 0,
    eventsCreated: 0,
    markerRepairs: 0,
  };

  try {
    const discovery = await dependencies.discover(MAX_MISSING_RECEIPT_CANDIDATES_PER_RUN);
    discoveryResult.rolloutAt = discovery.rolloutAt;
    discoveryResult.candidatesFound = discovery.candidates.length;

    for (const repair of discovery.markerRepairs) {
      try {
        if (await dependencies.projectMarker(repair.externalReference, repair.acceptedAt)) {
          discoveryResult.markerRepairs += 1;
        }
      } catch {
        logEvent("warn", "email.outbox.marker_repair_failed", {
          externalReference: repair.externalReference,
        });
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
        if (result.outcome === "stored") discoveryResult.eventsCreated += 1;
      } catch (error) {
        logEvent("warn", "email.outbox.discovery_candidate_failed", {
          externalReference: candidate.externalReference,
          errorName: error instanceof Error ? error.name : "unknown",
        });
      }
    }
  } catch (error) {
    discoveryResult.ok = false;
    discoveryResult.errorCode = "EMAIL_OUTBOX_DISCOVERY_FAILED";
    logEvent("error", "email.outbox.discovery_failed", {
      errorName: error instanceof Error ? error.name : "unknown",
    });
  }

  return {
    ok: existingWork.ok && salesRecovery.ok && discoveryResult.ok,
    existingWork,
    salesRecovery,
    discovery: discoveryResult,
    durationMs: Math.max(0, dependencies.now() - startedAt),
  };
};
