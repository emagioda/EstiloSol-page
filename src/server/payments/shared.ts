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

export const REJECTED_PAYMENT_STATUSES = new Set(["rejected", "cancelled", "charged_back"]);

export const amountMatches = (actual: number, expected: number, tolerance = 0.01) => {
  return Math.abs(actual - expected) <= tolerance;
};
