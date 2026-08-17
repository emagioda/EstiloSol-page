import { randomUUID } from "node:crypto";
import { del, delIfValue, getJson, setJson, setJsonIfNotExists } from "@/src/server/kv";
import { logEvent } from "@/src/server/observability/log";
import { trackBusinessEvent } from "@/src/server/observability/metrics";
import { privacyPolicy } from "@/src/server/privacy/policy";
import {
  appendOrderToSalesSheet,
  UPDATE_ORDER_ROW_WORST_CASE_MS,
  updateOrderRowInSalesSheet,
} from "@/src/server/sheets/repository";
import {
  attemptInventoryForPaidOrder,
  inventoryResultToOrderPatch,
  resolveOrderInventoryStatus,
  shouldAttemptInventoryAutomatically,
  type InventoryAttemptResult,
} from "./inventory";
import {
  addPendingSalesSheetOrder,
  removePendingSalesSheetOrder,
} from "./salesSheetSync";
import type { Order, OrderPaymentStatus, OrderStatus } from "./types";
import {
  applyMercadoPagoPaymentObservation,
  MULTIPLE_APPROVED_MP_PAYMENTS,
  type MercadoPagoPaymentObservation,
} from "@/src/server/payments/ledger";

export const WEBHOOK_DEDUPE_TTL_SECONDS = 7 * 24 * 3600;

const orderKey = (externalReference: string) => `es:order:${externalReference}`;
const orderWriteLockKey = (externalReference: string) => `es:order:write-lock:${externalReference}`;
const salesSheetSyncKey = (externalReference: string) => `es:order:sales-sheet-sync:${externalReference}`;

export const ORDER_WRITE_LOCK_TTL_SECONDS = 75;
export const ORDER_WRITE_LOCK_MINIMUM_MARGIN_MS = 20_000;
const ORDER_WRITE_LOCK_WAIT_MS = 30_000;
const ORDER_WRITE_LOCK_RETRY_MS = 20;

export const webhookDedupeKey = (eventId: string) => `es:mp:webhook:${eventId}`;
export const paymentDedupeKey = (paymentId: string) => `es:mp:payment:${paymentId}`;

type StoredOrder = Omit<Order, "paymentStatus" | "shippingStatus"> &
  Partial<Pick<Order, "paymentStatus" | "shippingStatus">>;

type UpdateOrderOptions = {
  syncSheet?: boolean;
};

type CreateOrderOptions = {
  syncSheet?: boolean;
};

type EnsureOrderResult = {
  order: Order;
  created: boolean;
};

type OrderPatch = Partial<Omit<Order, "externalReference" | "createdAt">>;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const withOrderWriteLock = async <T>(
  externalReference: string,
  operation: () => Promise<T>
): Promise<T> => {
  const lockKey = orderWriteLockKey(externalReference);
  const ownerToken = randomUUID();
  const deadline = Date.now() + ORDER_WRITE_LOCK_WAIT_MS;

  while (!(await setJsonIfNotExists(lockKey, ownerToken, ORDER_WRITE_LOCK_TTL_SECONDS))) {
    if (Date.now() >= deadline) {
      throw new Error(`Timed out waiting for order write lock: ${externalReference}`);
    }
    await sleep(ORDER_WRITE_LOCK_RETRY_MS);
  }

  try {
    return await operation();
  } finally {
    try {
      const released = await delIfValue(lockKey, ownerToken);
      if (!released) {
        logEvent("warn", "orders.write_lock_release_skipped", {
          orderId: externalReference,
        });
      }
    } catch (error) {
      logEvent("warn", "orders.write_lock_release_failed", {
        orderId: externalReference,
        errorName: error instanceof Error ? error.name : "unknown",
      });
    }
  }
};

const statusToPaymentStatus = (status: OrderStatus): OrderPaymentStatus => {
  if (status === "approved") return "confirmed";
  if (status === "refunded") return "refunded";
  if (status === "charged_back") return "charged_back";
  if (status === "rejected" || status === "cancelled") return "cancelled";
  return "pending";
};

