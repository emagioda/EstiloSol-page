import { logEvent } from "@/src/server/observability/log";
import {
  PAYMENT_TRANSITION_BLOCK_REASONS,
  PaymentTransitionBlockedError,
} from "@/src/server/orders/paymentTransition";
import type { Order } from "@/src/server/orders/types";
import {
  fetchPaymentByIdFromMp,
  iteratePaymentSearchPagesByExternalReference,
} from "./mpClient";
import {
  reconcileMercadoPagoPayment,
  reconcileMercadoPagoPaymentObservations,
} from "./reconciliation";
import {
  amountMatches,
  type MpPaymentResponse,
  type MpSearchPayment,
} from "./shared";

type MpPaymentForValidation = MpPaymentResponse | MpSearchPayment;

type StagedPaymentObservation = {
  payment: MpPaymentForValidation;
  source: "verify_payment_id" | "verify_search";
  fallbackPaymentId?: string;
};

export type AdminMercadoPagoConfirmationResult = {
  order: Order;
  activeApprovedPaymentIds: string[];
  discoveryComplete: boolean;
};

const normalizedPaymentId = (
  payment: MpPaymentForValidation,
  fallbackPaymentId?: string
) => String(payment.id ?? fallbackPaymentId ?? "").trim();

const isValidPaymentId = (paymentId: string) =>
  /^[a-zA-Z0-9_-]{1,64}$/.test(paymentId);

const isValidPaymentForOrder = (
  payment: MpPaymentForValidation,
  order: Order,
  fallbackPaymentId?: string
) => {
  const paymentId = normalizedPaymentId(payment, fallbackPaymentId);
  const status = String(payment.status ?? "").trim().toLowerCase();
  const amount = Number(payment.transaction_amount);
  const currency = String(payment.currency_id ?? "").trim().toUpperCase();

  return (
    isValidPaymentId(paymentId) &&
    String(payment.external_reference ?? "").trim() === order.externalReference &&
    order.currency === "ARS" &&
    currency === "ARS" &&
    Number.isFinite(amount) &&
    amountMatches(amount, order.total) &&
    status.length > 0 &&
    status.length <= 64
  );
};

const isApprovedPaymentForOrder = (
  payment: MpPaymentForValidation,
  order: Order,
  fallbackPaymentId?: string
) =>
  isValidPaymentForOrder(payment, order, fallbackPaymentId) &&
  String(payment.status ?? "").trim().toLowerCase() === "approved";

const activeApprovedPaymentIdsFromOrder = (order: Order) =>
  Object.values(order.mpPaymentLedger ?? {})
    .filter((entry) => entry.status === "approved")
    .map((entry) => entry.paymentId);

const providerAuthorityRequired = () =>
  new PaymentTransitionBlockedError(
    PAYMENT_TRANSITION_BLOCK_REASONS.providerAuthorityRequired
  );

export async function reconcileAdminMercadoPagoConfirmation(input: {
  order: Order;
  accessToken: string;
}): Promise<AdminMercadoPagoConfirmationResult> {
  const stagedPayments = new Map<string, StagedPaymentObservation>();
  let validationOrder = input.order;
  let protectedDirectOrder: Order | null = null;
  const exactPaymentId = String(input.order.mpPaymentId ?? "").trim();

  if (exactPaymentId && /^\d+$/.test(exactPaymentId)) {
    try {
      const direct = await fetchPaymentByIdFromMp(exactPaymentId, input.accessToken);
      if (
        direct.response.ok &&
        direct.data &&
        isValidPaymentForOrder(direct.data, input.order, exactPaymentId)
      ) {
        const directId = normalizedPaymentId(direct.data, exactPaymentId);
        stagedPayments.set(directId, {
          payment: direct.data,
          source: "verify_payment_id",
          fallbackPaymentId: exactPaymentId,
        });

        if (isApprovedPaymentForOrder(direct.data, input.order, exactPaymentId)) {
          try {
            const directReconciliation = await reconcileMercadoPagoPayment({
              externalReference: input.order.externalReference,
              payment: direct.data,
              source: "verify_payment_id",
              fallbackPaymentId: exactPaymentId,
            });
            if (
              (directReconciliation.outcome === "reconciled" ||
                directReconciliation.outcome === "recovery_attention") &&
              directReconciliation.order?.paymentStatus === "confirmed"
            ) {
              protectedDirectOrder = directReconciliation.order;
              validationOrder = directReconciliation.order;
            }
          } catch (error) {
            logEvent("warn", "payments.admin_mp_direct_reconciliation_failed", {
              externalReference: input.order.externalReference,
              paymentId: directId,
              errorName: error instanceof Error ? error.name : "unknown",
            });
          }
        }
      }
    } catch (error) {
      logEvent("warn", "payments.admin_mp_direct_lookup_failed", {
        externalReference: input.order.externalReference,
        paymentId: exactPaymentId,
        errorName: error instanceof Error ? error.name : "unknown",
      });
    }
  }

  try {
    for await (const search of iteratePaymentSearchPagesByExternalReference(
      input.order.externalReference,
      input.accessToken
    )) {
      if (!search.response.ok || !search.data) {
        throw providerAuthorityRequired();
      }
      for (const payment of search.data.results ?? []) {
        const paymentId = normalizedPaymentId(payment);
        if (!isValidPaymentId(paymentId) || stagedPayments.has(paymentId)) continue;
        stagedPayments.set(paymentId, { payment, source: "verify_search" });
      }
    }
  } catch (error) {
    logEvent("warn", "payments.admin_mp_search_incomplete", {
      externalReference: input.order.externalReference,
      errorName: error instanceof Error ? error.name : "unknown",
    });
    if (protectedDirectOrder) {
      return {
        order: protectedDirectOrder,
        activeApprovedPaymentIds: activeApprovedPaymentIdsFromOrder(protectedDirectOrder),
        discoveryComplete: false,
      };
    }
    throw providerAuthorityRequired();
  }

  const observations = Array.from(stagedPayments.values());
  const hasApprovedPayment = observations.some((observation) =>
    isApprovedPaymentForOrder(
      observation.payment,
      input.order,
      observation.fallbackPaymentId
    )
  );
  if (!hasApprovedPayment) {
    throw new PaymentTransitionBlockedError(
      PAYMENT_TRANSITION_BLOCK_REASONS.mercadoPagoNotApproved
    );
  }

  let reconciliation: Awaited<ReturnType<typeof reconcileMercadoPagoPaymentObservations>>;
  try {
    reconciliation = await reconcileMercadoPagoPaymentObservations({
      externalReference: input.order.externalReference,
      validationOrder,
      observations,
    });
  } catch {
    throw providerAuthorityRequired();
  }

  if (reconciliation.outcome !== "reconciled") {
    throw providerAuthorityRequired();
  }
  if (reconciliation.order.paymentStatus !== "confirmed") {
    throw new PaymentTransitionBlockedError(
      PAYMENT_TRANSITION_BLOCK_REASONS.terminalRequiresCorrection
    );
  }

  return {
    order: reconciliation.order,
    activeApprovedPaymentIds: reconciliation.activeApprovedPaymentIds,
    discoveryComplete: true,
  };
}
