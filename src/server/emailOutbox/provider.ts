import "server-only";

import { env } from "@/src/config/env";
import type { PurchaseReceiptPayloadV1 } from "./types";
import { renderPurchaseReceiptV1 } from "./payload";

export type ReceiptProviderResult =
  | { accepted: true; providerMessageId: string }
  | {
      accepted: false;
      disposition: "retryable" | "attention";
      errorCode:
        | "RESEND_RATE_LIMITED"
        | "RESEND_SERVER_ERROR"
        | "RESEND_NETWORK_ERROR"
        | "RESEND_NOT_CONFIGURED"
        | "RESEND_INVALID_REQUEST"
        | "RESEND_RESPONSE_INVALID"
        | "RESEND_IDEMPOTENCY_CONFLICT"
        | "RESEND_CONCURRENT_IDEMPOTENT_REQUEST";
      outcomeUnknown: boolean;
    };

const readErrorType = async (response: Response): Promise<string> => {
  const data = (await response.json().catch(() => null)) as { name?: unknown; type?: unknown } | null;
  const value = data?.name ?? data?.type;
  return typeof value === "string" ? value : "";
};
export const sendPurchaseReceiptToResend = async (input: {
  payload: PurchaseReceiptPayloadV1;
  idempotencyKey: string;
  beforeProviderRequest: () => Promise<void>;
}): Promise<ReceiptProviderResult> => {
  const apiKey = env.getOptionalServer("RESEND_API_KEY");
  if (!apiKey) {
    return {
      accepted: false,
      disposition: "retryable",
      errorCode: "RESEND_NOT_CONFIGURED",
      outcomeUnknown: false,
    };
  }
  const request = renderPurchaseReceiptV1(input.payload);
  await input.beforeProviderRequest();
  let response: Response;
  try {
    response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        "Idempotency-Key": input.idempotencyKey,
      },
      body: JSON.stringify(request),
    });
  } catch {
    return {
      accepted: false,
      disposition: "retryable",
      errorCode: "RESEND_NETWORK_ERROR",
      outcomeUnknown: true,
    };
  }

  if (response.ok) {
    const data = (await response.json().catch(() => null)) as { id?: unknown } | null;
    if (typeof data?.id === "string" && /^[A-Za-z0-9_-]{8,160}$/.test(data.id)) {
      return { accepted: true, providerMessageId: data.id };
    }
    return {
      accepted: false,
      disposition: "retryable",
      errorCode: "RESEND_RESPONSE_INVALID",
      outcomeUnknown: true,
    };
  }

  const errorType = await readErrorType(response);
  if (response.status === 409 && errorType === "invalid_idempotent_request") {
    return {
      accepted: false,
      disposition: "attention",
      errorCode: "RESEND_IDEMPOTENCY_CONFLICT",
      outcomeUnknown: false,
    };
  }
  if (response.status === 409 && errorType === "concurrent_idempotent_requests") {
    return {
      accepted: false,
      disposition: "retryable",
      errorCode: "RESEND_CONCURRENT_IDEMPOTENT_REQUEST",
      outcomeUnknown: true,
    };
  }
  if (response.status === 429) {
    return {
      accepted: false,
      disposition: "retryable",
      errorCode: "RESEND_RATE_LIMITED",
      outcomeUnknown: false,
    };
  }
  if (response.status >= 500) {
    return {
      accepted: false,
      disposition: "retryable",
      errorCode: "RESEND_SERVER_ERROR",
      outcomeUnknown: false,
    };
  }
  if (response.status === 401 || response.status === 403) {
    return {
      accepted: false,
      disposition: "retryable",
      errorCode: "RESEND_NOT_CONFIGURED",
      outcomeUnknown: false,
    };
  }
  return {
    accepted: false,
    disposition: "attention",
    errorCode: "RESEND_INVALID_REQUEST",
    outcomeUnknown: false,
  };
};