const ensureOrderDefaults = (order: StoredOrder): Order => ({
  ...order,
  paymentStatus: order.paymentStatus ?? statusToPaymentStatus(order.status),
  shippingStatus: order.shippingStatus ?? "in_process",
});

export async function createOrder(order: Order, options: CreateOrderOptions = {}): Promise<void> {
  const shouldSyncSheet = options.syncSheet !== false;
  let normalizedOrder = ensureOrderDefaults({
    ...order,
    inventoryStatus: order.inventoryStatus ?? "pending",
    ...(!shouldSyncSheet
      ? { salesSheetDeferredUntilApprovedAt: order.salesSheetDeferredUntilApprovedAt ?? Date.now() }
      : {}),
  });
  const key = orderKey(normalizedOrder.externalReference);
  const existing = await getJson<StoredOrder>(key);

  if (existing) {
    throw new Error(`Order with external reference ${normalizedOrder.externalReference} already exists`);
  }

  if (shouldSyncSheet) {
    try {
      await appendOrderToSalesSheet(normalizedOrder);
      normalizedOrder = {
        ...normalizedOrder,
        salesSheetSyncedAt: Date.now(),
      };
    } catch (error) {
      logEvent("error", "orders.sync_sheet_create_failed", {
        externalReference: normalizedOrder.externalReference,
        error,
      });
      throw error;
    }
  }

  await setJson(
    key,
    normalizedOrder,
    privacyPolicy.ttlSecondsForStatus(normalizedOrder.status)
  );
}

const recoveryOrderIdentityMatches = (current: Order, candidate: Order): boolean =>
  current.externalReference === candidate.externalReference &&
  current.total === candidate.total &&
  current.currency === candidate.currency &&
  JSON.stringify(current.items) === JSON.stringify(candidate.items);

export async function ensureOrderExists(
  order: Order,
  options: CreateOrderOptions = { syncSheet: false },
): Promise<EnsureOrderResult> {
  return withOrderWriteLock(order.externalReference, async () => {
    const existing = await getJson<StoredOrder>(orderKey(order.externalReference));
    if (existing) {
      const normalized = ensureOrderDefaults(existing);
      if (!recoveryOrderIdentityMatches(normalized, order)) {
        throw new Error(`Recovery order conflicts with existing order ${order.externalReference}`);
      }
      return { order: normalized, created: false };
    }

    if (options.syncSheet !== false) {
      throw new Error("Recovery order creation must defer Sheets synchronization");
    }
    const candidate = ensureOrderDefaults({
      ...order,
      inventoryStatus: order.inventoryStatus ?? "pending",
      salesSheetDeferredUntilApprovedAt:
        order.salesSheetDeferredUntilApprovedAt ?? order.createdAt,
    });
    const created = await setJsonIfNotExists(
      orderKey(candidate.externalReference),
      candidate,
      privacyPolicy.ttlSecondsForStatus(candidate.status),
    );
    if (!created) {
      const winner = await getJson<StoredOrder>(orderKey(candidate.externalReference));
      if (!winner) throw new Error("Recovery order claim could not be recovered");
      const normalized = ensureOrderDefaults(winner);
      if (!recoveryOrderIdentityMatches(normalized, candidate)) {
        throw new Error(`Recovery order conflicts with existing order ${candidate.externalReference}`);
      }
      return { order: normalized, created: false };
    }
    logEvent("info", "recovery.order_reconstructed", {
      orderId: candidate.externalReference,
    });
    return { order: candidate, created: true };
  });
}

