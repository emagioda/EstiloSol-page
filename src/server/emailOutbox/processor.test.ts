import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PurchaseReceiptPayloadV1, EmailOutboxEvent } from "./types";
import type { ReceiptProviderResult } from "./provider";
import { canonicalEmailPayloadJson, hashEmailPayload } from "./payload";
import {
  EMAIL_RETRY_BACKOFF_MS,
  RESEND_IDEMPOTENCY_WINDOW_MS,
  processClaimedEmailOutboxEvent,
  processEmailOutboxEvent,
} from "./processor";

const now = Date.parse("2026-08-16T12:00:00.000Z");
const payload = (recipientEmail = "customer@example.test"): PurchaseReceiptPayloadV1 => ({
  externalReference: "es-email-process-000001",
  recipientEmail,
  customerName: "Cliente",
  paymentId: "pay-process-1",
  approvedAt: now - 60_000,
  items: [{ title: "Producto", qty: 1, unitPrice: 1000, currency: "ARS" }],
  total: 1000,
  currency: "ARS",
  fromEmail: "Estilo Sol <ventas@example.test>",
  brandName: "Estilo Sol",
  supportEmail: "estilosol.ms@gmail.com",
  supportWhatsappLabel: "+54 9 341 688-8926",
  logoUrl: "",
  logoAlt: "Logo Estilo Sol",
  orderDetailUrl: "https://estilosol.example.test/tienda/success?ref=es-email-process-000001",
  templateVersion: 1,
});

const processingEvent = (
  patch: Partial<EmailOutboxEvent> = {},
  receiptPayload = payload(),
): EmailOutboxEvent => {
  const payloadJson = canonicalEmailPayloadJson(receiptPayload);
  return {
    eventKey: "purchase-receipt/es-email-process-000001/v1",
    externalReference: "es-email-process-000001",
    notificationType: "purchase_receipt",
    schemaVersion: 1,
    templateVersion: 1,
    payloadHash: hashEmailPayload(payloadJson),
    payloadJson,
    idempotencyKey: "purchase-receipt/es-email-process-000001/v1",
    state: "processing",
    attemptCount: 1,
    leaseOwner: "email-worker-one",
    leaseExpiresAt: new Date(now + 300_000).toISOString(),
    providerFirstAttemptAt: new Date(now).toISOString(),
    lastAttemptAt: new Date(now).toISOString(),
    createdAt: new Date(now - 1_000).toISOString(),
    updatedAt: new Date(now).toISOString(),
    ...patch,
  };
};

const dependencies = (event = processingEvent()) => ({
  now: () => now,
  owner: () => "email-worker-one",
  claim: vi.fn(async () => [event]),
  getEvent: vi.fn(async () => event),
  send: vi.fn(async (): Promise<ReceiptProviderResult> => ({
    accepted: true,
    providerMessageId: "provider-message-123",
  })),
  markAccepted: vi.fn(async () => ({
    ...event,
    state: "accepted" as const,
    leaseOwner: undefined,
    acceptedAt: new Date(now).toISOString(),
    providerMessageId: "provider-message-123",
  })),
  markRetryable: vi.fn(async () => ({ ...event, state: "retryable" as const })),
  markAttention: vi.fn(async () => ({ ...event, state: "attention" as const })),
  markSkipped: vi.fn(async () => ({ ...event, state: "skipped" as const })),
  projectMarker: vi.fn(async () => true),
});

