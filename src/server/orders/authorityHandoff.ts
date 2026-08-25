import type { RecoveryPaymentEvent } from "@/src/server/recovery/types";
import type { AdminOrderSheetRow } from "@/src/server/sheets/repository";
import {
  applyMercadoPagoPaymentObservation,
  type MercadoPagoPaymentObservation,
} from "@/src/server/payments/ledger";
import { inventoryResultToOrderPatch, type InventoryAttemptResult } from "./inventory";
import { isTrustedHistoricalCompletion } from "./fulfillmentCompletion";
import type {
  Order,
  OrderDeliveryMethod,
  OrderInventoryStatus,
  OrderPaymentMethod,
  OrderPaymentStatus,
  OrderShippingStatus,
  OrderStatus,
} from "./types";

export const ORDER_AUTHORITY_HANDOFF_ERRORS = {
  duplicateSalesRows: "ORDER_AUTHORITY_DUPLICATE_SALES_ROWS",
  incoherentSalesRow: "ORDER_AUTHORITY_INCOHERENT_SALES_ROW",
  untrustedHistoricalCompletion: "ORDER_AUTHORITY_UNTRUSTED_HISTORICAL_COMPLETION",
  malformedKvOrder: "ORDER_AUTHORITY_MALFORMED_KV_ORDER",
  invalidCandidate: "ORDER_AUTHORITY_INVALID_CANDIDATE",
} as const;

export type OrderAuthorityHandoffErrorCode =
  (typeof ORDER_AUTHORITY_HANDOFF_ERRORS)[keyof typeof ORDER_AUTHORITY_HANDOFF_ERRORS];

export class OrderAuthorityHandoffError extends Error {
  readonly code: OrderAuthorityHandoffErrorCode;

  constructor(code: OrderAuthorityHandoffErrorCode, message: string) {
    super(message);
    this.name = "OrderAuthorityHandoffError";
    this.code = code;
  }
}

const normalizeKey = (value: string) =>
  value
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");

const normalizedRaw = (row: AdminOrderSheetRow) =>
  Object.fromEntries(Object.entries(row.raw).map(([key, value]) => [normalizeKey(key), value]));

const text = (value: unknown) =>
  typeof value === "string"
    ? value.trim()
    : typeof value === "number" && Number.isFinite(value)
      ? String(value)
      : "";

const timestamp = (value: unknown): number | undefined => {
  if (typeof value === "number" && Number.isFinite(value) && value > 0) return value;
  const parsed = typeof value === "string" && value.trim() ? Date.parse(value) : Number.NaN;
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
};

export type CanonicalManualPaymentEvidence = {
  paymentMethod: Extract<OrderPaymentMethod, "cash" | "transfer">;
  paymentId: string;
  approvedAt: number;
};

export const parseCanonicalManualPaymentEvidence = (
  row: AdminOrderSheetRow,
  expectedPaymentMethod?: OrderPaymentMethod,
): CanonicalManualPaymentEvidence | null => {
  const raw = normalizedRaw(row);
  const paymentMethod = row.paymentMethod;
  if (
    (paymentMethod !== "cash" && paymentMethod !== "transfer") ||
    (expectedPaymentMethod !== undefined && paymentMethod !== expectedPaymentMethod)
  ) {
    return null;
  }
  const paymentId = text(raw.mp_payment_id ?? raw.id_pago_mp);
  const approvedAt = timestamp(raw.approved_at ?? raw.fecha_pago);
  const receiptVersion = Number(raw.receipt_outbox_version);
  const orderStatus = text(raw.order_status ?? raw.status ?? raw.estado).toLowerCase();
  const mpStatus = text(raw.mp_status ?? raw.estado_mp).toLowerCase();
  if (
    row.paymentStatus !== "confirmed" ||
    orderStatus !== "approved" ||
    mpStatus !== "manual_confirmed" ||
    paymentId !== `manual-${row.orderId}` ||
    approvedAt === undefined ||
    receiptVersion !== 1
  ) {
    return null;
  }
  return { paymentMethod, paymentId, approvedAt };
};

const ORDER_STATUSES = new Set<OrderStatus>([
  "created",
  "preference_created",
  "approved",
  "rejected",
  "pending",
  "cancelled",
  "refunded",
  "charged_back",
]);
const PAYMENT_STATUSES = new Set<OrderPaymentStatus>([
  "pending",
  "confirmed",
  "cancelled",
  "refunded",
  "charged_back",
]);
const SHIPPING_STATUSES = new Set<OrderShippingStatus>(["in_process", "completed"]);
const PAYMENT_METHODS = new Set<OrderPaymentMethod>(["mercadopago", "transfer", "cash"]);
const DELIVERY_METHODS = new Set<OrderDeliveryMethod>(["delivery", "pickup"]);
const INVENTORY_STATUSES = new Set<OrderInventoryStatus>([
  "pending",
  "deducted",
  "conflict",
  "error",
]);

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);