async function appendApprovedOrderToSalesSheet(order: Order): Promise<{ order: Order; synced: boolean }> {
  if (!order.salesSheetDeferredUntilApprovedAt || order.salesSheetSyncedAt) {
    return { order, synced: true };
  }

  const lockAcquired = await setJsonIfNotExists(
    salesSheetSyncKey(order.externalReference),
    "syncing",
    ORDER_WRITE_LOCK_TTL_SECONDS
  );

  if (!lockAcquired) {
    const marker = await getJson<string>(salesSheetSyncKey(order.externalReference));
    if (marker === "synced") {
      const salesSheetSyncedAt = Date.now();
      const updated = await updateOrder(
        order.externalReference,
        { salesSheetSyncedAt },
        { syncSheet: false },
      );
      return {
        order: updated ?? { ...order, salesSheetSyncedAt },
        synced: true,
      };
    }
    logEvent("info", "orders.sales_sheet_sync_already_running", {
      externalReference: order.externalReference,
    });
    return { order, synced: false };
  }

  let appendCompleted = false;
  try {
    await appendOrderToSalesSheet(order);
    appendCompleted = true;
    const salesSheetSyncedAt = Date.now();
    await setJson(salesSheetSyncKey(order.externalReference), "synced", WEBHOOK_DEDUPE_TTL_SECONDS);
    const updated = await updateOrder(
      order.externalReference,
      { salesSheetSyncedAt },
      { syncSheet: false }
    );
    try {
      await removePendingSalesSheetOrder(order.externalReference);
    } catch (error) {
      logEvent("warn", "orders.sales_sheet_pending_index_remove_failed", {
        orderId: order.externalReference,
        paymentStatus: order.paymentStatus,
        inventoryStatus: resolveOrderInventoryStatus(order) ?? "legacy",
        outcome: error instanceof Error ? error.name : "unknown",
      });
    }
    return {
      order: updated ?? { ...order, salesSheetSyncedAt },
      synced: true,
    };
  } catch (error) {
    if (!appendCompleted) {
      try {
        await del(salesSheetSyncKey(order.externalReference));
      } catch (deleteError) {
        logEvent("warn", "orders.sales_sheet_sync_lock_delete_failed", {
          orderId: order.externalReference,
          outcome: deleteError instanceof Error ? deleteError.name : "unknown",
        });
      }
    }
    const salesSheetSyncFailedAt = Date.now();
    logEvent("error", "orders.sales_sheet_approved_append_failed", {
      externalReference: order.externalReference,
      paymentId: order.mpPaymentId,
      error,
    });
    try {
      await trackBusinessEvent("payment.sales_sheet_sync_failed", {
        externalReference: order.externalReference,
        paymentId: order.mpPaymentId,
      });
    } catch (metricError) {
      logEvent("warn", "orders.sales_sheet_sync_failure_metric_failed", {
        orderId: order.externalReference,
        paymentStatus: order.paymentStatus,
        inventoryStatus: resolveOrderInventoryStatus(order) ?? "legacy",
        outcome: metricError instanceof Error ? metricError.name : "unknown",
      });
    }
    let updated: Order | null = null;
    try {
      updated = await updateOrder(
        order.externalReference,
        { salesSheetSyncFailedAt },
        { syncSheet: false }
      );
    } catch (updateError) {
      logEvent("error", "orders.sales_sheet_sync_failure_state_failed", {
        orderId: order.externalReference,
        paymentStatus: order.paymentStatus,
        inventoryStatus: resolveOrderInventoryStatus(order) ?? "legacy",
        outcome: updateError instanceof Error ? updateError.name : "unknown",
      });
    }
    try {
      await addPendingSalesSheetOrder(order.externalReference);
    } catch (indexError) {
      logEvent("error", "orders.sales_sheet_pending_index_failed", {
        orderId: order.externalReference,
        paymentStatus: order.paymentStatus,
        inventoryStatus: resolveOrderInventoryStatus(order) ?? "legacy",
        outcome: indexError instanceof Error ? indexError.name : "unknown",
      });
    }
    return {
      order: updated ?? { ...order, salesSheetSyncFailedAt },
      synced: false,
    };
  }
}

