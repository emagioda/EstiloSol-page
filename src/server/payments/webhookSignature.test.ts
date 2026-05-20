import { createHmac } from "node:crypto";
import { NextRequest } from "next/server";
import { describe, expect, it } from "vitest";
import {
  extractWebhookDataId,
  isValidWebhookSignature,
  parseWebhookSignature,
} from "@/src/server/payments/webhookSignature";

describe("webhookSignature", () => {
  it("parses a valid x-signature header", () => {
    const parsed = parseWebhookSignature("ts=1700000000,v1=abc123");

    expect(parsed).toEqual({ ts: "1700000000", v1: "abc123" });
  });

  it("returns null when signature header is malformed", () => {
    expect(parseWebhookSignature("ts=1700000000")).toBeNull();
    expect(parseWebhookSignature(null)).toBeNull();
  });

  it("validates webhook signature manifest", () => {
    const secret = "my-secret";
    const dataIdLower = "12345";
    const xRequestId = "req-1";
    const nowMs = Date.now();
    const ts = String(nowMs);
    const manifest = `id:${dataIdLower};request-id:${xRequestId};ts:${ts};`;
    const v1 = createHmac("sha256", secret).update(manifest).digest("hex");

    const result = isValidWebhookSignature({
      secret,
      dataIdLower,
      xRequestId,
      xSignatureHeader: `ts=${ts},v1=${v1}`,
      nowMs,
    });

    expect(result).toEqual({ ok: true });
  });

  it("rejects missing headers and invalid signatures", () => {
    const missing = isValidWebhookSignature({
      secret: "secret",
      dataIdLower: "123",
      xRequestId: null,
      xSignatureHeader: null,
    });

    expect(missing).toEqual({ ok: false, reason: "missing_headers" });

    const invalid = isValidWebhookSignature({
      secret: "secret",
      dataIdLower: "123",
      xRequestId: "req",
      xSignatureHeader: `ts=${Date.now()},v1=deadbeef`,
    });

    expect(invalid).toEqual({ ok: false, reason: "invalid_signature" });
  });

  it("rejects stale timestamps", () => {
    const staleTs = "1700000000";
    const manifest = `id:123;request-id:req;ts:${staleTs};`;
    const v1 = createHmac("sha256", "secret").update(manifest).digest("hex");

    expect(
      isValidWebhookSignature({
        secret: "secret",
        dataIdLower: "123",
        xRequestId: "req",
        xSignatureHeader: `ts=${staleTs},v1=${v1}`,
        nowMs: Date.now(),
      })
    ).toEqual({ ok: false, reason: "stale_timestamp" });
  });

  it("extracts webhook data id preferring query params", () => {
    const requestWithDataId = new NextRequest("http://localhost/api/mp/webhook?data.id=999");
    const fromDataId = extractWebhookDataId(requestWithDataId, { data: { id: "111" } });
    expect(fromDataId).toBe("999");

    const requestWithId = new NextRequest("http://localhost/api/mp/webhook?id=777");
    const fromId = extractWebhookDataId(requestWithId, { data: { id: "111" } });
    expect(fromId).toBe("777");

    const requestBodyOnly = new NextRequest("http://localhost/api/mp/webhook");
    const fromBody = extractWebhookDataId(requestBodyOnly, { data: { id: "  ABC-1 " } });
    expect(fromBody).toBe("abc-1");
  });
});
