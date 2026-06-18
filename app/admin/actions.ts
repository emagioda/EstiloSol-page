"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getServerSession } from "next-auth";
import { env } from "@/src/config/env";
import { isAdminEmail } from "@/src/server/auth/adminEmail";
import { authOptions } from "@/src/server/auth/options";
import { invalidateProductsCatalogCache } from "@/src/server/catalog/getProducts";
import { sendOrderReceiptEmail } from "@/src/server/notifications/orderReceipt";
import { logEvent } from "@/src/server/observability/log";
import { trackBusinessEvent } from "@/src/server/observability/metrics";
import { getOrder, markApproved, markTerminalPaymentState, updateOrder } from "@/src/server/orders/store";
import type { Order, OrderItem, OrderPaymentStatus, OrderShippingStatus, OrderStatus } from "@/src/server/orders/types";
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
  type AdminOrderSheetRow,
  decrementProductsStockInSheet,
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

const rawStringValue = (raw: Record<string, unknown>, keys: string[]) => {
  for (const key of keys) {
    const value = raw[key];
    if (typeof value === "string" && value.trim()) return value.trim();
    if (typeof value === "number" && Number.isFinite(value)) return String(value);
  }
  return "";
};

const sheetOrderHasStockDeducted = (sheetOrder: AdminOrderSheetRow) => {
  const raw = sheetOrder.raw as Record<string, unknown>;
  return Boolean(
    rawStringValue(raw, [
      "stock_deducted_at",
      "stockDeductedAt",
      "stock_descontado_en",
      "stock_discounted_at",
    ])
  );
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

const decrementFallbackOrderStockIfNeeded = async (
  sheetOrder: AdminOrderSheetRow,
  order: Order
): Promise<number | null> => {
  if (sheetOrderHasStockDeducted(sheetOrder)) return null;

  const stockDeductedAt = Date.now();
  try {
    await decrementProductsStockInSheet(
      order.externalReference,
      order.items.map((item) => ({
        productId: item.productId,
        qty: item.qty,
        title: item.title,
      }))
    );
  } catch (error) {
    logEvent("error", "admin.fallback_stock_deduction_failed", {
      externalReference: order.externalReference,
      error,
    });
    await trackBusinessEvent("payment.stock_deduction_failed", {
      externalReference: order.externalReference,
      source: "admin_fallback_order",
    });
    return null;
  }

  try {
    await invalidateProductsCatalogCache();
  } catch (error) {
    logEvent("warn", "admin.catalog_cache_invalidation_failed", {
      externalReference: order.externalReference,
      error,
    });
  }

  return stockDeductedAt;
};

const parseOrderItemsFromSheetRaw = (raw: Record<string, unknown>): OrderItem[] => {
  const itemsRaw = raw.items_json;
  if (typeof itemsRaw !== "string" || !itemsRaw.trim()) return [];

  try {
    const parsed = JSON.parse(itemsRaw) as Array<Record<string, unknown>>;
    if (!Array.isArray(parsed)) return [];

    return parsed
      .map((item) => {
        const productId = String(item.productId ?? item.product_id ?? "").trim();
        const title = String(item.title ?? item.name ?? "").trim();
        const qty = Number(item.qty);
        const unitPrice = Number(item.unitPrice ?? item.unit_price);
        if (!productId || !title || !Number.isFinite(qty) || !Number.isFinite(unitPrice)) {
          return null;
        }
        return {
          productId,
          title,
          qty: Math.max(1, Math.trunc(qty)),
          unitPrice,
          currency: "ARS" as const,
        };
      })
      .filter((item): item is OrderItem => item !== null);
  } catch {
    return [];
  }
};

const buildFallbackOrderFromSheet = async (
  orderId: string,
  paymentStatus: OrderPaymentStatus,
  shippingStatus: OrderShippingStatus
): Promise<Order | null> => {
  const sheetOrder = await getOrderRowById(orderId);
  if (!sheetOrder) return null;

  const raw = sheetOrder.raw as Record<string, unknown>;
  const parsedItems = parseOrderItemsFromSheetRaw(raw);
  const items =
    parsedItems.length > 0
      ? parsedItems
      : sheetOrder.items.map((item) => ({
          productId: item.productId || item.title,
          title: item.title,
          qty: Math.max(1, Math.trunc(item.qty)),
          unitPrice: typeof item.unitPrice === "number" ? item.unitPrice : 0,
          currency: "ARS" as const,
        }));
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

const applyOrderStatusesUpdate = async ({
  orderId,
  paymentStatus,
  shippingStatus,
}: {
  orderId: string;
  paymentStatus: OrderPaymentStatus;
  shippingStatus: OrderShippingStatus;
}) => {
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

    let verifiedPaymentId = fallbackOrder.mpPaymentId;
    let verifiedMpStatus = fallbackOrder.mpStatus;
    let stockDeductedAt: number | null = null;

    if (paymentStatus === "confirmed") {
      if (fallbackOrder.paymentMethod === "mercadopago") {
        const verified = await assertMercadoPagoApproval(
          fallbackOrder.externalReference,
          fallbackOrder.total,
          fallbackOrder.mpPaymentId
        );
        verifiedPaymentId = verified.paymentId;
        verifiedMpStatus = verified.mpStatus;
      } else {
        stockDeductedAt = await decrementFallbackOrderStockIfNeeded(sheetOrder, fallbackOrder);
      }
    }

    await updateOrderRowInSalesSheet(orderId, {
      paymentStatus,
      shippingStatus,
      orderStatus: orderStatusFromPaymentStatus(paymentStatus),
      ...(verifiedMpStatus ? { mpStatus: verifiedMpStatus } : {}),
      ...(verifiedPaymentId ? { mpPaymentId: verifiedPaymentId } : {}),
      ...(stockDeductedAt ? { stockDeductedAt } : {}),
      updatedAt: Date.now(),
    });

    if (paymentStatus === "confirmed" && fallbackOrder.customer?.email && !sheetOrder.receiptEmailSentAt) {
      const approvedAt = Date.now();
      const paymentId =
        fallbackOrder.paymentMethod === "mercadopago"
          ? verifiedPaymentId
          : verifiedPaymentId || `manual-${approvedAt}`;
      if (paymentId) {
        const emailResult = await sendOrderReceiptEmail({
          order: fallbackOrder,
          paymentId,
          approvedAt,
        });
        if (emailResult.sent) {
          await updateOrderRowInSalesSheet(orderId, { receiptEmailSentAt: Date.now() });
        }
      }
    }
    return;
  }

  const wasConfirmed = currentOrder.paymentStatus === "confirmed";

  if (paymentStatus === "confirmed") {
    const approvedAt = currentOrder.approvedAt ?? Date.now();
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

    await markApproved(orderId, {
      paymentId,
      mpStatus,
      approvedAt,
    });

    if (shippingStatus !== currentOrder.shippingStatus) {
      await updateOrder(orderId, { shippingStatus });
    }

    if (!wasConfirmed && !currentOrder.receiptEmailSentAt) {
      const emailResult = await sendOrderReceiptEmail({
        order: currentOrder,
        paymentId,
        approvedAt,
      });
      if (emailResult.sent) {
        await updateOrder(orderId, { receiptEmailSentAt: Date.now() });
      }
    }
    return;
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
    return;
  }

  await updateOrder(orderId, {
    paymentStatus,
    shippingStatus,
    status: "pending",
    mpStatus: "pending",
  });
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

  for (const update of updates) {
    const orderId = String(update?.orderId || "").trim();
    const paymentStatusRaw = String(update?.paymentStatus || "");
    const shippingStatusRaw = String(update?.shippingStatus || "");

    if (!orderId || !isPaymentStatus(paymentStatusRaw) || !isShippingStatus(shippingStatusRaw)) {
      throw new Error("Invalid batch order update payload");
    }

    await applyOrderStatusesUpdate({
      orderId,
      paymentStatus: paymentStatusRaw,
      shippingStatus: shippingStatusRaw,
    });
  }

  revalidatePath("/admin");
  revalidatePath("/admin/ventas");

  return { ok: true };
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