export async function ensureOrderDurableInSalesSheet(
  order: Order,
): Promise<{ order: Order; synced: boolean }> {
  const eligible =
    order.paymentStatus === "confirmed" ||
    order.paymentStatus === "refunded" ||
    order.paymentStatus === "charged_back";
  if (!eligible) return { order, synced: false };

  const candidate = order.salesSheetDeferredUntilApprovedAt
    ? order
    : { ...order, salesSheetDeferredUntilApprovedAt: order.updatedAt || Date.now() };
  const appendResult = await appendApprovedOrderToSalesSheet(candidate);
  if (!appendResult.synced) return appendResult;

  const projected = appendResult.order;
  await updateOrderRowInSalesSheet(projected.externalReference, {
    paymentStatus: projected.paymentStatus,
    shippingStatus: projected.shippingStatus,
    orderStatus: projected.status,
    mpStatus: projected.mpStatus,
    mpPaymentId: projected.mpPaymentId,
    mpPreferenceId: projected.mpPreferenceId,
    approvedAt: projected.approvedAt ?? null,
    receiptOutboxVersion: projected.receiptOutboxVersion,
    inventoryStatus: projected.inventoryStatus ?? null,
    inventoryIssueCode: projected.inventoryIssueCode ?? null,
    inventoryIssueAt: projected.inventoryIssueAt ?? null,
    stockDeductedAt: projected.stockDeductedAt ?? null,
    updatedAt: projected.updatedAt,
  });
  logEvent("info", "recovery.sales_row_ensured", {
    orderId: projected.externalReference,
    paymentStatus: projected.paymentStatus,
  });
  return { order: projected, synced: true };
}

export async function getOrder(externalReference: string): Promise<Order | null> {
  const stored = await getJson<StoredOrder>(orderKey(externalReference));
  if (!stored) return null;
  return ensureOrderDefaults(stored);
}

export const orderWriteLockCoversWorstCaseSheetUpdate = (): boolean =>
  ORDER_WRITE_LOCK_TTL_SECONDS * 1000 >=
  UPDATE_ORDER_ROW_WORST_CASE_MS + ORDER_WRITE_LOCK_MINIMUM_MARGIN_MS;

export const mergeOrderUpdate = (
  current: Order,
  patch: OrderPatch,
  updatedAt = Date.now()
): { order: Order; inventoryStatePreserved: boolean } => {
  const candidate: Order = {
    ...current,
    ...patch,
    externalReference: current.externalReference,
    createdAt: current.createdAt,
    updatedAt,
  };
  const currentInventoryStatus = resolveOrderInventoryStatus(current);
  const inventoryPatchTouched =
    "inventoryStatus" in patch ||
    "inventoryIssueCode" in patch ||
    "inventoryIssueAt" in patch ||
    "stockDeductedAt" in patch;
  const inventoryStatePreserved =
    currentInventoryStatus === "deducted" &&
    inventoryPatchTouched &&
    (candidate.inventoryStatus !== "deducted" ||
      candidate.stockDeductedAt !== current.stockDeductedAt ||
      candidate.inventoryIssueCode !== undefined ||
      candidate.inventoryIssueAt !== undefined);

  if (!inventoryStatePreserved) {
    return { order: candidate, inventoryStatePreserved: false };
  }

  return {
    order: {
      ...candidate,
      inventoryStatus: "deducted",
      stockDeductedAt: current.stockDeductedAt,
      inventoryIssueCode: undefined,
      inventoryIssueAt: undefined,
    },
    inventoryStatePreserved: true,
  };
};

const needsEnrolledSalesProjectionRecovery = (order: Order): boolean =>
  order.paymentStatus === "confirmed" && order.receiptOutboxVersion === 1;

