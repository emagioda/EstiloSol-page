import type { OrderStatus } from "@/src/server/orders/types";

export type MpPreferenceResponse = {
  id?: string | number;
  init_point?: string;
  sandbox_init_point?: string;
  message?: string;
  cause?: unknown;
};

export type MpSearchPayment = {
  id?: string | number;
  status?: string;
  external_reference?: string;
  transaction_amount?: number;
  currency_id?: string;
};

export type MpSearchResponse = {
  results?: MpSearchPayment[];
};

export type MpPaymentResponse = {
  id?: string | number;
  status?: string;
  external_reference?: string;
  transaction_amount?: number;
  currency_id?: string;
};

export const CANCELLED_PAYMENT_STATUSES = new Set(["cancelled", "canceled"]);
export const REFUNDED_PAYMENT_STATUSES = new Set(["refunded"]);
export const CHARGED_BACK_PAYMENT_STATUSES = new Set(["charged_back"]);
export const REJECTED_PAYMENT_STATUSES = new Set([
  "rejected",
  ...CANCELLED_PAYMENT_STATUSES,
  ...REFUNDED_PAYMENT_STATUSES,
  ...CHARGED_BACK_PAYMENT_STATUSES,
]);

export const terminalOrderStatusFromMpStatus = (
  rawStatus: string
): Extract<OrderStatus, "rejected" | "cancelled" | "refunded" | "charged_back"> | null => {
  const status = rawStatus.trim().toLowerCase();
  if (status === "rejected") return "rejected";
  if (CANCELLED_PAYMENT_STATUSES.has(status)) return "cancelled";
  if (REFUNDED_PAYMENT_STATUSES.has(status)) return "refunded";
  if (CHARGED_BACK_PAYMENT_STATUSES.has(status)) return "charged_back";
  return null;
};

export const amountMatches = (actual: number, expected: number, tolerance = 0.01) => {
  return Math.abs(actual - expected) <= tolerance;
};
