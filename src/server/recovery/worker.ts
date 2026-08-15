import "server-only";

import { randomUUID } from "node:crypto";
import { env } from "@/src/config/env";
import { logEvent } from "@/src/server/observability/log";
import {
  iteratePaymentSearchPagesByExternalReference,
  MercadoPagoPaymentSearchPaginationError,
} from "@/src/server/payments/mpClient";
import {
  reconcileMercadoPagoPaymentObservations,
  reconcileRecoveryPaymentEvent,
} from "@/src/server/payments/reconciliation";
import type { MpSearchPayment } from "@/src/server/payments/shared";
import { normalizeProtectedPaymentObservation } from "./paymentEvent";
import {
  claimRecoveryWork,
  markRecoverySnapshotState,
} from "./repository";
import {
  parseStoredRecoverySnapshot,
  recoverySnapshotToOrder,
} from "./snapshot";
import type {
  RecoveryPaymentEvent,
  StoredRecoverySnapshot,
} from "./types";

export const MAX_EVENTS_PER_RUN = 20;
export const MAX_SNAPSHOTS_PER_RUN = 20;
export const RECOVERY_WORK_LEASE_MS = 5 * 60 * 1000;
export const UNPAID_SNAPSHOT_RECOVERY_MARGIN_MS = 7 * 24 * 60 * 60 * 1000;

export type RecoveryWorkerResult = {
  ok: true;
  claimed: number;
  completed: number;
  retryable: number;
  attention: number;
  snapshotsScanned: number;
  eventsCreated: number;
  durationMs: number;
};

type RecoveryWorkerDependencies = {
  now: () => number;
  leaseOwner: () => string;
  claimWork: typeof claimRecoveryWork;
  reconcileEvent: typeof reconcileRecoveryPaymentEvent;
  searchPayments: (externalReference: string) => Promise<MpSearchPayment[]>;
  reconcileObservations: typeof reconcileMercadoPagoPaymentObservations;
  markSnapshot: typeof markRecoverySnapshotState;
};

const safeRecoveryErrorCode = (error: unknown, fallback: string) => {
  if (error && typeof error === "object" && "code" in error) {
    const code = String((error as { code?: unknown }).code ?? "").trim();
    if (/^[A-Z0-9_]{3,120}$/.test(code)) return code;
  }
  if (error instanceof MercadoPagoPaymentSearchPaginationError) {
    return `MP_SEARCH_${error.reason.toUpperCase()}`.slice(0, 120);
  }
  return fallback;
};

const searchPaymentsForSnapshot = async (externalReference: string): Promise<MpSearchPayment[]> => {
  const accessToken = env.getRequiredServer("MP_ACCESS_TOKEN");
  const payments = new Map<string, MpSearchPayment>();
  const pages = iteratePaymentSearchPagesByExternalReference(externalReference, accessToken);
  while (true) {
    const page = await pages.next();
    if (page.done) break;
    if (!page.value.response.ok) {
      throw new Error(`MP_SEARCH_STATUS_${page.value.response.status}`);
    }
    for (const payment of page.value.data?.results ?? []) {
      const paymentId = String(payment.id ?? "").trim();
      if (paymentId && !payments.has(paymentId)) payments.set(paymentId, payment);
    }
  }
  return [...payments.values()];
};

const productionDependencies: RecoveryWorkerDependencies = {
  now: Date.now,
  leaseOwner: randomUUID,
  claimWork: claimRecoveryWork,
  reconcileEvent: reconcileRecoveryPaymentEvent,
  searchPayments: searchPaymentsForSnapshot,
  reconcileObservations: reconcileMercadoPagoPaymentObservations,
  markSnapshot: markRecoverySnapshotState,
};

const processClaimedEvent = async (
  event: RecoveryPaymentEvent,
  leaseOwner: string,
  dependencies: RecoveryWorkerDependencies,
) => dependencies.reconcileEvent(event, leaseOwner);

