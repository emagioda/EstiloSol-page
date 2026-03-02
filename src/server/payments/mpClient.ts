import { fetchWithPolicy } from "@/src/server/http/fetchWithPolicy";
import type { MpPaymentResponse, MpPreferenceResponse, MpSearchResponse } from "./shared";

const DEFAULT_POLICY = {
  timeoutMs: 8000,
  retries: 1,
} as const;

export async function createPreferenceOnMp(
  payload: unknown,
  input: { accessToken: string; idempotencyKey: string }
): Promise<{ response: Response; data: MpPreferenceResponse | null }> {
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

  const data = (await response.json().catch(() => null)) as MpPreferenceResponse | null;
  return { response, data };
}

export async function searchPaymentsByExternalReference(
  externalReference: string,
  accessToken: string
): Promise<{ response: Response; data: MpSearchResponse | null }> {
  const searchUrl = new URL("https://api.mercadopago.com/v1/payments/search");
  searchUrl.searchParams.set("external_reference", externalReference);
  searchUrl.searchParams.set("sort", "date_created");
  searchUrl.searchParams.set("criteria", "desc");
  searchUrl.searchParams.set("limit", "5");

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