const isCoherentPaymentLedger = (value: unknown): boolean =>
  value === undefined ||
  (isRecord(value) &&
    Object.entries(value).every(
      ([paymentId, entry]) =>
        isRecord(entry) &&
        paymentId.length > 0 &&
        entry.paymentId === paymentId &&
        typeof entry.status === "string" &&
        entry.status.length > 0 &&
        typeof entry.amount === "number" &&
        Number.isFinite(entry.amount) &&
        entry.currency === "ARS" &&
        typeof entry.firstSeenAt === "number" &&
        Number.isFinite(entry.firstSeenAt) &&
        typeof entry.lastSeenAt === "number" &&
        Number.isFinite(entry.lastSeenAt),
    ));

export const assertCoherentOperationalOrder: (
  value: unknown,
  expectedExternalReference?: string,
  errorCode?: OrderAuthorityHandoffErrorCode,
) => asserts value is Order = (
  value: unknown,
  expectedExternalReference?: string,
  errorCode: OrderAuthorityHandoffErrorCode = ORDER_AUTHORITY_HANDOFF_ERRORS.invalidCandidate,
): asserts value is Order => {
  if (!isRecord(value)) {
    throw new OrderAuthorityHandoffError(errorCode, "Order authority value is not an object");
  }
  const order = value as Partial<Order>;
  if (
    typeof order.externalReference !== "string" ||
    !order.externalReference ||
    (expectedExternalReference !== undefined && order.externalReference !== expectedExternalReference) ||
    !ORDER_STATUSES.has(order.status as OrderStatus) ||
    !PAYMENT_STATUSES.has(order.paymentStatus as OrderPaymentStatus) ||
    !SHIPPING_STATUSES.has(order.shippingStatus as OrderShippingStatus) ||
    !PAYMENT_METHODS.has(order.paymentMethod as OrderPaymentMethod) ||
    !DELIVERY_METHODS.has(order.deliveryMethod as OrderDeliveryMethod) ||
    (order.inventoryStatus !== undefined &&
      !INVENTORY_STATUSES.has(order.inventoryStatus as OrderInventoryStatus)) ||
    (order.receiptOutboxVersion !== undefined && order.receiptOutboxVersion !== 1) ||
    (order.approvedAt !== undefined &&
      (!Number.isFinite(order.approvedAt) || order.approvedAt <= 0)) ||
    (order.stockDeductedAt !== undefined &&
      (!Number.isFinite(order.stockDeductedAt) || order.stockDeductedAt <= 0)) ||
    (order.mpPaymentId !== undefined &&
      (typeof order.mpPaymentId !== "string" || !order.mpPaymentId.trim())) ||
    !isCoherentPaymentLedger(order.mpPaymentLedger) ||
    !Array.isArray(order.items) ||
    order.items.length === 0 ||
    order.items.some(
      (item) =>
        !item ||
        typeof item.productId !== "string" ||
        !item.productId.trim() ||
        typeof item.title !== "string" ||
        !item.title.trim() ||
        !Number.isInteger(item.qty) ||
        item.qty <= 0 ||
        !Number.isFinite(item.unitPrice) ||
        item.unitPrice < 0 ||
        item.currency !== "ARS",
    ) ||
    !Number.isFinite(order.total) ||
    Number(order.total) < 0 ||
    order.currency !== "ARS" ||
    !Number.isFinite(order.createdAt) ||
    Number(order.createdAt) <= 0 ||
    !Number.isFinite(order.updatedAt) ||
    Number(order.updatedAt) <= 0
  ) {
    throw new OrderAuthorityHandoffError(errorCode, "Order authority value is incoherent");
  }
};

export const recoveryEventToPaymentObservation = (
  event: RecoveryPaymentEvent,
): MercadoPagoPaymentObservation => {
  const observedAt = Date.parse(event.mpUpdatedAt || event.observedAt);
  if (
    event.validationState !== "validated" ||
    !event.externalReference ||
    !event.paymentId ||
    event.currency !== "ARS" ||
    !Number.isFinite(event.amount) ||
    !Number.isFinite(observedAt)
  ) {
    throw new OrderAuthorityHandoffError(
      ORDER_AUTHORITY_HANDOFF_ERRORS.invalidCandidate,
      "Recovery payment event is not canonical",
    );
  }
  return {
    paymentId: event.paymentId,
    status: event.financialStatus,
    ...(event.statusDetail ? { statusDetail: event.statusDetail } : {}),
    amount: event.amount,
    currency: "ARS",
    observedAt,
  };
};

