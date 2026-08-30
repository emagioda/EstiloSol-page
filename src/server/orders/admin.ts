import { logEvent } from "@/src/server/observability/log";
import { listEmailOutboxAttention } from "@/src/server/emailOutbox/repository";
import type { EmailOutboxAttentionItem } from "@/src/server/emailOutbox/types";
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
} from "./salesSheetSync";
import { getOrder, projectCurrentOrderSalesState } from "./store";
import type { Order } from "./types";
import { listRecoveryAttention } from "@/src/server/recovery/repository";
import type { RecoveryAttentionItem } from "@/src/server/recovery/types";

type SheetStateUpdates = Parameters<typeof updateOrderRowInSalesSheet>[1];

type AdminOrderStateDependencies = {
  getSheetOrders?: typeof getOrdersForAdmin;
  getKvOrder?: typeof getOrder;
  syncSheetState?: typeof updateOrderRowInSalesSheet;
  projectCurrentState?: typeof projectCurrentOrderSalesState;
  listPendingOrderIds?: typeof listPendingSalesSheetOrderIds;
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

const cloneFulfillment = (order: Order) =>
  order.fulfillment
    ? {
        ...order.fulfillment,
        ...(order.fulfillment.deliveryZone
          ? { deliveryZone: { ...order.fulfillment.deliveryZone } }
          : {}),
        ...(order.fulfillment.deliveryAddress
          ? { deliveryAddress: { ...order.fulfillment.deliveryAddress } }
          : {}),
        ...(order.fulfillment.pickupPoint
          ? { pickupPoint: { ...order.fulfillment.pickupPoint } }
          : {}),
      }
    : undefined;

const isStrongFinancialStatus = (status: AdminOrderSheetRow["paymentStatus"]) =>
  status === "confirmed" || status === "refunded" || status === "charged_back";

const hasLedgerEvidenceFor = (
  order: Order,
  status: Extract<AdminOrderSheetRow["paymentStatus"], "refunded" | "charged_back">,
) => Object.values(order.mpPaymentLedger ?? {}).some((entry) => entry.status === status);

const resolveMonotonicPaymentStatus = (
  sheetStatus: AdminOrderSheetRow["paymentStatus"],
  kvOrder: Order,
): {
  status: AdminOrderSheetRow["paymentStatus"];
  mayWriteKvProjection: boolean;
  attentionCode?: string;
} => {
  const kvStatus = kvOrder.paymentStatus;
  if (sheetStatus === kvStatus) {
    return { status: sheetStatus, mayWriteKvProjection: true };
  }
  if (isStrongFinancialStatus(sheetStatus) && !isStrongFinancialStatus(kvStatus)) {
    return { status: sheetStatus, mayWriteKvProjection: false };
  }
  if (!isStrongFinancialStatus(sheetStatus) && kvStatus === "confirmed") {
    return { status: kvStatus, mayWriteKvProjection: true };
  }
  if (kvStatus === "refunded" || kvStatus === "charged_back") {
    if (!hasLedgerEvidenceFor(kvOrder, kvStatus)) {
      return {
        status: sheetStatus,
        mayWriteKvProjection: false,
        attentionCode: "FINANCIAL_LEDGER_EVIDENCE_MISSING",
      };
    }
    if (
      (sheetStatus === "refunded" || sheetStatus === "charged_back") &&
      sheetStatus !== kvStatus
    ) {
      return {
        status: sheetStatus,
        mayWriteKvProjection: false,
        attentionCode: "FINANCIAL_EVIDENCE_CONFLICT",
      };
    }
    return { status: kvStatus, mayWriteKvProjection: true };
  }
  if (isStrongFinancialStatus(sheetStatus)) {
    return { status: sheetStatus, mayWriteKvProjection: false };
  }
  return { status: kvStatus, mayWriteKvProjection: true };
};

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
  const financial = resolveMonotonicPaymentStatus(sheetOrder.paymentStatus, kvOrder);

  const order: AdminOrderSheetRow = {
    ...sheetOrder,
    total: kvOrder.total,
    deliveryMethod: kvOrder.deliveryMethod,
    fulfillment: cloneFulfillment(kvOrder),
    paymentStatus: financial.status,
    shippingStatus: kvOrder.shippingStatus,
    inventoryStatus,
    inventoryIssueCode,
    inventoryIssueAt,
    stockDeductedAt,
    ...(financial.attentionCode
      ? { financialAttentionCode: financial.attentionCode }
      : {}),
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
    shippingStatus: kvOrder.shippingStatus,
    updatedAt,
  };

  if (financial.mayWriteKvProjection) {
    syncUpdates.paymentStatus = financial.status;
    syncUpdates.orderStatus = kvOrder.status;
  }

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
  fulfillment: cloneFulfillment(order),
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
  const projectCurrentState =
    dependencies.projectCurrentState ??
    (dependencies.getKvOrder || dependencies.syncSheetState
      ? async (
          orderId: string,
          selectUpdates: (current: Order) => SheetStateUpdates | null,
        ) => {
          const current = await readKvOrder(orderId);
          if (!current) return null;
          const updates = selectUpdates(current);
          if (updates) await syncSheetState(orderId, updates);
          return current;
        }
      : projectCurrentOrderSalesState);
  const listPendingOrderIds =
    dependencies.listPendingOrderIds ?? listPendingSalesSheetOrderIds;
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
      if (isPending) {
        try {
          const recovery = await recoverPendingOrder(
            sheetOrder.orderId,
            { rowExists: true }
          );
          if (!recovery.order) return sheetOrder;
          const resolution = resolveAdminOrderState(
            sheetOrder,
            recovery.order,
            recovery.order.updatedAt,
          );
          return {
            ...resolution.order,
            salesSheetSyncPending: !salesSheetRecoveryCompleted(recovery.outcome),
          };
        } catch (error) {
          logEvent("warn", "orders.sales_sheet_append_pending", {
            orderId: sheetOrder.orderId,
            inventoryStatus: kvOrder
              ? resolveOrderInventoryStatus(kvOrder) ?? "legacy"
              : "unknown",
            paymentStatus: kvOrder?.paymentStatus ?? "unknown",
            outcome: error instanceof Error ? error.name : "unknown",
          });
          if (!kvOrder) return { ...sheetOrder, salesSheetSyncPending: true };
          return {
            ...resolveAdminOrderState(sheetOrder, kvOrder, now()).order,
            salesSheetSyncPending: true,
          };
        }
      }

      if (!kvOrder) return sheetOrder;
      const resolution = resolveAdminOrderState(sheetOrder, kvOrder, now());

      if (!resolution.syncUpdates) return resolution.order;

      try {
        const projectedCurrent = await projectCurrentState(
          sheetOrder.orderId,
          (current) =>
            resolveAdminOrderState(sheetOrder, current, current.updatedAt).syncUpdates,
        );
        logEvent("info", "orders.sheet_sync_recovered", {
          orderId: sheetOrder.orderId,
          inventoryStatus: projectedCurrent
            ? resolveOrderInventoryStatus(projectedCurrent) ?? "legacy"
            : resolution.order.inventoryStatus ?? "legacy",
        });
        if (projectedCurrent) {
          return resolveAdminOrderState(
            sheetOrder,
            projectedCurrent,
            projectedCurrent.updatedAt,
          ).order;
        }
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
        try {
          const recovery = await recoverPendingOrder(orderId, { rowExists: false });
          if (
            !recovery.order ||
            recovery.outcome === "stale" ||
            recovery.outcome === "not_eligible" ||
            recovery.outcome === "not_indexed"
          ) {
            return null;
          }
          return {
            ...buildAdminOrderSheetRowFromKv(recovery.order),
            salesSheetSyncPending: !salesSheetRecoveryCompleted(recovery.outcome),
          };
        } catch (error) {
          if (!kvOrder) return null;
          const result = buildAdminOrderSheetRowFromKv(kvOrder);
          logEvent("warn", "orders.sales_sheet_append_pending", {
            orderId,
            inventoryStatus: result.inventoryStatus ?? "legacy",
            paymentStatus: result.paymentStatus,
            outcome: error instanceof Error ? error.name : "unknown",
          });
          return result;
        }
      })
  );

  return [...sheetResults, ...missingResults.filter((order) => order !== null)].sort(
    (left, right) => right.createdAtMs - left.createdAtMs
  );
}

export async function getRecoveryAttentionForAdmin(): Promise<RecoveryAttentionItem[]> {
  try {
    return await listRecoveryAttention(100);
  } catch (error) {
    logEvent("warn", "recovery.admin_attention_unavailable", {
      errorName: error instanceof Error ? error.name : "unknown",
    });
    return [];
  }
}

export async function getEmailOutboxAttentionForAdmin(): Promise<EmailOutboxAttentionItem[]> {
  try {
    return await listEmailOutboxAttention(100);
  } catch (error) {
    logEvent("warn", "email.outbox.admin_attention_unavailable", {
      errorName: error instanceof Error ? error.name : "unknown",
    });
    return [];
  }
}
