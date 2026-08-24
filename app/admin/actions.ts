"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getServerSession } from "next-auth";
import { env } from "@/src/config/env";
import { isAdminEmail } from "@/src/server/auth/adminEmail";
import { authOptions } from "@/src/server/auth/options";
import { invalidateProductsCatalogCache } from "@/src/server/catalog/getProducts";
import { ensurePurchaseReceiptEventSafely } from "@/src/server/emailOutbox/service";
import { logEvent } from "@/src/server/observability/log";
import {
  applyAdminOrderStatusIntent,
  getOrder,
  retryPaidOrderInventory,
} from "@/src/server/orders/store";
import {
  ADMIN_ORDER_STATE_CHANGED,
  ADMIN_ORDER_STATE_CHANGED_MESSAGE,
  AdminOrderStateChangedError,
  assertValidAdminOrderStatusIntent,
  type AdminOrderStatusIntent,
  type AdminStatusField,
} from "@/src/server/orders/adminIntent";
import {
  attemptInventoryForPaidOrder,
  inventoryResultToOrderPatch,
  resolveOrderInventoryStatus,
  shouldAttemptInventoryAutomatically,
} from "@/src/server/orders/inventory";
import {
  getFulfillmentCompletionBlockMessage,
  isTrustedHistoricalCompletion,
  type FulfillmentCompletionBlockReason,
} from "@/src/server/orders/fulfillmentCompletion";
import type { Order, OrderPaymentStatus, OrderShippingStatus, OrderStatus } from "@/src/server/orders/types";
import {
  getPaymentTransitionBlockMessage,
  PAYMENT_TRANSITION_BLOCK_REASONS,
  PaymentTransitionBlockedError,
  type PaymentTransitionBlockReason,
} from "@/src/server/orders/paymentTransition";
import {
  parseFallbackOrderFulfillment,
  parseFallbackOrderItems,
} from "@/src/server/orders/sheetFallback";
import { reconcileAdminMercadoPagoConfirmation } from "@/src/server/payments/adminConfirmation";
import {
  applyAdminOrderStatusIntentInSalesSheet,
  getOrderRowById,
  updateOrderRowInSalesSheet,
  updateProductRowInSheet,
  type AdminOrderSheetRow,
} from "@/src/server/sheets/repository";

const parsePaymentStatus = (value: FormDataEntryValue | null): OrderPaymentStatus | null => {
  if (
    value === "pending" ||
    value === "confirmed" ||
    value === "cancelled" ||
    value === "refunded" ||
    value === "charged_back"
  ) {
    return value;
  }
  return null;
};

const parseShippingStatus = (value: FormDataEntryValue | null): OrderShippingStatus | null => {
  if (value === "in_process" || value === "completed") {
    return value;
  }
  return null;
};

const isPaymentStatus = (value: string): value is OrderPaymentStatus =>
  value === "pending" ||
  value === "confirmed" ||
  value === "cancelled" ||
  value === "refunded" ||
  value === "charged_back";

const isShippingStatus = (value: string): value is OrderShippingStatus =>
  value === "in_process" || value === "completed";

const parseStringList = (value: FormDataEntryValue | null): string[] =>
  String(value || "")
    .split(/\r?\n|,/)
    .map((entry) => entry.trim())
    .filter(Boolean);

const parseCatalogProductType = (value: FormDataEntryValue | null) => {
  const normalized = String(value || "UNICO").trim().toUpperCase();
  return normalized === "KIT" ? "KIT" : "UNICO";
};

const parseOptionalStockQty = (value: FormDataEntryValue | null) => {
  const raw = String(value || "").trim();
  if (!raw) return null;
  const parsed = Number(raw.replace(",", "."));
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new Error("Invalid stock quantity");
  }
  return Math.trunc(parsed);
};

const requireAdminSession = async () => {
  const session = await getServerSession(authOptions);
  if (!isAdminEmail(session?.user?.email)) {
    throw new Error("Unauthorized");
  }
};