describe("AUD3-H06-E durable receipt processor", () => {
  beforeEach(() => vi.clearAllMocks());

  it("persists accepted state and provider id before projecting receiptEmailSentAt", async () => {
    const event = processingEvent();
    const deps = dependencies(event);
    await expect(processClaimedEmailOutboxEvent(event, "email-worker-one", deps)).resolves.toBe("accepted");
    expect(deps.send).toHaveBeenCalledWith({
      payload: payload(),
      idempotencyKey: event.eventKey,
    });
    expect(deps.markAccepted).toHaveBeenCalledWith(expect.objectContaining({
      eventKey: event.eventKey,
      providerMessageId: "provider-message-123",
    }));
    expect(deps.markAccepted.mock.invocationCallOrder[0]).toBeLessThan(
      deps.projectMarker.mock.invocationCallOrder[0],
    );
  });

  it("repairs a missing compatibility marker from accepted state without provider resend", async () => {
    const event = processingEvent({
      state: "accepted",
      leaseOwner: undefined,
      acceptedAt: new Date(now).toISOString(),
      providerMessageId: "provider-message-123",
      payloadJson: "",
    });
    const deps = dependencies(event);
    await expect(processEmailOutboxEvent(event.eventKey, deps)).resolves.toBe("marker_repaired");
    expect(deps.projectMarker).toHaveBeenCalledWith(event.externalReference, event.acceptedAt);
    expect(deps.send).not.toHaveBeenCalled();
    expect(deps.claim).not.toHaveBeenCalled();
  });

  it("does not resend after an accepted write response is lost", async () => {
    const event = processingEvent();
    const accepted = {
      ...event,
      state: "accepted" as const,
      acceptedAt: new Date(now).toISOString(),
      providerMessageId: "provider-message-123",
    };
    const deps = dependencies(event);
    deps.markAccepted.mockRejectedValueOnce(new Error("response lost"));
    deps.getEvent.mockResolvedValueOnce(accepted);
    await expect(processClaimedEmailOutboxEvent(event, "email-worker-one", deps)).resolves.toBe("accepted");
    expect(deps.send).toHaveBeenCalledTimes(1);
    expect(deps.projectMarker).toHaveBeenCalledWith(accepted.externalReference, accepted.acceptedAt);
  });

  it("skips missing customer email without calling Resend", async () => {
    const event = processingEvent({}, payload(""));
    const deps = dependencies(event);
    await expect(processClaimedEmailOutboxEvent(event, "email-worker-one", deps)).resolves.toBe("skipped");
    expect(deps.markSkipped).toHaveBeenCalledWith({
      eventKey: event.eventKey,
      leaseOwner: "email-worker-one",
      errorCode: "MISSING_CUSTOMER_EMAIL",
    });
    expect(deps.send).not.toHaveBeenCalled();
  });

  it("sends invalid customer email to attention without calling Resend", async () => {
    const event = processingEvent({}, payload("not-an-email"));
    const deps = dependencies(event);
    await expect(processClaimedEmailOutboxEvent(event, "email-worker-one", deps)).resolves.toBe("attention");
    expect(deps.markAttention).toHaveBeenCalledWith({
      eventKey: event.eventKey,
      leaseOwner: "email-worker-one",
      errorCode: "CUSTOMER_EMAIL_INVALID",
    });
    expect(deps.send).not.toHaveBeenCalled();
  });

  it("moves a tampered payload to attention", async () => {
    const event = processingEvent({ payloadJson: "{}" });
    const deps = dependencies(event);
    await expect(processClaimedEmailOutboxEvent(event, "email-worker-one", deps)).resolves.toBe("attention");
    expect(deps.markAttention).toHaveBeenCalledWith(expect.objectContaining({
      errorCode: "EMAIL_OUTBOX_EVENT_CONFLICT",
    }));
    expect(deps.send).not.toHaveBeenCalled();
  });

  it("schedules bounded backoff for retryable provider failures", async () => {
    const event = processingEvent({ attemptCount: 1 });
    const deps = dependencies(event);
    deps.send.mockResolvedValueOnce({
      accepted: false,
      disposition: "retryable",
      errorCode: "RESEND_RATE_LIMITED",
      outcomeUnknown: false,
    });
    await expect(processClaimedEmailOutboxEvent(event, "email-worker-one", deps)).resolves.toBe("retryable");
    expect(deps.markRetryable).toHaveBeenCalledWith({
      eventKey: event.eventKey,
      leaseOwner: "email-worker-one",
      errorCode: "RESEND_RATE_LIMITED",
      nextAttemptAt: new Date(now + EMAIL_RETRY_BACKOFF_MS[0]).toISOString(),
    });
  });

  it("moves the fifth failed attempt to attention", async () => {
    const event = processingEvent({ attemptCount: 5 });
    const deps = dependencies(event);
    deps.send.mockResolvedValueOnce({
      accepted: false,
      disposition: "retryable",
      errorCode: "RESEND_SERVER_ERROR",
      outcomeUnknown: false,
    });
    await expect(processClaimedEmailOutboxEvent(event, "email-worker-one", deps)).resolves.toBe("attention");
    expect(deps.markAttention).toHaveBeenCalledWith(expect.objectContaining({
      errorCode: "RESEND_SERVER_ERROR",
    }));
    expect(deps.markRetryable).not.toHaveBeenCalled();
  });

  it("does not blindly retry response-unknown work outside Resend's safe window", async () => {
    const event = processingEvent({
      attemptCount: 2,
      providerFirstAttemptAt: new Date(now - RESEND_IDEMPOTENCY_WINDOW_MS).toISOString(),
      lastErrorCode: "RESEND_NETWORK_ERROR",
    });
    const deps = dependencies(event);
    await expect(processClaimedEmailOutboxEvent(event, "email-worker-one", deps)).resolves.toBe("attention");
    expect(deps.markAttention).toHaveBeenCalledWith(expect.objectContaining({
      errorCode: "RESEND_OUTCOME_UNKNOWN",
    }));
    expect(deps.send).not.toHaveBeenCalled();
  });

  it("retries response-unknown work inside the safe window with the same provider key", async () => {
    const event = processingEvent({
      attemptCount: 2,
      providerFirstAttemptAt: new Date(now - RESEND_IDEMPOTENCY_WINDOW_MS + 1).toISOString(),
      lastErrorCode: "RESEND_NETWORK_ERROR",
    });
    const deps = dependencies(event);
    await expect(processClaimedEmailOutboxEvent(event, "email-worker-one", deps)).resolves.toBe("accepted");
    expect(deps.send).toHaveBeenCalledWith(expect.objectContaining({ idempotencyKey: event.eventKey }));
  });

  it("AUD3-H06E-CRASH-06 reclaims blank-error ambiguous processing inside 24h with the same request", async () => {
    const event = processingEvent({
      attemptCount: 2,
      providerFirstAttemptAt: new Date(now - 60 * 60 * 1000).toISOString(),
      lastErrorCode: undefined,
    });
    const deps = dependencies(event);
    await expect(processClaimedEmailOutboxEvent(event, "email-worker-one", deps)).resolves.toBe("accepted");
    expect(deps.send).toHaveBeenCalledWith({
      payload: payload(),
      idempotencyKey: event.idempotencyKey,
    });
  });

  it("AUD3-H06E-CRASH-07 moves blank-error ambiguous processing at 24h to unknown attention", async () => {
    const event = processingEvent({
      attemptCount: 2,
      providerFirstAttemptAt: new Date(now - RESEND_IDEMPOTENCY_WINDOW_MS).toISOString(),
      lastErrorCode: undefined,
    });
    const deps = dependencies(event);
    await expect(processClaimedEmailOutboxEvent(event, "email-worker-one", deps)).resolves.toBe("attention");
    expect(deps.markAttention).toHaveBeenCalledWith({
      eventKey: event.eventKey,
      leaseOwner: "email-worker-one",
      errorCode: "RESEND_OUTCOME_UNKNOWN",
    });
    expect(deps.send).not.toHaveBeenCalled();
  });

  it("AUD3-H06E-CRASH-08 accepts an inside-window idempotent replay with the original provider id", async () => {
    const event = processingEvent({
      attemptCount: 2,
      providerFirstAttemptAt: new Date(now - 60 * 60 * 1000).toISOString(),
      lastErrorCode: undefined,
    });
    const deps = dependencies(event);
    deps.send.mockResolvedValueOnce({
      accepted: true,
      providerMessageId: "provider-message-original",
    });
    await expect(processClaimedEmailOutboxEvent(event, "email-worker-one", deps)).resolves.toBe("accepted");
    expect(deps.markAccepted).toHaveBeenCalledWith(expect.objectContaining({
      providerMessageId: "provider-message-original",
    }));
    expect(deps.send).toHaveBeenCalledTimes(1);
  });

  it("AUD3-H06E-CRASH-09 bounds concurrent idempotent uncertainty by the same 24h window", async () => {
    const inside = processingEvent({
      attemptCount: 2,
      providerFirstAttemptAt: new Date(now - RESEND_IDEMPOTENCY_WINDOW_MS + 1).toISOString(),
      lastErrorCode: "RESEND_CONCURRENT_IDEMPOTENT_REQUEST",
    });
    const insideDeps = dependencies(inside);
    insideDeps.send.mockResolvedValueOnce({
      accepted: false,
      disposition: "retryable",
      errorCode: "RESEND_CONCURRENT_IDEMPOTENT_REQUEST",
      outcomeUnknown: true,
    });
    await expect(processClaimedEmailOutboxEvent(inside, "email-worker-one", insideDeps)).resolves.toBe("retryable");
    expect(insideDeps.send).toHaveBeenCalledWith(expect.objectContaining({
      idempotencyKey: inside.idempotencyKey,
    }));

    const outside = processingEvent({
      attemptCount: 3,
      providerFirstAttemptAt: new Date(now - RESEND_IDEMPOTENCY_WINDOW_MS).toISOString(),
      lastErrorCode: "RESEND_CONCURRENT_IDEMPOTENT_REQUEST",
    });
    const outsideDeps = dependencies(outside);
    await expect(processClaimedEmailOutboxEvent(outside, "email-worker-one", outsideDeps)).resolves.toBe("attention");
    expect(outsideDeps.markAttention).toHaveBeenCalledWith(expect.objectContaining({
      errorCode: "RESEND_OUTCOME_UNKNOWN",
    }));
    expect(outsideDeps.send).not.toHaveBeenCalled();
  });

  it("AUD3-H06E-CRASH-10 never reclaims accepted work with expired-looking timestamps", async () => {
    const event = processingEvent({
      state: "accepted",
      leaseOwner: undefined,
      leaseExpiresAt: new Date(now - RESEND_IDEMPOTENCY_WINDOW_MS).toISOString(),
      providerFirstAttemptAt: new Date(now - 2 * RESEND_IDEMPOTENCY_WINDOW_MS).toISOString(),
      acceptedAt: new Date(now - RESEND_IDEMPOTENCY_WINDOW_MS).toISOString(),
      completedAt: new Date(now - RESEND_IDEMPOTENCY_WINDOW_MS).toISOString(),
      providerMessageId: "provider-message-123",
      payloadJson: "",
    });
    const deps = dependencies(event);
    await expect(processEmailOutboxEvent(event.eventKey, deps)).resolves.toBe("marker_repaired");
    expect(deps.claim).not.toHaveBeenCalled();
    expect(deps.send).not.toHaveBeenCalled();
  });

  it("does not process a lease owned by another worker", async () => {
    const event = processingEvent({ leaseOwner: "email-worker-other" });
    const deps = dependencies(event);
    await expect(processClaimedEmailOutboxEvent(event, "email-worker-one", deps)).resolves.toBe("not_claimed");
    expect(deps.send).not.toHaveBeenCalled();
  });
});
