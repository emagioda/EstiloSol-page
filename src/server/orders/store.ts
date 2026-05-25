import { del, getJson, setJson, setJsonIfNotExists } from "@/src/server/kv";
import { invalidateProductsCatalogCache } from "@/src/server/catalog/getProducts";
import { logEvent } from "@/src/server/observability/log";
import { trackBusinessEvent } from "@/src/server/observability/metrics";
import { privacyPolicy } from "@/src/server/privacy/policy";
import {
  appendOrderToSalesSheet,
  decrementProductsStockInSheet,
  updateOrderRowInSalesSheet,
} from "@/src/server/sheets/repository";
import type { Order, OrderPaymentStatus, OrderStatus } from "./types";

export const WEBHOOK_DEDUPE_TTL_SECONDS = 7 * 24 * 3600;

const orderKey = (externalReference: string) => `es:order:${externalReference}`;
const salesSheetSyncKey = (externalReference: string) => `es:order:sales-sheet-sync:${externalReference}`;

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

async function deductStockForOrder(order: Order): Promise<number | null> {
  if (order.stockDeductedAt) return order.stockDeductedAt;

  const deductedAt = Date.now();
  await decrementProductsStockInSheet(
    order.externalReference,
    order.items.map((item) => ({
      productId: item.productId,
      qty: item.qty,
      title: item.title,
    }))
  );
  await invalidateProductsCatalogCache();

  return deductedAt;
}

export async function createOrder(order: Order, options: CreateOrderOptions = {}): Promise<void> {
  const shouldSyncSheet = options.syncSheet !== false;
  let normalizedOrder = ensureOrderDefaults({
    ...order,
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

export async function updateOrder(
  externalReference: string,
  patch: Partial<Omit<Order, "externalReference" | "createdAt">>,
  options: UpdateOrderOptions = {}
): Promise<Order | null> {
  const current = await getJson<StoredOrder>(orderKey(externalReference));
  if (!current) return null;

  const normalizedCurrent = ensureOrderDefaults(current);

  const updated: Order = {
    ...normalizedCurrent,
    ...patch,
    externalReference: normalizedCurrent.externalReference,
    createdAt: normalizedCurrent.createdAt,
    updatedAt: Date.now(),
  };

  await setJson(
    orderKey(externalReference),
    updated,
    privacyPolicy.ttlSecondsForStatus(updated.status)
  );

  if (options.syncSheet !== false) {
    try {
      await updateOrderRowInSalesSheet(updated.externalReference, {
        paymentStatus: updated.paymentStatus,
        shippingStatus: updated.shippingStatus,
        orderStatus: updated.status,
        mpStatus: updated.mpStatus,
        mpPaymentId: updated.mpPaymentId,
        mpPreferenceId: updated.mpPreferenceId,
        receiptEmailSentAt: updated.receiptEmailSentAt,
        stockDeductedAt: updated.stockDeductedAt,
        updatedAt: updated.updatedAt,
      });
    } catch (error) {
      logEvent("warn", "orders.sync_sheet_update_failed", {
        externalReference: updated.externalReference,
        error,
      });
    }
  }

  return updated;
}

export async function markApproved(
  externalReference: string,
  input: { paymentId: string; mpStatus: string; approvedAt?: number }
): Promise<Order | null> {
  const current = await getOrder(externalReference);
  let stockDeductedAt: number | null = null;

  if (current) {
    try {
      stockDeductedAt = await deductStockForOrder(current);
    } catch (error) {
      logEvent("error", "orders.stock_deduction_failed", {
        externalReference,
        paymentId: input.paymentId,
        error,
      });
      await trackBusinessEvent("payment.stock_deduction_failed", {
        externalReference,
        paymentId: input.paymentId,
      });
    }
  }

  const updated = await updateOrder(
    externalReference,
    {
      status: "approved",
      paymentStatus: "confirmed",
      mpPaymentId: input.paymentId,
      mpStatus: input.mpStatus,
      approvedAt: input.approvedAt ?? Date.now(),
      ...(stockDeductedAt ? { stockDeductedAt } : {}),
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
