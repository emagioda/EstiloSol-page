import { logEvent } from "@/src/server/observability/log";
import {
  getOrdersForAdmin,
  updateOrderRowInSalesSheet,
  type AdminOrderSheetRow,
} from "@/src/server/sheets/repository";
import { resolveOrderInventoryStatus } from "./inventory";
import { getOrder } from "./store";
import type { Order } from "./types";

type SheetStateUpdates = Parameters<typeof updateOrderRowInSalesSheet>[1];

type AdminOrderStateDependencies = {
  getSheetOrders?: typeof getOrdersForAdmin;
  getKvOrder?: typeof getOrder;
  syncSheetState?: typeof updateOrderRowInSalesSheet;
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

export async function getOrdersForAdminWithKvState(
  dependencies: AdminOrderStateDependencies = {}
): Promise<AdminOrderSheetRow[]> {
  const readSheetOrders = dependencies.getSheetOrders ?? getOrdersForAdmin;
  const readKvOrder = dependencies.getKvOrder ?? getOrder;
  const syncSheetState = dependencies.syncSheetState ?? updateOrderRowInSalesSheet;
  const now = dependencies.now ?? Date.now;
  const sheetOrders = await readSheetOrders();

  return Promise.all(
    sheetOrders.map(async (sheetOrder) => {
      const kvOrder = await readKvOrder(sheetOrder.orderId);
      if (!kvOrder) return sheetOrder;

      const resolution = resolveAdminOrderState(sheetOrder, kvOrder, now());
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
}
