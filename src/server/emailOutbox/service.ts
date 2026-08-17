import "server-only";

import { scheduleAfterResponse } from "@/src/server/http/afterResponse";
import { logEvent } from "@/src/server/observability/log";
import type { Order } from "@/src/server/orders/types";
import {
  buildPurchaseReceiptEventKey,
  buildPurchaseReceiptPayload,
  canonicalEmailPayloadJson,
  hashEmailPayload,
} from "./payload";
import { processEmailOutboxEvent } from "./processor";
import { upsertEmailOutboxEvent } from "./repository";

const processPurchaseReceiptEventSafely = async (eventKey: string, externalReference: string) => {
  try {
    await processEmailOutboxEvent(eventKey);
  } catch (error) {
    logEvent("warn", "email.outbox.immediate_processing_failed", {
      externalReference,
      eventKey,
      errorName: error instanceof Error ? error.name : "unknown",
    });
  }
};

export const ensurePurchaseReceiptEvent = async (input: {
  order: Order;
  paymentId: string;
  approvedAt: number;
}) => {
  const payload = buildPurchaseReceiptPayload(input);
  const payloadJson = canonicalEmailPayloadJson(payload);
  const payloadHash = hashEmailPayload(payloadJson);
  const eventKey = buildPurchaseReceiptEventKey(input.order.externalReference);
  const result = await upsertEmailOutboxEvent({
    eventKey,
    externalReference: input.order.externalReference,
    payloadHash,
    payloadJson,
    idempotencyKey: eventKey,
  });
  logEvent("info", result.outcome === "stored" ? "email.outbox.created" : "email.outbox.replayed", {
    externalReference: input.order.externalReference,
    eventKey,
    state: result.event.state,
  });
  scheduleAfterResponse(async () => {
    await processPurchaseReceiptEventSafely(eventKey, input.order.externalReference);
  });
  return result;
};

export const ensurePurchaseReceiptEventSafely = async (input: {
  order: Order;
  paymentId: string;
  approvedAt: number;
}) => {
  try {
    return await ensurePurchaseReceiptEvent(input);
  } catch (error) {
    logEvent("warn", "email.outbox.creation_failed", {
      externalReference: input.order.externalReference,
      errorName: error instanceof Error ? error.name : "unknown",
      errorCode:
        error && typeof error === "object" && "code" in error
          ? String((error as { code?: unknown }).code ?? "EMAIL_OUTBOX_STORE_UNAVAILABLE")
          : "EMAIL_OUTBOX_STORE_UNAVAILABLE",
    });
    return null;
  }
};

export const nudgePurchaseReceiptEvent = (externalReference: string) => {
  try {
    const eventKey = buildPurchaseReceiptEventKey(externalReference);
    scheduleAfterResponse(async () => {
      await processPurchaseReceiptEventSafely(eventKey, externalReference);
    });
  } catch (error) {
    logEvent("warn", "email.outbox.nudge_failed", {
      externalReference,
      errorName: error instanceof Error ? error.name : "unknown",
    });
  }
};
