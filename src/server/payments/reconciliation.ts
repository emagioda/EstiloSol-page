import {
  ensurePurchaseReceiptEventSafely,
  nudgePurchaseReceiptEvent,
} from "@/src/server/emailOutbox/service";
import { logEvent } from "@/src/server/observability/log";
import {
  ensureOrderDurableInSalesSheet,
  getOrder,
  reconstructOrderFromAuthorityEvidence,
  reconcileMercadoPagoPaymentObservation,
  reconcileMercadoPagoPaymentObservationBatch,
  updateOrder,
} from "@/src/server/orders/store";
import type { Order } from "@/src/server/orders/types";
import type { MercadoPagoPaymentObservation } from "./ledger";
import type { MpPaymentResponse, MpSearchPayment } from "./shared";
import { amountMatches } from "./shared";
import {
  completeRecoveryEvent,
  loadRecoveryAuthorityEvidence,
  markRecoveryEventRetryableSafely,
  prepareProtectedPaymentDurability,
} from "@/src/server/recovery/service";
import {
  getRecoverySnapshot,
  markRecoveryEventState,
} from "@/src/server/recovery/repository";
import {
  parseStoredRecoverySnapshot,
  recoverySnapshotToOrder,
} from "@/src/server/recovery/snapshot";
import type { RecoveryPaymentEvent } from "@/src/server/recovery/types";
import { updateOrderRowInSalesSheet } from "@/src/server/sheets/repository";

type MercadoPagoPaymentLike = MpPaymentResponse | MpSearchPayment;
type ReconciliationSource =
  | "webhook"
  | "verify_payment_id"
  | "verify_search"
  | "snapshot_scan";

type MercadoPagoObservationInput = {
  payment: MercadoPagoPaymentLike;
  source: ReconciliationSource;
  fallbackPaymentId?: string;
  observedAt?: number;
};

