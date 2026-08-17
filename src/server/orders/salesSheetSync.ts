import {
  addSetMember,
  isSetMember,
  listSetMembers,
  removeSetMember,
} from "@/src/server/kv";
import type { Order } from "./types";

const PENDING_SALES_SHEET_SYNC_INDEX_KEY = "es:orders:pending-sales-sheet-sync";

export async function addPendingSalesSheetOrder(orderId: string): Promise<boolean> {
  return addSetMember(PENDING_SALES_SHEET_SYNC_INDEX_KEY, orderId);
}

export async function removePendingSalesSheetOrder(orderId: string): Promise<boolean> {
  return removeSetMember(PENDING_SALES_SHEET_SYNC_INDEX_KEY, orderId);
}

export async function listPendingSalesSheetOrderIds(): Promise<string[]> {
  return (await listSetMembers(PENDING_SALES_SHEET_SYNC_INDEX_KEY)).sort();
}

export async function isPendingSalesSheetOrder(orderId: string): Promise<boolean> {
  return isSetMember(PENDING_SALES_SHEET_SYNC_INDEX_KEY, orderId);
}

export function shouldRecoverOrderInSalesSheet(order: Order): boolean {
  if (
    order.paymentStatus === "confirmed" &&
    order.receiptOutboxVersion === 1 &&
    order.salesSheetSyncFailedAt
  ) {
    return true;
  }

  if (!order.salesSheetDeferredUntilApprovedAt) return false;

  return Boolean(
    order.paymentStatus === "confirmed" ||
      order.approvedAt ||
      order.salesSheetSyncFailedAt
  );
}
