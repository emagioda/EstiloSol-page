import { randomUUID } from "node:crypto";
import { del, delIfValue, getJson, setJson, setJsonIfNotExists } from "@/src/server/kv";
import { logEvent } from "@/src/server/observability/log";
import { trackBusinessEvent } from "@/src/server/observability/metrics";
import { privacyPolicy } from "@/src/server/privacy/policy";
import {
  appendOrderToSalesSheet,
  updateOrderRowInSalesSheet,
} from "@/src/server/sheets/repository";
import {
  attemptInventoryForPaidOrder,
  inventoryResultToOrderPatch,
  resolveOrderInventoryStatus,
  shouldAttemptInventoryAutomatically,
  type InventoryAttemptResult,
} from "./inventory";
import type { Order, OrderPaymentStatus, OrderStatus } from "./types";

export const WEBHOOK_DEDUPE_TTL_SECONDS = 7 * 24 * 3600;

const orderKey = (externalReference: string) => `es:order:${externalReference}`;
const orderWriteLockKey = (externalReference: string) => `es:order:write-lock:${externalReference}`;
const salesSheetSyncKey = (externalReference: string) => `es:order:sales-sheet-sync:${externalReference}`;
const receiptEmailSyncKey = (externalReference: string) => `es:order:receipt-email-sync:${externalReference}`;

const ORDER_WRITE_LOCK_TTL_SECONDS = 45;
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

async function appendApprovedOrderToSalesSheet(order: Order): Promise<{ order: Order; synced: boolean }> {
  if (!order.salesSheetDeferredUntilApprovedAt || order.salesSheetSyncedAt) {
    return { order, synced: true };
  }

  const lockAcquired = await setJsonIfNotExists(
    salesSheetSyncKey(order.externalReference),
    "syncing",
    WEBHOOK_DEDUPE_TTL_SECONDS
  );

  if (!lockAcquired) {
    logEvent("info", "orders.sales_sheet_sync_already_running", {
      externalReference: order.externalReference,
    });
    return { order, synced: false };
  }

  try {
    await appendOrderToSalesSheet(order);
    const salesSheetSyncedAt = Date.now();
    await setJson(salesSheetSyncKey(order.externalReference), "synced", WEBHOOK_DEDUPE_TTL_SECONDS);
    const updated = await updateOrder(
      order.externalReference,
      { salesSheetSyncedAt },
      { syncSheet: false }
    );
    return {
      order: updated ?? { ...order, salesSheetSyncedAt },
      synced: true,
    };
  } catch (error) {
    await del(salesSheetSyncKey(order.externalReference));
    const salesSheetSyncFailedAt = Date.now();
    logEvent("error", "orders.sales_sheet_approved_append_failed", {
      externalReference: order.externalReference,
      paymentId: order.mpPaymentId,
      error,
    });
    await trackBusinessEvent("payment.sales_sheet_sync_failed", {
      externalReference: order.externalReference,
      paymentId: order.mpPaymentId,
    });
    const updated = await updateOrder(
      order.externalReference,
      { salesSheetSyncFailedAt },
      { syncSheet: false }
    );
    return {
      order: updated ?? { ...order, salesSheetSyncFailedAt },
      synced: false,
    };
  }
}

export async function getOrder(externalReference: string): Promise<Order | null> {
  const stored = await getJson<StoredOrder>(orderKey(externalReference));
  if (!stored) return null;
  return ensureOrderDefaults(stored);
}

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

export async function updateOrder(
  externalReference: string,
  patch: OrderPatch,
  options: UpdateOrderOptions = {}
): Promise<Order | null> {
  return withOrderWriteLock(externalReference, async () => {
    const current = await getJson<StoredOrder>(orderKey(externalReference));
    if (!current) return null;

    const normalizedCurrent = ensureOrderDefaults(current);
    const { order: updated, inventoryStatePreserved } = mergeOrderUpdate(
      normalizedCurrent,
      patch
    );

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
          error,
        });
        logEvent("warn", "orders.sheet_sync_pending", {
          orderId: updated.externalReference,
          inventoryStatus: resolveOrderInventoryStatus(updated) ?? "legacy",
          errorName: error instanceof Error ? error.name : "unknown",
        });
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

export async function claimReceiptEmailDelivery(externalReference: string): Promise<boolean> {
  return setJsonIfNotExists(
    receiptEmailSyncKey(externalReference),
    "sending",
    WEBHOOK_DEDUPE_TTL_SECONDS
  );
}

export async function releaseReceiptEmailDelivery(externalReference: string): Promise<void> {
  await del(receiptEmailSyncKey(externalReference));
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