const resolveAdminRedirectPath = (
  value: FormDataEntryValue | null,
  fallback: "/admin/ventas" | "/admin/productos"
) => {
  const path = String(value || "").trim();
  if (path === "/admin/ventas" || path === "/admin/productos") {
    return path;
  }
  return fallback;
};

const orderStatusFromPaymentStatus = (paymentStatus: OrderPaymentStatus): OrderStatus => {
  if (paymentStatus === "confirmed") return "approved";
  if (paymentStatus === "cancelled") return "cancelled";
  if (paymentStatus === "refunded") return "refunded";
  if (paymentStatus === "charged_back") return "charged_back";
  return "pending";
};

const buildFallbackOrderFromSheet = (
  sheetOrder: AdminOrderSheetRow,
  paymentStatus: OrderPaymentStatus,
  shippingStatus: OrderShippingStatus
): Order => {
  const raw = sheetOrder.raw as Record<string, unknown>;
  const items = parseFallbackOrderItems(raw, sheetOrder.items);
  const canonicalPaymentId = raw.mp_payment_id ?? raw.id_pago_mp;
  const canonicalPaymentStatus = raw.mp_status ?? raw.estado_mp;
  const mpPaymentId =
    typeof canonicalPaymentId === "string" && canonicalPaymentId.trim()
      ? canonicalPaymentId.trim()
      : undefined;
  const mpStatus =
    typeof canonicalPaymentStatus === "string" && canonicalPaymentStatus.trim()
      ? canonicalPaymentStatus.trim()
      : paymentStatus === "confirmed"
      ? "approved"
      : paymentStatus === "cancelled"
      ? "cancelled"
      : paymentStatus === "refunded"
      ? "refunded"
      : paymentStatus === "charged_back"
      ? "charged_back"
      : "pending";

  return {
    externalReference: sheetOrder.orderId,
    status: orderStatusFromPaymentStatus(paymentStatus),
    paymentStatus,
    shippingStatus,
    inventoryStatus: sheetOrder.inventoryStatus,
    inventoryIssueCode: sheetOrder.inventoryIssueCode || undefined,
    inventoryIssueAt: sheetOrder.inventoryIssueAt
      ? Date.parse(sheetOrder.inventoryIssueAt) || undefined
      : undefined,
    stockDeductedAt: sheetOrder.stockDeductedAt
      ? Date.parse(sheetOrder.stockDeductedAt) || undefined
      : undefined,
    receiptEmailSentAt: sheetOrder.receiptEmailSentAt
      ? Date.parse(sheetOrder.receiptEmailSentAt) || undefined
      : undefined,
    paymentMethod: sheetOrder.paymentMethod,
    deliveryMethod: sheetOrder.deliveryMethod,
    fulfillment: parseFallbackOrderFulfillment(raw, sheetOrder.deliveryMethod),
    items,
    total: sheetOrder.total,
    currency: "ARS",
    createdAt: sheetOrder.createdAtMs || Date.now(),
    updatedAt: Date.now(),
    mpPaymentId,
    mpStatus,
    approvedAt: (() => {
      const value = raw.approved_at ?? raw.fecha_pago;
      if (typeof value === "number" && Number.isFinite(value)) return value;
      if (typeof value === "string" && value.trim()) return Date.parse(value) || undefined;
      return undefined;
    })(),
    receiptOutboxVersion:
      raw.receipt_outbox_version === 1 || String(raw.receipt_outbox_version || "").trim() === "1"
        ? 1
        : undefined,
    customer: {
      ...(sheetOrder.customerName ? { name: sheetOrder.customerName } : {}),
      ...(sheetOrder.whatsapp ? { phone: sheetOrder.whatsapp } : {}),
      ...(sheetOrder.email ? { email: sheetOrder.email } : {}),
    },
  };
};

