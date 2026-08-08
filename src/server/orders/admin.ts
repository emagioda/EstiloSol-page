import { logEvent } from "@/src/server/observability/log";
import {
  getOrdersForAdmin,
  updateOrderRowInSalesSheet,
  type AdminOrderSheetRow,
} from "@/src/server/sheets/repository";
import { resolveOrderInventoryStatus } from "./inventory";
import {
  recoverPendingSalesSheetOrder,
  salesSheetRecoveryCompleted,
} from "./salesSheetRecovery";
import {
  listPendingSalesSheetOrderIds,
  removePendingSalesSheetOrder,
  shouldRecoverOrderInSalesSheet,
} from "./salesSheetSync";
import { getOrder } from "./store";
import type { Order } from "./types";

type SheetStateUpdates = Parameters<typeof updateOrderRowInSalesSheet>[1];

type AdminOrderStateDependencies = {
  getSheetOrders?: typeof getOrdersForAdmin;
  getKvOrder?: typeof getOrder;
  syncSheetState?: typeof updateOrderRowInSalesSheet;
  listPendingOrderIds?: typeof listPendingSalesSheetOrderIds;
  removePendingOrder?: typeof removePendingSalesSheetOrder;
  recoverPendingOrder?: typeof recoverPendingSalesSheetOrder;
  now?: () => number;
};

export type AdminOrderStateResolution = {
  order: AdminOrderSheetRow;
  syncUpdates: SheetStateUpdates | null;
};

const toIsoString = (timestamp: number | undefined): string =>
  timestamp ? new Date(timestamp).toISOString() : "";

const toTimestamp = (value: string): number | undefined => {
  if (!value) return undefined;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : undefined;
};

const timestampsMatch = (sheetValue: string, kvValue: number | undefined): boolean =>
  toTimestamp(sheetValue) === kvValue;

export const resolveAdminOrderState = (
  sheetOrder: AdminOrderSheetRow,
  kvOrder: Order,
  updatedAt = Date.now()
): AdminOrderStateResolution => {
  const kvInventoryStatus = resolveOrderInventoryStatus(kvOrder);
  const sheetHasDeductedEvidence =
    sheetOrder.inventoryStatus === "deducted" && Boolean(toTimestamp(sheetOrder.stockDeductedAt));
  const kvCanSupplyInventoryState =
    kvInventoryStatus !== undefined &&
    !(sheetHasDeductedEvidence && kvInventoryStatus !== "deducted");

  const inventoryStatus = kvCanSupplyInventoryState
    ? kvInventoryStatus
    : sheetOrder.inventoryStatus;
  const inventoryRequiresAttention =
    inventoryStatus === "conflict" || inventoryStatus === "error";
  const effectiveInventoryIssueAt =
    kvCanSupplyInventoryState && inventoryRequiresAttention
      ? kvOrder.inventoryIssueAt
      : undefined;
  const effectiveStockDeductedAt =
    kvCanSupplyInventoryState && inventoryStatus === "deducted"
      ? kvOrder.stockDeductedAt
      : undefined;
  const inventoryIssueCode = kvCanSupplyInventoryState
    ? inventoryRequiresAttention
      ? kvOrder.inventoryIssueCode ?? ""
      : ""
    : sheetOrder.inventoryIssueCode;
  const inventoryIssueAt = kvCanSupplyInventoryState
    ? inventoryRequiresAttention
      ? toIsoString(effectiveInventoryIssueAt)
      : ""
    : sheetOrder.inventoryIssueAt;
  const stockDeductedAt = kvCanSupplyInventoryState
    ? inventoryStatus === "deducted"
      ? toIsoString(effectiveStockDeductedAt)
      : ""
    : sheetOrder.stockDeductedAt;

  const order: AdminOrderSheetRow = {
    ...sheetOrder,
    paymentStatus: kvOrder.paymentStatus,
    shippingStatus: kvOrder.shippingStatus,
    inventoryStatus,
    inventoryIssueCode,
    inventoryIssueAt,
    stockDeductedAt,
  };

  const paymentChanged = sheetOrder.paymentStatus !== order.paymentStatus;
  const shippingChanged = sheetOrder.shippingStatus !== order.shippingStatus;
  const inventoryChanged =
    kvCanSupplyInventoryState &&
    (sheetOrder.inventoryStatus !== inventoryStatus ||
      sheetOrder.inventoryIssueCode !== inventoryIssueCode ||
      !timestampsMatch(sheetOrder.inventoryIssueAt, effectiveInventoryIssueAt) ||
      !timestampsMatch(sheetOrder.stockDeductedAt, effectiveStockDeductedAt));

  if (!paymentChanged && !shippingChanged && !inventoryChanged) {
    return { order, syncUpdates: null };
  }

  const syncUpdates: SheetStateUpdates = {
    paymentStatus: kvOrder.paymentStatus,
    shippingStatus: kvOrder.shippingStatus,
    orderStatus: kvOrder.status,
    updatedAt,
  };

  if (kvCanSupplyInventoryState) {
    syncUpdates.inventoryStatus = inventoryStatus ?? null;
    syncUpdates.inventoryIssueCode = inventoryIssueCode || null;
    syncUpdates.inventoryIssueAt = effectiveInventoryIssueAt ?? null;
    syncUpdates.stockDeductedAt = effectiveStockDeductedAt ?? null;
  }

  return { order, syncUpdates };
};

