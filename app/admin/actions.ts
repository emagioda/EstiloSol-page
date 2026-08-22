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
  assertAdminPaymentTransitionRequest,
  getOrder,
  markApproved,
  retryPaidOrderInventory,
  updateOrder,
} from "@/src/server/orders/store";
import {
  attemptInventoryForPaidOrder,
  inventoryResultToOrderPatch,
  resolveOrderInventoryStatus,
  shouldAttemptInventoryAutomatically,
  type InventoryAttemptResult,
} from "@/src/server/orders/inventory";
import {
  evaluateFulfillmentCompletion,
  FulfillmentCompletionBlockedError,
  getFulfillmentCompletionBlockMessage,
  isTrustedHistoricalCompletion,
  type FulfillmentCompletionBlockReason,
} from "@/src/server/orders/fulfillmentCompletion";
import type { Order, OrderPaymentStatus, OrderShippingStatus, OrderStatus } from "@/src/server/orders/types";
import {
  evaluateAdminPaymentTransitionRequest,
  getPaymentTransitionBlockMessage,
  PAYMENT_TRANSITION_BLOCK_REASONS,
  PaymentTransitionBlockedError,
  type PaymentTransitionBlockReason,
} from "@/src/server/orders/paymentTransition";
import {
  parseFallbackOrderFulfillment,
  parseFallbackOrderItems,
} from "@/src/server/orders/sheetFallback";
import {
  fetchPaymentByIdFromMp,
  searchPaymentsByExternalReference,
} from "@/src/server/payments/mpClient";
import {
  amountMatches,
  type MpPaymentResponse,
  type MpSearchPayment,
} from "@/src/server/payments/shared";
import { reconcileMercadoPagoPayment } from "@/src/server/payments/reconciliation";
import {
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

type MpPaymentForValidation = MpPaymentResponse | MpSearchPayment;

const isApprovedMpPaymentForOrder = (
  payment: MpPaymentForValidation | null,
  externalReference: string,
  expectedTotal: number
) => {
  if (!payment) return false;
  const status = String(payment.status || "").trim().toLowerCase();
  const paymentRef = String(payment.external_reference || "").trim();
  const currency = String(payment.currency_id || "").trim().toUpperCase();
  const amount = Number(payment.transaction_amount);

  return (
    status === "approved" &&
    paymentRef === externalReference &&
    currency === "ARS" &&
    Number.isFinite(amount) &&
    amountMatches(amount, expectedTotal)
  );
};

const assertMercadoPagoApproval = async (
  externalReference: string,
  expectedTotal: number,
  paymentId?: string
): Promise<{
  payment: MpPaymentForValidation;
  source: "verify_payment_id" | "verify_search";
  fallbackPaymentId?: string;
}> => {
  let accessToken: string;
  try {
    accessToken = env.getRequiredServer("MP_ACCESS_TOKEN");
  } catch {
    throw new PaymentTransitionBlockedError(
      PAYMENT_TRANSITION_BLOCK_REASONS.providerAuthorityRequired
    );
  }
  const normalizedPaymentId = String(paymentId || "").trim();

  if (normalizedPaymentId && /^\d+$/.test(normalizedPaymentId)) {
    try {
      const { response, data } = await fetchPaymentByIdFromMp(normalizedPaymentId, accessToken);
      if (response.ok && data && isApprovedMpPaymentForOrder(data, externalReference, expectedTotal)) {
        return {
          payment: data,
          source: "verify_payment_id",
          fallbackPaymentId: normalizedPaymentId,
        };
      }
    } catch {
      // Search by exact external reference below before failing closed.
    }
  }

  let searchResult: Awaited<ReturnType<typeof searchPaymentsByExternalReference>>;
  try {
    searchResult = await searchPaymentsByExternalReference(externalReference, accessToken);
  } catch {
    throw new PaymentTransitionBlockedError(
      PAYMENT_TRANSITION_BLOCK_REASONS.providerAuthorityRequired
    );
  }
  const { response, data } = searchResult;
  if (!response.ok || !data) {
    throw new PaymentTransitionBlockedError(
      PAYMENT_TRANSITION_BLOCK_REASONS.providerAuthorityRequired
    );
  }

  const approvedPayment = (data.results || []).find((payment) =>
    isApprovedMpPaymentForOrder(payment, externalReference, expectedTotal)
  );
  if (approvedPayment) {
    return {
      payment: approvedPayment,
      source: "verify_search",
      fallbackPaymentId: String(approvedPayment.id || normalizedPaymentId),
    };
  }
  throw new PaymentTransitionBlockedError(
    PAYMENT_TRANSITION_BLOCK_REASONS.mercadoPagoNotApproved
  );
};

const buildFallbackOrderFromSheet = (
  sheetOrder: AdminOrderSheetRow,
  paymentStatus: OrderPaymentStatus,
  shippingStatus: OrderShippingStatus
): Order => {
  const raw = sheetOrder.raw as Record<string, unknown>;
  const items = parseFallbackOrderItems(raw, sheetOrder.items);
  const mpPaymentId =
    typeof raw.mp_payment_id === "string" && raw.mp_payment_id.trim() ? raw.mp_payment_id.trim() : undefined;
  const mpStatus =
    typeof raw.mp_status === "string" && raw.mp_status.trim()
      ? raw.mp_status.trim()
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
    customer: {
      ...(sheetOrder.customerName ? { name: sheetOrder.customerName } : {}),
      ...(sheetOrder.whatsapp ? { phone: sheetOrder.whatsapp } : {}),
      ...(sheetOrder.email ? { email: sheetOrder.email } : {}),
    },
  };
};

