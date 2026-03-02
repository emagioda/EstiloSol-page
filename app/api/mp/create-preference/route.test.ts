import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "@/app/api/mp/create-preference/route";

describe("create-preference fallback flow", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    process.env.MP_ACCESS_TOKEN = "test-token";
    process.env.NEXT_PUBLIC_SHEETS_ENDPOINT = "https://sheets.example.test/catalog";
    delete process.env.APP_BASE_URL;
    delete process.env.MP_SUCCESS_URL;
    delete process.env.MP_FAILURE_URL;
    delete process.env.MP_PENDING_URL;
    delete process.env.MP_WEBHOOK_URL;
  });

  it("retries without auto_return when first MP attempt fails on local success URL", async () => {
    const mpBodies: Array<Record<string, unknown>> = [];

    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const url = String(input);

      if (url.startsWith("https://sheets.example.test/catalog")) {
        return new Response(
          JSON.stringify([
            {
              id: "p-1",
              name: "Producto 1",
              price: 1000,
              currency: "ARS",
              active: true,
            },
          ]),
          { status: 200, headers: { "Content-Type": "application/json" } }
        );
      }

      if (url === "https://api.mercadopago.com/checkout/preferences") {
        const rawBody = typeof init?.body === "string" ? init.body : "{}";
        const parsedBody = JSON.parse(rawBody) as Record<string, unknown>;
        mpBodies.push(parsedBody);

        if (mpBodies.length === 1) {
          return new Response(JSON.stringify({ message: "auto_return not allowed" }), {
            status: 400,
            headers: { "Content-Type": "application/json" },
          });
        }

        return new Response(
          JSON.stringify({
            id: "pref-1",
            init_point: "https://mp.test/init",
            sandbox_init_point: "https://mp.test/sandbox",
          }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        );
      }

      throw new Error(`Unexpected fetch url: ${url}`);
    });

    const request = new NextRequest("http://localhost:3000/api/mp/create-preference", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        items: [{ productId: "p-1", qty: 1, name: "Producto 1" }],
        payer: { name: "Ana", phone: "+5491112345678" },
      }),
    });

    const response = await POST(request);
    const body = (await response.json()) as {
      id?: string;
      initPoint?: string;
      sandboxInitPoint?: string;
      externalReference?: string;
    };

    expect(response.status).toBe(200);
    expect(body.id).toBe("pref-1");
    expect(body.initPoint).toBe("https://mp.test/init");
    expect(body.sandboxInitPoint).toBe("https://mp.test/sandbox");
    expect(typeof body.externalReference).toBe("string");
    expect(body.externalReference?.startsWith("es-")).toBe(true);

    expect(mpBodies).toHaveLength(2);
    expect(mpBodies[0].auto_return).toBe("approved");
    expect(mpBodies[1]).not.toHaveProperty("auto_return");

    fetchMock.mockRestore();
  });
});
