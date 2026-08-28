import type {
  MercadoPagoPaymentLedgerEntry,
  Order,
  OrderPaymentStatus,
  OrderStatus,
} from "@/src/server/orders/types";

export const MAX_MERCADO_PAGO_PAYMENT_LEDGER_ENTRIES = 20;
export const MULTIPLE_APPROVED_MP_PAYMENTS = "MULTIPLE_APPROVED_MP_PAYMENTS" as const;

export type MercadoPagoPaymentObservation = {
  paymentId: string;
  status: string;
  statusDetail?: string;
  amount: number;
  currency: "ARS";
  observedAt: number;
};

const isExplicitApprovalReversal = (status: string) =>
  status === "refunded" || status === "charged_back";

const isProtectedFinancialEvidence = (entry: MercadoPagoPaymentLedgerEntry) =>
  entry.status === "approved" ||
  entry.approvedAt !== undefined ||
  isExplicitApprovalReversal(entry.status);

const compareEvictionCandidates = (
  left: MercadoPagoPaymentLedgerEntry,
  right: MercadoPagoPaymentLedgerEntry
) => {
  const lastSeenDifference = left.lastSeenAt - right.lastSeenAt;
  if (lastSeenDifference) return lastSeenDifference;
  const firstSeenDifference = left.firstSeenAt - right.firstSeenAt;
  if (firstSeenDifference) return firstSeenDifference;
  if (left.paymentId === right.paymentId) return 0;
  return left.paymentId < right.paymentId ? -1 : 1;
};

const durableStatusForEntry = (
  existing: MercadoPagoPaymentLedgerEntry | undefined,
  observedStatus: string
) => {
  if (!existing || !isExplicitApprovalReversal(existing.status)) return observedStatus;
  if (observedStatus === "charged_back") return "charged_back";
  return existing.status;
};

const statusPriority = (status: string) => {
  if (status === "charged_back") return 5;
  if (status === "refunded") return 4;
  if (status === "cancelled" || status === "canceled") return 3;
  if (status === "rejected") return 2;
  return 1;
};

export const resolveTerminalPaymentStatusByLedgerPrecedence = (
  current: OrderPaymentStatus,
  incoming: Extract<OrderPaymentStatus, "refunded" | "charged_back">,
): Extract<OrderPaymentStatus, "refunded" | "charged_back"> =>
  current === "refunded" || current === "charged_back"
    ? statusPriority(current) > statusPriority(incoming)
      ? current
      : incoming
    : incoming;

const toOrderState = (
  status: string
): { status: OrderStatus; paymentStatus: OrderPaymentStatus } => {
  if (status === "charged_back") return { status: "charged_back", paymentStatus: "charged_back" };
  if (status === "refunded") return { status: "refunded", paymentStatus: "refunded" };
  if (status === "cancelled" || status === "canceled") {
    return { status: "cancelled", paymentStatus: "cancelled" };
  }
  if (status === "rejected") return { status: "rejected", paymentStatus: "cancelled" };
  return { status: "pending", paymentStatus: "pending" };
};

const activeApprovedEntries = (ledger: Record<string, MercadoPagoPaymentLedgerEntry>) =>
  Object.values(ledger).filter(
    (entry) => entry.approvedAt !== undefined && !isExplicitApprovalReversal(entry.status)
  );

const entryIsUnchanged = (
  entry: MercadoPagoPaymentLedgerEntry | undefined,
  observation: MercadoPagoPaymentObservation
) =>
  Boolean(
    entry &&
      entry.status === observation.status &&
      entry.statusDetail === observation.statusDetail &&
      entry.amount === observation.amount &&
      entry.currency === observation.currency
  );

export type MercadoPagoLedgerResult = {
  patch: Pick<
    Order,
    | "status"
    | "paymentStatus"
    | "mpPaymentId"
    | "mpStatus"
    | "mpPaymentLedger"
    | "mpPaymentAttentionCode"
    | "approvedAt"
  >;
  duplicate: boolean;
  firstEffectiveApproval: boolean;
  activeApprovedPaymentIds: string[];
  omittedForCapacity: boolean;
  evictedPaymentIds: string[];
};

