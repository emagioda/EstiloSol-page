import { fetchWithPolicy } from "@/src/server/http/fetchWithPolicy";
import { logEvent } from "@/src/server/observability/log";
import type { MpPaymentResponse, MpPreferenceResponse, MpSearchResponse } from "./shared";

const DEFAULT_POLICY = {
  timeoutMs: 8000,
  retries: 1,
} as const;

export const MP_PAYMENT_SEARCH_PAGE_SIZE = 20;
export const MAX_MP_PAYMENT_SEARCH_PAGES = 10;
export const MAX_MP_PAYMENT_SEARCH_RESULTS =
  MP_PAYMENT_SEARCH_PAGE_SIZE * MAX_MP_PAYMENT_SEARCH_PAGES;

type PaymentSearchPaginationFailureReason =
  | "invalid_paging"
  | "page_limit"
  | "result_limit";

export class MercadoPagoPaymentSearchPaginationError extends Error {
  readonly reason: PaymentSearchPaginationFailureReason;
  readonly reportedTotal?: number;

  constructor(reason: PaymentSearchPaginationFailureReason, reportedTotal?: number) {
    super(`Mercado Pago payment search incomplete: ${reason}`);
    this.name = "MercadoPagoPaymentSearchPaginationError";
    this.reason = reason;
    this.reportedTotal = reportedTotal;
  }
}

export async function createPreferenceOnMp(
  payload: unknown,
  input: { accessToken: string; idempotencyKey: string }
): Promise<{ response: Response; data: MpPreferenceResponse | null }> {
  const startedAt = Date.now();
  let status: number | undefined;

  try {
    const response = await fetchWithPolicy(
      "https://api.mercadopago.com/checkout/preferences",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${input.accessToken}`,
          "Content-Type": "application/json",
          "X-Idempotency-Key": input.idempotencyKey,
        },
        body: JSON.stringify(payload),
        cache: "no-store",
      },
      DEFAULT_POLICY
    );
    status = response.status;

    const data = (await response.json().catch(() => null)) as MpPreferenceResponse | null;
    logEvent("info", "payments.mp.create_preference_timing", {
      status,
      ok: response.ok,
      durationMs: Date.now() - startedAt,
    });
    return { response, data };
  } catch (error) {
    logEvent("warn", "payments.mp.create_preference_timing", {
      status,
      ok: false,
      durationMs: Date.now() - startedAt,
      errorName: error instanceof Error ? error.name : "unknown",
    });
    throw error;
  }
}

const isUsableCheckoutUrl = (value: unknown): value is string => {
  if (typeof value !== "string" || !value.trim()) return false;
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:";
  } catch {
    return false;
  }
};

export const isValidMpPreferenceResponse = (
  data: MpPreferenceResponse | null
): data is MpPreferenceResponse & { id: string | number } => {
  if (!data) return false;
  const validId =
    (typeof data.id === "string" && data.id.trim().length > 0) ||
    (typeof data.id === "number" && Number.isFinite(data.id));
  return Boolean(
    validId &&
      (isUsableCheckoutUrl(data.init_point) || isUsableCheckoutUrl(data.sandbox_init_point))
  );
};

export async function searchPaymentsByExternalReference(
  externalReference: string,
  accessToken: string,
  pagination: { offset?: number; limit?: number } = {}
): Promise<{ response: Response; data: MpSearchResponse | null }> {
  const offset = pagination.offset ?? 0;
  const limit = pagination.limit ?? MP_PAYMENT_SEARCH_PAGE_SIZE;
  const searchUrl = new URL("https://api.mercadopago.com/v1/payments/search");
  searchUrl.searchParams.set("external_reference", externalReference);
  searchUrl.searchParams.set("sort", "date_created");
  searchUrl.searchParams.set("criteria", "desc");
  searchUrl.searchParams.set("limit", String(limit));
  searchUrl.searchParams.set("offset", String(offset));

  const response = await fetchWithPolicy(
    searchUrl.toString(),
    {
      method: "GET",
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
      cache: "no-store",
    },
    DEFAULT_POLICY
  );

  const data = (await response.json().catch(() => null)) as MpSearchResponse | null;
  return { response, data };
}

const isNonNegativeInteger = (value: unknown): value is number =>
  typeof value === "number" && Number.isInteger(value) && value >= 0;

export async function* iteratePaymentSearchPagesByExternalReference(
  externalReference: string,
  accessToken: string
): AsyncGenerator<{ response: Response; data: MpSearchResponse | null }> {
  let offset = 0;

  for (let page = 0; page < MAX_MP_PAYMENT_SEARCH_PAGES; page += 1) {
    const search = await searchPaymentsByExternalReference(externalReference, accessToken, {
      offset,
      limit: MP_PAYMENT_SEARCH_PAGE_SIZE,
    });
    if (!search.response.ok) {
      yield search;
      return;
    }

    if (!search.data) {
      throw new MercadoPagoPaymentSearchPaginationError("invalid_paging");
    }
    const results = search.data.results ?? [];
    const paging = search.data.paging;
    if (!paging) {
      if (results.length >= MP_PAYMENT_SEARCH_PAGE_SIZE) {
        throw new MercadoPagoPaymentSearchPaginationError("invalid_paging");
      }
      yield search;
      return;
    }

    if (
      !isNonNegativeInteger(paging.total) ||
      !isNonNegativeInteger(paging.offset) ||
      !isNonNegativeInteger(paging.limit) ||
      paging.limit === 0 ||
      paging.offset !== offset
    ) {
      throw new MercadoPagoPaymentSearchPaginationError("invalid_paging");
    }
    if (paging.total > MAX_MP_PAYMENT_SEARCH_RESULTS) {
      throw new MercadoPagoPaymentSearchPaginationError("result_limit", paging.total);
    }
    const expectedPageSize = Math.min(paging.limit, paging.total - paging.offset);
    if (
      expectedPageSize < 0 ||
      results.length !== expectedPageSize ||
      paging.offset + results.length > paging.total
    ) {
      throw new MercadoPagoPaymentSearchPaginationError("invalid_paging", paging.total);
    }

    yield search;

    const nextOffset = paging.offset + paging.limit;
    if (nextOffset >= paging.total) return;
    if (nextOffset <= offset) {
      throw new MercadoPagoPaymentSearchPaginationError("invalid_paging", paging.total);
    }
    offset = nextOffset;
  }

  throw new MercadoPagoPaymentSearchPaginationError("page_limit");
}

export async function fetchPaymentByIdFromMp(
  paymentId: string,
  accessToken: string
): Promise<{ response: Response; data: MpPaymentResponse | null }> {
  const response = await fetchWithPolicy(
    `https://api.mercadopago.com/v1/payments/${encodeURIComponent(paymentId)}`,
    {
      method: "GET",
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
      cache: "no-store",
    },
    DEFAULT_POLICY
  );

  const data = (await response.json().catch(() => null)) as MpPaymentResponse | null;
  return { response, data };
}