type AdminOrderUpdateResult = {
  orderId: string;
  inventoryStatus?: Order["inventoryStatus"];
  shippingStatus: OrderShippingStatus;
  shippingBlocked: boolean;
  paymentBlocked?: boolean;
  paymentBlockReason?: PaymentTransitionBlockReason;
  paymentBlockMessage?: string;
  completionBlockReason?: FulfillmentCompletionBlockReason;
  completionBlockMessage?: string;
};

const completionBlockFields = (reason: FulfillmentCompletionBlockReason) => ({
  shippingBlocked: true,
  completionBlockReason: reason,
  completionBlockMessage: getFulfillmentCompletionBlockMessage(reason),
});

const persistRequestedShippingStatus = async ({
  orderId,
  previousOrder,
  currentOrder,
  requestedShippingStatus,
}: {
  orderId: string;
  previousOrder: Order;
  currentOrder: Order;
  requestedShippingStatus: OrderShippingStatus;
}): Promise<{
  order: Order;
  shippingBlocked: boolean;
  completionBlockReason?: FulfillmentCompletionBlockReason;
  completionBlockMessage?: string;
}> => {
  if (isTrustedHistoricalCompletion(previousOrder)) {
    return { order: currentOrder, shippingBlocked: false };
  }

  if (requestedShippingStatus === "in_process") {
    const order =
      currentOrder.shippingStatus === "in_process"
        ? currentOrder
        : (await updateOrder(orderId, { shippingStatus: "in_process" })) ?? currentOrder;
    return { order, shippingBlocked: false };
  }

  const completionDecision = evaluateFulfillmentCompletion({
    ...currentOrder,
    shippingStatus: "completed",
  });
  if (!completionDecision.allowed) {
    const order =
      currentOrder.shippingStatus === "in_process"
        ? currentOrder
        : (await updateOrder(orderId, { shippingStatus: "in_process" })) ?? currentOrder;
    return { order, ...completionBlockFields(completionDecision.reason) };
  }

  try {
    const order =
      currentOrder.shippingStatus === "completed"
        ? currentOrder
        : (await updateOrder(orderId, { shippingStatus: "completed" })) ?? currentOrder;
    return { order, shippingBlocked: false };
  } catch (error) {
    if (!(error instanceof FulfillmentCompletionBlockedError)) throw error;
    const newestOrder = (await getOrder(orderId)) ?? currentOrder;
    return { order: newestOrder, ...completionBlockFields(error.reason) };
  }
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

const shippingResultFields = (result: Awaited<ReturnType<typeof persistRequestedShippingStatus>>) => ({
  shippingStatus: result.order.shippingStatus,
  shippingBlocked: result.shippingBlocked,
  ...(result.completionBlockReason
    ? {
        completionBlockReason: result.completionBlockReason,
        completionBlockMessage: result.completionBlockMessage,
      }
    : {}),
});

const persistFallbackShippingStatus = async ({
  order,
  requestedShippingStatus,
  persist = true,
}: {
  order: Order;
  requestedShippingStatus: OrderShippingStatus;
  persist?: boolean;
}): Promise<Awaited<ReturnType<typeof persistRequestedShippingStatus>>> => {
  if (isTrustedHistoricalCompletion(order)) {
    return { order, shippingBlocked: false };
  }

  const completionDecision =
    requestedShippingStatus === "completed"
      ? evaluateFulfillmentCompletion({ ...order, shippingStatus: "completed" })
      : { allowed: true as const };
  const completionBlockReason = completionDecision.allowed
    ? undefined
    : completionDecision.reason;
  const shippingStatus = completionBlockReason ? "in_process" : requestedShippingStatus;
  if (shippingStatus === order.shippingStatus) {
    return {
      order,
      ...(completionBlockReason
        ? completionBlockFields(completionBlockReason)
        : { shippingBlocked: false }),
    };
  }

  const updatedAt = Date.now();
  if (persist) {
    await updateOrderRowInSalesSheet(order.externalReference, {
      shippingStatus,
      updatedAt,
    });
  }
  return {
    order: { ...order, shippingStatus, updatedAt },
    ...(completionBlockReason
      ? completionBlockFields(completionBlockReason)
      : { shippingBlocked: false }),
  };
};

const reconcileVerifiedMercadoPagoApproval = async (order: Order): Promise<Order> => {
  const verified = await assertMercadoPagoApproval(
    order.externalReference,
    order.total,
    order.mpPaymentId
  );
  let reconciliation: Awaited<ReturnType<typeof reconcileMercadoPagoPayment>>;
  try {
    reconciliation = await reconcileMercadoPagoPayment({
      externalReference: order.externalReference,
      payment: verified.payment,
      source: verified.source,
      fallbackPaymentId: verified.fallbackPaymentId,
    });
  } catch {
    throw new PaymentTransitionBlockedError(
      PAYMENT_TRANSITION_BLOCK_REASONS.providerAuthorityRequired
    );
  }

  if (reconciliation.outcome !== "reconciled") {
    throw new PaymentTransitionBlockedError(
      PAYMENT_TRANSITION_BLOCK_REASONS.providerAuthorityRequired
    );
  }
  if (reconciliation.order.paymentStatus !== "confirmed") {
    throw new PaymentTransitionBlockedError(
      PAYMENT_TRANSITION_BLOCK_REASONS.terminalRequiresCorrection
    );
  }
  return reconciliation.order;
};

const applySheetFallbackOrderStatusesUpdate = async ({
  orderId,
  paymentStatus,
  shippingStatus,
}: {
  orderId: string;
  paymentStatus: OrderPaymentStatus;
  shippingStatus: OrderShippingStatus;
}): Promise<AdminOrderUpdateResult> => {
  const sheetOrder = await getOrderRowById(orderId);
  if (!sheetOrder) throw new Error("Pedido no encontrado.");

  const currentOrder = buildFallbackOrderFromSheet(
    sheetOrder,
    sheetOrder.paymentStatus,
    sheetOrder.shippingStatus
  );
  const decision = evaluateAdminPaymentTransitionRequest({
    current: currentOrder.paymentStatus,
    requested: paymentStatus,
    paymentMethod: currentOrder.paymentMethod,
  });
  if (!decision.allowed) throw new PaymentTransitionBlockedError(decision.reason);

  if (decision.replay) {
    const shippingResult = await persistFallbackShippingStatus({
      order: currentOrder,
      requestedShippingStatus: shippingStatus,
    });
    return {
      orderId,
      inventoryStatus: resolveOrderInventoryStatus(shippingResult.order),
      ...shippingResultFields(shippingResult),
    };
  }

  if (decision.authority === "mp_authoritative") {
    const reconciledOrder = await reconcileVerifiedMercadoPagoApproval(currentOrder);
    const shippingResult = await persistRequestedShippingStatus({
      orderId,
      previousOrder: currentOrder,
      currentOrder: reconciledOrder,
      requestedShippingStatus: shippingStatus,
    });
    return {
      orderId,
      inventoryStatus: resolveOrderInventoryStatus(shippingResult.order),
      ...shippingResultFields(shippingResult),
    };
  }

  const approvedAt = Date.now();
  const paymentId = currentOrder.mpPaymentId || `manual-${approvedAt}`;
  const confirmationOrder: Order = {
    ...currentOrder,
    status: "approved",
    paymentStatus: "confirmed",
    mpPaymentId: paymentId,
    mpStatus: "manual_confirmed",
    approvedAt,
  };
  let inventoryAttempt: InventoryAttemptResult | null = null;
  let inventoryPatch: Partial<Order> = {};
  if (shouldAttemptInventoryAutomatically(confirmationOrder)) {
    const attempted = await inventoryPatchFromAttempt(confirmationOrder);
    inventoryAttempt = attempted.result;
    inventoryPatch = attempted.patch;
  }
  const paidOrder = { ...confirmationOrder, ...inventoryPatch };
  const shippingResult = await persistFallbackShippingStatus({
    order: paidOrder,
    requestedShippingStatus: shippingStatus,
    persist: false,
  });

  await updateOrderRowInSalesSheet(orderId, {
    paymentStatus: "confirmed",
    shippingStatus: shippingResult.order.shippingStatus,
    orderStatus: "approved",
    mpStatus: "manual_confirmed",
    mpPaymentId: paymentId,
    approvedAt,
    receiptOutboxVersion: 1,
    ...(inventoryAttempt
      ? {
          inventoryStatus: inventoryPatch.inventoryStatus ?? null,
          inventoryIssueCode: inventoryPatch.inventoryIssueCode ?? null,
          inventoryIssueAt: inventoryPatch.inventoryIssueAt ?? null,
          stockDeductedAt: inventoryPatch.stockDeductedAt,
        }
      : {}),
    updatedAt: Date.now(),
  });

  if (!sheetOrder.receiptEmailSentAt) {
    await ensurePurchaseReceiptEventSafely({
      order: shippingResult.order,
      paymentId,
      approvedAt,
    });
  }
  return {
    orderId,
    inventoryStatus: resolveOrderInventoryStatus(shippingResult.order),
    ...shippingResultFields(shippingResult),
  };
};

const applyOrderStatusesUpdate = async ({
  orderId,
  paymentStatus,
  shippingStatus,
}: {
  orderId: string;
  paymentStatus: OrderPaymentStatus;
  shippingStatus: OrderShippingStatus;
}): Promise<AdminOrderUpdateResult> => {
  const lockedRequest = await assertAdminPaymentTransitionRequest(orderId, paymentStatus);
  if (!lockedRequest) {
    return applySheetFallbackOrderStatusesUpdate({ orderId, paymentStatus, shippingStatus });
  }
  const currentOrder = lockedRequest.order;

  if (lockedRequest.decision.replay) {
    const shippingResult = await persistRequestedShippingStatus({
      orderId,
      previousOrder: currentOrder,
      currentOrder,
      requestedShippingStatus: shippingStatus,
    });
    return {
      orderId,
      inventoryStatus: resolveOrderInventoryStatus(shippingResult.order),
      ...shippingResultFields(shippingResult),
    };
  }

  if (lockedRequest.decision.authority === "mp_authoritative") {
    const reconciledOrder = await reconcileVerifiedMercadoPagoApproval(currentOrder);
    const shippingResult = await persistRequestedShippingStatus({
      orderId,
      previousOrder: currentOrder,
      currentOrder: reconciledOrder,
      requestedShippingStatus: shippingStatus,
    });
    return {
      orderId,
      inventoryStatus: resolveOrderInventoryStatus(shippingResult.order),
      ...shippingResultFields(shippingResult),
    };
  }

  const approvedAt = Date.now();
  const paymentId = currentOrder.mpPaymentId || `manual-${approvedAt}`;
  const approvedOrder = await markApproved(
    orderId,
    { paymentId, mpStatus: "manual_confirmed", approvedAt },
    "admin_manual"
  );
  if (!approvedOrder || approvedOrder.paymentStatus !== "confirmed") {
    throw new Error("No se pudo persistir la confirmación del pago.");
  }
  const shippingResult = await persistRequestedShippingStatus({
    orderId,
    previousOrder: currentOrder,
    currentOrder: approvedOrder,
    requestedShippingStatus: shippingStatus,
  });
  if (!currentOrder.receiptEmailSentAt) {
    await ensurePurchaseReceiptEventSafely({
      order: shippingResult.order,
      paymentId,
      approvedAt,
    });
  }
  return {
    orderId,
    inventoryStatus: resolveOrderInventoryStatus(shippingResult.order),
    ...shippingResultFields(shippingResult),
  };
};

export async function updateOrderStatusesAction(formData: FormData) {
  await requireAdminSession();

  const orderId = String(formData.get("orderId") || "").trim();
  const paymentStatus = parsePaymentStatus(formData.get("paymentStatus"));
  const shippingStatus = parseShippingStatus(formData.get("shippingStatus"));
  const redirectTo = resolveAdminRedirectPath(formData.get("redirectTo"), "/admin/ventas");

  if (!orderId || !paymentStatus || !shippingStatus) {
    throw new Error("Invalid order update payload");
  }

  await applyOrderStatusesUpdate({
    orderId,
    paymentStatus,
    shippingStatus,
  });

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
  updates: Array<{
    orderId: string;
    paymentStatus: string;
    shippingStatus: string;
  }>
) {
  await requireAdminSession();

  if (!Array.isArray(updates)) {
    throw new Error("Invalid batch order update payload");
  }

  const results: AdminOrderUpdateResult[] = [];
  for (const update of updates) {
    const orderId = String(update?.orderId || "").trim();
    const paymentStatusRaw = String(update?.paymentStatus || "");
    const shippingStatusRaw = String(update?.shippingStatus || "");

    if (!orderId || !isPaymentStatus(paymentStatusRaw) || !isShippingStatus(shippingStatusRaw)) {
      throw new Error("Invalid batch order update payload");
    }

    try {
      results.push(await applyOrderStatusesUpdate({
        orderId,
        paymentStatus: paymentStatusRaw,
        shippingStatus: shippingStatusRaw,
      }));
    } catch (error) {
      if (!(error instanceof PaymentTransitionBlockedError)) throw error;
      const currentOrder = await getOrder(orderId);
      const sheetOrder = currentOrder ? null : await getOrderRowById(orderId);
      results.push({
        orderId,
        inventoryStatus: currentOrder?.inventoryStatus ?? sheetOrder?.inventoryStatus,
        shippingStatus:
          currentOrder?.shippingStatus ?? sheetOrder?.shippingStatus ?? shippingStatusRaw,
        shippingBlocked: false,
        paymentBlocked: true,
        paymentBlockReason: error.reason,
        paymentBlockMessage: getPaymentTransitionBlockMessage(error.reason),
      });
    }
  }

  revalidatePath("/admin");
  revalidatePath("/admin/ventas");

  return { ok: results.every((result) => !result.paymentBlocked), results };
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
