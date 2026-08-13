import { scheduleAfterResponse } from "@/src/server/http/afterResponse";
import { sendOrderReceiptEmail } from "@/src/server/notifications/orderReceipt";
import { logEvent } from "@/src/server/observability/log";
import { trackBusinessEvent } from "@/src/server/observability/metrics";
import {
  claimReceiptEmailDelivery,
  getOrder,
  reconcileMercadoPagoPaymentObservation,
  releaseReceiptEmailDelivery,
  updateOrder,
} from "@/src/server/orders/store";
import type { Order } from "@/src/server/orders/types";
import type { MpPaymentResponse, MpSearchPayment } from "./shared";
import { amountMatches } from "./shared";

type MercadoPagoPaymentLike = MpPaymentResponse | MpSearchPayment;
type ReconciliationSource = "webhook" | "verify_payment_id" | "verify_search";

export type MercadoPagoReconciliationResult =
  | { outcome: "order_not_found" }
  | {
      outcome: "ignored";
      reason: "invalid_payment_id" | "reference_mismatch" | "amount_mismatch" | "currency_mismatch" | "missing_status";
      order: Order;
    }
  | {
      outcome: "reconciled";
      order: Order;
      paymentId: string;
      status: string;
      duplicate: boolean;
      firstEffectiveApproval: boolean;
      activeApprovedPaymentIds: string[];
    };

const safeMetric = async (event: Parameters<typeof trackBusinessEvent>[0], properties: Record<string, unknown>) => {
  try {
    await trackBusinessEvent(event, properties);
  } catch (error) {
    logEvent("warn", "payments.reconciliation_metric_failed", {
      event,
      errorName: error instanceof Error ? error.name : "unknown",
    });
  }
};

const trySendReceiptEmail = async (order: Order, paymentId: string, approvedAt: number) => {
  if (order.receiptEmailSentAt) return;
  const claimed = await claimReceiptEmailDelivery(order.externalReference);
  if (!claimed) return;

  const latestOrder = await getOrder(order.externalReference);
  if (latestOrder?.receiptEmailSentAt) return;

  const result = await sendOrderReceiptEmail({ order, paymentId, approvedAt });
  if (result.sent) {
    await updateOrder(order.externalReference, { receiptEmailSentAt: Date.now() });
    await safeMetric("payment.receipt_email.sent", { externalReference: order.externalReference });
    return;
  }

  if (result.reason !== "missing_customer_email") {
    logEvent("warn", "payments.receipt_email_failed", {
      externalReference: order.externalReference,
      reason: result.reason,
      detail: result.detail,
    });
    await safeMetric("payment.receipt_email.failed", {
      externalReference: order.externalReference,
      reason: result.reason,
    });
  }
  await releaseReceiptEmailDelivery(order.externalReference);
};

const ignored = (
  reason: Extract<MercadoPagoReconciliationResult, { outcome: "ignored" }>["reason"],
  order: Order,
  source: ReconciliationSource
): MercadoPagoReconciliationResult => {
  logEvent("warn", "payments.mp_observation_ignored", {
    orderId: order.externalReference,
    source,
    reason,
  });
  return { outcome: "ignored", reason, order };
};

export async function reconcileMercadoPagoPayment(input: {
  externalReference: string;
  payment: MercadoPagoPaymentLike;
  source: ReconciliationSource;
  fallbackPaymentId?: string;
  observedAt?: number;
}): Promise<MercadoPagoReconciliationResult> {
  const order = await getOrder(input.externalReference);
  if (!order) return { outcome: "order_not_found" };

  const paymentId = String(input.payment.id ?? input.fallbackPaymentId ?? "");
  if (!/^[a-zA-Z0-9_-]{1,64}$/.test(paymentId)) {
    return ignored("invalid_payment_id", order, input.source);
  }
  if (String(input.payment.external_reference ?? "") !== order.externalReference) {
    return ignored("reference_mismatch", order, input.source);
  }

  const amount = Number(input.payment.transaction_amount);
  if (!Number.isFinite(amount) || !amountMatches(amount, order.total)) {
    return ignored("amount_mismatch", order, input.source);
  }
  const currency = String(input.payment.currency_id ?? "").toUpperCase();
  if (order.currency !== "ARS" || currency !== "ARS") {
    return ignored("currency_mismatch", order, input.source);
  }
  const status = String(input.payment.status ?? "").trim().toLowerCase();
  if (!status || status.length > 64) return ignored("missing_status", order, input.source);
  const observedAt = input.observedAt ?? Date.now();

  const result = await reconcileMercadoPagoPaymentObservation(order.externalReference, {
    paymentId,
    status,
    ...(input.payment.status_detail
      ? { statusDetail: String(input.payment.status_detail).slice(0, 120) }
      : {}),
    amount,
    currency: "ARS",
    observedAt,
  });
  if (!result.order) return { outcome: "order_not_found" };

  if (result.firstEffectiveApproval && result.receiptOrder) {
    const approvedAt =
      result.receiptOrder.mpPaymentLedger?.[paymentId]?.approvedAt ?? observedAt;
    scheduleAfterResponse(() => trySendReceiptEmail(result.receiptOrder!, paymentId, approvedAt));
  }

  logEvent("info", result.duplicate ? "payments.mp_observation_deduped" : "payments.mp_observation_reconciled", {
    orderId: order.externalReference,
    source: input.source,
    paymentId,
    mpStatus: status,
    paymentStatus: result.order.paymentStatus,
    approvedPaymentCount: result.activeApprovedPaymentIds.length,
  });

  return {
    outcome: "reconciled",
    order: result.order,
    paymentId,
    status,
    duplicate: result.duplicate,
    firstEffectiveApproval: result.firstEffectiveApproval,
    activeApprovedPaymentIds: result.activeApprovedPaymentIds,
  };
}
