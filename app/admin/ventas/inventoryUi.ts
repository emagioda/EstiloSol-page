import type { AdminOrderSheetRow } from "@/src/server/sheets/repository";
import type { OrderInventoryStatus, OrderPaymentStatus, OrderShippingStatus } from "@/src/server/orders/types";

type InventoryOrder = Pick<
  AdminOrderSheetRow,
  "inventoryStatus" | "inventoryIssueCode" | "paymentStatus" | "shippingStatus"
>;

const CONFLICT_LABELS: Record<string, string> = {
  INSUFFICIENT_STOCK: "Stock insuficiente",
  PRODUCT_NOT_FOUND: "Producto no encontrado",
  PRODUCT_INACTIVE: "Producto inactivo",
  PRODUCT_NOT_AVAILABLE: "Producto no disponible",
  DUPLICATE_PRODUCT_ID: "ID de producto duplicado",
  INVALID_STOCK_QTY: "Stock inválido",
};

export const getInventoryStatusLabel = (status: OrderInventoryStatus | undefined) => {
  if (status === "pending") return "Pendiente";
  if (status === "deducted") return "Descontado";
  if (status === "conflict") return "Conflicto";
  if (status === "error") return "Error técnico";
  return "No registrado";
};

export const getInventoryIssueLabel = (
  status: OrderInventoryStatus | undefined,
  issueCode: string
) => {
  if (status === "conflict") return CONFLICT_LABELS[issueCode] ?? "Conflicto de inventario";
  if (status === "error") return "No se pudo completar la actualización del inventario";
  return "Sin incidencias";
};

export const inventoryRequiresAttention = (status: OrderInventoryStatus | undefined) =>
  status === "conflict" || status === "error";

export const canRetryInventory = (status: OrderInventoryStatus | undefined) =>
  inventoryRequiresAttention(status);

export const canCompleteShipping = (status: OrderInventoryStatus | undefined) =>
  !inventoryRequiresAttention(status);

export const isOrderReadyForShipping = (order: InventoryOrder) =>
  order.paymentStatus === "confirmed" &&
  order.shippingStatus === "in_process" &&
  !inventoryRequiresAttention(order.inventoryStatus);

export const isOrderNormallyCompleted = (order: InventoryOrder) =>
  order.paymentStatus === "confirmed" &&
  order.shippingStatus === "completed" &&
  !inventoryRequiresAttention(order.inventoryStatus);

export const getOrderAction = (
  order: Pick<InventoryOrder, "inventoryStatus">,
  draft: { paymentStatus: OrderPaymentStatus; shippingStatus: OrderShippingStatus }
) => {
  if (inventoryRequiresAttention(order.inventoryStatus)) {
    return { label: "Requiere atención", tone: "review" as const };
  }
  if (draft.paymentStatus === "pending") {
    return { label: "Falta confirmar pago", tone: "payment" as const };
  }
  if (
    draft.paymentStatus === "cancelled" ||
    draft.paymentStatus === "refunded" ||
    draft.paymentStatus === "charged_back"
  ) {
    return { label: "Revisar venta", tone: "review" as const };
  }
  if (draft.shippingStatus === "in_process") {
    return { label: "Preparar o entregar", tone: "shipping" as const };
  }
  return { label: "Venta finalizada", tone: "done" as const };
};
