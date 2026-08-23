import { amountMatches } from "@/src/server/payments/shared";
import { resolveOrderInventoryStatus } from "./inventory";
import type { Order, OrderFulfillment } from "./types";

export const FULFILLMENT_COMPLETION_BLOCK_REASONS = {
  paymentNotConfirmed: "PAYMENT_NOT_CONFIRMED",
  inventoryNotDeducted: "INVENTORY_NOT_DEDUCTED",
  inventoryRequiresAttention: "INVENTORY_REQUIRES_ATTENTION",
  totalsInvalid: "FULFILLMENT_TOTALS_INVALID",
  deliveryIncomplete: "DELIVERY_INCOMPLETE",
  pickupIncomplete: "PICKUP_INCOMPLETE",
  deliveryMethodInvalid: "DELIVERY_METHOD_INVALID",
  requiresReconfirmation: "FULFILLMENT_REQUIRES_RECONFIRMATION",
  completedReopenNotAllowed: "SHIPPING_COMPLETED_REOPEN_NOT_ALLOWED",
} as const;

export type FulfillmentCompletionBlockReason =
  (typeof FULFILLMENT_COMPLETION_BLOCK_REASONS)[keyof typeof FULFILLMENT_COMPLETION_BLOCK_REASONS];

export type FulfillmentCompletionDecision =
  | { allowed: true }
  | { allowed: false; reason: FulfillmentCompletionBlockReason };

const block = (reason: FulfillmentCompletionBlockReason): FulfillmentCompletionDecision => ({
  allowed: false,
  reason,
});

const hasText = (value: unknown): value is string =>
  typeof value === "string" && value.trim().length > 0;

const hasValidMoneySnapshot = (fulfillment: OrderFulfillment, orderTotal: number): boolean => {
  const monetaryFields = [
    fulfillment.subtotalProducts,
    fulfillment.discountAmount,
    fulfillment.shippingFee,
    fulfillment.finalTotal,
  ];
  if (monetaryFields.some((value) => !Number.isFinite(value) || value < 0)) return false;

  const calculatedTotal =
    fulfillment.subtotalProducts - fulfillment.discountAmount + fulfillment.shippingFee;
  return (
    calculatedTotal >= 0 &&
    amountMatches(calculatedTotal, fulfillment.finalTotal) &&
    Number.isFinite(orderTotal) &&
    orderTotal >= 0 &&
    amountMatches(fulfillment.finalTotal, orderTotal)
  );
};

const evaluateFulfillmentSnapshot = (
  order: Pick<Order, "deliveryMethod" | "fulfillment" | "total">
): FulfillmentCompletionDecision => {
  if (order.deliveryMethod !== "delivery" && order.deliveryMethod !== "pickup") {
    return block(FULFILLMENT_COMPLETION_BLOCK_REASONS.deliveryMethodInvalid);
  }

  const fulfillment = order.fulfillment;
  if (!fulfillment) {
    return block(
      order.deliveryMethod === "delivery"
        ? FULFILLMENT_COMPLETION_BLOCK_REASONS.deliveryIncomplete
        : FULFILLMENT_COMPLETION_BLOCK_REASONS.pickupIncomplete
    );
  }
  if (!hasValidMoneySnapshot(fulfillment, order.total) || !hasText(fulfillment.summary)) {
    return block(FULFILLMENT_COMPLETION_BLOCK_REASONS.totalsInvalid);
  }

  if (order.deliveryMethod === "delivery") {
    const zone = fulfillment.deliveryZone;
    const address = fulfillment.deliveryAddress;
    if (
      !zone ||
      !hasText(zone.id) ||
      !hasText(zone.name) ||
      zone.insideZoneConfirmed !== true ||
      !address ||
      !hasText(address.street) ||
      !hasText(address.number) ||
      !hasText(address.betweenStreets)
    ) {
      return block(FULFILLMENT_COMPLETION_BLOCK_REASONS.deliveryIncomplete);
    }
    return { allowed: true };
  }

  const pickupPoint = fulfillment.pickupPoint;
  if (
    !pickupPoint ||
    !hasText(pickupPoint.id) ||
    !hasText(pickupPoint.name) ||
    !hasText(pickupPoint.address) ||
    !hasText(pickupPoint.reference)
  ) {
    return block(FULFILLMENT_COMPLETION_BLOCK_REASONS.pickupIncomplete);
  }
  return { allowed: true };
};

export const evaluateFulfillmentCompletion = (order: Order): FulfillmentCompletionDecision => {
  if (order.paymentStatus !== "confirmed") {
    return block(FULFILLMENT_COMPLETION_BLOCK_REASONS.paymentNotConfirmed);
  }

  const inventoryStatus = resolveOrderInventoryStatus(order);
  if (inventoryStatus === "conflict" || inventoryStatus === "error") {
    return block(FULFILLMENT_COMPLETION_BLOCK_REASONS.inventoryRequiresAttention);
  }
  if (inventoryStatus !== "deducted") {
    return block(FULFILLMENT_COMPLETION_BLOCK_REASONS.inventoryNotDeducted);
  }

  return evaluateFulfillmentSnapshot(order);
};

export const isTrustedHistoricalCompletion = (order: Order): boolean => {
  if (order.shippingStatus !== "completed") return false;
  if (
    order.paymentStatus !== "confirmed" &&
    order.paymentStatus !== "refunded" &&
    order.paymentStatus !== "charged_back"
  ) {
    return false;
  }
  if (resolveOrderInventoryStatus(order) !== "deducted") return false;
  return evaluateFulfillmentSnapshot(order).allowed;
};

export const getFulfillmentCompletionBlockMessage = (
  reason: FulfillmentCompletionBlockReason
): string => {
  if (reason === FULFILLMENT_COMPLETION_BLOCK_REASONS.paymentNotConfirmed) {
    return "Pago todavía no confirmado.";
  }
  if (reason === FULFILLMENT_COMPLETION_BLOCK_REASONS.inventoryNotDeducted) {
    return "Stock todavía no descontado.";
  }
  if (reason === FULFILLMENT_COMPLETION_BLOCK_REASONS.inventoryRequiresAttention) {
    return "El inventario requiere atención.";
  }
  if (reason === FULFILLMENT_COMPLETION_BLOCK_REASONS.deliveryIncomplete) {
    return "Faltan datos de entrega.";
  }
  if (reason === FULFILLMENT_COMPLETION_BLOCK_REASONS.pickupIncomplete) {
    return "Faltan datos del punto de retiro.";
  }
  if (reason === FULFILLMENT_COMPLETION_BLOCK_REASONS.deliveryMethodInvalid) {
    return "Falta definir el método de entrega.";
  }
  if (reason === FULFILLMENT_COMPLETION_BLOCK_REASONS.requiresReconfirmation) {
    return "La venta fue corregida y quedó En proceso. Volvé a indicar Finalizado.";
  }
  if (reason === FULFILLMENT_COMPLETION_BLOCK_REASONS.completedReopenNotAllowed) {
    return "Una venta finalizada no puede reabrirse desde la edición normal.";
  }
  return "Datos/totales históricos incompletos.";
};

export class FulfillmentCompletionBlockedError extends Error {
  readonly code = "FULFILLMENT_COMPLETION_BLOCKED";

  constructor(readonly reason: FulfillmentCompletionBlockReason) {
    super(getFulfillmentCompletionBlockMessage(reason));
    this.name = "FulfillmentCompletionBlockedError";
  }
}
