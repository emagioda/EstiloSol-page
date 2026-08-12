import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "@/app/api/mp/create-preference/route";
import { kv } from "@/src/server/kv";
import * as orderStore from "@/src/server/orders/store";
import * as metrics from "@/src/server/observability/metrics";

vi.mock("@/src/server/security/rateLimit", () => ({
  checkRateLimit: vi.fn(async () => true),
}));

type FetchMockOptions = {
  catalog?: Array<Record<string, unknown>>;
  mpHandler?: (callNumber: number, init?: RequestInit) => Promise<Response>;
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

let attemptSequence = 0;
let fingerprintNonce = "";
const newAttemptId = (label = "mp") => `attempt-${label}-${Date.now()}-${++attemptSequence}`;

const buildCheckoutBody = (overrides: Record<string, unknown> = {}) => ({
  items: [{ productId: "p-1", qty: 1, name: "Producto 1", unitPrice: 1000 }],
  paymentMethod: "mercadopago",
  deliveryMethod: "pickup",
  fulfillment: { pickupPointId: "mercado-del-patio" },
  payer: { name: "Ana", phone: "+5491112345678" },
  notes: fingerprintNonce,
  checkoutAttemptId: newAttemptId(),
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
  const mpIdempotencyKeys: string[] = [];
  const sheetPostBodies: Array<Record<string, unknown>> = [];
  const rawCatalog: Array<Record<string, unknown>> = options.catalog || [baseCatalogProduct];
  const catalog = rawCatalog.map((item) => ({
    ...item,
    authoritative_price: item.authoritative_price ?? item.price,
    authoritative_currency: item.authoritative_currency ?? item.currency,
    authoritative_active: item.authoritative_active ?? item.active,
    authoritative_stock_status: item.authoritative_stock_status ?? item.stock_status,
    authoritative_stock_qty: item.authoritative_stock_qty ?? item.stock_qty,
  }));

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
      mpIdempotencyKeys.push(new Headers(init?.headers).get("X-Idempotency-Key") || "");

      if (options.mpHandler) {
        return options.mpHandler(mpBodies.length, init);
      }

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

  return { fetchMock, mpBodies, mpIdempotencyKeys, sheetPostBodies };
};

describe("create-preference local development flow", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    fingerprintNonce = newAttemptId("fingerprint");
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

  it("TEST-HF-03 rejects a malformed duplicate before creating an order or preference", async () => {
    const createOrderSpy = vi.spyOn(orderStore, "createOrder");
    const { fetchMock, mpBodies, sheetPostBodies } = installPreferenceFetchMock({
      catalog: [
        baseCatalogProduct,
        { ...baseCatalogProduct, name: "" },
      ],
    });

    const response = await POST(createRequest(buildCheckoutBody()));
    const body = (await response.json()) as { code?: string };

    expect(response.status).toBe(400);
    expect(body.code).toBe("DUPLICATE_PRODUCT_ID");
    expect(createOrderSpy).not.toHaveBeenCalled();
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

  it("AUD3-IDM-006 allows an intentional identical purchase after completion", async () => {
    const { fetchMock, mpBodies, sheetPostBodies } = installPreferenceFetchMock();

    const firstResponse = await POST(createRequest(buildCheckoutBody({
      checkoutAttemptId: `attempt-${Date.now()}-first`,
    })));
    const secondResponse = await POST(createRequest(buildCheckoutBody({
      checkoutAttemptId: `attempt-${Date.now()}-second`,
    })));
    const firstBody = (await firstResponse.json()) as {
      checkoutAttemptId?: string;
      externalReference?: string;
    };
    const secondBody = (await secondResponse.json()) as {
      checkoutAttemptId?: string;
      externalReference?: string;
    };

    expect(firstResponse.status).toBe(200);
    expect(secondResponse.status).toBe(200);
    expect(firstBody.checkoutAttemptId).not.toBe(secondBody.checkoutAttemptId);
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
              authoritative_price: 1000,
              authoritative_currency: "ARS",
              authoritative_active: true,
              authoritative_stock_status: "in_stock",
              authoritative_stock_qty: 5,
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
        checkoutAttemptId: newAttemptId("non-https"),
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
      shipping_fee: 3000,
    });
    expect(mpBodies[0].shipments).toEqual({
      cost: 3000,
      mode: "not_specified",
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
              authoritative_price: 1000,
              authoritative_currency: "ARS",
              authoritative_active: true,
              authoritative_stock_status: "in_stock",
              authoritative_stock_qty: 5,
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
        items: [{ productId: "p-1", qty: 2, name: "Producto 1" }],
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
        checkoutAttemptId: newAttemptId("delivery"),
      }),
    });

    const response = await POST(request);

    expect(response.status).toBe(200);
    expect(mpBodies).toHaveLength(1);
    const items = mpBodies[0].items as Array<{ id?: string; unit_price?: number }>;
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ id: "p-1", unit_price: 1000 });
    expect(mpBodies[0].shipments).toEqual({
      cost: 3500,
      mode: "not_specified",
    });
    expect(mpBodies[0].metadata).toMatchObject({
      delivery_method: "delivery",
      shipping_fee: 3500,
    });

    fetchMock.mockRestore();
  });

  it("builds one Mercado Pago item from repeated product lines", async () => {
    const { fetchMock, mpBodies } = installPreferenceFetchMock({
      catalog: [{ ...baseCatalogProduct, stock_qty: 3 }],
    });

    const response = await POST(createRequest(buildCheckoutBody({
      items: [
        { productId: "p-1", qty: 1, name: "Nombre falso", unitPrice: 1000 },
        { productId: "p-1", qty: 2, name: "Otro nombre", unitPrice: 1000 },
      ],
    })));

    expect(response.status).toBe(200);
    const items = mpBodies[0].items as Array<{ id?: string; title?: string; quantity?: number; unit_price?: number }>;
    expect(items).toEqual([expect.objectContaining({
      id: "p-1",
      title: "Producto 1",
      quantity: 3,
      unit_price: 1000,
    })]);
    fetchMock.mockRestore();
  });

  it("does not read catalog, create an order or create a preference for a partially invalid cart", async () => {
    const { fetchMock, mpBodies, sheetPostBodies } = installPreferenceFetchMock();

    const response = await POST(createRequest(buildCheckoutBody({
      items: [
        { productId: "p-1", qty: 1, unitPrice: 1000 },
        { productId: "bad", qty: -1, unitPrice: 1000 },
      ],
    })));
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body).toMatchObject({ code: "INVALID_QUANTITY", itemIndex: 1, productId: "bad" });
    expect(mpBodies).toHaveLength(0);
    expect(sheetPostBodies).toHaveLength(0);
    expect(fetchMock).not.toHaveBeenCalled();
    fetchMock.mockRestore();
  });

  it("AUD3-MP-IDEM-01/02 serializes simultaneous requests and replays one preference", async () => {
    const { fetchMock, mpBodies } = installPreferenceFetchMock();
    const body = buildCheckoutBody({ checkoutAttemptId: newAttemptId("concurrent") });

    const [left, right] = await Promise.all([
      POST(createRequest(body)),
      POST(createRequest(body)),
    ]);
    const [leftBody, rightBody] = await Promise.all([left.json(), right.json()]);

    expect(left.status).toBe(200);
    expect(right.status).toBe(200);
    expect(rightBody).toMatchObject(leftBody);
    expect(mpBodies).toHaveLength(1);
    fetchMock.mockRestore();
  });

  it("AUD3-IDM-006 canonicalizes concurrent cross-tab MP attempts with different IDs", async () => {
    let releasePreference!: () => void;
    let signalPreferenceEntered!: () => void;
    const preferenceEntered = new Promise<void>((resolve) => {
      signalPreferenceEntered = resolve;
    });
    const preferenceGate = new Promise<void>((resolve) => {
      releasePreference = resolve;
    });
    const { fetchMock, mpBodies, mpIdempotencyKeys } = installPreferenceFetchMock({
      mpHandler: async () => {
        signalPreferenceEntered();
        await preferenceGate;
        return new Response(
          JSON.stringify({
            id: "pref-cross-tab",
            init_point: "https://mp.test/cross-tab",
          }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        );
      },
    });
    const kvSetSpy = vi.spyOn(kv, "set");
    const sharedPayload = buildCheckoutBody();
    const attemptA = newAttemptId("tab-a");
    const attemptB = newAttemptId("tab-b");

    const leftPromise = POST(createRequest({ ...sharedPayload, checkoutAttemptId: attemptA }));
    await preferenceEntered;
    const rightPromise = POST(createRequest({ ...sharedPayload, checkoutAttemptId: attemptB }));
    await vi.waitFor(() => {
      const leaseClaims = kvSetSpy.mock.calls.filter(([key]) => String(key).endsWith(":lease"));
      expect(leaseClaims).toHaveLength(2);
    });
    releasePreference();

    const [left, right] = await Promise.all([leftPromise, rightPromise]);
    const [leftBody, rightBody] = (await Promise.all([left.json(), right.json()])) as Array<{
      checkoutAttemptId?: string;
      externalReference?: string;
      summaryToken?: string;
    }>;

    expect(left.status).toBe(200);
    expect(right.status).toBe(200);
    expect(leftBody.checkoutAttemptId).toBe(attemptA);
    expect(rightBody.checkoutAttemptId).toBe(attemptA);
    expect(rightBody.externalReference).toBe(leftBody.externalReference);
    expect(rightBody.summaryToken).toBe(leftBody.summaryToken);
    expect(mpBodies).toHaveLength(1);
    expect(mpIdempotencyKeys).toHaveLength(1);
    expect(mpIdempotencyKeys[0]).toMatch(/^[a-f0-9]{64}$/);
    fetchMock.mockRestore();
  });

  it("AUD3-MP-IDEM-03/04 recovers network uncertainty with the same ref and idempotency key", async () => {
    const { fetchMock, mpBodies, mpIdempotencyKeys } = installPreferenceFetchMock({
      mpHandler: async (callNumber) => {
        if (callNumber <= 2) throw new TypeError("response lost");
        return new Response(
          JSON.stringify({
            id: "pref-recovered",
            init_point: "https://mp.test/recovered",
          }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        );
      },
    });
    const body = buildCheckoutBody({ checkoutAttemptId: newAttemptId("response-lost") });

    const first = await POST(createRequest(body));
    const second = await POST(createRequest(body));
    const secondBody = (await second.json()) as { externalReference?: string };

    expect(first.status).toBe(502);
    expect(second.status).toBe(200);
    expect(new Set(mpBodies.map((entry) => entry.external_reference))).toEqual(
      new Set([secondBody.externalReference])
    );
    expect(new Set(mpIdempotencyKeys)).toHaveLength(1);
    fetchMock.mockRestore();
  });

  it("AUD3-MP-IDEM-06 completed replay skips catalog and Mercado Pago", async () => {
    const { fetchMock } = installPreferenceFetchMock();
    const body = buildCheckoutBody({ checkoutAttemptId: newAttemptId("replay-no-io") });
    const first = await POST(createRequest(body));
    expect(first.status).toBe(200);
    fetchMock.mockClear();

    const second = await POST(createRequest(body));

    expect(second.status).toBe(200);
    expect(fetchMock).not.toHaveBeenCalled();
    fetchMock.mockRestore();
  });

  it("AUD3-MP-IDEM-05 keeps a valid preference successful when metrics fail", async () => {
    const metricSpy = vi
      .spyOn(metrics, "trackBusinessEvent")
      .mockRejectedValue(new Error("metrics unavailable"));
    const { fetchMock, mpBodies } = installPreferenceFetchMock();

    const response = await POST(createRequest(buildCheckoutBody({
      checkoutAttemptId: newAttemptId("metric-failure"),
    })));

    expect(response.status).toBe(200);
    expect(mpBodies).toHaveLength(1);
    expect(metricSpy).toHaveBeenCalledWith(
      "checkout.preference.created",
      expect.objectContaining({ externalReference: expect.any(String) })
    );
    fetchMock.mockRestore();
  });

  it("AUD3-MP-IDEM-07 rejects fingerprint mismatch without another MP call", async () => {
    const { fetchMock, mpBodies } = installPreferenceFetchMock();
    const checkoutAttemptId = newAttemptId("conflict");
    const first = await POST(createRequest(buildCheckoutBody({ checkoutAttemptId })));
    const second = await POST(createRequest(buildCheckoutBody({
      checkoutAttemptId,
      items: [{ productId: "p-1", qty: 2, unitPrice: 1000 }],
    })));
    const secondBody = (await second.json()) as { code?: string };

    expect(first.status).toBe(200);
    expect(second.status).toBe(409);
    expect(secondBody.code).toBe("CHECKOUT_ATTEMPT_CONFLICT");
    expect(mpBodies).toHaveLength(1);
    fetchMock.mockRestore();
  });

  it("AUD3-MP-IDEM-08 rejects HTTP 200 with a malformed preference", async () => {
    const { fetchMock } = installPreferenceFetchMock({
      mpHandler: async () => new Response(JSON.stringify({}), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    });

    const response = await POST(createRequest(buildCheckoutBody({
      checkoutAttemptId: newAttemptId("malformed"),
    })));

    expect(response.status).toBe(502);
    fetchMock.mockRestore();
  });

  it("fails closed without checkoutAttemptId and never calls MP", async () => {
    const { fetchMock, mpBodies } = installPreferenceFetchMock();
    const body: Record<string, unknown> = buildCheckoutBody();
    delete body.checkoutAttemptId;
    const response = await POST(createRequest(body));
    const responseBody = (await response.json()) as { code?: string };

    expect(response.status).toBe(400);
    expect(responseBody.code).toBe("CHECKOUT_ATTEMPT_REQUIRED");
    expect(mpBodies).toHaveLength(0);
    expect(fetchMock).not.toHaveBeenCalled();
    fetchMock.mockRestore();
  });
});