export type AdminOrderUpdateInput = {
  orderId: string;
  changedFields: AdminStatusField[];
  expectedPaymentStatus?: OrderPaymentStatus;
  expectedShippingStatus?: OrderShippingStatus;
  requestedPaymentStatus?: OrderPaymentStatus;
  requestedShippingStatus?: OrderShippingStatus;
};

type AdminOrderOutcomeStatus = "success" | "business_block" | "conflict" | "failure";

export type AdminOrderUpdateResult = {
  orderId: string;
  status: AdminOrderOutcomeStatus;
  paymentStatus: OrderPaymentStatus;
  inventoryStatus?: Order["inventoryStatus"];
  shippingStatus: OrderShippingStatus;
  shippingBlocked: boolean;
  paymentBlocked?: boolean;
  paymentBlockReason?: PaymentTransitionBlockReason;
  paymentBlockMessage?: string;
  completionBlockReason?: FulfillmentCompletionBlockReason;
  completionBlockMessage?: string;
  code?: string;
  message?: string;
};

const inventoryPatchFromAttempt = async (order: Order) => {
  const result = await attemptInventoryForPaidOrder(order);
  logEvent(result.status === "deducted" ? "info" : "warn", `inventory.${result.status}`, {
    orderId: order.externalReference,
    source: "admin_fallback",
    inventoryStatus: result.status,
    ...(result.status === "deducted" ? { deduped: result.deduped } : { issueCode: result.issueCode }),
  });
  return { result, patch: inventoryResultToOrderPatch(result) };
};

const isDurablyClaimedManualPaymentIntent = (
  intent: AdminOrderStatusIntent,
  order: Order
) =>
  intent.changedFields.includes("paymentStatus") &&
  intent.expectedPaymentStatus === "pending" &&
  intent.requestedPaymentStatus === "confirmed" &&
  order.paymentStatus === "confirmed" &&
  (order.paymentMethod === "cash" || order.paymentMethod === "transfer") &&
  order.mpStatus === "manual_confirmed" &&
  Boolean(order.mpPaymentId) &&
  Number.isFinite(order.approvedAt) &&
  order.receiptOutboxVersion === 1;

const reconcileVerifiedMercadoPagoApproval = async (order: Order): Promise<Order> => {
  let accessToken: string;
  try {
    accessToken = env.getRequiredServer("MP_ACCESS_TOKEN");
  } catch {
    throw new PaymentTransitionBlockedError(
      PAYMENT_TRANSITION_BLOCK_REASONS.providerAuthorityRequired
    );
  }

  try {
    const result = await reconcileAdminMercadoPagoConfirmation({ order, accessToken });
    return result.order;
  } catch (error) {
    if (error instanceof PaymentTransitionBlockedError) throw error;
    throw new PaymentTransitionBlockedError(
      PAYMENT_TRANSITION_BLOCK_REASONS.providerAuthorityRequired
    );
  }
};

const resultFromOrder = ({
  order,
  status = "success",
  shippingBlocked = false,
  completionBlockReason,
}: {
  order: Order;
  status?: AdminOrderOutcomeStatus;
  shippingBlocked?: boolean;
  completionBlockReason?: FulfillmentCompletionBlockReason;
}): AdminOrderUpdateResult => ({
  orderId: order.externalReference,
  status,
  paymentStatus: order.paymentStatus,
  inventoryStatus: resolveOrderInventoryStatus(order),
  shippingStatus: order.shippingStatus,
  shippingBlocked,
  ...(completionBlockReason
    ? {
        completionBlockReason,
        completionBlockMessage: getFulfillmentCompletionBlockMessage(completionBlockReason),
      }
    : {}),
});

