import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PurchaseReceiptPayloadV1 } from "./types";
import { sendPurchaseReceiptToResend } from "./provider";

const payload: PurchaseReceiptPayloadV1 = {
  externalReference: "es-email-provider-000001",
  recipientEmail: "customer@example.test",
  customerName: "Cliente",
  paymentId: "pay-provider-1",
  approvedAt: 1_765_843_200_000,
  items: [{ title: "Producto", qty: 1, unitPrice: 1000, currency: "ARS" }],
  total: 1000,
  currency: "ARS",
  fromEmail: "Estilo Sol <ventas@example.test>",
  templateVersion: 1,
};

describe("AUD3-H06-E Resend provider adapter", () => {
  beforeEach(() => {
    process.env.RESEND_API_KEY = "re_test_key";
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("sends the stable event identity in Idempotency-Key and requires a provider id", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ id: "provider-message-123" }), { status: 200 }),
    );
    const result = await sendPurchaseReceiptToResend({
      payload,
      idempotencyKey: "purchase-receipt/es-email-provider-000001/v1",
    });
    expect(result).toEqual({ accepted: true, providerMessageId: "provider-message-123" });
    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.resend.com/emails",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          "Idempotency-Key": "purchase-receipt/es-email-provider-000001/v1",
        }),
      }),
    );
  });

  it("treats a successful response without a valid id as response-unknown", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({}), { status: 200 }));
    await expect(sendPurchaseReceiptToResend({ payload, idempotencyKey: "stable-key" })).resolves.toEqual({
      accepted: false,
      disposition: "retryable",
      errorCode: "RESEND_RESPONSE_INVALID",
      outcomeUnknown: true,
    });
  });

  it.each([
    [429, {}, "RESEND_RATE_LIMITED", "retryable"],
    [503, {}, "RESEND_SERVER_ERROR", "retryable"],
    [400, {}, "RESEND_INVALID_REQUEST", "attention"],
    [409, { name: "invalid_idempotent_request" }, "RESEND_IDEMPOTENCY_CONFLICT", "attention"],
    [409, { name: "concurrent_idempotent_requests" }, "RESEND_CONCURRENT_IDEMPOTENT_REQUEST", "retryable"],
  ] as const)("classifies HTTP %s without exposing response content", async (status, body, errorCode, disposition) => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify(body), { status }),
    );
    await expect(sendPurchaseReceiptToResend({ payload, idempotencyKey: "stable-key" })).resolves.toMatchObject({
      accepted: false,
      disposition,
      errorCode,
    });
  });

  it("classifies a network failure as outcome-unknown", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("socket with sensitive detail"));
    await expect(sendPurchaseReceiptToResend({ payload, idempotencyKey: "stable-key" })).resolves.toEqual({
      accepted: false,
      disposition: "retryable",
      errorCode: "RESEND_NETWORK_ERROR",
      outcomeUnknown: true,
    });
  });

  it("never calls the provider when Resend is not configured", async () => {
    delete process.env.RESEND_API_KEY;
    const fetchMock = vi.spyOn(globalThis, "fetch");
    await expect(sendPurchaseReceiptToResend({ payload, idempotencyKey: "stable-key" })).resolves.toMatchObject({
      accepted: false,
      errorCode: "RESEND_NOT_CONFIGURED",
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