export async function updateOrder(
  externalReference: string,
  patch: OrderPatch,
  options: UpdateOrderOptions = {}
): Promise<Order | null> {
  return withOrderWriteLock(externalReference, async () => {
    const current = await getJson<StoredOrder>(orderKey(externalReference));
    if (!current) return null;

    const normalizedCurrent = ensureOrderDefaults(current);
    const { order: mergedOrder, inventoryStatePreserved } = mergeOrderUpdate(
      normalizedCurrent,
      patch
    );
    let updated = mergedOrder;

    if (inventoryStatePreserved) {
      logEvent("info", "orders.inventory_state_preserved", {
        orderId: externalReference,
        inventoryStatus: "deducted",
      });
    }

    await setJson(
      orderKey(externalReference),
      updated,
      privacyPolicy.ttlSecondsForStatus(updated.status)
    );

    if (options.syncSheet !== false) {
      try {
        const inventoryStateTouched =
          inventoryStatePreserved ||
          "inventoryStatus" in patch ||
          "inventoryIssueCode" in patch ||
          "inventoryIssueAt" in patch ||
          "stockDeductedAt" in patch;
        const sheetUpdates: Parameters<typeof updateOrderRowInSalesSheet>[1] = {
          paymentStatus: updated.paymentStatus,
          shippingStatus: updated.shippingStatus,
          orderStatus: updated.status,
          mpStatus: updated.mpStatus,
          mpPaymentId: updated.mpPaymentId,
          mpPreferenceId: updated.mpPreferenceId,
          approvedAt: updated.approvedAt ?? null,
          receiptOutboxVersion: updated.receiptOutboxVersion,
          receiptEmailSentAt: updated.receiptEmailSentAt,
          updatedAt: updated.updatedAt,
        };
        if (inventoryStateTouched) {
          sheetUpdates.inventoryStatus = updated.inventoryStatus ?? null;
          sheetUpdates.inventoryIssueCode = updated.inventoryIssueCode ?? null;
          sheetUpdates.inventoryIssueAt = updated.inventoryIssueAt ?? null;
          sheetUpdates.stockDeductedAt = updated.stockDeductedAt ?? null;
        }
        await updateOrderRowInSalesSheet(updated.externalReference, sheetUpdates);
      } catch (error) {
        logEvent("warn", "orders.sync_sheet_update_failed", {
          externalReference: updated.externalReference,
          errorName: error instanceof Error ? error.name : "unknown",
        });
        logEvent("warn", "orders.sheet_sync_pending", {
          orderId: updated.externalReference,
          inventoryStatus: resolveOrderInventoryStatus(updated) ?? "legacy",
          errorName: error instanceof Error ? error.name : "unknown",
        });
        if (needsEnrolledSalesProjectionRecovery(updated)) {
          const salesSheetSyncFailedAt = Date.now();
          const failedProjectionOrder = {
            ...updated,
            salesSheetSyncFailedAt,
            updatedAt: Math.max(updated.updatedAt, salesSheetSyncFailedAt),
          };
          try {
            await setJson(
              orderKey(externalReference),
              failedProjectionOrder,
              privacyPolicy.ttlSecondsForStatus(failedProjectionOrder.status),
            );
            updated = failedProjectionOrder;
          } catch (stateError) {
            logEvent("error", "orders.sales_sheet_sync_failure_state_failed", {
              orderId: externalReference,
              paymentStatus: updated.paymentStatus,
              inventoryStatus: resolveOrderInventoryStatus(updated) ?? "legacy",
              outcome: stateError instanceof Error ? stateError.name : "unknown",
            });
          }
          try {
            await addPendingSalesSheetOrder(externalReference);
          } catch (indexError) {
            logEvent("error", "orders.sales_sheet_pending_index_failed", {
              orderId: externalReference,
              paymentStatus: updated.paymentStatus,
              inventoryStatus: resolveOrderInventoryStatus(updated) ?? "legacy",
              outcome: indexError instanceof Error ? indexError.name : "unknown",
            });
          }
        }
      }
    }

    return updated;
  });
}

const reportInventoryAttempt = async (
  externalReference: string,
  result: InventoryAttemptResult,
  source: "payment_approval" | "admin_retry"
) => {
  const context = {
    orderId: externalReference,
    source,
    inventoryStatus: result.status,
    ...(result.status === "deducted"
      ? { deduped: result.deduped }
      : { issueCode: result.issueCode }),
  };
  logEvent(result.status === "deducted" ? "info" : "warn", `inventory.${result.status}`, context);
  try {
    await trackBusinessEvent(`inventory.${result.status}` as
      | "inventory.deducted"
      | "inventory.conflict"
      | "inventory.error", context);
  } catch (error) {
    logEvent("warn", "inventory.metric_failed", {
      orderId: externalReference,
      source,
      errorName: error instanceof Error ? error.name : "unknown",
    });
  }
};

