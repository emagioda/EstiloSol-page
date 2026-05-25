import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "@/app/api/mp/create-preference/route";

type FetchMockOptions = {
  catalog?: Array<Record<string, unknown>>;
};

const baseCatalogProduct = {
  id: "p-1",
  name: "Producto 1",
  price: 1000,
  currency: "ARS",
  active: true,
  stock_status: "in_stock",
  stock_qty: 5,
};

const buildCheckoutBody = (overrides: Record<string, unknown> = {}) => ({
  items: [{ productId: "p-1", qty: 1, name: "Producto 1", unitPrice: 1000 }],
  paymentMethod: "mercadopago",
  deliveryMethod: "pickup",
  fulfillment: { pickupPointId: "mercado-del-patio" },
  payer: { name: "Ana", phone: "+5491112345678" },
  ...overrides,
});

const createRequest = (body: Record<string, unknown>) =>
  new NextRequest("http://localhost:3000/api/mp/create-preference", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

const installPreferenceFetchMock = (options: FetchMockOptions = {}) => {
  const mpBodies: Array<Record<string, unknown>> = [];
  const sheetPostBodies: Array<Record<string, unknown>> = [];
  const catalog = options.catalog || [baseCatalogProduct];

  const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const url = String(input);
    const method = String(init?.method || "GET").toUpperCase();

    if (url.startsWith("https://sheets.example.test/catalog") && method === "GET") {
      return new Response(JSON.stringify(catalog), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }

    if (url.startsWith("https://sheets.example.test/catalog") && method === "POST") {
      sheetPostBodies.push(JSON.parse(String(init?.body || "{}")) as Record<string, unknown>);
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }

    if (url === "https://api.mercadopago.com/checkout/preferences") {
      const rawBody = typeof init?.body === "string" ? init.body : "{}";
      const parsedBody = JSON.parse(rawBody) as Record<string, unknown>;
      mpBodies.push(parsedBody);

      return new Response(
        JSON.stringify({
          id: `pref-${mpBodies.length}`,
          init_point: `https://mp.test/init-${mpBodies.length}`,
          sandbox_init_point: `https://mp.test/sandbox-${mpBodies.length}`,
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    }

    throw new Error(`Unexpected fetch url: ${url}`);
  });

  return { fetchMock, mpBodies, sheetPostBodies };
};

describe("create-preference local development flow", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    process.env.MP_ACCESS_TOKEN = "test-token";
    process.env.SHEETS_ENDPOINT = "https://sheets.example.test/catalog";
    process.env.SHEETS_API_TOKEN = "test-sheets-token";
    delete process.env.NEXT_PUBLIC_SHEETS_ENDPOINT;
    delete process.env.APP_BASE_URL;
    delete process.env.MP_SUCCESS_URL;
    delete process.env.MP_FAILURE_URL;
    delete process.env.MP_PENDING_URL;
    delete process.env.MP_WEBHOOK_URL;
  });

  it("rejects manipulated frontend prices before creating a preference", async () => {
    const { fetchMock, mpBodies, sheetPostBodies } = installPreferenceFetchMock();

    const response = await POST(createRequest(buildCheckoutBody({
      items: [{ productId: "p-1", qty: 1, name: "Producto 1", unitPrice: 1 }],
    })));
    const body = (await response.json()) as {
      error?: string;
      invalidProducts?: Array<{ productId?: string; reason?: string; currentPrice?: number; requestedPrice?: number }>;
    };

    expect(response.status).toBe(400);
    expect(body.error).toMatch(/precio/i);
    expect(body.invalidProducts?.[0]).toMatchObject({
      productId: "p-1",
      reason: "price_changed",
      requestedPrice: 1,
      currentPrice: 1000,
    });
    expect(mpBodies).toHaveLength(0);
    expect(sheetPostBodies).toHaveLength(0);

    fetchMock.mockRestore();
  });

  it("rejects insufficient stock without relying on validate-cart first", async () => {
    const { fetchMock, mpBodies, sheetPostBodies } = installPreferenceFetchMock({
      catalog: [{ ...baseCatalogProduct, stock_qty: 1 }],
    });

    const response = await POST(createRequest(buildCheckoutBody({
      items: [{ productId: "p-1", qty: 2, name: "Producto 1", unitPrice: 1000 }],
    })));
    const body = (await response.json()) as {
      invalidProducts?: Array<{ productId?: string; reason?: string; availableQty?: number | null }>;
    };

    expect(response.status).toBe(400);
    expect(body.invalidProducts?.[0]).toMatchObject({
      productId: "p-1",
      reason: "insufficient_stock",
      availableQty: 1,
    });
    expect(mpBodies).toHaveLength(0);
    expect(sheetPostBodies).toHaveLength(0);

    fetchMock.mockRestore();
  });

  it("reuses the same preference for duplicate checkout attempts", async () => {
    const { fetchMock, mpBodies, sheetPostBodies } = installPreferenceFetchMock();
    const checkoutAttemptId = `attempt-${Date.now()}-same`;
    const body = buildCheckoutBody({ checkoutAttemptId });

    const firstResponse = await POST(createRequest(body));
    const firstBody = (await firstResponse.json()) as { initPoint?: string; externalReference?: string };
    const secondResponse = await POST(createRequest(body));
    const secondBody = (await secondResponse.json()) as { initPoint?: string; externalReference?: string };

    expect(firstResponse.status).toBe(200);
    expect(secondResponse.status).toBe(200);
    expect(secondBody).toMatchObject(firstBody);
    expect(mpBodies).toHaveLength(1);
    expect(sheetPostBodies.filter((entry) => entry.action === "appendRow")).toHaveLength(0);

    fetchMock.mockRestore();
  });

  it("creates a new preference for a different checkout attempt", async () => {
    const { fetchMock, mpBodies, sheetPostBodies } = installPreferenceFetchMock();

    const firstResponse = await POST(createRequest(buildCheckoutBody({
      checkoutAttemptId: `attempt-${Date.now()}-first`,
    })));
    const secondResponse = await POST(createRequest(buildCheckoutBody({
      checkoutAttemptId: `attempt-${Date.now()}-second`,
    })));
    const firstBody = (await firstResponse.json()) as { externalReference?: string };
    const secondBody = (await secondResponse.json()) as { externalReference?: string };

    expect(firstResponse.status).toBe(200);
    expect(secondResponse.status).toBe(200);
    expect(firstBody.externalReference).not.toBe(secondBody.externalReference);
    expect(mpBodies).toHaveLength(2);
    expect(sheetPostBodies.filter((entry) => entry.action === "appendRow")).toHaveLength(0);

    fetchMock.mockRestore();
  });

  it("creates preference without auto_return when success url is non-https", async () => {
    const mpBodies: Array<Record<string, unknown>> = [];
    const sheetPostBodies: Array<Record<string, unknown>> = [];

    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const url = String(input);
      const method = String(init?.method || "GET").toUpperCase();

      if (url.startsWith("https://sheets.example.test/catalog") && method === "GET") {
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

      if (url.startsWith("https://sheets.example.test/catalog") && method === "POST") {
        return new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }

      if (url === "https://api.mercadopago.com/checkout/preferences") {
        const rawBody = typeof init?.body === "string" ? init.body : "{}";
        const parsedBody = JSON.parse(rawBody) as Record<string, unknown>;
        mpBodies.push(parsedBody);

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
        paymentMethod: "mercadopago",
        deliveryMethod: "pickup",
        fulfillment: { pickupPointId: "mercado-del-patio" },
        payer: { name: "Ana", phone: "+5491112345678" },
      }),
    });

    const response = await POST(request);
    const body = (await response.json()) as {
      id?: string;
      initPoint?: string;
      sandboxInitPoint?: string;
      externalReference?: string;
      summaryToken?: string;
    };

    expect(response.status).toBe(200);
    expect(body.id).toBe("pref-1");
    expect(body.initPoint).toBe("https://mp.test/init");
    expect(body.sandboxInitPoint).toBe("https://mp.test/sandbox");
    expect(typeof body.externalReference).toBe("string");
    expect(typeof body.summaryToken).toBe("string");

    expect(mpBodies).toHaveLength(1);
    expect(sheetPostBodies.filter((entry) => entry.action === "appendRow")).toHaveLength(0);
    expect(mpBodies[0]).not.toHaveProperty("auto_return");
    expect(mpBodies[0].metadata).toMatchObject({
      store: "estilo-sol",
      delivery_method: "pickup",
      shipping_fee: 0,
    });

    const backUrls = mpBodies[0].back_urls as { success?: string } | undefined;
    expect(backUrls?.success?.startsWith("http://localhost:3000/tienda/success?ref=es-")).toBe(true);
    const successUrl = new URL(backUrls?.success || "");
    expect(successUrl.searchParams.get("summaryToken")).toBe(body.summaryToken);

    fetchMock.mockRestore();
  });

  it("sends delivery shipping through Mercado Pago shipments", async () => {
    const mpBodies: Array<Record<string, unknown>> = [];
    const sheetPostBodies: Array<Record<string, unknown>> = [];

    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const url = String(input);
      const method = String(init?.method || "GET").toUpperCase();

      if (url.startsWith("https://sheets.example.test/catalog") && method === "GET") {
        return new Response(
          JSON.stringify([
            {
              id: "p-1",
              name: "Producto 1",
              price: 1000,
              currency: "ARS",
              active: true,
              stock_status: "in_stock",
              stock_qty: 5,
            },
          ]),
          { status: 200, headers: { "Content-Type": "application/json" } }
        );
      }

      if (url.startsWith("https://sheets.example.test/catalog") && method === "POST") {
        sheetPostBodies.push(JSON.parse(String(init?.body || "{}")) as Record<string, unknown>);
        return new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }

      if (url === "https://api.mercadopago.com/checkout/preferences") {
        mpBodies.push(JSON.parse(String(init?.body || "{}")) as Record<string, unknown>);
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
        items: [{ productId: "p-1", qty: 2, name: "Producto 1", shippingFee: -4000 }],
        paymentMethod: "mercadopago",
        deliveryMethod: "delivery",
        fulfillment: {
          deliveryAddress: {
            street: "San Lorenzo",
            number: "1234",
            betweenStreets: "Mitre y Entre Rios",
            insideZoneConfirmed: true,
          },
          shippingFee: 0,
        },
        payer: { name: "Ana", phone: "+5491112345678" },
      }),
    });

    const response = await POST(request);

    expect(response.status).toBe(200);
    expect(mpBodies).toHaveLength(1);
    const items = mpBodies[0].items as Array<{ id?: string; unit_price?: number }>;
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ id: "p-1", unit_price: 1000 });
    expect(mpBodies[0].shipments).toEqual({
      cost: 4000,
      mode: "not_specified",
    });
    expect(mpBodies[0].metadata).toMatchObject({
      delivery_method: "delivery",
      shipping_fee: 4000,
    });

    fetchMock.mockRestore();
  });
});
