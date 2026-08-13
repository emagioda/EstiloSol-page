import { scheduleAfterResponse } from "@/src/server/http/afterResponse";
import { sendOrderReceiptEmail } from "@/src/server/notifications/orderReceipt";
import { logEvent } from "@/src/server/observability/log";
import { trackBusinessEvent } from "@/src/server/observability/metrics";
import {
  claimReceiptEmailDelivery,
  getOrder,
  reconcileMercadoPagoPaymentObservation,
  reconcileMercadoPagoPaymentObservationBatch,
  releaseReceiptEmailDelivery,
  updateOrder,
} from "@/src/server/orders/store";
import type { Order } from "@/src/server/orders/types";
import type { MercadoPagoPaymentObservation } from "./ledger";
import type { MpPaymentResponse, MpSearchPayment } from "./shared";
import { amountMatches } from "./shared";

type MercadoPagoPaymentLike = MpPaymentResponse | MpSearchPayment;
type ReconciliationSource = "webhook" | "verify_payment_id" | "verify_search";

type MercadoPagoObservationInput = {
  payment: MercadoPagoPaymentLike;
  source: ReconciliationSource;
  fallbackPaymentId?: string;
  observedAt?: number;
};

export type MercadoPagoReconciliationResult =
  | { outcome: "order_not_found" }
  | {
      outcome: "ignored";
      reason:
        | "invalid_payment_id"
        | "reference_mismatch"
        | "amount_mismatch"
        | "currency_mismatch"
        | "missing_status"
        | "ledger_capacity";
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

export type MercadoPagoBatchReconciliationResult =
  | { outcome: "order_not_found" }
  | {
      outcome: "reconciled";
      order: Order;
      observationResults: MercadoPagoReconciliationResult[];
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

type ValidatedObservation = {
  paymentId: string;
  status: string;
  source: ReconciliationSource;
  observation: MercadoPagoPaymentObservation;
};

const validateObservation = (
  order: Order,
  input: MercadoPagoObservationInput
):
  | { ok: true; value: ValidatedObservation }
  | {
      ok: false;
      reason: Extract<MercadoPagoReconciliationResult, { outcome: "ignored" }>["reason"];
    } => {
  const paymentId = String(input.payment.id ?? input.fallbackPaymentId ?? "");
  if (!/^[a-zA-Z0-9_-]{1,64}$/.test(paymentId)) {
    return { ok: false, reason: "invalid_payment_id" };
  }
  if (String(input.payment.external_reference ?? "") !== order.externalReference) {
    return { ok: false, reason: "reference_mismatch" };
  }

  const amount = Number(input.payment.transaction_amount);
  if (!Number.isFinite(amount) || !amountMatches(amount, order.total)) {
    return { ok: false, reason: "amount_mismatch" };
  }
  const currency = String(input.payment.currency_id ?? "").toUpperCase();
  if (order.currency !== "ARS" || currency !== "ARS") {
    return { ok: false, reason: "currency_mismatch" };
  }
  const status = String(input.payment.status ?? "").trim().toLowerCase();
  if (!status || status.length > 64) return { ok: false, reason: "missing_status" };
  const observedAt = input.observedAt ?? Date.now();

  return {
    ok: true,
    value: {
      paymentId,
      status,
      source: input.source,
      observation: {
        paymentId,
        status,
        ...(input.payment.status_detail
          ? { statusDetail: String(input.payment.status_detail).slice(0, 120) }
          : {}),
        amount,
        currency: "ARS",
        observedAt,
      },
    },
  };
};

const reconciledObservationResult = (input: {
  order: Order;
  paymentId: string;
  status: string;
  source: ReconciliationSource;
  duplicate: boolean;
  firstEffectiveApproval: boolean;
  activeApprovedPaymentIds: string[];
  evictedPaymentIds: string[];
}): MercadoPagoReconciliationResult => {
  if (input.evictedPaymentIds.length > 0) {
    logEvent("warn", "payments.mp_ledger_compacted", {
      orderId: input.order.externalReference,
      source: input.source,
      protectedPaymentId: input.paymentId,
      evictedPaymentIds: input.evictedPaymentIds,
    });
  }

  logEvent(
    "info",
    input.duplicate ? "payments.mp_observation_deduped" : "payments.mp_observation_reconciled",
    {
      orderId: input.order.externalReference,
      source: input.source,
      paymentId: input.paymentId,
      mpStatus: input.status,
      paymentStatus: input.order.paymentStatus,
      approvedPaymentCount: input.activeApprovedPaymentIds.length,
    }
  );

  return {
    outcome: "reconciled",
    order: input.order,
    paymentId: input.paymentId,
    status: input.status,
    duplicate: input.duplicate,
    firstEffectiveApproval: input.firstEffectiveApproval,
    activeApprovedPaymentIds: input.activeApprovedPaymentIds,
  };
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

  const validated = validateObservation(order, input);
  if (!validated.ok) return ignored(validated.reason, order, input.source);
  const { paymentId, status, observation } = validated.value;

  const result = await reconcileMercadoPagoPaymentObservation(
    order.externalReference,
    observation
  );
  if (!result.order) return { outcome: "order_not_found" };
  if (result.omittedForCapacity) {
    return ignored("ledger_capacity", result.order, input.source);
  }

  if (result.firstEffectiveApproval && result.receiptOrder) {
    const approvedAt =
      result.receiptOrder.mpPaymentLedger?.[paymentId]?.approvedAt ?? observation.observedAt;
    scheduleAfterResponse(() => trySendReceiptEmail(result.receiptOrder!, paymentId, approvedAt));
  }

  return reconciledObservationResult({
    order: result.order,
    paymentId,
    status,
    source: input.source,
    duplicate: result.duplicate,
    firstEffectiveApproval: result.firstEffectiveApproval,
    activeApprovedPaymentIds: result.activeApprovedPaymentIds,
    evictedPaymentIds: result.evictedPaymentIds,
  });
}

export async function reconcileMercadoPagoPaymentObservations(input: {
  externalReference: string;
  observations: MercadoPagoObservationInput[];
  validationOrder?: Order;
}): Promise<MercadoPagoBatchReconciliationResult> {
  const validationOrder = input.validationOrder ?? (await getOrder(input.externalReference));
  if (!validationOrder) return { outcome: "order_not_found" };

  const prepared = input.observations.map((observationInput) => {
    const validation = validateObservation(validationOrder, observationInput);
    if (!validation.ok) {
      return {
        ok: false as const,
        result: ignored(validation.reason, validationOrder, observationInput.source),
      };
    }
    return { ok: true as const, value: validation.value };
  });
  const validated = prepared.filter(
    (entry): entry is Extract<(typeof prepared)[number], { ok: true }> => entry.ok
  );

  if (validated.length === 0) {
    const ignoredResults = prepared
      .filter(
        (entry): entry is Extract<(typeof prepared)[number], { ok: false }> => !entry.ok
      )
      .map((entry) => entry.result);
    return {
      outcome: "reconciled",
      order: validationOrder,
      observationResults: ignoredResults,
      firstEffectiveApproval: false,
      activeApprovedPaymentIds: [],
    };
  }

  const result = await reconcileMercadoPagoPaymentObservationBatch(
    input.externalReference,
    validated.map((entry) => entry.value.observation)
  );
  if (!result.order) return { outcome: "order_not_found" };

  let appliedIndex = 0;
  const observationResults = prepared.map((entry): MercadoPagoReconciliationResult => {
    if (!entry.ok) return entry.result;
    const application = result.observationResults[appliedIndex++];
    if (!application || application.omittedForCapacity) {
      return ignored("ledger_capacity", result.order!, entry.value.source);
    }
    return reconciledObservationResult({
      order: result.order!,
      paymentId: entry.value.paymentId,
      status: entry.value.status,
      source: entry.value.source,
      duplicate: application.duplicate,
      firstEffectiveApproval: false,
      activeApprovedPaymentIds: result.activeApprovedPaymentIds,
      evictedPaymentIds: application.evictedPaymentIds,
    });
  });

  if (result.firstEffectiveApproval && result.receiptOrder) {
    const paymentId =
      result.receiptOrder.mpPaymentId ?? result.activeApprovedPaymentIds[0];
    if (paymentId) {
      const approvedAt =
        result.receiptOrder.mpPaymentLedger?.[paymentId]?.approvedAt ??
        result.receiptOrder.approvedAt ??
        Date.now();
      scheduleAfterResponse(() =>
        trySendReceiptEmail(result.receiptOrder!, paymentId, approvedAt)
      );
    }
  }

  return {
    outcome: "reconciled",
    order: result.order,
    observationResults,
    firstEffectiveApproval: result.firstEffectiveApproval,
    activeApprovedPaymentIds: result.activeApprovedPaymentIds,
  };
}