export async function markApproved(
  externalReference: string,
  input: { paymentId: string; mpStatus: string; approvedAt?: number }
): Promise<Order | null> {
  const current = await getOrder(externalReference);
  if (!current) return null;

  let inventoryPatch: Partial<Order> = {};
  if (shouldAttemptInventoryAutomatically(current)) {
    const inventoryResult = await attemptInventoryForPaidOrder(current);
    inventoryPatch = inventoryResultToOrderPatch(inventoryResult);
    await reportInventoryAttempt(externalReference, inventoryResult, "payment_approval");
  } else {
    logEvent("info", "inventory.automatic_attempt_skipped", {
      orderId: externalReference,
      inventoryStatus: current.inventoryStatus ?? "legacy_deducted",
    });
  }

  const updated = await updateOrder(
    externalReference,
    {
      status: "approved",
      paymentStatus: "confirmed",
      mpPaymentId: input.paymentId,
      mpStatus: input.mpStatus,
      approvedAt: input.approvedAt ?? Date.now(),
      ...(current.paymentStatus !== "confirmed" ? { receiptOutboxVersion: 1 as const } : {}),
      ...inventoryPatch,
    },
    { syncSheet: current?.salesSheetDeferredUntilApprovedAt ? false : undefined }
  );

  const salesSheetResult = updated?.salesSheetDeferredUntilApprovedAt
    ? await appendApprovedOrderToSalesSheet(updated)
    : { order: updated, synced: true };
  const approvedOrder = salesSheetResult.order;

  if (!approvedOrder || !privacyPolicy.minimizeApprovedOrderPII) {
    return approvedOrder;
  }

  if (approvedOrder.salesSheetDeferredUntilApprovedAt && !salesSheetResult.synced) {
    logEvent("warn", "orders.defer_pii_minimization_until_sales_sheet_sync", {
      externalReference,
      paymentId: input.paymentId,
    });
    return approvedOrder;
  }

  return updateOrder(externalReference, {
    customer: privacyPolicy.anonymizeCustomer(approvedOrder.customer),
    notes: undefined,
  }, { syncSheet: false });
}

export type MercadoPagoPaymentReconciliationResult = {
  order: Order | null;
  receiptOrder?: Order;
  duplicate: boolean;
  firstEffectiveApproval: boolean;
  activeApprovedPaymentIds: string[];
  omittedForCapacity: boolean;
  evictedPaymentIds: string[];
};

export type MercadoPagoPaymentObservationApplication = {
  paymentId: string;
  duplicate: boolean;
  omittedForCapacity: boolean;
  evictedPaymentIds: string[];
};

export type MercadoPagoPaymentBatchReconciliationResult = {
  order: Order | null;
  receiptOrder?: Order;
  firstEffectiveApproval: boolean;
  activeApprovedPaymentIds: string[];
  observationResults: MercadoPagoPaymentObservationApplication[];
};

type MercadoPagoPaymentBatchDependencies = {
  persistOrder?: (key: string, order: Order, ttlSeconds: number) => Promise<void>;
};

const paymentProjectionChanged = (before: Order, after: Order) =>
  before.status !== after.status ||
  before.paymentStatus !== after.paymentStatus ||
  before.mpPaymentId !== after.mpPaymentId ||
  before.mpStatus !== after.mpStatus ||
  before.receiptOutboxVersion !== after.receiptOutboxVersion ||
  before.inventoryStatus !== after.inventoryStatus ||
  before.inventoryIssueCode !== after.inventoryIssueCode ||
  before.inventoryIssueAt !== after.inventoryIssueAt ||
  before.stockDeductedAt !== after.stockDeductedAt;