export const buildAdminOrderSheetRowFromKv = (
  order: Order,
  salesSheetSyncPending = true
): AdminOrderSheetRow => ({
  orderId: order.externalReference,
  createdAt: toIsoString(order.createdAt),
  createdAtMs: order.createdAt,
  customerName: order.customer?.name ?? "",
  whatsapp: order.customer?.phone ?? "",
  email: order.customer?.email ?? "",
  total: order.total,
  currency: order.currency,
  paymentStatus: order.paymentStatus,
  shippingStatus: order.shippingStatus,
  inventoryStatus: resolveOrderInventoryStatus(order),
  inventoryIssueCode: order.inventoryIssueCode ?? "",
  inventoryIssueAt: toIsoString(order.inventoryIssueAt),
  stockDeductedAt: toIsoString(order.stockDeductedAt),
  paymentMethod: order.paymentMethod,
  deliveryMethod: order.deliveryMethod,
  items: order.items.map((item) => ({
    productId: item.productId,
    title: item.title,
    qty: item.qty,
    unitPrice: item.unitPrice,
  })),
  itemsSummary:
    order.fulfillment?.summary ??
    order.items.map((item) => `${item.title} x${item.qty}`).join(", "),
  notes: order.notes ?? "",
  receiptEmailSentAt: toIsoString(order.receiptEmailSentAt),
  salesSheetSyncPending,
  raw: {},
});

