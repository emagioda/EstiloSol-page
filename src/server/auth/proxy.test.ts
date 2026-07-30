import { NextRequest } from "next/server";
import { getToken } from "next-auth/jwt";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { proxy } from "@/proxy";

vi.mock("next-auth/jwt", () => ({
  getToken: vi.fn(),
}));

const SITE_ORIGIN = "https://shop.example.test";
const ADMIN_EMAIL = "admin@example.test";

const mockedGetToken = vi.mocked(getToken);

const createAdminRequest = (
  path = "/admin",
  headers?: Record<string, string>
) => new NextRequest(new URL(path, SITE_ORIGIN), { headers });

const expectSignInRedirect = (
  response: Response,
  expectedCallbackUrl = "/admin"
) => {
  expect(response.status).toBe(307);
  expect(response.headers.get("x-middleware-next")).toBeNull();

  const location = response.headers.get("location");
  expect(location).not.toBeNull();

  const signInUrl = new URL(location!);
  expect(signInUrl.origin).toBe(SITE_ORIGIN);
  expect(signInUrl.pathname).toBe("/auth/signin");

  const callbackUrl = signInUrl.searchParams.get("callbackUrl");
  expect(callbackUrl).toBe(expectedCallbackUrl);
  expect(callbackUrl).toMatch(/^\/admin(?:[/?]|$)/);
  expect(new URL(callbackUrl!, SITE_ORIGIN).origin).toBe(SITE_ORIGIN);
};

describe("admin proxy authentication", () => {
  beforeEach(() => {
    vi.stubEnv("ADMIN_EMAIL", ADMIN_EMAIL);
    mockedGetToken.mockReset();
    mockedGetToken.mockResolvedValue(null);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("redirects a request to /admin without a session", async () => {
    const response = await proxy(createAdminRequest());

    expectSignInRedirect(response);
  });

  it("allows a synthetic session matching the synthetic ADMIN_EMAIL", async () => {
    mockedGetToken.mockResolvedValue({ email: ADMIN_EMAIL });

    const response = await proxy(createAdminRequest());

    expect(response.status).toBe(200);
    expect(response.headers.get("x-middleware-next")).toBe("1");
    expect(response.headers.get("location")).toBeNull();
  });

  it("rejects a session with a different email", async () => {
    mockedGetToken.mockResolvedValue({ email: "other@example.test" });

    const response = await proxy(createAdminRequest());

    expectSignInRedirect(response);
  });

  it("rejects a valid token when ADMIN_EMAIL is absent", async () => {
    vi.stubEnv("ADMIN_EMAIL", "");
    mockedGetToken.mockResolvedValue({ email: ADMIN_EMAIL });

    const response = await proxy(createAdminRequest());

    expectSignInRedirect(response);
  });

  it("redirects when Authorization is absent", async () => {
    const request = createAdminRequest();

    const response = await proxy(request);

    expect(request.headers.has("authorization")).toBe(false);
    expectSignInRedirect(response);
  });

  it("redirects when Authorization is empty", async () => {
    const request = createAdminRequest("/admin", { Authorization: "" });

    const response = await proxy(request);

    expect(request.headers.get("authorization")).toBe("");
    expectSignInRedirect(response);
  });

  it("redirects for a random Authorization value", async () => {
    const response = await proxy(
      createAdminRequest("/admin", { Authorization: "random-value" })
    );

    expectSignInRedirect(response);
  });

  it("redirects for an invalid Authorization scheme", async () => {
    const response = await proxy(
      createAdminRequest("/admin", { Authorization: "Basic synthetic-value" })
    );

    expectSignInRedirect(response);
  });

  it("redirects instead of throwing for Authorization: Bearer %", async () => {
    mockedGetToken.mockRejectedValue(new URIError("malformed bearer"));

    const response = await proxy(
      createAdminRequest("/admin", { Authorization: "Bearer %" })
    );

    expectSignInRedirect(response);
  });

  it("next-auth handles Authorization: Bearer % without throwing", async () => {
    const actualJwt = await vi.importActual<typeof import("next-auth/jwt")>(
      "next-auth/jwt"
    );
    const request = createAdminRequest("/admin", {
      Authorization: "Bearer %",
    });

    await expect(
      actualJwt.getToken({
        req: request,
        secret: "synthetic-test-secret",
      })
    ).resolves.toBeNull();
  });

  it("redirects for an invalid cookie", async () => {
    mockedGetToken.mockRejectedValue(new URIError("malformed cookie"));

    const response = await proxy(
      createAdminRequest("/admin", {
        Cookie: "next-auth.session-token=%",
      })
    );

    expectSignInRedirect(response);
  });

  it("redirects for an invalid JWT", async () => {
    const response = await proxy(
      createAdminRequest("/admin", {
        Authorization: "Bearer not.a.valid-jwt",
      })
    );

    expectSignInRedirect(response);
  });

  it("redirects when getToken returns null", async () => {
    mockedGetToken.mockResolvedValue(null);

    const response = await proxy(createAdminRequest("/admin/productos"));

    expectSignInRedirect(response, "/admin/productos");
  });

  it("fails closed when getToken throws URIError", async () => {
    mockedGetToken.mockRejectedValue(new URIError("synthetic URI error"));

    const response = await proxy(createAdminRequest());

    expectSignInRedirect(response);
  });

  it("fails closed when getToken throws a generic Error", async () => {
    mockedGetToken.mockRejectedValue(new Error("synthetic generic error"));

    const response = await proxy(createAdminRequest());

    expectSignInRedirect(response);
  });

  it("keeps callbackUrl local and does not create an open redirect", async () => {
    const path =
      "/admin/productos?callbackUrl=https%3A%2F%2Fevil.example%2Fsteal";

    const response = await proxy(createAdminRequest(path));

    expectSignInRedirect(response, path);

    const signInUrl = new URL(response.headers.get("location")!);
    const callbackUrl = signInUrl.searchParams.get("callbackUrl")!;
    expect(callbackUrl.startsWith("//")).toBe(false);
    expect(new URL(callbackUrl, SITE_ORIGIN).hostname).toBe(
      new URL(SITE_ORIGIN).hostname
    );
  });

  it("does not log headers, cookies, tokens, or secrets on errors", async () => {
    const logSpies = [
      vi.spyOn(console, "debug").mockImplementation(() => undefined),
      vi.spyOn(console, "error").mockImplementation(() => undefined),
      vi.spyOn(console, "info").mockImplementation(() => undefined),
      vi.spyOn(console, "log").mockImplementation(() => undefined),
      vi.spyOn(console, "warn").mockImplementation(() => undefined),
    ];
    mockedGetToken.mockRejectedValue(
      new Error(
        "Authorization: Bearer synthetic-token; Cookie: synthetic-cookie; NEXTAUTH_SECRET=synthetic-secret"
      )
    );

    const response = await proxy(
      createAdminRequest("/admin", {
        Authorization: "Bearer synthetic-token",
        Cookie: "next-auth.session-token=synthetic-cookie",
      })
    );

    expectSignInRedirect(response);
    for (const spy of logSpies) {
      expect(spy).not.toHaveBeenCalled();
    }
  });
});
