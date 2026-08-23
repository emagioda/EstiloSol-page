import type {
  AdminOrderUpdateInput,
  AdminOrderUpdateResult,
} from "@/app/admin/actions";
import type { AdminOrderSheetRow } from "@/src/server/sheets/repository";

type StatusDraft = Pick<AdminOrderSheetRow, "paymentStatus" | "shippingStatus">;

export const buildAdminOrderStatusUpdate = (
  order: Pick<AdminOrderSheetRow, "orderId" | "paymentStatus" | "shippingStatus">,
  draft: StatusDraft
): AdminOrderUpdateInput | null => {
  const paymentChanged = order.paymentStatus !== draft.paymentStatus;
  const shippingChanged = order.shippingStatus !== draft.shippingStatus;
  if (!paymentChanged && !shippingChanged) return null;

  return {
    orderId: order.orderId,
    changedFields: [
      ...(paymentChanged ? ["paymentStatus" as const] : []),
      ...(shippingChanged ? ["shippingStatus" as const] : []),
    ],
    ...(paymentChanged
      ? {
          expectedPaymentStatus: order.paymentStatus,
          requestedPaymentStatus: draft.paymentStatus,
        }
      : {}),
    ...(shippingChanged
      ? {
          expectedShippingStatus: order.shippingStatus,
          requestedShippingStatus: draft.shippingStatus,
        }
      : {}),
  };
};

export const summarizeAdminOrderOutcomes = (results: AdminOrderUpdateResult[]): string => {
  const labels: Record<AdminOrderUpdateResult["status"], string> = {
    success: "Guardados",
    business_block: "Bloqueados",
    conflict: "Cambiaron desde que abriste la pantalla",
    failure: "Fallaron",
  };
  return (["success", "business_block", "conflict", "failure"] as const)
    .map((status) => {
      const orderIds = results
        .filter((result) => result.status === status)
        .map((result) => result.orderId);
      return orderIds.length > 0 ? `${labels[status]}: ${orderIds.join(", ")}.` : "";
    })
    .filter(Boolean)
    .join(" ");
};
