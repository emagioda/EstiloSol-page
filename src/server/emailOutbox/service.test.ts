import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Order } from "@/src/server/orders/types";
import type { EmailOutboxEvent } from "./types";

vi.mock("@/src/server/http/afterResponse", () => ({
  scheduleAfterResponse: vi.fn(),
}));
vi.mock("./repository", () => ({
  upsertEmailOutboxEvent: vi.fn(),
}));
vi.mock("./processor", () => ({
  processEmailOutboxEvent: vi.fn(),
}));

import { scheduleAfterResponse } from "@/src/server/http/afterResponse";
import { upsertEmailOutboxEvent } from "./repository";
import { ensurePurchaseReceiptEvent, ensurePurchaseReceiptEventSafely } from "./service";

const order: Order = {
  externalReference: "es-email-service-000001",
  status: "approved",
  paymentStatus: "confirmed",
  shippingStatus: "in_process",
  paymentMethod: "mercadopago",
  items: [{ productId: "p1", title: "Producto", qty: 1, unitPrice: 1000, currency: "ARS" }],
  total: 1000,
  currency: "ARS",
  createdAt: 1,
  updatedAt: 2,
  customer: { email: "customer@example.test" },
};

const storedEvent: EmailOutboxEvent = {
  eventKey: "purchase-receipt/es-email-service-000001/v1",
  externalReference: "es-email-service-000001",
  notificationType: "purchase_receipt",
  schemaVersion: 1,
  templateVersion: 1,
  payloadHash: "a".repeat(64),
  payloadJson: "{}",
  idempotencyKey: "purchase-receipt/es-email-service-000001/v1",
  state: "pending",
  attemptCount: 0,
  createdAt: "2026-08-16T10:00:00.000Z",
  updatedAt: "2026-08-16T10:00:00.000Z",
};

describe("AUD3-H06-E receipt eligibility service", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.CONTACT_FROM_EMAIL = "Estilo Sol <ventas@example.test>";
    vi.mocked(upsertEmailOutboxEvent).mockResolvedValue({ outcome: "stored", event: storedEvent });
  });

  it("durably stores the event before scheduling optional immediate processing", async () => {
    await ensurePurchaseReceiptEvent({ order, paymentId: "pay-service-1", approvedAt: 10 });
    expect(upsertEmailOutboxEvent).toHaveBeenCalledWith(expect.objectContaining({
      eventKey: storedEvent.eventKey,
      externalReference: order.externalReference,
      idempotencyKey: storedEvent.eventKey,
      payloadHash: expect.stringMatching(/^[a-f0-9]{64}$/),
    }));
    expect(vi.mocked(upsertEmailOutboxEvent).mock.invocationCallOrder[0]).toBeLessThan(
      vi.mocked(scheduleAfterResponse).mock.invocationCallOrder[0],
    );
  });

  it("does not schedule transient processing when durable creation fails", async () => {
    vi.mocked(upsertEmailOutboxEvent).mockRejectedValueOnce(new Error("Sheets unavailable"));
    await expect(ensurePurchaseReceiptEventSafely({
      order,
      paymentId: "pay-service-1",
      approvedAt: 10,
    })).resolves.toBeNull();
    expect(scheduleAfterResponse).not.toHaveBeenCalled();
  });
});