export async function reconcileMercadoPagoPaymentObservationBatch(
  externalReference: string,
  observations: MercadoPagoPaymentObservation[],
  dependencies: MercadoPagoPaymentBatchDependencies = {}
): Promise<MercadoPagoPaymentBatchReconciliationResult> {
  let inventoryResult: InventoryAttemptResult | undefined;
  const persistOrder = dependencies.persistOrder ?? setJson;
  const persisted = await withOrderWriteLock(externalReference, async () => {
    const stored = await getJson<StoredOrder>(orderKey(externalReference));
    if (!stored) return null;

    const current = ensureOrderDefaults(stored);
    let aggregate = current;
    let acceptedObservationCount = 0;
    let activeApprovedPaymentIds: string[] = [];
    const observationResults: MercadoPagoPaymentObservationApplication[] = [];

    // Build the complete financial projection in memory. No observation prefix is persisted.
    for (const observation of observations) {
      const ledgerResult = applyMercadoPagoPaymentObservation(aggregate, observation);
      activeApprovedPaymentIds = ledgerResult.activeApprovedPaymentIds;
      observationResults.push({
        paymentId: observation.paymentId,
        duplicate: ledgerResult.duplicate,
        omittedForCapacity: ledgerResult.omittedForCapacity,
        evictedPaymentIds: ledgerResult.evictedPaymentIds,
      });
      if (ledgerResult.omittedForCapacity) continue;
      acceptedObservationCount += 1;
      aggregate = { ...aggregate, ...ledgerResult.patch };
    }

    const firstEffectiveApproval =
      current.paymentStatus !== "confirmed" && aggregate.paymentStatus === "confirmed";
    if (acceptedObservationCount === 0) {
      return {
        before: current,
        order: current,
        firstEffectiveApproval: false,
        activeApprovedPaymentIds,
        observationResults,
      };
    }

    let inventoryPatch: Partial<Order> = {};
    if (firstEffectiveApproval && shouldAttemptInventoryAutomatically(current)) {
      inventoryResult = await attemptInventoryForPaidOrder(current);
      inventoryPatch = inventoryResultToOrderPatch(inventoryResult);
    }

    const { order: updated } = mergeOrderUpdate(current, {
      status: aggregate.status,
      paymentStatus: aggregate.paymentStatus,
      mpPaymentId: aggregate.mpPaymentId,
      mpStatus: aggregate.mpStatus,
      mpPaymentLedger: aggregate.mpPaymentLedger,
      mpPaymentAttentionCode: aggregate.mpPaymentAttentionCode,
      approvedAt: aggregate.approvedAt,
      ...(firstEffectiveApproval ? { receiptOutboxVersion: 1 as const } : {}),
      ...inventoryPatch,
    });
    // This is the batch's only durable financial order write.
    await persistOrder(
      orderKey(externalReference),
      updated,
      privacyPolicy.ttlSecondsForStatus(updated.status)
    );

    return {
      before: current,
      order: updated,
      receiptOrder: firstEffectiveApproval ? updated : undefined,
      firstEffectiveApproval,
      activeApprovedPaymentIds,
      observationResults,
    };
  });

  if (!persisted) {
    return {
      order: null,
      firstEffectiveApproval: false,
      activeApprovedPaymentIds: [],
      observationResults: [],
    };
  }

  if (inventoryResult) {
    await reportInventoryAttempt(externalReference, inventoryResult, "payment_approval");
  } else if (persisted.firstEffectiveApproval) {
    logEvent("info", "inventory.automatic_attempt_skipped", {
      orderId: externalReference,
      inventoryStatus: persisted.before.inventoryStatus ?? "legacy_deducted",
    });
  }

  if (persisted.activeApprovedPaymentIds.length > 1) {
    logEvent("warn", "payments.multiple_approved_mp_payments", {
      orderId: externalReference,
      attentionCode: MULTIPLE_APPROVED_MP_PAYMENTS,
      approvedPaymentCount: persisted.activeApprovedPaymentIds.length,
    });
  }

  let projectedOrder = persisted.order;
  let deferredSheetSynced = true;
  if (
    persisted.firstEffectiveApproval &&
    projectedOrder.salesSheetDeferredUntilApprovedAt &&
    !projectedOrder.salesSheetSyncedAt
  ) {
    const sheetResult = await appendApprovedOrderToSalesSheet(projectedOrder);
    projectedOrder = sheetResult.order;
    deferredSheetSynced = sheetResult.synced;
  } else if (
    (!projectedOrder.salesSheetDeferredUntilApprovedAt || projectedOrder.salesSheetSyncedAt) &&
    paymentProjectionChanged(persisted.before, projectedOrder)
  ) {
    projectedOrder = (await updateOrder(externalReference, {})) ?? projectedOrder;
  }

  if (
    persisted.firstEffectiveApproval &&
    projectedOrder.paymentStatus === "confirmed" &&
    privacyPolicy.minimizeApprovedOrderPII &&
    (!projectedOrder.salesSheetDeferredUntilApprovedAt || deferredSheetSynced)
  ) {
    projectedOrder =
      (await updateOrder(
        externalReference,
        {
          customer: privacyPolicy.anonymizeCustomer(projectedOrder.customer),
          notes: undefined,
        },
        { syncSheet: false }
      )) ?? projectedOrder;
  }

  return {
    order: projectedOrder,
    receiptOrder: persisted.receiptOrder,
    firstEffectiveApproval: persisted.firstEffectiveApproval,
    activeApprovedPaymentIds: persisted.activeApprovedPaymentIds,
    observationResults: persisted.observationResults,
  };
}

