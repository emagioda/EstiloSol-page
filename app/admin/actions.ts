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
  getOrder,
  markApproved,
  markTerminalPaymentState,
  retryPaidOrderInventory,
  updateOrder,
} from "@/src/server/orders/store";
import {
  attemptInventoryForPaidOrder,
  inventoryResultToOrderPatch,
  isInventoryBlockingShipping,
  resolveOrderInventoryStatus,
  shouldAttemptInventoryAutomatically,
  type InventoryAttemptResult,
} from "@/src/server/orders/inventory";
import type { Order, OrderPaymentStatus, OrderShippingStatus, OrderStatus } from "@/src/server/orders/types";
import { parseFallbackOrderItems } from "@/src/server/orders/sheetFallback";
import {
  fetchPaymentByIdFromMp,
  searchPaymentsByExternalReference,
} from "@/src/server/payments/mpClient";
import {
  amountMatches,
  terminalOrderStatusFromMpStatus,
  type MpPaymentResponse,
  type MpSearchPayment,
} from "@/src/server/payments/shared";
import {
  getOrderRowById,
  updateOrderRowInSalesSheet,
  updateProductRowInSheet,
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

const terminalOrderStatusFromPaymentStatus = (
  paymentStatus: OrderPaymentStatus
): Extract<OrderStatus, "cancelled" | "refunded" | "charged_back"> | null => {
  if (paymentStatus === "cancelled") return "cancelled";
  if (paymentStatus === "refunded") return "refunded";
  if (paymentStatus === "charged_back") return "charged_back";
  return null;
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
): Promise<{ paymentId: string; mpStatus: string }> => {
  const accessToken = env.getRequiredServer("MP_ACCESS_TOKEN");
  const normalizedPaymentId = String(paymentId || "").trim();

  if (normalizedPaymentId && /^\d+$/.test(normalizedPaymentId)) {
    const { response, data } = await fetchPaymentByIdFromMp(normalizedPaymentId, accessToken);
    if (!response.ok || !data) {
      throw new Error("No se pudo verificar el pago en Mercado Pago.");
    }
    const mpStatus = String(data.status || "").trim().toLowerCase();
    const terminalStatus = terminalOrderStatusFromMpStatus(mpStatus);
    if (terminalStatus) {
      throw new Error(`Mercado Pago informa estado final no aprobable: ${mpStatus}.`);
    }
    if (isApprovedMpPaymentForOrder(data, externalReference, expectedTotal)) {
      return { paymentId: String(data.id || normalizedPaymentId), mpStatus };
    }
  }

  const { response, data } = await searchPaymentsByExternalReference(externalReference, accessToken);
  if (!response.ok || !data) {
    throw new Error("No se pudo buscar el pago en Mercado Pago.");
  }

  const approvedPayment = (data.results || []).find((payment) =>
    isApprovedMpPaymentForOrder(payment, externalReference, expectedTotal)
  );
  if (approvedPayment) {
    return {
      paymentId: String(approvedPayment.id || normalizedPaymentId),
      mpStatus: String(approvedPayment.status || "approved").trim().toLowerCase(),
    };
  }

  const terminalPayment = (data.results || []).find((payment) =>
    terminalOrderStatusFromMpStatus(String(payment.status || ""))
  );
  if (terminalPayment) {
    throw new Error(
      `Mercado Pago informa estado final no aprobable: ${String(terminalPayment.status || "desconocido")}.`
    );
  }

  throw new Error("Mercado Pago no confirma un pago aprobado para esta orden.");
};

const buildFallbackOrderFromSheet = async (
  orderId: string,
  paymentStatus: OrderPaymentStatus,
  shippingStatus: OrderShippingStatus
): Promise<Order | null> => {
  const sheetOrder = await getOrderRowById(orderId);
  if (!sheetOrder) return null;

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

const applyOrderStatusesUpdate = async ({
  orderId,
  paymentStatus,
  shippingStatus,
}: {
  orderId: string;
  paymentStatus: OrderPaymentStatus;
  shippingStatus: OrderShippingStatus;
}): Promise<AdminOrderUpdateResult> => {
  const currentOrder = await getOrder(orderId);

  if (!currentOrder) {
    const sheetOrder = await getOrderRowById(orderId);
    if (!sheetOrder) {
      throw new Error("Pedido no encontrado.");
    }

    const fallbackOrder = await buildFallbackOrderFromSheet(orderId, paymentStatus, shippingStatus);
    if (!fallbackOrder) {
      throw new Error("No se pudo reconstruir el pedido desde Google Sheets.");
    }

    const wasConfirmed = sheetOrder.paymentStatus === "confirmed";
    const wasInventoryBlocked = isInventoryBlockingShipping(fallbackOrder);
    if (shippingStatus === "completed" && wasInventoryBlocked && wasConfirmed) {
      throw new Error("No se puede finalizar la entrega mientras el inventario requiere atención.");
    }

    let verifiedPaymentId = fallbackOrder.mpPaymentId;
    let verifiedMpStatus = fallbackOrder.mpStatus;
    let inventoryAttempt: InventoryAttemptResult | null = null;
    let inventoryPatch: Partial<Order> = {};

    if (paymentStatus === "confirmed") {
      if (fallbackOrder.paymentMethod === "mercadopago" && !wasConfirmed) {
        const verified = await assertMercadoPagoApproval(
          fallbackOrder.externalReference,
          fallbackOrder.total,
          fallbackOrder.mpPaymentId
        );
        verifiedPaymentId = verified.paymentId;
        verifiedMpStatus = verified.mpStatus;
      }

      const isFirstApprovalAttempt = !wasConfirmed || fallbackOrder.inventoryStatus === "pending";
      if (isFirstApprovalAttempt && shouldAttemptInventoryAutomatically(fallbackOrder)) {
        const attempted = await inventoryPatchFromAttempt(fallbackOrder);
        inventoryAttempt = attempted.result;
        inventoryPatch = attempted.patch;
      }
    }

    const resolvedFallbackOrder = { ...fallbackOrder, ...inventoryPatch };
    const shippingBlocked =
      shippingStatus === "completed" && isInventoryBlockingShipping(resolvedFallbackOrder);
    const resolvedShippingStatus = shippingBlocked ? "in_process" : shippingStatus;

    const approvedAt = paymentStatus === "confirmed" && !wasConfirmed ? Date.now() : null;
    await updateOrderRowInSalesSheet(orderId, {
      paymentStatus,
      shippingStatus: resolvedShippingStatus,
      orderStatus: orderStatusFromPaymentStatus(paymentStatus),
      ...(verifiedMpStatus ? { mpStatus: verifiedMpStatus } : {}),
      ...(verifiedPaymentId ? { mpPaymentId: verifiedPaymentId } : {}),
      ...(approvedAt ? { approvedAt } : {}),
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

    if (paymentStatus === "confirmed" && !wasConfirmed && !sheetOrder.receiptEmailSentAt) {
      const paymentId =
        fallbackOrder.paymentMethod === "mercadopago"
          ? verifiedPaymentId
          : verifiedPaymentId || `manual-${approvedAt!}`;
      if (paymentId && approvedAt) {
        await ensurePurchaseReceiptEventSafely({
          order: {
            ...resolvedFallbackOrder,
            paymentStatus: "confirmed",
            shippingStatus: resolvedShippingStatus,
            approvedAt,
            mpPaymentId: paymentId,
          },
          paymentId,
          approvedAt,
        });
      }
    }
    return {
      orderId,
      inventoryStatus: resolveOrderInventoryStatus(resolvedFallbackOrder),
      shippingStatus: resolvedShippingStatus,
      shippingBlocked,
    };
  }

  const wasConfirmed = currentOrder.paymentStatus === "confirmed";
  if (
    shippingStatus === "completed" &&
    isInventoryBlockingShipping(currentOrder) &&
    wasConfirmed
  ) {
    throw new Error("No se puede finalizar la entrega mientras el inventario requiere atención.");
  }

  if (paymentStatus === "confirmed") {
    const approvedAt = wasConfirmed ? currentOrder.approvedAt ?? Date.now() : Date.now();
    let paymentId = currentOrder.mpPaymentId || `manual-${approvedAt}`;
    let mpStatus = currentOrder.mpStatus || "manual_confirmed";

    if (
      currentOrder.paymentMethod === "mercadopago" &&
      (!wasConfirmed || !currentOrder.mpPaymentId || currentOrder.mpPaymentId.startsWith("manual-"))
    ) {
      const verified = await assertMercadoPagoApproval(
        currentOrder.externalReference,
        currentOrder.total,
        currentOrder.mpPaymentId
      );
      paymentId = verified.paymentId;
      mpStatus = verified.mpStatus;
    }

    const needsApprovalProcessing = !wasConfirmed || currentOrder.inventoryStatus === "pending";
    const approvedOrder = needsApprovalProcessing
      ? await markApproved(orderId, {
          paymentId,
          mpStatus,
          approvedAt,
        })
      : currentOrder;
    if (!approvedOrder || approvedOrder.paymentStatus !== "confirmed") {
      throw new Error("No se pudo persistir la confirmación del pago.");
    }

    const shippingBlocked =
      shippingStatus === "completed" && isInventoryBlockingShipping(approvedOrder);
    const resolvedShippingStatus = shippingBlocked ? "in_process" : shippingStatus;
    if (resolvedShippingStatus !== approvedOrder.shippingStatus) {
      await updateOrder(orderId, { shippingStatus: resolvedShippingStatus });
    }

    if (!wasConfirmed && !currentOrder.receiptEmailSentAt) {
      await ensurePurchaseReceiptEventSafely({
        order: {
          ...currentOrder,
          paymentStatus: "confirmed",
          approvedAt,
          mpPaymentId: paymentId,
        },
        paymentId,
        approvedAt,
      });
    }
    return {
      orderId,
      inventoryStatus: resolveOrderInventoryStatus(approvedOrder),
      shippingStatus: resolvedShippingStatus,
      shippingBlocked,
    };
  }

  if (shippingStatus === "completed" && isInventoryBlockingShipping(currentOrder)) {
    throw new Error("No se puede finalizar la entrega mientras el inventario requiere atención.");
  }

  const terminalStatus = terminalOrderStatusFromPaymentStatus(paymentStatus);
  if (terminalStatus) {
    await markTerminalPaymentState(orderId, {
      status: terminalStatus,
      paymentId: currentOrder.mpPaymentId,
      mpStatus: currentOrder.mpStatus || terminalStatus,
    });
    if (shippingStatus !== currentOrder.shippingStatus) {
      await updateOrder(orderId, { shippingStatus });
    }
    return {
      orderId,
      inventoryStatus: resolveOrderInventoryStatus(currentOrder),
      shippingStatus,
      shippingBlocked: false,
    };
  }

  await updateOrder(orderId, {
    paymentStatus,
    shippingStatus,
    status: "pending",
    mpStatus: "pending",
  });
  return {
    orderId,
    inventoryStatus: resolveOrderInventoryStatus(currentOrder),
    shippingStatus,
    shippingBlocked: false,
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

    const fallbackOrder = await buildFallbackOrderFromSheet(
      orderId,
      sheetOrder.paymentStatus,
      sheetOrder.shippingStatus
    );
    if (!fallbackOrder) throw new Error("No se pudo reconstruir el pedido desde Google Sheets.");

    if (resolveOrderInventoryStatus(fallbackOrder) === "deducted") {
      inventoryStatus = "deducted";
    } else {
      const { patch } = await inventoryPatchFromAttempt(fallbackOrder);
      await updateOrderRowInSalesSheet(orderId, {
        inventoryStatus: patch.inventoryStatus ?? null,
        inventoryIssueCode: patch.inventoryIssueCode ?? null,
        inventoryIssueAt: patch.inventoryIssueAt ?? null,
        stockDeductedAt: patch.stockDeductedAt,
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

    results.push(await applyOrderStatusesUpdate({
      orderId,
      paymentStatus: paymentStatusRaw,
      shippingStatus: shippingStatusRaw,
    }));
  }

  revalidatePath("/admin");
  revalidatePath("/admin/ventas");

  return { ok: true, results };
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
