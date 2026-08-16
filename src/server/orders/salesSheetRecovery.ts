import { randomUUID } from "node:crypto";
import { delIfValue, setJsonIfNotExists } from "@/src/server/kv";
import { logEvent } from "@/src/server/observability/log";
import { privacyPolicy } from "@/src/server/privacy/policy";
import {
  appendOrderToSalesSheet,
  updateOrderRowInSalesSheet,
} from "@/src/server/sheets/repository";
import { resolveOrderInventoryStatus } from "./inventory";
import {
  addPendingSalesSheetOrder,
  isPendingSalesSheetOrder,
  removePendingSalesSheetOrder,
  shouldRecoverOrderInSalesSheet,
} from "./salesSheetSync";
import { getOrder, ORDER_WRITE_LOCK_TTL_SECONDS, updateOrder } from "./store";
import type { Order } from "./types";

const recoveryLockKey = (orderId: string) =>
  `es:order:sales-sheet-recovery-lock:${orderId}`;

export type SalesSheetRecoveryOutcome =
  | "appended"
  | "reconciled"
  | "already_synced"
  | "pending"
  | "busy"
  | "stale"
  | "not_eligible"
  | "not_indexed";

export type SalesSheetRecoveryResult = {
  outcome: SalesSheetRecoveryOutcome;
  order: Order | null;
};

type SalesSheetRecoveryDependencies = {
  isPending?: typeof isPendingSalesSheetOrder;
  readOrder?: typeof getOrder;
  appendOrder?: typeof appendOrderToSalesSheet;
  updateSheetRow?: typeof updateOrderRowInSalesSheet;
  persistOrder?: typeof updateOrder;
  addPending?: typeof addPendingSalesSheetOrder;
  removePending?: typeof removePendingSalesSheetOrder;
  now?: () => number;
};

const buildOperationalSheetUpdates = (order: Order, updatedAt: number) => ({
  paymentStatus: order.paymentStatus,
  shippingStatus: order.shippingStatus,
  orderStatus: order.status,
  mpStatus: order.mpStatus,
  mpPaymentId: order.mpPaymentId,
  mpPreferenceId: order.mpPreferenceId,
  receiptOutboxVersion: order.receiptOutboxVersion,
  receiptEmailSentAt: order.receiptEmailSentAt,
  inventoryStatus: resolveOrderInventoryStatus(order) ?? null,
  inventoryIssueCode: order.inventoryIssueCode ?? null,
  inventoryIssueAt: order.inventoryIssueAt ?? null,
  stockDeductedAt: order.stockDeductedAt ?? null,
  updatedAt,
});

const logRecovery = (
  level: "info" | "warn",
  event: string,
  order: Order,
  outcome: SalesSheetRecoveryOutcome
) => {
  logEvent(level, event, {
    orderId: order.externalReference,
    inventoryStatus: resolveOrderInventoryStatus(order) ?? "legacy",
    paymentStatus: order.paymentStatus,
    outcome,
  });
};

export async function recoverPendingSalesSheetOrder(
  orderId: string,
  options: { rowExists: boolean },
  dependencies: SalesSheetRecoveryDependencies = {}
): Promise<SalesSheetRecoveryResult> {
  const checkPending = dependencies.isPending ?? isPendingSalesSheetOrder;
  const readOrder = dependencies.readOrder ?? getOrder;
  const appendOrder = dependencies.appendOrder ?? appendOrderToSalesSheet;
  const updateSheetRow = dependencies.updateSheetRow ?? updateOrderRowInSalesSheet;
  const persistOrder = dependencies.persistOrder ?? updateOrder;
  const addPending = dependencies.addPending ?? addPendingSalesSheetOrder;
  const removePending = dependencies.removePending ?? removePendingSalesSheetOrder;
  const now = dependencies.now ?? Date.now;
  const ownerToken = randomUUID();
  const lockKey = recoveryLockKey(orderId);
  const acquired = await setJsonIfNotExists(
    lockKey,
    ownerToken,
    ORDER_WRITE_LOCK_TTL_SECONDS
  );

  if (!acquired) {
    return { outcome: "busy", order: await readOrder(orderId) };
  }

  try {
    if (!(await checkPending(orderId))) {
      return { outcome: "not_indexed", order: await readOrder(orderId) };
    }

    const order = await readOrder(orderId);
    if (!order) {
      await removePending(orderId);
      logEvent("warn", "orders.sales_sheet_pending_index_stale", {
        orderId,
        inventoryStatus: "unknown",
        paymentStatus: "unknown",
        outcome: "stale",
      });
      return { outcome: "stale", order: null };
    }

    if (!shouldRecoverOrderInSalesSheet(order)) {
      await removePending(orderId);
      logRecovery("warn", "orders.sales_sheet_pending_index_stale", order, "not_eligible");
      return { outcome: "not_eligible", order };
    }

    if (order.salesSheetSyncedAt) {
      await removePending(orderId);
      logRecovery("info", "orders.sales_sheet_append_recovered", order, "already_synced");
      return { outcome: "already_synced", order };
    }

    try {
      if (options.rowExists) {
        await updateSheetRow(
          orderId,
          buildOperationalSheetUpdates(order, now())
        );
      } else {
        logRecovery("warn", "orders.sales_sheet_missing_detected", order, "pending");
        await appendOrder(order);
      }

      const salesSheetSyncedAt = now();
      const updated = await persistOrder(
        orderId,
        {
          salesSheetSyncedAt,
          salesSheetSyncFailedAt: undefined,
          ...(privacyPolicy.minimizeApprovedOrderPII
            ? {
                customer: privacyPolicy.anonymizeCustomer(order.customer),
                notes: undefined,
              }
            : {}),
        },
        { syncSheet: false }
      );
      if (!updated) throw new Error("Order disappeared while reconciling sales sheet");

      await removePending(orderId);
      const outcome = options.rowExists ? "reconciled" : "appended";
      logRecovery("info", "orders.sales_sheet_append_recovered", updated, outcome);
      return { outcome, order: updated };
    } catch (error) {
      try {
        await addPending(orderId);
        await persistOrder(
          orderId,
          { salesSheetSyncFailedAt: now() },
          { syncSheet: false }
        );
      } catch (stateError) {
        logEvent("error", "orders.sales_sheet_pending_state_failed", {
          orderId,
          inventoryStatus: resolveOrderInventoryStatus(order) ?? "legacy",
          paymentStatus: order.paymentStatus,
          outcome: stateError instanceof Error ? stateError.name : "unknown",
        });
      }
      logEvent("warn", "orders.sales_sheet_append_pending", {
        orderId,
        inventoryStatus: resolveOrderInventoryStatus(order) ?? "legacy",
        paymentStatus: order.paymentStatus,
        outcome: error instanceof Error ? error.name : "unknown",
      });
      return { outcome: "pending", order: (await readOrder(orderId)) ?? order };
    }
  } finally {
    try {
      await delIfValue(lockKey, ownerToken);
    } catch (error) {
      logEvent("warn", "orders.sales_sheet_recovery_lock_release_failed", {
        orderId,
        outcome: error instanceof Error ? error.name : "unknown",
      });
    }
  }
}

export const salesSheetRecoveryCompleted = (
  outcome: SalesSheetRecoveryOutcome
): boolean =>
  outcome === "appended" ||
  outcome === "reconciled" ||
  outcome === "already_synced" ||
  outcome === "not_indexed";