export type MercadoPagoReconciliationResult =
  | { outcome: "order_not_found" }
  | {
      outcome: "recovery_attention";
      paymentId: string;
      status: string;
      order: Order | null;
    }
  | {
      outcome: "ignored";
      reason:
        | "invalid_payment_id"
        | "reference_mismatch"
        | "amount_mismatch"
        | "currency_mismatch"
        | "missing_status"
        | "ledger_capacity";
      order: Order | null;
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
      outcome: "recovery_attention";
      order: Order | null;
      observationResults: MercadoPagoReconciliationResult[];
    }
  | {
      outcome: "reconciled";
      order: Order;
      observationResults: MercadoPagoReconciliationResult[];
      firstEffectiveApproval: boolean;
      activeApprovedPaymentIds: string[];
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

const ensureReceiptAndProjection = async (
  order: Order,
  paymentId: string,
  approvedAt: number,
): Promise<Order> => {
  const ensured = await ensurePurchaseReceiptEventSafely({ order, paymentId, approvedAt });
  if (!ensured) return order;
  return (
    (await updateOrder(
      order.externalReference,
      { receiptOutboxVersion: 1 },
    )) ?? order
  );
};

export async function reconcileMercadoPagoPayment(input: {
  externalReference: string;
  payment: MercadoPagoPaymentLike;
  source: ReconciliationSource;
  fallbackPaymentId?: string;
  observedAt?: number;
}): Promise<MercadoPagoReconciliationResult> {
  const durable = await prepareProtectedPaymentDurability({
    expectedExternalReference: input.externalReference,
    payment: input.payment,
    source: input.source,
    fallbackPaymentId: input.fallbackPaymentId,
    observedAt: input.observedAt,
  });
  if (durable.protected && durable.outcome === "reference_mismatch") {
    return { outcome: "ignored", reason: "reference_mismatch", order: null };
  }
  if (durable.protected && durable.outcome !== "ready") {
    return {
      outcome: "recovery_attention",
      paymentId: durable.event.paymentId,
      status: durable.event.financialStatus,
      order: durable.order,
    };
  }

  const order = durable.protected ? durable.order : await getOrder(input.externalReference);
  if (!order) return { outcome: "order_not_found" };

  const validated = validateObservation(order, input);
  if (!validated.ok) {
    if (durable.protected) {
      await markRecoveryEventState({
        eventKey: durable.event.eventKey,
        state: "attention",
        errorCode: `RECOVERY_${validated.reason.toUpperCase()}`,
      });
    }
    return ignored(validated.reason, order, input.source);
  }
  const { paymentId, status, observation } = validated.value;

  let result: Awaited<ReturnType<typeof reconcileMercadoPagoPaymentObservation>>;
  try {
    result = await reconcileMercadoPagoPaymentObservation(
      order.externalReference,
      observation,
    );
    if (result.order && durable.protected && !result.omittedForCapacity) {
      const sales = await ensureOrderDurableInSalesSheet(result.order);
      if (!sales.synced) throw new Error("RECOVERY_SALES_ROW_NOT_DURABLE");
      result.order = sales.order;
      await completeRecoveryEvent(durable.event);
    }
  } catch (error) {
    if (durable.protected) {
      await markRecoveryEventRetryableSafely(
        durable.event,
        error instanceof Error ? error.message.slice(0, 120) : "RECOVERY_RECONCILIATION_FAILED",
      );
    }
    throw error;
  }
  if (!result.order) return { outcome: "order_not_found" };
  if (result.omittedForCapacity) {
    if (durable.protected) {
      await markRecoveryEventState({
        eventKey: durable.event.eventKey,
        state: "attention",
        errorCode: "RECOVERY_LEDGER_CAPACITY",
      });
    }
    return ignored("ledger_capacity", result.order, input.source);
  }

  if (
    (result.firstEffectiveApproval && result.receiptOrder) ||
    (durable.protected && status === "approved" && result.order.paymentStatus === "confirmed")
  ) {
    const receiptOrder = result.receiptOrder ?? result.order;
    const approvedAt =
      receiptOrder.mpPaymentLedger?.[paymentId]?.approvedAt ?? observation.observedAt;
    result.order = await ensureReceiptAndProjection(receiptOrder, paymentId, approvedAt);
  } else if (result.order.paymentStatus === "confirmed") {
    nudgePurchaseReceiptEvent(result.order.externalReference);
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
  const durability = [] as Array<{
    input: MercadoPagoObservationInput;
    event?: RecoveryPaymentEvent;
    earlyResult?: MercadoPagoReconciliationResult;
    order?: Order;
  }>;
  let recoveredOrder: Order | undefined;
  for (const observationInput of input.observations) {
    const preparedDurability = await prepareProtectedPaymentDurability({
      expectedExternalReference: input.externalReference,
      payment: observationInput.payment,
      source: observationInput.source,
      fallbackPaymentId: observationInput.fallbackPaymentId,
      observedAt: observationInput.observedAt,
    });
    if (
      preparedDurability.protected &&
      preparedDurability.outcome === "reference_mismatch"
    ) {
      durability.push({
        input: observationInput,
        earlyResult: { outcome: "ignored", reason: "reference_mismatch", order: null },
      });
      continue;
    }
    if (preparedDurability.protected && preparedDurability.outcome !== "ready") {
      durability.push({
        input: observationInput,
        event: preparedDurability.event,
        order: preparedDurability.order ?? undefined,
        earlyResult: {
          outcome: "recovery_attention",
          paymentId: preparedDurability.event.paymentId,
          status: preparedDurability.event.financialStatus,
          order: preparedDurability.order,
        },
      });
      continue;
    }
    if (preparedDurability.protected) {
      recoveredOrder = preparedDurability.order;
      durability.push({
        input: observationInput,
        event: preparedDurability.event,
        order: preparedDurability.order,
      });
    } else {
      durability.push({ input: observationInput });
    }
  }

  const validationOrder =
    input.validationOrder ?? recoveredOrder ?? (await getOrder(input.externalReference));
  if (!validationOrder) {
    const attentionResults = durability
      .map((entry) => entry.earlyResult)
      .filter(
        (entry): entry is Extract<MercadoPagoReconciliationResult, { outcome: "recovery_attention" }> =>
          entry?.outcome === "recovery_attention",
      );
    if (attentionResults.length > 0) {
      return {
        outcome: "recovery_attention",
        order: null,
        observationResults: attentionResults,
      };
    }
    return { outcome: "order_not_found" };
  }

  const prepared = await Promise.all(
    durability.map(async (entry) => {
      if (entry.earlyResult) {
        return { ok: false as const, result: entry.earlyResult, event: entry.event };
      }
      const validation = validateObservation(validationOrder, entry.input);
      if (!validation.ok) {
        if (entry.event) {
          await markRecoveryEventState({
            eventKey: entry.event.eventKey,
            state: "attention",
            errorCode: `RECOVERY_${validation.reason.toUpperCase()}`,
          });
        }
        return {
          ok: false as const,
          result: ignored(validation.reason, validationOrder, entry.input.source),
          event: entry.event,
        };
      }
      return { ok: true as const, value: validation.value, event: entry.event };
    }),
  );
  const validated = prepared.filter(
    (entry): entry is Extract<(typeof prepared)[number], { ok: true }> => entry.ok
  );

  if (validated.length === 0) {
    const ignoredResults = prepared
      .filter(
        (entry): entry is Extract<(typeof prepared)[number], { ok: false }> => !entry.ok
      )
      .map((entry) => entry.result);
    const hasRecoveryAttention = ignoredResults.some(
      (entry) => entry.outcome === "recovery_attention",
    );
    if (hasRecoveryAttention) {
      return {
        outcome: "recovery_attention",
        order: validationOrder,
        observationResults: ignoredResults,
      };
    }
    return {
      outcome: "reconciled",
      order: validationOrder,
      observationResults: ignoredResults,
      firstEffectiveApproval: false,
      activeApprovedPaymentIds: [],
    };
  }

  let result: Awaited<ReturnType<typeof reconcileMercadoPagoPaymentObservationBatch>>;
  try {
    result = await reconcileMercadoPagoPaymentObservationBatch(
      input.externalReference,
      validated.map((entry) => entry.value.observation),
    );
  } catch (error) {
    await Promise.all(
      validated
        .filter((entry) => entry.event)
        .map((entry) =>
          markRecoveryEventRetryableSafely(
            entry.event!,
            error instanceof Error
              ? error.message.slice(0, 120)
              : "RECOVERY_RECONCILIATION_FAILED",
          ),
        ),
    );
    throw error;
  }
  if (!result.order) return { outcome: "order_not_found" };

  let appliedIndex = 0;
  const completedEvents: RecoveryPaymentEvent[] = [];
  const ledgerCapacityEvents: RecoveryPaymentEvent[] = [];
  const observationResults = prepared.map((entry): MercadoPagoReconciliationResult => {
    if (!entry.ok) return entry.result;
    const application = result.observationResults[appliedIndex++];
    if (!application || application.omittedForCapacity) {
      if (entry.event) {
        ledgerCapacityEvents.push(entry.event);
      }
      return ignored("ledger_capacity", result.order!, entry.value.source);
    }
    if (entry.event) completedEvents.push(entry.event);
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

  for (const event of ledgerCapacityEvents) {
    await markRecoveryEventState({
      eventKey: event.eventKey,
      state: "attention",
      errorCode: "RECOVERY_LEDGER_CAPACITY",
    });
  }

  let projectedOrder = result.order;
  if (completedEvents.length > 0) {
    try {
      const sales = await ensureOrderDurableInSalesSheet(projectedOrder);
      if (!sales.synced) throw new Error("RECOVERY_SALES_ROW_NOT_DURABLE");
      projectedOrder = sales.order;
      for (const event of completedEvents) {
        await completeRecoveryEvent(event);
      }
    } catch (error) {
      await Promise.all(
        completedEvents.map((event) =>
          markRecoveryEventRetryableSafely(
            event,
            error instanceof Error
              ? error.message.slice(0, 120)
              : "RECOVERY_SALES_SYNC_FAILED",
          ),
        ),
      );
      throw error;
    }
  }

  const durableApprovedEvent = completedEvents.find(
    (event) => event.financialStatus === "approved",
  );
  if (
    (result.firstEffectiveApproval && result.receiptOrder) ||
    (durableApprovedEvent && projectedOrder.paymentStatus === "confirmed")
  ) {
    const receiptOrder = result.receiptOrder ?? projectedOrder;
    const paymentId =
      receiptOrder.mpPaymentId ?? durableApprovedEvent?.paymentId ?? result.activeApprovedPaymentIds[0];
    if (paymentId) {
      const approvedAt =
        receiptOrder.mpPaymentLedger?.[paymentId]?.approvedAt ??
        receiptOrder.approvedAt ??
        (durableApprovedEvent ? Date.parse(durableApprovedEvent.observedAt) : Number.NaN);
      if (!Number.isFinite(approvedAt)) {
        throw new Error("RECOVERY_APPROVAL_TIMESTAMP_MISSING");
      }
      projectedOrder = await ensureReceiptAndProjection(receiptOrder, paymentId, approvedAt);
    }
  } else if (projectedOrder.paymentStatus === "confirmed") {
    nudgePurchaseReceiptEvent(projectedOrder.externalReference);
  }

  return {
    outcome: "reconciled",
    order: projectedOrder,
    observationResults,
    firstEffectiveApproval: result.firstEffectiveApproval,
    activeApprovedPaymentIds: result.activeApprovedPaymentIds,
  };
}

export type RecoveryEventReconciliationOutcome =
  | { outcome: "completed"; order: Order | null }
  | { outcome: "attention"; order: Order | null };

export async function reconcileRecoveryPaymentEvent(
  event: RecoveryPaymentEvent,
  leaseOwner: string,
): Promise<RecoveryEventReconciliationOutcome> {
  if (event.validationState !== "validated") {
    await markRecoveryEventState({
      eventKey: event.eventKey,
      state: "attention",
      leaseOwner,
      errorCode: event.lastErrorCode || "RECOVERY_EVENT_NOT_VALIDATED",
    });
    return { outcome: "attention", order: null };
  }

  try {
    let order = await getOrder(event.externalReference);
    if (!order) {
      const storedSnapshot = await getRecoverySnapshot(event.externalReference);
      if (storedSnapshot?.snapshotJson) {
        const snapshot = parseStoredRecoverySnapshot(storedSnapshot);
        const authorityEvidence = await loadRecoveryAuthorityEvidence({
          externalReference: event.externalReference,
          snapshotHash: storedSnapshot.snapshotHash,
          currentEvent: event,
        });
        order = (
          await reconstructOrderFromAuthorityEvidence(
            recoverySnapshotToOrder(snapshot),
            authorityEvidence,
          )
        ).order;
      } else if (
        event.financialStatus === "refunded" ||
        event.financialStatus === "charged_back"
      ) {
        await updateOrderRowInSalesSheet(event.externalReference, {
          paymentStatus: event.financialStatus,
          orderStatus: event.financialStatus,
          mpStatus: event.financialStatus,
          mpPaymentId: event.paymentId,
          updatedAt: Date.parse(event.observedAt),
        });
        await completeRecoveryEvent(event, leaseOwner);
        return { outcome: "completed", order: null };
      } else {
        await markRecoveryEventState({
          eventKey: event.eventKey,
          state: "attention",
          leaseOwner,
          errorCode: "RECOVERY_ORDER_RECONSTRUCTION_UNAVAILABLE",
        });
        return { outcome: "attention", order: null };
      }
    }

    const payment: MpPaymentResponse = {
      id: event.paymentId,
      status: event.financialStatus,
      external_reference: event.externalReference,
      transaction_amount: event.amount,
      currency_id: event.currency,
      status_detail: event.statusDetail,
      date_last_updated: event.mpUpdatedAt,
    };
    const validated = validateObservation(order, {
      payment,
      source: event.source,
      observedAt: Date.parse(event.observedAt),
    });
    if (!validated.ok) {
      await markRecoveryEventState({
        eventKey: event.eventKey,
        state: "attention",
        leaseOwner,
        errorCode: `RECOVERY_${validated.reason.toUpperCase()}`,
      });
      return { outcome: "attention", order };
    }

    const result = await reconcileMercadoPagoPaymentObservation(
      order.externalReference,
      validated.value.observation,
    );
    if (!result.order || result.omittedForCapacity) {
      await markRecoveryEventState({
        eventKey: event.eventKey,
        state: "attention",
        leaseOwner,
        errorCode: result.omittedForCapacity
          ? "RECOVERY_LEDGER_CAPACITY"
          : "RECOVERY_ORDER_NOT_FOUND",
      });
      return { outcome: "attention", order: result.order };
    }
    const sales = await ensureOrderDurableInSalesSheet(result.order);
    if (!sales.synced) throw new Error("RECOVERY_SALES_ROW_NOT_DURABLE");
    await completeRecoveryEvent(event, leaseOwner);

    if (
      (result.firstEffectiveApproval && result.receiptOrder) ||
      (event.financialStatus === "approved" && sales.order.paymentStatus === "confirmed")
    ) {
      const receiptOrder = result.receiptOrder ?? sales.order;
      const approvedAt =
        receiptOrder.mpPaymentLedger?.[event.paymentId]?.approvedAt ??
        Date.parse(event.observedAt);
      sales.order = await ensureReceiptAndProjection(
        receiptOrder,
        event.paymentId,
        approvedAt,
      );
    } else if (sales.order.paymentStatus === "confirmed") {
      nudgePurchaseReceiptEvent(sales.order.externalReference);
    }
    return { outcome: "completed", order: sales.order };
  } catch (error) {
    await markRecoveryEventRetryableSafely(
      event,
      error instanceof Error ? error.message.slice(0, 120) : "RECOVERY_WORKER_FAILED",
      leaseOwner,
    );
    throw error;
  }
}
