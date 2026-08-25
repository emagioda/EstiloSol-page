import { randomUUID } from "node:crypto";
import { delIfValue, setJsonIfNotExists } from "@/src/server/kv";
import { logEvent } from "@/src/server/observability/log";
import { resolveOrderInventoryStatus } from "./inventory";
import {
  isPendingSalesSheetOrder,
} from "./salesSheetSync";
import {
  getOrder,
  ORDER_WRITE_LOCK_TTL_SECONDS,
  reconcileCurrentOrderSalesProjection,
  type CurrentSalesProjectionResult,
} from "./store";
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
  reconcileProjection?: typeof reconcileCurrentOrderSalesProjection;
};

const logRecovery = (
  level: "info" | "warn",
  event: string,
  order: Order,
  outcome: SalesSheetRecoveryOutcome,
) => {
  logEvent(level, event, {
    orderId: order.externalReference,
    inventoryStatus: resolveOrderInventoryStatus(order) ?? "legacy",
    paymentStatus: order.paymentStatus,
    outcome,
  });
};

const mapProjectionOutcome = (
  projection: CurrentSalesProjectionResult,
): SalesSheetRecoveryOutcome => {
  if (projection.outcome === "appended") return "appended";
  if (projection.outcome === "projected") return "reconciled";
  if (projection.outcome === "missing") return "stale";
  if (projection.outcome === "not_eligible") return "not_eligible";
  if (projection.outcome === "not_indexed") return "not_indexed";
  return "pending";
};

export async function recoverPendingSalesSheetOrder(
  orderId: string,
  options: { rowExists: boolean },
  dependencies: SalesSheetRecoveryDependencies = {},
): Promise<SalesSheetRecoveryResult> {
  const checkPending = dependencies.isPending ?? isPendingSalesSheetOrder;
  const readOrder = dependencies.readOrder ?? getOrder;
  const reconcileProjection =
    dependencies.reconcileProjection ?? reconcileCurrentOrderSalesProjection;
  const ownerToken = randomUUID();
  const lockKey = recoveryLockKey(orderId);
  const acquired = await setJsonIfNotExists(
    lockKey,
    ownerToken,
    ORDER_WRITE_LOCK_TTL_SECONDS,
  );

  if (!acquired) {
    return { outcome: "busy", order: await readOrder(orderId) };
  }

  try {
    if (!(await checkPending(orderId))) {
      return { outcome: "not_indexed", order: await readOrder(orderId) };
    }

    let projection = await reconcileProjection(orderId, {
      rowExists: options.rowExists,
      requirePending: true,
    });

    // Append identity dedupe is not a freshness acknowledgement. Re-enter the
    // normal Order lock and project current KV into the now-existing row.
    if (projection.outcome === "deduped") {
      projection = await reconcileProjection(orderId, {
        rowExists: true,
        requirePending: true,
      });
    }

    const outcome = mapProjectionOutcome(projection);
    if (outcome === "stale" || outcome === "not_eligible") {
      if (projection.order) {
        logRecovery("warn", "orders.sales_sheet_pending_index_stale", projection.order, outcome);
      } else {
        logEvent("warn", "orders.sales_sheet_pending_index_stale", {
          orderId,
          inventoryStatus: "unknown",
          paymentStatus: "unknown",
          outcome,
        });
      }
      return { outcome, order: projection.order };
    }

    if (outcome === "not_indexed") {
      return { outcome, order: projection.order };
    }

    if (outcome === "appended" || outcome === "reconciled") {
      if (projection.order) {
        logRecovery("info", "orders.sales_sheet_append_recovered", projection.order, outcome);
      }
      return { outcome, order: projection.order };
    }

    const current = (await readOrder(orderId)) ?? projection.order;
    logEvent("warn", "orders.sales_sheet_append_pending", {
      orderId,
      inventoryStatus: current ? resolveOrderInventoryStatus(current) ?? "legacy" : "unknown",
      paymentStatus: current?.paymentStatus ?? "unknown",
      outcome: projection.error instanceof Error ? projection.error.name : projection.outcome,
    });
    return { outcome: "pending", order: current };
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
  outcome: SalesSheetRecoveryOutcome,
): boolean =>
  outcome === "appended" ||
  outcome === "reconciled" ||
  outcome === "already_synced" ||
  outcome === "stale" ||
  outcome === "not_eligible" ||
  outcome === "not_indexed";
