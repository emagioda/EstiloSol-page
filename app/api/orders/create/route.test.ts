import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/src/server/sheets/repository", () => ({
  appendOrderToSalesSheet: vi.fn(async () => ({ deduped: false })),
  decrementProductsStockInSheet: vi.fn(async () => undefined),
  updateOrderRowInSalesSheet: vi.fn(async () => undefined),
}));

vi.mock("@/src/server/http/afterResponse", () => ({
  scheduleAfterResponse: vi.fn(),
}));

import { POST } from "@/app/api/orders/create/route";
import { getCheckoutAttempt } from "@/src/server/checkout/attempts";
import { scheduleAfterResponse } from "@/src/server/http/afterResponse";
import { kv } from "@/src/server/kv";
import * as orderStore from "@/src/server/orders/store";
import { getOrder } from "@/src/server/orders/store";
import {
  appendOrderToSalesSheet,
  decrementProductsStockInSheet,
} from "@/src/server/sheets/repository";

vi.mock("@/src/server/security/rateLimit", () => ({
  checkRateLimit: vi.fn(async () => true),
}));

let attemptSequence = 0;
let fingerprintNonce = "";
const newAttemptId = (label = "manual") => `attempt-${label}-${Date.now()}-${++attemptSequence}`;

const baseCatalogProduct = {
  id: "p-1",
  name: "Producto 1",
  price: 2000,
  currency: "ARS",
  active: true,
  stock_status: "in_stock",
  stock_qty: 5,
  authoritative_price: 2000,
  authoritative_currency: "ARS",
  authoritative_active: true,
  authoritative_stock_status: "in_stock",
  authoritative_stock_qty: 5,
};

const buildManualBody = (overrides: Record<string, unknown> = {}) => ({
  items: [{ productId: "p-1", qty: 1, name: "Producto 1" }],
  paymentMethod: "cash",
  deliveryMethod: "pickup",
  fulfillment: { pickupPointId: "santa-fe-mitre" },
  payer: { name: "Ana", phone: "+5491112345678" },
  notes: fingerprintNonce,
  checkoutAttemptId: newAttemptId(),
  ...overrides,
});

const createManualRequest = (body: Record<string, unknown>) =>
  new NextRequest("http://localhost:3000/api/orders/create", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

const installCatalogFetchMock = () =>
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const url = String(input);
    const method = String(init?.method || "GET").toUpperCase();
    if (url.startsWith("https://sheets.example.test/catalog") && method === "GET") {
      return new Response(JSON.stringify([baseCatalogProduct]), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }
    throw new Error(`Unexpected fetch url: ${url}`);
  });