const applySheetFallbackOrderStatusesUpdate = async (
  orderId: string,
  intent: AdminOrderStatusIntent
): Promise<AdminOrderUpdateResult> => {
  let sheetResult = await applyAdminOrderStatusIntentInSalesSheet(orderId, intent);
  if (sheetResult.outcome === "provider_confirmation_required") {
    const providerSheetOrder = await getOrderRowById(orderId);
    if (!providerSheetOrder) throw new Error("Pedido no encontrado.");
    const providerOrder = buildFallbackOrderFromSheet(
      providerSheetOrder,
      providerSheetOrder.paymentStatus,
      providerSheetOrder.shippingStatus
    );
    await reconcileVerifiedMercadoPagoApproval(providerOrder);
    sheetResult = await applyAdminOrderStatusIntentInSalesSheet(orderId, intent);
    if (sheetResult.outcome === "provider_confirmation_required") {
      throw new PaymentTransitionBlockedError(
        PAYMENT_TRANSITION_BLOCK_REASONS.providerAuthorityRequired
      );
    }
  }
  const paymentBlockReason = sheetResult.paymentBlockReason;
  let completionBlockReason = sheetResult.completionBlockReason;

  let sheetOrder = await getOrderRowById(orderId);
  if (!sheetOrder) throw new Error("Pedido no encontrado.");
  let canonicalOrder = buildFallbackOrderFromSheet(
    sheetOrder,
    sheetResult.current.paymentStatus,
    sheetResult.current.shippingStatus
  );
  const shouldEnsureClaimedManualPaymentEffects =
    isDurablyClaimedManualPaymentIntent(intent, canonicalOrder);

  if (
    shouldEnsureClaimedManualPaymentEffects &&
    shouldAttemptInventoryAutomatically(canonicalOrder)
  ) {
    const { patch } = await inventoryPatchFromAttempt(canonicalOrder);
    await updateOrderRowInSalesSheet(orderId, {
      inventoryStatus: patch.inventoryStatus ?? null,
      inventoryIssueCode: patch.inventoryIssueCode ?? null,
      inventoryIssueAt: patch.inventoryIssueAt ?? null,
      stockDeductedAt: patch.stockDeductedAt ?? null,
      updatedAt: Date.now(),
    });
    canonicalOrder = { ...canonicalOrder, ...patch };
  }

  const shouldReevaluateShippingAfterClaimedPayment =
    shouldEnsureClaimedManualPaymentEffects &&
    intent.changedFields.includes("shippingStatus") &&
    intent.requestedShippingStatus === "completed" &&
    sheetResult.current.shippingStatus !== "completed";
  if (sheetResult.shippingDeferred || shouldReevaluateShippingAfterClaimedPayment) {
    const shippingIntent: AdminOrderStatusIntent = {
      changedFields: ["shippingStatus"],
      expectedShippingStatus: intent.expectedShippingStatus,
      requestedShippingStatus: intent.requestedShippingStatus,
    };
    sheetResult = await applyAdminOrderStatusIntentInSalesSheet(orderId, shippingIntent);
    completionBlockReason = sheetResult.completionBlockReason;
    sheetOrder = await getOrderRowById(orderId);
    if (!sheetOrder) throw new Error("Pedido no encontrado.");
    canonicalOrder = buildFallbackOrderFromSheet(
      sheetOrder,
      sheetResult.current.paymentStatus,
      sheetResult.current.shippingStatus
    );
  } else {
    canonicalOrder = {
      ...canonicalOrder,
      paymentStatus: sheetResult.current.paymentStatus,
      shippingStatus: sheetResult.current.shippingStatus,
    };
  }

  if (shouldEnsureClaimedManualPaymentEffects && !sheetOrder.receiptEmailSentAt) {
    const paymentId = canonicalOrder.mpPaymentId;
    const approvedAt = canonicalOrder.approvedAt;
    if (!paymentId || !approvedAt) {
      throw new Error("No se pudo recuperar la identidad canónica del pago manual.");
    }
    await ensurePurchaseReceiptEventSafely({ order: canonicalOrder, paymentId, approvedAt });
  }

  if (paymentBlockReason) {
    return {
      ...resultFromOrder({ order: canonicalOrder, status: "business_block" }),
      paymentBlocked: true,
      paymentBlockReason,
      paymentBlockMessage: getPaymentTransitionBlockMessage(paymentBlockReason),
    };
  }
  return resultFromOrder({
    order: canonicalOrder,
    status: completionBlockReason ? "business_block" : "success",
    shippingBlocked: Boolean(completionBlockReason),
    completionBlockReason,
  });
};

