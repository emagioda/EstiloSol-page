"use server";

import { revalidatePath, revalidateTag } from "next/cache";
import { redirect } from "next/navigation";
import { getServerSession } from "next-auth";
import { isAdminEmail } from "@/src/server/auth/adminEmail";
import { authOptions } from "@/src/server/auth/options";
import { sendOrderReceiptEmail } from "@/src/server/notifications/orderReceipt";
import { getOrder, markApproved, updateOrder } from "@/src/server/orders/store";
import type { Order, OrderItem, OrderPaymentStatus, OrderShippingStatus } from "@/src/server/orders/types";
import {
  getOrderRowById,
  updateOrderRowInSalesSheet,
  updateProductRowInSheet,
} from "@/src/server/sheets/repository";

const parsePaymentStatus = (value: FormDataEntryValue | null): OrderPaymentStatus | null => {
  if (value === "pending" || value === "confirmed" || value === "cancelled") {
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
  value === "pending" || value === "confirmed" || value === "cancelled";

const isShippingStatus = (value: string): value is OrderShippingStatus =>
  value === "in_process" || value === "completed";

const parseStringList = (value: FormDataEntryValue | null): string[] =>
  String(value || "")
    .split(/\r?\n|,/)
    .map((entry) => entry.trim())
    .filter(Boolean);

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
      ? "rejected"
      : "pending";

  return {
    externalReference: sheetOrder.orderId,
    status: paymentStatus === "confirmed" ? "approved" : paymentStatus === "cancelled" ? "rejected" : "pending",
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
    await updateOrderRowInSalesSheet(orderId, {
      paymentStatus,
      shippingStatus,
      orderStatus: paymentStatus === "confirmed" ? "approved" : paymentStatus === "cancelled" ? "rejected" : "pending",
      updatedAt: Date.now(),
    });

    if (paymentStatus === "confirmed") {
      const fallbackOrder = await buildFallbackOrderFromSheet(orderId, paymentStatus, shippingStatus);
      if (fallbackOrder?.customer?.email) {
        const approvedAt = Date.now();
        const paymentId = fallbackOrder.mpPaymentId || `manual-${approvedAt}`;
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
    const paymentId = currentOrder.mpPaymentId || `manual-${approvedAt}`;
    await markApproved(orderId, {
      paymentId,
      mpStatus: currentOrder.mpStatus || "approved",
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
  } else {
    await updateOrder(orderId, {
      paymentStatus,
      shippingStatus,
      status: paymentStatus === "cancelled" ? "rejected" : "pending",
      ...(paymentStatus === "pending" ? { mpStatus: "pending" } : {}),
    });
  }
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
  const productType = String(formData.get("productType") || "UNICO").trim().toUpperCase();
  const isKit = productType === "KIT";
  const includes = isKit ? parseStringList(formData.get("includes")) : [];
  const images = parseStringList(formData.get("images"));
  const isNew = String(formData.get("isNew") || "").toLowerCase() === "true";
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
  });

  revalidateTag("catalog", "max");
  revalidatePath("/admin");
  revalidatePath("/admin/productos");
  revalidatePath("/tienda");
  redirect(redirectTo);
}