describe("orders create manual payment flow", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.clearAllMocks();
    fingerprintNonce = newAttemptId("fingerprint");
    process.env.SHEETS_ENDPOINT = "https://sheets.example.test/catalog";
    process.env.SHEETS_API_TOKEN = "test-sheets-token";
  });

  it("creates cash/transfer orders without decrementing stock", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const url = String(input);
      const method = String(init?.method || "GET").toUpperCase();

      if (url.startsWith("https://sheets.example.test/catalog") && method === "GET") {
        return new Response(
          JSON.stringify([
            {
              id: "p-1",
              name: "Producto 1",
              price: 2000,
              currency: "ARS",
              active: true,
              stock_status: "in_stock",
              stock_qty: 5,
              authoritative_price: 2000,
              authoritative_currency: "ARS",
              authoritative_active: true,
              authoritative_stock_status: "in_stock",
              authoritative_stock_qty: 5,
            },
          ]),
          { status: 200, headers: { "Content-Type": "application/json" } }
        );
      }

      throw new Error(`Unexpected fetch url: ${url}`);
    });

    const request = new NextRequest("http://localhost:3000/api/orders/create", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        items: [{ productId: "p-1", qty: 1, name: "Producto 1" }],
        paymentMethod: "cash",
        deliveryMethod: "pickup",
        fulfillment: { pickupPointId: "santa-fe-mitre", shippingFee: 999999 },
        payer: { name: "Ana", phone: "+5491112345678" },
        checkoutAttemptId: newAttemptId("cash"),
      }),
    });

    const response = await POST(request);
    const body = (await response.json()) as {
      externalReference?: string;
      summaryToken?: string;
      total?: number;
    };

    expect(response.status).toBe(200);
    expect(body.externalReference?.startsWith("es-")).toBe(true);
    expect(body.summaryToken).toMatch(/^[a-f0-9]{32}$/);
    expect(body.total).toBe(4800);
    expect(appendOrderToSalesSheet).toHaveBeenCalledTimes(1);
    expect(decrementProductsStockInSheet).not.toHaveBeenCalled();

    fetchMock.mockRestore();
  });

  it("creates manual delivery orders with backend-calculated shipping", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const url = String(input);
      const method = String(init?.method || "GET").toUpperCase();

      if (url.startsWith("https://sheets.example.test/catalog") && method === "GET") {
        return new Response(
          JSON.stringify([
            {
              id: "p-1",
              name: "Producto 1",
              price: 20000,
              currency: "ARS",
              active: true,
              stock_status: "in_stock",
              stock_qty: 5,
              authoritative_price: 20000,
              authoritative_currency: "ARS",
              authoritative_active: true,
              authoritative_stock_status: "in_stock",
              authoritative_stock_qty: 5,
            },
          ]),
          { status: 200, headers: { "Content-Type": "application/json" } }
        );
      }

      throw new Error(`Unexpected fetch url: ${url}`);
    });

    const request = new NextRequest("http://localhost:3000/api/orders/create", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        items: [{ productId: "p-1", qty: 1, name: "Producto 1" }],
        paymentMethod: "transfer",
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
        checkoutAttemptId: newAttemptId("transfer"),
      }),
    });

    const response = await POST(request);
    const body = (await response.json()) as { total?: number };

    expect(response.status).toBe(200);
    expect(body.total).toBe(21500);
    expect(appendOrderToSalesSheet).toHaveBeenCalledTimes(1);

    fetchMock.mockRestore();
  });

  it("rejects pickup orders with invalid pickupPointId", async () => {
    const request = new NextRequest("http://localhost:3000/api/orders/create", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        items: [{ productId: "p-1", qty: 1, name: "Producto 1" }],
        paymentMethod: "cash",
        deliveryMethod: "pickup",
        fulfillment: { pickupPointId: "inventado" },
        payer: { name: "Ana", phone: "+5491112345678" },
        checkoutAttemptId: newAttemptId("invalid-pickup"),
      }),
    });

    const response = await POST(request);
    const body = (await response.json()) as { error?: string };

    expect(response.status).toBe(400);
    expect(body.error).toMatch(/Punto de encuentro inválido/i);
  });

  it.each(["cash", "transfer"] as const)(
    "AUD3-MANUAL-IDEM-01/03/04 replays sequential %s submits",
    async (paymentMethod) => {
      const fetchMock = installCatalogFetchMock();
      const body = buildManualBody({
        paymentMethod,
        checkoutAttemptId: newAttemptId(`sequential-${paymentMethod}`),
      });

      const first = await POST(createManualRequest(body));
      const firstBody = await first.json();
      const second = await POST(createManualRequest(body));
      const secondBody = await second.json();

      expect(first.status).toBe(200);
      expect(second.status).toBe(200);
      expect(secondBody).toMatchObject(firstBody);
      expect(appendOrderToSalesSheet).toHaveBeenCalledTimes(1);
      fetchMock.mockRestore();
    }
  );

  it("AUD3-MANUAL-IDEM-02/05 serializes concurrent manual requests into one row", async () => {
    const fetchMock = installCatalogFetchMock();
    const body = buildManualBody({ checkoutAttemptId: newAttemptId("concurrent") });

    const [left, right] = await Promise.all([
      POST(createManualRequest(body)),
      POST(createManualRequest(body)),
    ]);
    const [leftBody, rightBody] = await Promise.all([left.json(), right.json()]);

    expect(left.status).toBe(200);
    expect(right.status).toBe(200);
    expect(rightBody).toMatchObject(leftBody);
    expect(appendOrderToSalesSheet).toHaveBeenCalledTimes(1);
    fetchMock.mockRestore();
  });

  it.each(["cash", "transfer"] as const)(
    "AUD3-IDM-006 canonicalizes concurrent cross-tab %s attempts with different IDs",
    async (paymentMethod) => {
      const fetchMock = installCatalogFetchMock();
      let releaseSheetAppend!: () => void;
      let signalSheetAppendEntered!: () => void;
      const sheetAppendEntered = new Promise<void>((resolve) => {
        signalSheetAppendEntered = resolve;
      });
      const sheetAppendGate = new Promise<void>((resolve) => {
        releaseSheetAppend = resolve;
      });
      vi.mocked(appendOrderToSalesSheet).mockImplementationOnce(async () => {
        signalSheetAppendEntered();
        await sheetAppendGate;
        return { deduped: false };
      });
      const createOrderSpy = vi.spyOn(orderStore, "createOrder");
      const kvSetSpy = vi.spyOn(kv, "set");
      const sharedPayload = buildManualBody({ paymentMethod });
      const attemptA = newAttemptId(`${paymentMethod}-tab-a`);
      const attemptB = newAttemptId(`${paymentMethod}-tab-b`);

      const leftPromise = POST(createManualRequest({
        ...sharedPayload,
        checkoutAttemptId: attemptA,
      }));
      await sheetAppendEntered;
      const rightPromise = POST(createManualRequest({
        ...sharedPayload,
        checkoutAttemptId: attemptB,
      }));
      await vi.waitFor(() => {
        const leaseClaims = kvSetSpy.mock.calls.filter(([key]) => String(key).endsWith(":lease"));
        expect(leaseClaims).toHaveLength(2);
      });
      releaseSheetAppend();

      const [left, right] = await Promise.all([leftPromise, rightPromise]);
      const leftBody = (await left.json()) as {
        checkoutAttemptId?: string;
        externalReference?: string;
        summaryToken?: string;
      };
      // Simulate losing tab B's response before it can persist the canonical ID.
      expect(right.status).toBe(200);
      const retry = await POST(createManualRequest({
        ...sharedPayload,
        checkoutAttemptId: attemptB,
      }));
      const retryBody = (await retry.json()) as {
        checkoutAttemptId?: string;
        externalReference?: string;
        summaryToken?: string;
      };

      expect(left.status).toBe(200);
      expect(retry.status).toBe(200);
      expect(leftBody.checkoutAttemptId).toBe(attemptA);
      expect(retryBody.checkoutAttemptId).toBe(attemptA);
      expect(retryBody.externalReference).toBe(leftBody.externalReference);
      expect(retryBody.summaryToken).toBe(leftBody.summaryToken);
      expect(createOrderSpy).toHaveBeenCalledTimes(1);
      expect(appendOrderToSalesSheet).toHaveBeenCalledTimes(1);
      expect(scheduleAfterResponse).toHaveBeenCalledTimes(1);
      fetchMock.mockRestore();
    }
  );

  it("AUD3-MANUAL-IDEM-06 recovers a sheet commit plus lost response with the same ref", async () => {
    const fetchMock = installCatalogFetchMock();
    const logicalRows = new Set<string>();
    vi.mocked(appendOrderToSalesSheet)
      .mockImplementationOnce(async (order) => {
        logicalRows.add(order.externalReference);
        throw new TypeError("response lost after sheet commit");
      })
      .mockImplementationOnce(async (order) => {
        logicalRows.add(order.externalReference);
        return { deduped: true };
      });
    const checkoutAttemptId = newAttemptId("sheet-response-lost");
    const body = buildManualBody({ checkoutAttemptId });

    const first = await POST(createManualRequest(body));
    const preparedAttempt = await getCheckoutAttempt(checkoutAttemptId);
    const second = await POST(createManualRequest(body));
    const secondBody = (await second.json()) as { externalReference?: string };

    expect(first.status).toBe(502);
    expect(second.status).toBe(200);
    expect(secondBody.externalReference).toBe(preparedAttempt?.externalReference);
    expect(logicalRows).toEqual(new Set([preparedAttempt?.externalReference]));
    fetchMock.mockRestore();
  });

  it("AUD3-MANUAL-IDEM-08 rejects a fingerprint mismatch without another row", async () => {
    const fetchMock = installCatalogFetchMock();
    const checkoutAttemptId = newAttemptId("conflict");
    const first = await POST(createManualRequest(buildManualBody({ checkoutAttemptId })));
    const second = await POST(createManualRequest(buildManualBody({
      checkoutAttemptId,
      paymentMethod: "transfer",
    })));
    const secondBody = (await second.json()) as { code?: string };

    expect(first.status).toBe(200);
    expect(second.status).toBe(409);
    expect(secondBody.code).toBe("CHECKOUT_ATTEMPT_CONFLICT");
    expect(appendOrderToSalesSheet).toHaveBeenCalledTimes(1);
    fetchMock.mockRestore();
  });

  it.each(["cash", "transfer"] as const)(
    "AUD3-MANUAL-IDEM-09/10 keeps %s payment pending without stock deduction",
    async (paymentMethod) => {
      const fetchMock = installCatalogFetchMock();
      const response = await POST(createManualRequest(buildManualBody({
        paymentMethod,
        checkoutAttemptId: newAttemptId(`pending-${paymentMethod}`),
      })));
      const body = (await response.json()) as { externalReference?: string };
      const order = body.externalReference ? await getOrder(body.externalReference) : null;

      expect(response.status).toBe(200);
      expect(order).toMatchObject({ paymentStatus: "pending", inventoryStatus: "pending" });
      expect(decrementProductsStockInSheet).not.toHaveBeenCalled();
      fetchMock.mockRestore();
    }
  );

  it("fails closed without checkoutAttemptId and never writes Ventas", async () => {
    const body: Record<string, unknown> = buildManualBody();
    delete body.checkoutAttemptId;
    const response = await POST(createManualRequest(body));
    const responseBody = (await response.json()) as { code?: string };

    expect(response.status).toBe(400);
    expect(responseBody.code).toBe("CHECKOUT_ATTEMPT_REQUIRED");
    expect(appendOrderToSalesSheet).not.toHaveBeenCalled();
  });

  it("AUD3-IDEM-09/MANUAL-IDEM-07 fails closed when KV claim persistence fails", async () => {
    const kvSet = vi.spyOn(kv, "set").mockRejectedValueOnce(new Error("KV unavailable"));
    const response = await POST(createManualRequest(buildManualBody({
      checkoutAttemptId: newAttemptId("kv-failure"),
    })));

    expect(response.status).toBe(503);
    expect(kvSet).toHaveBeenCalledTimes(1);
    expect(appendOrderToSalesSheet).not.toHaveBeenCalled();
  });
});