const applyOrderStatusesUpdate = async (
  orderId: string,
  intent: AdminOrderStatusIntent
): Promise<AdminOrderUpdateResult> => {
  let application = await applyAdminOrderStatusIntent(orderId, intent);
  if (!application) return applySheetFallbackOrderStatusesUpdate(orderId, intent);

  if (application.outcome === "provider_confirmation_required") {
    await reconcileVerifiedMercadoPagoApproval(application.order);
    application = await applyAdminOrderStatusIntent(orderId, intent);
    if (!application || application.outcome === "provider_confirmation_required") {
      throw new Error("No se pudo aplicar el estado confirmado por Mercado Pago.");
    }
  }

  if (application.receiptEnrollmentRequired) {
    const paymentId = application.order.mpPaymentId;
    const approvedAt = application.order.approvedAt;
    if (!paymentId || !approvedAt) {
      throw new Error("No se pudo recuperar la identidad canónica del pago manual.");
    }
    await ensurePurchaseReceiptEventSafely({ order: application.order, paymentId, approvedAt });
  }

  return resultFromOrder({
    order: application.order,
    status: application.shippingBlocked ? "business_block" : "success",
    shippingBlocked: application.shippingBlocked,
    completionBlockReason: application.completionBlockReason,
  });
};

export async function updateOrderStatusesAction(formData: FormData) {
  await requireAdminSession();

  const orderId = String(formData.get("orderId") || "").trim();
  const changedFields = formData
    .getAll("changedFields")
    .flatMap((value) => String(value).split(","))
    .map((value) => value.trim())
    .filter(Boolean) as AdminStatusField[];
  const redirectTo = resolveAdminRedirectPath(formData.get("redirectTo"), "/admin/ventas");
  const expectedPaymentStatus = parsePaymentStatus(formData.get("expectedPaymentStatus"));
  const expectedShippingStatus = parseShippingStatus(formData.get("expectedShippingStatus"));
  const requestedPaymentStatus = parsePaymentStatus(formData.get("requestedPaymentStatus"));
  const requestedShippingStatus = parseShippingStatus(formData.get("requestedShippingStatus"));
  const intent: AdminOrderStatusIntent = {
    changedFields,
    ...(expectedPaymentStatus ? { expectedPaymentStatus } : {}),
    ...(expectedShippingStatus ? { expectedShippingStatus } : {}),
    ...(requestedPaymentStatus ? { requestedPaymentStatus } : {}),
    ...(requestedShippingStatus ? { requestedShippingStatus } : {}),
  };

  if (!orderId) {
    throw new Error("Invalid order update payload");
  }
  assertValidAdminOrderStatusIntent(intent);

  await applyOrderStatusesUpdate(orderId, intent);

  revalidatePath("/admin");
  revalidatePath("/admin/ventas");
  redirect(redirectTo);
}