const processClaimedSnapshot = async (
  stored: StoredRecoverySnapshot,
  now: number,
  dependencies: RecoveryWorkerDependencies,
): Promise<{ outcome: "completed" | "retryable" | "attention" | "checked"; eventsCreated: number }> => {
  let snapshot;
  try {
    snapshot = parseStoredRecoverySnapshot(stored);
  } catch (error) {
    await dependencies.markSnapshot({
      externalReference: stored.externalReference,
      state: "attention",
      errorCode: safeRecoveryErrorCode(error, "RECOVERY_SNAPSHOT_INVALID"),
    });
    return { outcome: "attention", eventsCreated: 0 };
  }

  let payments: MpSearchPayment[];
  try {
    payments = await dependencies.searchPayments(snapshot.externalReference);
  } catch (error) {
    await dependencies.markSnapshot({
      externalReference: snapshot.externalReference,
      state: stored.recoveryState,
      errorCode: safeRecoveryErrorCode(error, "MP_SEARCH_UNAVAILABLE"),
    });
    return { outcome: "retryable", eventsCreated: 0 };
  }

  const protectedPayments = payments.filter((payment) =>
    Boolean(normalizeProtectedPaymentObservation({ payment })),
  );
  if (protectedPayments.length > 0) {
    try {
      const result = await dependencies.reconcileObservations({
        externalReference: snapshot.externalReference,
        validationOrder: recoverySnapshotToOrder(snapshot),
        observations: protectedPayments.map((payment) => ({
          payment,
          source: "snapshot_scan" as const,
        })),
      });
      if (result.outcome === "order_not_found") {
        throw new Error("RECOVERY_ORDER_NOT_FOUND");
      }
      const eventsCreated = result.observationResults.filter(
        (observation) => observation.outcome !== "ignored",
      ).length;
      if (result.outcome === "recovery_attention") {
        return { outcome: "attention", eventsCreated };
      }
      if (eventsCreated === 0) {
        await dependencies.markSnapshot({
          externalReference: snapshot.externalReference,
          state: "pending_payment",
        });
        return { outcome: "checked", eventsCreated: 0 };
      }
      return { outcome: "completed", eventsCreated };
    } catch (error) {
      await dependencies.markSnapshot({
        externalReference: snapshot.externalReference,
        state: stored.recoveryState,
        errorCode: safeRecoveryErrorCode(error, "RECOVERY_RECONCILIATION_FAILED"),
      });
      return { outcome: "retryable", eventsCreated: protectedPayments.length };
    }
  }

  if (now >= snapshot.preferenceExpiresAt + UNPAID_SNAPSHOT_RECOVERY_MARGIN_MS) {
    await dependencies.markSnapshot({
      externalReference: snapshot.externalReference,
      state: "expired_unpaid",
      redactSnapshot: true,
    });
    return { outcome: "completed", eventsCreated: 0 };
  }

  await dependencies.markSnapshot({
    externalReference: snapshot.externalReference,
    state: "pending_payment",
  });
  return { outcome: "checked", eventsCreated: 0 };
};

export async function runPaymentRecoveryWorker(
  dependencyOverrides: Partial<RecoveryWorkerDependencies> = {},
): Promise<RecoveryWorkerResult> {
  const dependencies = { ...productionDependencies, ...dependencyOverrides };
  const startedAt = dependencies.now();
  const leaseOwner = dependencies.leaseOwner();
  const claimedAt = new Date(startedAt).toISOString();
  const work = await dependencies.claimWork({
    leaseOwner,
    claimedAt,
    leaseExpiresAt: new Date(startedAt + RECOVERY_WORK_LEASE_MS).toISOString(),
    maxEvents: MAX_EVENTS_PER_RUN,
    maxSnapshots: MAX_SNAPSHOTS_PER_RUN,
  });
  logEvent("info", "recovery.worker.claimed", {
    attemptCount: work.events.length + work.snapshots.length,
  });

  let completed = 0;
  let retryable = 0;
  let attention = 0;
  let eventsCreated = 0;

  for (const event of work.events) {
    try {
      const outcome = await processClaimedEvent(event, leaseOwner, dependencies);
      if (outcome.outcome === "completed") completed += 1;
      else attention += 1;
    } catch {
      retryable += 1;
    }
  }

  for (const snapshot of work.snapshots) {
    const outcome = await processClaimedSnapshot(snapshot, startedAt, dependencies);
    eventsCreated += outcome.eventsCreated;
    if (outcome.outcome === "completed") completed += 1;
    else if (outcome.outcome === "retryable") retryable += 1;
    else if (outcome.outcome === "attention") attention += 1;
  }

  return {
    ok: true,
    claimed: work.events.length + work.snapshots.length,
    completed,
    retryable,
    attention,
    snapshotsScanned: work.snapshots.length,
    eventsCreated,
    durationMs: Math.max(0, dependencies.now() - startedAt),
  };
}
