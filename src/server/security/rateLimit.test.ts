import { NextRequest } from "next/server";
import { afterEach, describe, expect, it } from "vitest";
import { getRateLimitFingerprint } from "@/src/server/security/rateLimit";

const originalNodeEnv = process.env.NODE_ENV;

describe("rate limit fingerprint", () => {
  afterEach(() => {
    process.env.NODE_ENV = originalNodeEnv;
  });

  it("prefers Vercel's trusted forwarded IP in production", () => {
    process.env.NODE_ENV = "production";

    const request = new NextRequest("http://localhost:3000/api/test", {
      headers: {
        "x-forwarded-for": "1.1.1.1",
        "x-vercel-forwarded-for": "2.2.2.2",
        "user-agent": "test-agent",
      },
    });

    expect(getRateLimitFingerprint(request)).toBe("ip:2.2.2.2");
  });

  it("does not trust generic x-forwarded-for in production", () => {
    process.env.NODE_ENV = "production";

    const request = new NextRequest("http://localhost:3000/api/test", {
      headers: {
        "x-forwarded-for": "1.1.1.1",
        "user-agent": "test-agent",
      },
    });

    const fingerprint = getRateLimitFingerprint(request);

    expect(fingerprint).toMatch(/^ua:/);
    expect(fingerprint).not.toBe("ip:1.1.1.1");
  });
});