export async function retryOrderInventoryAction(orderIdInput: string) {
  await requireAdminSession();
  const orderId = String(orderIdInput || "").trim();
  if (!orderId) throw new Error("Pedido inválido.");

  const currentOrder = await getOrder(orderId);
  let inventoryStatus: Order["inventoryStatus"];

  if (currentOrder) {
    const updated = await retryPaidOrderInventory(orderId);
    if (!updated) throw new Error("Pedido no encontrado.");
    inventoryStatus = resolveOrderInventoryStatus(updated);
  } else {
    const sheetOrder = await getOrderRowById(orderId);
    if (!sheetOrder) throw new Error("Pedido no encontrado.");
    if (sheetOrder.paymentStatus !== "confirmed") {
      throw new Error("El inventario solo puede reintentarse para un pago confirmado.");
    }

    const fallbackOrder = buildFallbackOrderFromSheet(
      sheetOrder,
      sheetOrder.paymentStatus,
      sheetOrder.shippingStatus
    );

    if (resolveOrderInventoryStatus(fallbackOrder) === "deducted") {
      inventoryStatus = "deducted";
    } else {
      const { patch } = await inventoryPatchFromAttempt(fallbackOrder);
      const shouldResetInvalidCompletion =
        fallbackOrder.shippingStatus === "completed" &&
        !isTrustedHistoricalCompletion(fallbackOrder);
      await updateOrderRowInSalesSheet(orderId, {
        inventoryStatus: patch.inventoryStatus ?? null,
        inventoryIssueCode: patch.inventoryIssueCode ?? null,
        inventoryIssueAt: patch.inventoryIssueAt ?? null,
        stockDeductedAt: patch.stockDeductedAt,
        ...(shouldResetInvalidCompletion ? { shippingStatus: "in_process" } : {}),
        updatedAt: Date.now(),
      });
      inventoryStatus = patch.inventoryStatus;
    }
  }

  revalidatePath("/admin");
  revalidatePath("/admin/ventas");

  return {
    ok: inventoryStatus === "deducted",
    inventoryStatus,
    message:
      inventoryStatus === "deducted"
        ? "El inventario se descontó correctamente."
        : inventoryStatus === "conflict"
          ? "El inventario todavía presenta un conflicto."
          : "No se pudo completar la actualización de inventario.",
  };
}