export const applyMercadoPagoPaymentObservation = (
  order: Order,
  observation: MercadoPagoPaymentObservation
): MercadoPagoLedgerResult => {
  const currentLedger = order.mpPaymentLedger ?? {};
  const existing = currentLedger[observation.paymentId];
  const legacyApprovedAt =
    order.paymentStatus === "confirmed" && order.mpPaymentId === observation.paymentId
      ? order.approvedAt ?? observation.observedAt
      : undefined;
  const approvedAt =
    existing?.approvedAt ??
    legacyApprovedAt ??
    (observation.status === "approved" ? observation.observedAt : undefined);
  const durableStatus = durableStatusForEntry(existing, observation.status);
  const incomingIsProtected =
    approvedAt !== undefined || isExplicitApprovalReversal(durableStatus);
  const isNewEntry = existing === undefined;
  const currentEntryCount = Object.keys(currentLedger).length;
  const omittedForCapacity =
    isNewEntry &&
    !incomingIsProtected &&
    currentEntryCount >= MAX_MERCADO_PAGO_PAYMENT_LEDGER_ENTRIES;
  if (omittedForCapacity) {
    const currentApprovedPaymentIds = activeApprovedEntries(currentLedger).map(
      (entry) => entry.paymentId
    );
    const legacyApprovedPaymentId =
      order.paymentStatus === "confirmed" &&
      order.mpPaymentId &&
      !currentLedger[order.mpPaymentId]
        ? order.mpPaymentId
        : undefined;
    return {
      patch: {
        status: order.status,
        paymentStatus: order.paymentStatus,
        mpPaymentId: order.mpPaymentId,
        mpStatus: order.mpStatus,
        mpPaymentLedger: currentLedger,
        mpPaymentAttentionCode: order.mpPaymentAttentionCode,
        approvedAt: order.approvedAt,
      },
      duplicate: false,
      firstEffectiveApproval: false,
      activeApprovedPaymentIds: Array.from(
        new Set([
          ...currentApprovedPaymentIds,
          ...(legacyApprovedPaymentId ? [legacyApprovedPaymentId] : []),
        ])
      ),
      omittedForCapacity: true,
      evictedPaymentIds: [],
    };
  }
  const evictionsNeeded = Math.max(
    0,
    currentEntryCount - MAX_MERCADO_PAGO_PAYMENT_LEDGER_ENTRIES + 1
  );
  const evictedPaymentIds =
    isNewEntry && incomingIsProtected && evictionsNeeded > 0
      ? Object.values(currentLedger)
          .filter((entry) => !isProtectedFinancialEvidence(entry))
          .sort(compareEvictionCandidates)
          .slice(0, evictionsNeeded)
          .map((entry) => entry.paymentId)
      : [];
  const ledger = { ...currentLedger };
  for (const paymentId of evictedPaymentIds) delete ledger[paymentId];

  ledger[observation.paymentId] = {
    paymentId: observation.paymentId,
    status: durableStatus,
    ...(durableStatus === observation.status && observation.statusDetail
      ? { statusDetail: observation.statusDetail }
      : existing?.statusDetail
        ? { statusDetail: existing.statusDetail }
        : {}),
    amount: observation.amount,
    currency: observation.currency,
    firstSeenAt: existing?.firstSeenAt ?? observation.observedAt,
    lastSeenAt: observation.observedAt,
    ...(approvedAt !== undefined ? { approvedAt } : {}),
  };
  const approvedEntries = activeApprovedEntries(ledger);
  const legacyApprovedPaymentId =
    order.paymentStatus === "confirmed" &&
    order.mpPaymentId &&
    !ledger[order.mpPaymentId]
      ? order.mpPaymentId
      : undefined;
  const activeApprovedPaymentIds = Array.from(
    new Set([
      ...approvedEntries.map((approvedEntry) => approvedEntry.paymentId),
      ...(legacyApprovedPaymentId ? [legacyApprovedPaymentId] : []),
    ])
  );
  const hasUnidentifiedLegacyApproval =
    order.paymentStatus === "confirmed" && !order.mpPaymentId;
  const hasEffectiveApproval = activeApprovedPaymentIds.length > 0 || hasUnidentifiedLegacyApproval;
  const firstEffectiveApproval = order.paymentStatus !== "confirmed" && hasEffectiveApproval;

  let canonicalEntry: MercadoPagoPaymentLedgerEntry | undefined;
  let status: OrderStatus;
  let paymentStatus: OrderPaymentStatus;
  let canonicalPaymentId: string | undefined;
  let canonicalStatus: string | undefined;

  if (hasEffectiveApproval) {
    canonicalPaymentId =
      order.mpPaymentId && activeApprovedPaymentIds.includes(order.mpPaymentId)
        ? order.mpPaymentId
        : approvedEntries
            .slice()
            .sort((left, right) =>
              (left.approvedAt ?? left.firstSeenAt) - (right.approvedAt ?? right.firstSeenAt)
            )[0]?.paymentId ?? order.mpPaymentId;
    canonicalEntry = canonicalPaymentId ? ledger[canonicalPaymentId] : undefined;
    status = "approved";
    paymentStatus = "confirmed";
    canonicalStatus = canonicalEntry?.status === "approved" ? "approved" : order.mpStatus ?? "approved";
  } else {
    canonicalEntry = Object.values(ledger)
      .slice()
      .sort((left, right) => {
        const priorityDifference = statusPriority(right.status) - statusPriority(left.status);
        return priorityDifference || right.lastSeenAt - left.lastSeenAt;
      })[0];
    const aggregate = toOrderState(canonicalEntry?.status ?? observation.status);
    status = aggregate.status;
    paymentStatus = aggregate.paymentStatus;
    canonicalPaymentId = canonicalEntry?.paymentId;
    canonicalStatus = canonicalEntry?.status;
  }

  const earliestApprovedAt = approvedEntries
    .map((approvedEntry) => approvedEntry.approvedAt)
    .filter((value): value is number => value !== undefined)
    .sort((left, right) => left - right)[0];
  const multipleApproved = activeApprovedPaymentIds.length > 1;

  return {
    patch: {
      status,
      paymentStatus,
      mpPaymentId: canonicalPaymentId,
      mpStatus: canonicalStatus,
      mpPaymentLedger: ledger,
      mpPaymentAttentionCode:
        order.mpPaymentAttentionCode ??
        (multipleApproved ? MULTIPLE_APPROVED_MP_PAYMENTS : undefined),
      approvedAt: hasEffectiveApproval ? order.approvedAt ?? earliestApprovedAt : order.approvedAt,
    },
    duplicate: entryIsUnchanged(existing, observation),
    firstEffectiveApproval,
    activeApprovedPaymentIds,
    omittedForCapacity: false,
    evictedPaymentIds,
  };
};