export async function getOrdersForAdminWithKvState(
  dependencies: AdminOrderStateDependencies = {}
): Promise<AdminOrderSheetRow[]> {
  const readSheetOrders = dependencies.getSheetOrders ?? getOrdersForAdmin;
  const readKvOrder = dependencies.getKvOrder ?? getOrder;
  const syncSheetState = dependencies.syncSheetState ?? updateOrderRowInSalesSheet;
  const listPendingOrderIds =
    dependencies.listPendingOrderIds ?? listPendingSalesSheetOrderIds;
  const removePendingOrder =
    dependencies.removePendingOrder ?? removePendingSalesSheetOrder;
  const recoverPendingOrder =
    dependencies.recoverPendingOrder ?? recoverPendingSalesSheetOrder;
  const now = dependencies.now ?? Date.now;
  const [sheetOrders, pendingOrderIds] = await Promise.all([
    readSheetOrders(),
    listPendingOrderIds(),
  ]);
  const pendingOrderIdSet = new Set(pendingOrderIds);
  const sheetOrderIdSet = new Set(sheetOrders.map((order) => order.orderId));

  const sheetResults = await Promise.all(
    sheetOrders.map(async (sheetOrder) => {
      const kvOrder = await readKvOrder(sheetOrder.orderId);
      const isPending = pendingOrderIdSet.has(sheetOrder.orderId);
      if (!kvOrder) {
        if (isPending) {
          try {
            await removePendingOrder(sheetOrder.orderId);
            logEvent("warn", "orders.sales_sheet_pending_index_stale", {
              orderId: sheetOrder.orderId,
              inventoryStatus: "unknown",
              paymentStatus: "unknown",
              outcome: "stale",
            });
          } catch (error) {
            logEvent("warn", "orders.sales_sheet_append_pending", {
              orderId: sheetOrder.orderId,
              inventoryStatus: "unknown",
              paymentStatus: "unknown",
              outcome: error instanceof Error ? error.name : "unknown",
            });
          }
        }
        return sheetOrder;
      }

      const resolution = resolveAdminOrderState(sheetOrder, kvOrder, now());
      if (isPending) {
        if (!shouldRecoverOrderInSalesSheet(kvOrder)) {
          await removePendingOrder(sheetOrder.orderId);
          return resolution.order;
        }

        try {
          const recovery = await recoverPendingOrder(
            sheetOrder.orderId,
            { rowExists: true }
          );
          return {
            ...resolution.order,
            salesSheetSyncPending: !salesSheetRecoveryCompleted(recovery.outcome),
          };
        } catch (error) {
          logEvent("warn", "orders.sales_sheet_append_pending", {
            orderId: sheetOrder.orderId,
            inventoryStatus: resolution.order.inventoryStatus ?? "legacy",
            paymentStatus: resolution.order.paymentStatus,
            outcome: error instanceof Error ? error.name : "unknown",
          });
          return { ...resolution.order, salesSheetSyncPending: true };
        }
      }

      if (!resolution.syncUpdates) return resolution.order;

      try {
        await syncSheetState(sheetOrder.orderId, resolution.syncUpdates);
        logEvent("info", "orders.sheet_sync_recovered", {
          orderId: sheetOrder.orderId,
          inventoryStatus: resolution.order.inventoryStatus ?? "legacy",
        });
      } catch (error) {
        logEvent("warn", "orders.sheet_sync_pending", {
          orderId: sheetOrder.orderId,
          inventoryStatus: resolution.order.inventoryStatus ?? "legacy",
          errorName: error instanceof Error ? error.name : "unknown",
        });
      }

      return resolution.order;
    })
  );

  const missingResults = await Promise.all(
    pendingOrderIds
      .filter((orderId) => !sheetOrderIdSet.has(orderId))
      .map(async (orderId) => {
        const kvOrder = await readKvOrder(orderId);
        if (!kvOrder) {
          try {
            await removePendingOrder(orderId);
            logEvent("warn", "orders.sales_sheet_pending_index_stale", {
              orderId,
              inventoryStatus: "unknown",
              paymentStatus: "unknown",
              outcome: "stale",
            });
          } catch (error) {
            logEvent("warn", "orders.sales_sheet_append_pending", {
              orderId,
              inventoryStatus: "unknown",
              paymentStatus: "unknown",
              outcome: error instanceof Error ? error.name : "unknown",
            });
          }
          return null;
        }

        if (!shouldRecoverOrderInSalesSheet(kvOrder)) {
          await removePendingOrder(orderId);
          logEvent("warn", "orders.sales_sheet_pending_index_stale", {
            orderId,
            inventoryStatus: resolveOrderInventoryStatus(kvOrder) ?? "legacy",
            paymentStatus: kvOrder.paymentStatus,
            outcome: "not_eligible",
          });
          return null;
        }

        let result = buildAdminOrderSheetRowFromKv(kvOrder);
        try {
          const recovery = await recoverPendingOrder(orderId, { rowExists: false });
          result = {
            ...result,
            salesSheetSyncPending: !salesSheetRecoveryCompleted(recovery.outcome),
          };
        } catch (error) {
          logEvent("warn", "orders.sales_sheet_append_pending", {
            orderId,
            inventoryStatus: result.inventoryStatus ?? "legacy",
            paymentStatus: result.paymentStatus,
            outcome: error instanceof Error ? error.name : "unknown",
          });
        }
        return result;
      })
  );

  return [...sheetResults, ...missingResults.filter((order) => order !== null)].sort(
    (left, right) => right.createdAtMs - left.createdAtMs
  );
}