export async function saveOrderStatusesBatchAction(
  updates: AdminOrderUpdateInput[]
) {
  await requireAdminSession();

  if (!Array.isArray(updates)) {
    throw new Error("Invalid batch order update payload");
  }

  const validated = updates.map((update) => {
    const orderId = String(update?.orderId || "").trim();
    const changedFields = Array.isArray(update?.changedFields)
      ? update.changedFields.map((field) => String(field)) as AdminStatusField[]
      : [];
    const intent: AdminOrderStatusIntent = {
      changedFields,
      ...(Object.prototype.hasOwnProperty.call(update || {}, "expectedPaymentStatus")
        ? { expectedPaymentStatus: update.expectedPaymentStatus }
        : {}),
      ...(Object.prototype.hasOwnProperty.call(update || {}, "expectedShippingStatus")
        ? { expectedShippingStatus: update.expectedShippingStatus }
        : {}),
      ...(Object.prototype.hasOwnProperty.call(update || {}, "requestedPaymentStatus")
        ? { requestedPaymentStatus: update.requestedPaymentStatus }
        : {}),
      ...(Object.prototype.hasOwnProperty.call(update || {}, "requestedShippingStatus")
        ? { requestedShippingStatus: update.requestedShippingStatus }
        : {}),
    };
    if (
      !orderId ||
      ("expectedPaymentStatus" in intent && !isPaymentStatus(String(intent.expectedPaymentStatus))) ||
      ("requestedPaymentStatus" in intent && !isPaymentStatus(String(intent.requestedPaymentStatus))) ||
      ("expectedShippingStatus" in intent && !isShippingStatus(String(intent.expectedShippingStatus))) ||
      ("requestedShippingStatus" in intent && !isShippingStatus(String(intent.requestedShippingStatus)))
    ) {
      throw new Error("Invalid batch order update payload");
    }
    assertValidAdminOrderStatusIntent(intent);
    return { orderId, intent };
  });

  const seenOrderIds = new Set<string>();
  for (const update of validated) {
    if (seenOrderIds.has(update.orderId)) {
      throw new Error("El lote contiene pedidos duplicados. No se guardó ningún cambio.");
    }
    seenOrderIds.add(update.orderId);
  }

  const results: AdminOrderUpdateResult[] = [];
  for (const update of validated) {
    try {
      results.push(await applyOrderStatusesUpdate(update.orderId, update.intent));
    } catch (error) {
      if (error instanceof AdminOrderStateChangedError) {
        results.push({
          orderId: update.orderId,
          status: "conflict",
          code: ADMIN_ORDER_STATE_CHANGED,
          message: ADMIN_ORDER_STATE_CHANGED_MESSAGE,
          paymentStatus: error.current.paymentStatus,
          shippingStatus: error.current.shippingStatus,
          shippingBlocked: false,
        });
        continue;
      }

      let currentOrder: Order | null = null;
      let sheetOrder: AdminOrderSheetRow | null = null;
      try {
        currentOrder = await getOrder(update.orderId);
        if (!currentOrder) sheetOrder = await getOrderRowById(update.orderId);
      } catch {
        // The original per-Order failure is the authoritative outcome.
      }
      const fallbackPayment = update.intent.requestedPaymentStatus ??
        update.intent.expectedPaymentStatus ?? "pending";
      const fallbackShipping = update.intent.requestedShippingStatus ??
        update.intent.expectedShippingStatus ?? "in_process";
      const paymentStatus = currentOrder?.paymentStatus ?? sheetOrder?.paymentStatus ?? fallbackPayment;
      const shippingStatus = currentOrder?.shippingStatus ?? sheetOrder?.shippingStatus ?? fallbackShipping;
      const inventoryStatus = currentOrder?.inventoryStatus ?? sheetOrder?.inventoryStatus;

      if (error instanceof PaymentTransitionBlockedError) {
        results.push({
          orderId: update.orderId,
          status: "business_block",
          paymentStatus,
          inventoryStatus,
          shippingStatus,
          shippingBlocked: false,
          paymentBlocked: true,
          paymentBlockReason: error.reason,
          paymentBlockMessage: getPaymentTransitionBlockMessage(error.reason),
        });
        continue;
      }

      results.push({
        orderId: update.orderId,
        status: "failure",
        paymentStatus,
        inventoryStatus,
        shippingStatus,
        shippingBlocked: false,
        message: "No se pudo guardar este pedido. Revisá el estado actual e intentá nuevamente.",
      });
    }
  }

  revalidatePath("/admin");
  revalidatePath("/admin/ventas");

  return { ok: results.every((result) => result.status === "success"), results };
}

export async function updateCatalogProductAction(formData: FormData) {
  await requireAdminSession();

  const productId = String(formData.get("productId") || "").trim();
  const name = String(formData.get("name") || "").trim();
  const priceRaw = String(formData.get("price") || "").trim();
  const active = formData.get("active") === "on";
  const shortDescription = String(formData.get("shortDescription") || "").trim();
  const description = String(formData.get("description") || "").trim();
  const productType = parseCatalogProductType(formData.get("productType"));
  const isKit = productType === "KIT";
  const includes = isKit ? parseStringList(formData.get("includes")) : [];
  const images = parseStringList(formData.get("images"));
  const isNew = String(formData.get("isNew") || "").toLowerCase() === "true";
  const isFeatured = String(formData.get("isFeatured") || "").toLowerCase() === "true";
  const stockQty = parseOptionalStockQty(formData.get("stockQty"));
  const redirectTo = resolveAdminRedirectPath(formData.get("redirectTo"), "/admin/productos");

  const price = Number(priceRaw.replace(",", "."));

  if (!productId || !name || !Number.isFinite(price) || price < 0) {
    throw new Error("Invalid product update payload");
  }

  await updateProductRowInSheet(productId, {
    name,
    price,
    active,
    shortDescription,
    description,
    includes,
    images,
    isNew,
    isFeatured,
    productType,
    stockQty,
  });

  await invalidateProductsCatalogCache();
  revalidatePath("/admin");
  revalidatePath("/admin/productos");
  redirect(redirectTo);
}
