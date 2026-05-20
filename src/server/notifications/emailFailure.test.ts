import { beforeEach, describe, expect, it, vi } from "vitest";
import { sendOrderReceivedEmail } from "@/src/server/notifications/orderReceived";
import { sendOrderReceiptEmail } from "@/src/server/notifications/orderReceipt";
import type { Order } from "@/src/server/orders/types";

const buildOrder = (): Order => ({
  externalReference: "es-20260101-000000-emailtest",
  summaryToken: "summary-token",
  status: "pending",
  paymentStatus: "pending",
  shippingStatus: "in_process",
  paymentMethod: "cash",
  deliveryMethod: "pickup",
  items: [
    {
      productId: "p1",
      title: "Producto",
      unitPrice: 1000,
      qty: 1,
      currency: "ARS",
    },
  ],
  total: 1000,
  currency: "ARS",
  createdAt: Date.now(),
  updatedAt: Date.now(),
  customer: {
    name: "Ana",
    email: "ana@example.com",
  },
});

describe("email provider failures", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    process.env.RESEND_API_KEY = "resend-test-token";
  });

  it("does not return raw Resend error bodies for order received emails", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("provider secret payload", { status: 500 })
    );

    const result = await sendOrderReceivedEmail({ order: buildOrder() });

    expect(result).toEqual({
      sent: false,
      reason: "send_failed",
      detail: "resend_status_500",
    });
  });

  it("does not return raw Resend error bodies for payment receipt emails", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("provider secret payload", { status: 503 })
    );

    const result = await sendOrderReceiptEmail({
      order: buildOrder(),
      paymentId: "123456",
      approvedAt: Date.now(),
    });

    expect(result).toEqual({
      sent: false,
      reason: "send_failed",
      detail: "resend_status_503",
    });
  });
});
