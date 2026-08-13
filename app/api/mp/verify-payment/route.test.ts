import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { InventoryOperationError } from "@/src/server/inventory/errors";

vi.mock("@/src/server/sheets/repository", () => ({
  appendOrderAndDecrementStockInSheet: vi.fn(async () => undefined),
  appendOrderToSalesSheet: vi.fn(async () => undefined),
  decrementProductsStockInSheet: vi.fn(async () => undefined),
  updateOrderRowInSalesSheet: vi.fn(async () => undefined),
}));

import { GET, POST } from "@/app/api/mp/verify-payment/route";
import { createOrder, getOrder } from "@/src/server/orders/store";
import { appendOrderToSalesSheet, decrementProductsStockInSheet } from "@/src/server/sheets/repository";

describe("verify-payment confirmation flow", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.clearAllMocks();
    process.env.MP_ACCESS_TOKEN = "test-token";
    vi.mocked(appendOrderToSalesSheet).mockResolvedValue(undefined);
    vi.mocked(decrementProductsStockInSheet).mockResolvedValue({ deduped: false, updated: [] });
  });

  it("confirms approved payment when Mercado Pago reports approval", async () => {
    const ref = `es-${Date.now()}-testok`;

    await createOrder({
      externalReference: ref,
      status: "created",
      paymentStatus: "pending",
      shippingStatus: "in_process",
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
    }, { syncSheet: false });

    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          results: [
            {
              id: "pay-1",
              status: "approved",
              external_reference: ref,
              transaction_amount: 1000,
              currency_id: "ARS",
            },
          ],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      )
    );

    const request = new NextRequest("http://localhost:3000/api/mp/verify-payment", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ref }),
    });
    const response = await POST(request);
    const body = (await response.json()) as { approved?: boolean; externalReference?: string };

    expect(response.status).toBe(200);
    expect(body.approved).toBe(true);
    expect(body.externalReference).toBe(ref);
    expect(decrementProductsStockInSheet).toHaveBeenCalledWith(ref, [
      {
        productId: "p1",
        qty: 1,
        title: "Producto",
      },
    ]);
    expect(appendOrderToSalesSheet).toHaveBeenCalledTimes(1);
    expect(vi.mocked(appendOrderToSalesSheet).mock.calls[0]?.[0]).toMatchObject({
      externalReference: ref,
      status: "approved",
      paymentStatus: "confirmed",
      mpPaymentId: "pay-1",
    });

    fetchMock.mockRestore();
  });

  it("keeps payment confirmation when stock deduction fails", async () => {
    const ref = `es-${Date.now()}-stockfail`;
    vi.mocked(decrementProductsStockInSheet).mockRejectedValueOnce(new Error("Sheets stock failed"));

    await createOrder({
      externalReference: ref,
      status: "created",
      paymentStatus: "pending",
      shippingStatus: "in_process",
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
    }, { syncSheet: false });

    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          results: [
            {
              id: "pay-stockfail",
              status: "approved",
              external_reference: ref,
              transaction_amount: 1000,
              currency_id: "ARS",
            },
          ],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      )
    );

    const request = new NextRequest("http://localhost:3000/api/mp/verify-payment", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ref }),
    });
    const response = await POST(request);
    const body = (await response.json()) as { approved?: boolean; externalReference?: string };
    const updatedOrder = await getOrder(ref);

    expect(response.status).toBe(200);
    expect(body.approved).toBe(true);
    expect(body.externalReference).toBe(ref);
    expect(updatedOrder?.status).toBe("approved");
    expect(updatedOrder?.paymentStatus).toBe("confirmed");
    expect(updatedOrder?.stockDeductedAt).toBeUndefined();
    expect(appendOrderToSalesSheet).toHaveBeenCalledTimes(1);

    fetchMock.mockRestore();
  });

  it("keeps approved payment when sales sheet append fails after Mercado Pago approval", async () => {
    const ref = `es-${Date.now()}-sheetfail`;
    vi.mocked(appendOrderToSalesSheet).mockRejectedValueOnce(new Error("Sheets append failed"));

    await createOrder({
      externalReference: ref,
      status: "created",
      paymentStatus: "pending",
      shippingStatus: "in_process",
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
      customer: { name: "Ana Gomez", phone: "+5491112345678", email: "ana@example.com" },
    }, { syncSheet: false });

    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          results: [
            {
              id: "pay-sheetfail",
              status: "approved",
              external_reference: ref,
              transaction_amount: 1000,
              currency_id: "ARS",
            },
          ],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      )
    );

    const request = new NextRequest("http://localhost:3000/api/mp/verify-payment", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ref }),
    });
    const response = await POST(request);
    const body = (await response.json()) as { approved?: boolean; externalReference?: string };
    const updatedOrder = await getOrder(ref);

    expect(response.status).toBe(200);
    expect(body.approved).toBe(true);
    expect(body.externalReference).toBe(ref);
    expect(updatedOrder?.status).toBe("approved");
    expect(updatedOrder?.paymentStatus).toBe("confirmed");
    expect(updatedOrder?.salesSheetSyncedAt).toBeUndefined();
    expect(updatedOrder?.salesSheetSyncFailedAt).toEqual(expect.any(Number));
    expect(updatedOrder?.customer?.email).toBe("ana@example.com");

    fetchMock.mockRestore();
  });

  it("does not approve payment_id when order is not found", async () => {
    const ref = `es-${Date.now()}-missingorder`;
    const paymentId = "148769407279";

    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          id: paymentId,
          status: "approved",
          external_reference: ref,
          transaction_amount: 58000,
          currency_id: "ARS",
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      )
    );

    const request = new NextRequest("http://localhost:3000/api/mp/verify-payment", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ref, paymentId }),
    });
    const response = await POST(request);
    const body = (await response.json()) as { approved?: boolean; externalReference?: string; paymentId?: string };

    expect(response.status).toBe(200);
    expect(body.approved).toBe(false);
    expect(body.externalReference).toBeUndefined();
    expect(body.paymentId).toBeUndefined();
    expect(fetchMock).not.toHaveBeenCalled();

    fetchMock.mockRestore();
  });

  it("does not approve when Mercado Pago reports a mismatched amount", async () => {
    const ref = `es-${Date.now()}-badamount`;

    await createOrder({
      externalReference: ref,
      status: "created",
      paymentStatus: "pending",
      shippingStatus: "in_process",
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
    }, { syncSheet: false });

    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          results: [
            {
              id: "pay-1",
              status: "approved",
              external_reference: ref,
              transaction_amount: 1,
              currency_id: "ARS",
            },
          ],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      )
    );

    const request = new NextRequest("http://localhost:3000/api/mp/verify-payment", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ref }),
    });
    const response = await POST(request);
    const body = (await response.json()) as { approved?: boolean };
    const updatedOrder = await getOrder(ref);

    expect(response.status).toBe(200);
    expect(body.approved).toBe(false);
    expect(updatedOrder?.status).toBe("created");
    expect(decrementProductsStockInSheet).not.toHaveBeenCalled();
  });

  it("rate limits repeated POST confirmation attempts by externalReference", async () => {
    const ref = `es-${Date.now()}-ratelimit`;

    await createOrder({
      externalReference: ref,
      status: "created",
      paymentStatus: "pending",
      shippingStatus: "in_process",
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
    }, { syncSheet: false });

    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ results: [] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })
    );

    let response: Response | null = null;
    for (let index = 0; index < 21; index += 1) {
      const request = new NextRequest("http://localhost:3000/api/mp/verify-payment", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-vercel-forwarded-for": `10.0.0.${index + 1}`,
        },
        body: JSON.stringify({ ref }),
      });
      response = await POST(request);
    }

    expect(response?.status).toBe(429);
    expect(fetchMock).toHaveBeenCalledTimes(20);
  });

  it("updates approved orders when Mercado Pago later reports a refund", async () => {
    const ref = `es-${Date.now()}-refund`;

    await createOrder({
      externalReference: ref,
      status: "approved",
      paymentStatus: "confirmed",
      shippingStatus: "in_process",
      mpPaymentId: "pay-1",
      mpStatus: "approved",
      approvedAt: Date.now(),
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
    });

    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          results: [
            {
              id: "pay-1",
              status: "refunded",
              external_reference: ref,
              transaction_amount: 1000,
              currency_id: "ARS",
            },
          ],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      )
    );

    const request = new NextRequest("http://localhost:3000/api/mp/verify-payment", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ref }),
    });
    const response = await POST(request);
    const body = (await response.json()) as { approved?: boolean; status?: string };
    const updatedOrder = await getOrder(ref);

    expect(response.status).toBe(200);
    expect(body.approved).toBe(false);
    expect(body.status).toBe("refunded");
    expect(updatedOrder?.status).toBe("refunded");
    expect(updatedOrder?.paymentStatus).toBe("refunded");

    fetchMock.mockRestore();
  });

  it("keeps GET read-only and does not call Mercado Pago", async () => {
    const ref = `es-${Date.now()}-readonly`;

    await createOrder({
      externalReference: ref,
      status: "created",
      paymentStatus: "pending",
      shippingStatus: "in_process",
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
    }, { syncSheet: false });

    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          results: [
            {
              id: "pay-1",
              status: "approved",
              external_reference: ref,
              transaction_amount: 1000,
              currency_id: "ARS",
            },
          ],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      )
    );

    const request = new NextRequest(`http://localhost:3000/api/mp/verify-payment?ref=${encodeURIComponent(ref)}`);
    const response = await GET(request);
    const body = (await response.json()) as { approved?: boolean };
    const order = await getOrder(ref);

    expect(response.status).toBe(200);
    expect(body.approved).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(order?.status).toBe("created");

    fetchMock.mockRestore();
  });

  const createPr2Order = async (suffix: string, patch: Partial<Parameters<typeof createOrder>[0]> = {}) => {
    const ref = `es-${Date.now()}-${suffix}-${Math.random().toString(16).slice(2)}`;
    await createOrder({
      externalReference: ref,
      status: "created",
      paymentStatus: "pending",
      shippingStatus: "in_process",
      inventoryStatus: "pending",
      items: [{ productId: "p1", title: "Producto", unitPrice: 1000, qty: 1, currency: "ARS" }],
      total: 1000,
      currency: "ARS",
      createdAt: Date.now(),
      updatedAt: Date.now(),
      ...patch,
    }, { syncSheet: false });
    return ref;
  };

  const mockApprovedSearch = (ref: string) => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({
      results: [{
        id: `pay-${ref}`,
        status: "approved",
        external_reference: ref,
        transaction_amount: 1000,
        currency_id: "ARS",
      }],
    }), { status: 200, headers: { "Content-Type": "application/json" } }));
  };

  const postVerify = (ref: string) => POST(new NextRequest("http://localhost:3000/api/mp/verify-payment", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ref }),
  }));

  it("AUD3-PAY-03 verify reconciles every search result instead of choosing one", async () => {
    const ref = await createPr2Order("multiple-payments");
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({
      results: [
        {
          id: "A",
          status: "approved",
          external_reference: ref,
          transaction_amount: 1000,
          currency_id: "ARS",
        },
        {
          id: "B",
          status: "rejected",
          external_reference: ref,
          transaction_amount: 1000,
          currency_id: "ARS",
        },
      ],
    }), { status: 200, headers: { "Content-Type": "application/json" } }));

    const response = await postVerify(ref);
    const body = await response.json();
    const stored = await getOrder(ref);
    expect(body.approved).toBe(true);
    expect(stored?.paymentStatus).toBe("confirmed");
    expect(Object.keys(stored?.mpPaymentLedger ?? {})).toEqual(["A", "B"]);
  });

  it("AUD3-PAY-15 MP timeout does not degrade a legacy confirmed order", async () => {
    const ref = await createPr2Order("timeout-confirmed", {
      status: "approved",
      paymentStatus: "confirmed",
      mpPaymentId: "A",
      mpStatus: "approved",
      approvedAt: Date.now(),
      inventoryStatus: "deducted",
      stockDeductedAt: Date.now(),
    });
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new TypeError("network timeout"));

    const body = await (await postVerify(ref)).json();
    const stored = await getOrder(ref);
    expect(body.approved).toBe(true);
    expect(stored).toMatchObject({ paymentStatus: "confirmed", mpPaymentId: "A" });
    expect(stored?.mpPaymentLedger).toBeUndefined();
  });

  it("AUD3-PAY-16 MP not found does not degrade a legacy confirmed order", async () => {
    const ref = await createPr2Order("not-found-confirmed", {
      status: "approved",
      paymentStatus: "confirmed",
      mpPaymentId: "A",
      mpStatus: "approved",
      approvedAt: Date.now(),
      inventoryStatus: "deducted",
      stockDeductedAt: Date.now(),
    });
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ message: "not found" }), { status: 404 })
    );

    const body = await (await postVerify(ref)).json();
    const stored = await getOrder(ref);
    expect(body.approved).toBe(true);
    expect(stored).toMatchObject({ paymentStatus: "confirmed", mpPaymentId: "A" });
    expect(stored?.mpPaymentLedger).toBeUndefined();
  });

  it("PR2-VERIFY-01 deducted inventory still returns approved true", async () => {
    const ref = await createPr2Order("verify-deducted");
    mockApprovedSearch(ref);
    const body = await (await postVerify(ref)).json();
    expect(body.approved).toBe(true);
    expect((await getOrder(ref))?.inventoryStatus).toBe("deducted");
  });

  it("PR2-VERIFY-02 conflict inventory still returns approved true", async () => {
    vi.mocked(decrementProductsStockInSheet).mockRejectedValueOnce(new InventoryOperationError({
      code: "INSUFFICIENT_STOCK",
      message: "none",
    }));
    const ref = await createPr2Order("verify-conflict");
    mockApprovedSearch(ref);
    const body = await (await postVerify(ref)).json();
    expect(body.approved).toBe(true);
    expect((await getOrder(ref))?.inventoryStatus).toBe("conflict");
  });

  it("PR2-VERIFY-03 technical inventory error still returns approved true", async () => {
    vi.mocked(decrementProductsStockInSheet).mockRejectedValueOnce(new Error("network down"));
    const ref = await createPr2Order("verify-error");
    mockApprovedSearch(ref);
    const body = await (await postVerify(ref)).json();
    expect(body.approved).toBe(true);
    expect((await getOrder(ref))?.inventoryStatus).toBe("error");
  });

  it.each([
    ["PR2-VERIFY-04 conflict returns friendly processing copy", new InventoryOperationError({ code: "INSUFFICIENT_STOCK", message: "none" })],
    ["PR2-VERIFY-05 error returns friendly processing copy", new Error("network down")],
  ])("%s", async (_name, failure) => {
    vi.mocked(decrementProductsStockInSheet).mockRejectedValueOnce(failure);
    const ref = await createPr2Order("verify-friendly");
    mockApprovedSearch(ref);
    const body = await (await postVerify(ref)).json();
    expect(body.message).toContain("estamos procesando tu pedido");
  });

  it("PR2-VERIFY-06 response never exposes inventoryIssueCode", async () => {
    vi.mocked(decrementProductsStockInSheet).mockRejectedValueOnce(new InventoryOperationError({
      code: "INSUFFICIENT_STOCK",
      message: "none",
    }));
    const ref = await createPr2Order("verify-private");
    mockApprovedSearch(ref);
    const body = await (await postVerify(ref)).json();
    expect(JSON.stringify(body)).not.toContain("INSUFFICIENT_STOCK");
    expect(body).not.toHaveProperty("inventoryIssueCode");
  });

  it.each([
    ["PR2-VERIFY-07 repeated POST on conflict does not retry stock", new InventoryOperationError({ code: "INSUFFICIENT_STOCK", message: "none" })],
    ["PR2-VERIFY-08 repeated POST on error does not retry stock", new Error("network down")],
  ])("%s", async (_name, failure) => {
    vi.mocked(decrementProductsStockInSheet).mockRejectedValueOnce(failure);
    const ref = await createPr2Order("verify-repeat");
    mockApprovedSearch(ref);
    await postVerify(ref);
    await postVerify(ref);
    expect(decrementProductsStockInSheet).toHaveBeenCalledTimes(1);
  });

  it("PR2-VERIFY-09 cached GET recognizes conflict/error as an approved payment", async () => {
    const ref = await createPr2Order("verify-cached", {
      status: "approved",
      paymentStatus: "confirmed",
      inventoryStatus: "conflict",
      inventoryIssueCode: "INSUFFICIENT_STOCK",
      inventoryIssueAt: Date.now(),
    });
    const fetchMock = vi.spyOn(globalThis, "fetch");
    const response = await GET(new NextRequest(`http://localhost:3000/api/mp/verify-payment?ref=${ref}`));
    const body = await response.json();
    expect(body.approved).toBe(true);
    expect(body.message).toContain("estamos procesando tu pedido");
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