export const validateRecoveryPaymentEvidence = (
  snapshotOrder: Order,
  events: RecoveryPaymentEvent[],
): boolean => {
  if (snapshotOrder.paymentMethod !== "mercadopago") return false;
  if (events.length === 0) {
    throw new OrderAuthorityHandoffError(
      ORDER_AUTHORITY_HANDOFF_ERRORS.invalidCandidate,
      "Missing durable provider evidence is unknown",
    );
  }
  for (const event of events) {
    if (
      event.externalReference !== snapshotOrder.externalReference ||
      !event.snapshotHash ||
      !/^[a-f0-9]{64}$/i.test(event.snapshotHash) ||
      Math.abs(event.amount - snapshotOrder.total) > 0.01 ||
      event.currency !== snapshotOrder.currency
    ) {
      throw new OrderAuthorityHandoffError(
        ORDER_AUTHORITY_HANDOFF_ERRORS.invalidCandidate,
        "Recovery payment evidence conflicts with immutable snapshot facts",
      );
    }
    recoveryEventToPaymentObservation(event);
  }
  return events.some((event) => event.financialStatus === "approved");
};

const paymentObservationRank = (status: string) => {
  if (status === "charged_back") return 3;
  if (status === "refunded") return 2;
  return 1;
};

export const assertCoherentSalesAuthorityRow = (
  snapshotOrder: Order,
  row: AdminOrderSheetRow,
) => {
  const raw = normalizedRaw(row);
  const rawOrderId = text(
    raw.nro_de_compra ??
      raw.order_id ??
      raw.id_pedido ??
      raw.orderid ??
      raw.external_reference ??
      raw.id,
  );
  const rawTotal = text(raw.total ?? raw.total_amount ?? raw.amount);
  const rawCurrency = text(raw.currency ?? raw.moneda).toUpperCase();
  const paymentToken = normalizeKey(
    text(raw.estado_de_pago ?? raw.payment_status ?? raw.estado_pago ?? raw.payment_state),
  );
  const shippingToken = normalizeKey(
    text(raw.estado_de_envio ?? raw.shipping_status ?? raw.estado_envio ?? raw.shipping_state),
  );
  const parsedPaymentToken: OrderPaymentStatus | null =
    paymentToken.includes("contracargo") || paymentToken.includes("charge")
      ? "charged_back"
      : paymentToken.includes("reintegr") ||
          paymentToken.includes("devol") ||
          paymentToken.includes("refund")
        ? "refunded"
        : paymentToken.includes("confirm") || paymentToken.includes("aprobad")
          ? "confirmed"
          : paymentToken.includes("cancel") || paymentToken.includes("rechaz")
            ? "cancelled"
            : paymentToken.includes("pend")
              ? "pending"
              : null;
  const parsedShippingToken: OrderShippingStatus | null =
    shippingToken.includes("final") ||
    shippingToken.includes("complet") ||
    shippingToken.includes("entreg")
      ? "completed"
      : shippingToken.includes("proces") || shippingToken.includes("pending")
        ? "in_process"
        : null;
  if (
    rawOrderId !== snapshotOrder.externalReference ||
    !rawTotal ||
    rawCurrency !== snapshotOrder.currency ||
    parsedPaymentToken !== row.paymentStatus ||
    parsedShippingToken !== row.shippingStatus ||
    !Number.isFinite(row.createdAtMs) ||
    row.createdAtMs <= 0 ||
    row.orderId !== snapshotOrder.externalReference ||
    row.currency !== snapshotOrder.currency ||
    Math.abs(row.total - snapshotOrder.total) > 0.01 ||
    row.paymentMethod !== snapshotOrder.paymentMethod ||
    row.deliveryMethod !== snapshotOrder.deliveryMethod
  ) {
    throw new OrderAuthorityHandoffError(
      ORDER_AUTHORITY_HANDOFF_ERRORS.incoherentSalesRow,
      `ventas identity conflicts with ${snapshotOrder.externalReference}`,
    );
  }
};

export type RecoveryAuthorityCandidateInput = {
  snapshotOrder: Order;
  paymentEvents: RecoveryPaymentEvent[];
  salesRow: AdminOrderSheetRow | null;
  inventoryResult?: InventoryAttemptResult;
  receiptEventExists: boolean;
  now?: number;
};

