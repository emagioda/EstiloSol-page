import { createHmac } from "node:crypto";
import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Order } from "@/src/server/orders/types";

const { kvClient } = vi.hoisted(() => ({
  kvClient: {
    get: vi.fn(),
    set: vi.fn(),
    del: vi.fn(),
    incr: vi.fn(),
    incrby: vi.fn(),
    expire: vi.fn(),
  },
}));

vi.mock("@/src/server/kv", () => ({
  kv: kvClient,
  getJson: vi.fn(),
  setJson: vi.fn(),
}));

vi.mock("@/src/server/orders/store", () => ({
  WEBHOOK_DEDUPE_TTL_SECONDS: 604800,
  claimReceiptEmailDelivery: vi.fn(),
  getOrder: vi.fn(),
  markApproved: vi.fn(),
  markTerminalPaymentState: vi.fn(),
  paymentDedupeKey: (id: string) => `payment:${id}`,
  releaseReceiptEmailDelivery: vi.fn(),
  updateOrder: vi.fn(),
  webhookDedupeKey: (id: string) => `webhook:${id}`,
}));

vi.mock("@/src/server/payments/mpClient", () => ({ fetchPaymentByIdFromMp: vi.fn() }));
vi.mock("@/src/server/http/afterResponse", () => ({ scheduleAfterResponse: vi.fn() }));

import { POST } from "@/app/api/mp/webhook/route";
import { getJson, setJson } from "@/src/server/kv";
import { getOrder, markApproved } from "@/src/server/orders/store";
import { fetchPaymentByIdFromMp } from "@/src/server/payments/mpClient";
import { scheduleAfterResponse } from "@/src/server/http/afterResponse";

const paymentId = "998877";
const ref = "webhook-persistence-order";
const order: Order = {
  externalReference: ref,
  status: "created",
  paymentStatus: "pending",
  shippingStatus: "in_process",
  inventoryStatus: "pending",
  items: [{ productId: "p1", title: "Producto", qty: 1, unitPrice: 1000, currency: "ARS" }],
  total: 1000,
  currency: "ARS",
  createdAt: 1,
  updatedAt: 1,
};

const request = () => {
  const ts = String(Date.now());
  const requestId = "request-persistence";
  const manifest = `id:${paymentId};request-id:${requestId};ts:${ts};`;
  const signature = createHmac("sha256", "webhook-secret").update(manifest).digest("hex");
  return new NextRequest("http://localhost:3000/api/mp/webhook", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-request-id": requestId,
      "x-signature": `ts=${ts},v1=${signature}`,
    },
    body: JSON.stringify({ data: { id: paymentId } }),
  });
};

beforeEach(() => {
  vi.clearAllMocks();
  process.env.MP_ACCESS_TOKEN = "test-token";
  process.env.MP_WEBHOOK_SECRET = "webhook-secret";
  kvClient.incr.mockResolvedValue(1);
  kvClient.incrby.mockResolvedValue(1);
  kvClient.expire.mockResolvedValue(1);
  vi.mocked(getJson).mockResolvedValue(null);
  vi.mocked(getOrder).mockResolvedValue(order);
  vi.mocked(fetchPaymentByIdFromMp).mockResolvedValue({
    response: new Response("{}", { status: 200 }),
    data: {
      id: paymentId,
      status: "approved",
      external_reference: ref,
      transaction_amount: 1000,
      currency_id: "ARS",
    },
  });
});

describe("PR 2 webhook persistence boundary", () => {
  it("PR2-WEBHOOK-06 does not mark dedupe when general order persistence fails", async () => {
    vi.mocked(markApproved).mockRejectedValue(new Error("KV unavailable"));
    const response = await POST(request());
    expect(response.status).toBe(503);
    expect(setJson).not.toHaveBeenCalled();
  });

  it("PR2-WEBHOOK-07 does not schedule email before confirmed payment persistence", async () => {
    vi.mocked(markApproved).mockResolvedValue(null);
    const response = await POST(request());
    expect(response.status).toBe(503);
    expect(scheduleAfterResponse).not.toHaveBeenCalled();
  });
});
