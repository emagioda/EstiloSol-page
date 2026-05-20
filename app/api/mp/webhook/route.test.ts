import { createHmac } from "node:crypto";
import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "@/app/api/mp/webhook/route";

const signedWebhookRequest = (paymentId: string) => {
  const ts = String(Date.now());
  const xRequestId = "req-1";
  const manifest = `id:${paymentId};request-id:${xRequestId};ts:${ts};`;
  const v1 = createHmac("sha256", "webhook-secret").update(manifest).digest("hex");

  return new NextRequest("http://localhost:3000/api/mp/webhook", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-request-id": xRequestId,
      "x-signature": `ts=${ts},v1=${v1}`,
    },
    body: JSON.stringify({ data: { id: paymentId } }),
  });
};

describe("mercado pago webhook route", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    process.env.MP_ACCESS_TOKEN = "test-token";
    process.env.MP_WEBHOOK_SECRET = "webhook-secret";
  });

  it("rejects invalid signatures before calling Mercado Pago", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("{}", { status: 200 }));

    const request = new NextRequest("http://localhost:3000/api/mp/webhook", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-request-id": "req-1",
        "x-signature": `ts=${Date.now()},v1=deadbeef`,
      },
      body: JSON.stringify({ data: { id: "12345" } }),
    });

    const response = await POST(request);

    expect(response.status).toBe(401);
    expect(fetchMock).not.toHaveBeenCalled();

    fetchMock.mockRestore();
  });

  it("does not dedupe webhook events when Mercado Pago lookup fails", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("network down"));

    const first = await POST(signedWebhookRequest("12345"));
    const second = await POST(signedWebhookRequest("12345"));

    expect(first.status).toBe(503);
    expect(second.status).toBe(503);
    expect(fetchMock).toHaveBeenCalled();

    fetchMock.mockRestore();
  });
});