export const buildRecoveryAuthorityCandidate = (
  input: RecoveryAuthorityCandidateInput,
): Order => {
  if (input.salesRow) {
    assertCoherentSalesAuthorityRow(input.snapshotOrder, input.salesRow);
  }
  const canonicalApprovalExists = validateRecoveryPaymentEvidence(
    input.snapshotOrder,
    input.paymentEvents,
  );

  // Only the validated snapshot is copied. The ventas row is never spread into Order.
  let candidate: Order = {
    ...input.snapshotOrder,
    status: input.snapshotOrder.status,
    paymentStatus: input.snapshotOrder.paymentStatus,
    shippingStatus: "in_process",
    inventoryStatus: "pending",
    inventoryIssueCode: undefined,
    inventoryIssueAt: undefined,
    stockDeductedAt: undefined,
    receiptOutboxVersion: input.receiptEventExists ? 1 : undefined,
    updatedAt: input.now ?? Date.now(),
  };

  let priorApprovalProven = canonicalApprovalExists;
  if (candidate.paymentMethod === "mercadopago") {
    const events = [...input.paymentEvents]
      .filter((event) => event.externalReference === candidate.externalReference)
      .sort((left, right) => {
        const time = Date.parse(left.mpUpdatedAt || left.observedAt) - Date.parse(right.mpUpdatedAt || right.observedAt);
        return time || paymentObservationRank(left.financialStatus) - paymentObservationRank(right.financialStatus);
      });
    for (const event of events) {
      const ledger = applyMercadoPagoPaymentObservation(
        candidate,
        recoveryEventToPaymentObservation(event),
      );
      if (ledger.omittedForCapacity) {
        throw new OrderAuthorityHandoffError(
          ORDER_AUTHORITY_HANDOFF_ERRORS.invalidCandidate,
          "Recovery payment evidence exceeds ledger capacity",
        );
      }
      candidate = { ...candidate, ...ledger.patch };
    }
    const sheetPaymentStatus = input.salesRow?.paymentStatus;
    const sheetStatusIsCovered =
      sheetPaymentStatus === undefined ||
      sheetPaymentStatus === "pending" ||
      (sheetPaymentStatus === "cancelled" &&
        (candidate.paymentStatus === "cancelled" ||
          priorApprovalProven ||
          candidate.paymentStatus === "refunded" ||
          candidate.paymentStatus === "charged_back")) ||
      (sheetPaymentStatus === "confirmed" &&
        (priorApprovalProven ||
          candidate.paymentStatus === "refunded" ||
          candidate.paymentStatus === "charged_back")) ||
      (sheetPaymentStatus === "refunded" &&
        (candidate.paymentStatus === "refunded" || candidate.paymentStatus === "charged_back")) ||
      (sheetPaymentStatus === "charged_back" && candidate.paymentStatus === "charged_back");
    if (!sheetStatusIsCovered) {
      throw new OrderAuthorityHandoffError(
        ORDER_AUTHORITY_HANDOFF_ERRORS.incoherentSalesRow,
        "ventas financial state lacks matching durable provider evidence",
      );
    }
  } else if (input.salesRow) {
    const manual = parseCanonicalManualPaymentEvidence(
      input.salesRow,
      candidate.paymentMethod,
    );
    if (manual) {
      priorApprovalProven = true;
      candidate = {
        ...candidate,
        status: "approved",
        paymentStatus: "confirmed",
        mpStatus: "manual_confirmed",
        mpPaymentId: manual.paymentId,
        approvedAt: manual.approvedAt,
        receiptOutboxVersion: 1,
      };
    } else if (input.salesRow.paymentStatus !== "pending") {
      throw new OrderAuthorityHandoffError(
        ORDER_AUTHORITY_HANDOFF_ERRORS.incoherentSalesRow,
        "Manual ventas payment evidence is incomplete",
      );
    }
  }

  if (input.inventoryResult) {
    candidate = { ...candidate, ...inventoryResultToOrderPatch(input.inventoryResult) };
  }

  if (input.salesRow?.shippingStatus === "completed") {
    const journalPreexisted =
      input.inventoryResult?.status === "deducted" && input.inventoryResult.deduped;
    const historicalCandidate: Order = { ...candidate, shippingStatus: "completed" };
    if (
      !priorApprovalProven ||
      !journalPreexisted ||
      !isTrustedHistoricalCompletion(historicalCandidate)
    ) {
      throw new OrderAuthorityHandoffError(
        ORDER_AUTHORITY_HANDOFF_ERRORS.untrustedHistoricalCompletion,
        "ventas completed state lacks canonical historical H07-A evidence",
      );
    }
    candidate = historicalCandidate;
  }

  assertCoherentOperationalOrder(candidate);
  return candidate;
};