export async function reconcileMercadoPagoPaymentObservation(
  externalReference: string,
  observation: MercadoPagoPaymentObservation
): Promise<MercadoPagoPaymentReconciliationResult> {
  const batch = await reconcileMercadoPagoPaymentObservationBatch(
    externalReference,
    [observation]
  );
  const application = batch.observationResults[0];
  return {
    order: batch.order,
    receiptOrder: batch.receiptOrder,
    duplicate: application?.duplicate ?? false,
    firstEffectiveApproval: batch.firstEffectiveApproval,
    activeApprovedPaymentIds: batch.activeApprovedPaymentIds,
    omittedForCapacity: application?.omittedForCapacity ?? false,
    evictedPaymentIds: application?.evictedPaymentIds ?? [],
  };
}

export async function retryPaidOrderInventory(externalReference: string): Promise<Order | null> {
  const current = await getOrder(externalReference);
  if (!current) return null;
  if (current.paymentStatus !== "confirmed") {
    throw new Error("El inventario solo puede reintentarse para un pago confirmado.");
  }
  if (resolveOrderInventoryStatus(current) === "deducted") return current;

  const inventoryResult = await attemptInventoryForPaidOrder(current);
  await reportInventoryAttempt(externalReference, inventoryResult, "admin_retry");
  return updateOrder(externalReference, inventoryResultToOrderPatch(inventoryResult));
}

export async function markRejected(
  externalReference: string,
  input: { paymentId?: string; mpStatus: string }
): Promise<Order | null> {
  return markTerminalPaymentState(externalReference, {
    status: "rejected",
    paymentId: input.paymentId,
    mpStatus: input.mpStatus,
  });
}

export async function markTerminalPaymentState(
  externalReference: string,
  input: {
    status: Extract<OrderStatus, "rejected" | "cancelled" | "refunded" | "charged_back">;
    paymentId?: string;
    mpStatus: string;
  }
): Promise<Order | null> {
  return updateOrder(externalReference, {
    status: input.status,
    paymentStatus: statusToPaymentStatus(input.status),
    ...(input.paymentId ? { mpPaymentId: input.paymentId } : {}),
    mpStatus: input.mpStatus,
    notes: undefined,
  });
}

export async function markCancelled(
  externalReference: string,
  input: { paymentId?: string; mpStatus: string }
): Promise<Order | null> {
  return markTerminalPaymentState(externalReference, {
    status: "cancelled",
    paymentId: input.paymentId,
    mpStatus: input.mpStatus,
  });
}

export async function markRefunded(
  externalReference: string,
  input: { paymentId?: string; mpStatus: string }
): Promise<Order | null> {
  return markTerminalPaymentState(externalReference, {
    status: "refunded",
    paymentId: input.paymentId,
    mpStatus: input.mpStatus,
  });
}

export async function markChargedBack(
  externalReference: string,
  input: { paymentId?: string; mpStatus: string }
): Promise<Order | null> {
  return markTerminalPaymentState(externalReference, {
    status: "charged_back",
    paymentId: input.paymentId,
    mpStatus: input.mpStatus,
  });
}

export function paymentStatusFromOrderStatus(status: OrderStatus): OrderPaymentStatus {
  return statusToPaymentStatus(status);
}

export async function markPreferenceCreated(
  externalReference: string,
  input: { preferenceId: string; status?: OrderStatus },
  options: UpdateOrderOptions = {}
): Promise<Order | null> {
  return updateOrder(externalReference, {
    status: input.status ?? "preference_created",
    mpPreferenceId: input.preferenceId,
  }, options);
}
