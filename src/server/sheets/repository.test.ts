import { afterEach, describe, expect, it, vi } from "vitest";
import {
  applyAdminOrderStatusIntentInSalesSheet,
  appendOrderToSalesSheet,
  buildSalesSheetRow,
  decrementProductsStockInSheet,
  getOrdersForAdmin,
  getUniqueOrderRowById,
  parseAdminOrderRow,
  parseInventoryStatus,
  REQUIRED_SALES_FULFILLMENT_HEADERS,
  updateOrderRowInSalesSheet,
} from "@/src/server/sheets/repository";
import { AdminOrderStateChangedError } from "@/src/server/orders/adminIntent";
import { InventoryOperationError } from "@/src/server/inventory/errors";
import type { Order } from "@/src/server/orders/types";

const baseOrder: Order = {
  externalReference: "es-20260101-000000-test",
  status: "pending",
  paymentStatus: "pending",
  shippingStatus: "in_process",
  paymentMethod: "transfer",
  deliveryMethod: "delivery",
  items: [
    {
      productId: "p1",
      title: "Producto 1",
      unitPrice: 20000,
      qty: 1,
      currency: "ARS",
    },
  ],
  total: 22000,
  currency: "ARS",
  createdAt: Date.UTC(2026, 0, 1),
  updatedAt: Date.UTC(2026, 0, 1),
};

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

describe("AUD3 H07-D1 ventas append identity response", () => {
  it.each([
    { deduped: false, response: { ok: true } },
    { deduped: true, response: { ok: true, deduped: true } },
  ])("reports deduped=$deduped without changing the Apps Script contract", async ({
    deduped,
    response,
  }) => {
    vi.stubEnv("SHEETS_ENDPOINT", "https://sheets.example.test/append");
    vi.stubEnv("SHEETS_WRITE_TOKEN", "write-token");
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify(response), { status: 200 }),
    );

    await expect(appendOrderToSalesSheet(baseOrder)).resolves.toEqual({ deduped });
  });
});

describe("AUD3 H07-C1 Sheet Admin intent contract", () => {
  it("sends field-specific expected state with the Admin token", async () => {
    vi.stubEnv("SHEETS_ENDPOINT", "https://sheets.example.test/admin");
    vi.stubEnv("SHEETS_ADMIN_TOKEN", "admin-token");
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({
        ok: true,
        outcome: "applied",
        current: { paymentStatus: "confirmed", shippingStatus: "in_process" },
        paymentApplied: true,
        shippingApplied: false,
        shippingDeferred: false,
        mpPaymentId: "manual-order-sheet",
        approvedAt: 100,
      }), { status: 200 }),
    );

    await applyAdminOrderStatusIntentInSalesSheet("order-sheet", {
      changedFields: ["paymentStatus"],
      expectedPaymentStatus: "pending",
      requestedPaymentStatus: "confirmed",
    });
    const body = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body)) as Record<string, unknown>;
    expect(body).toMatchObject({
      action: "applyAdminOrderStatusIntent",
      token: "admin-token",
      orderId: "order-sheet",
      intent: {
        changedFields: ["paymentStatus"],
        expectedPaymentStatus: "pending",
        requestedPaymentStatus: "confirmed",
      },
    });
    expect((body.intent as Record<string, unknown>)).not.toHaveProperty("requestedShippingStatus");
  });

  it("preserves the stable conflict code and latest statuses", async () => {
    vi.stubEnv("SHEETS_ENDPOINT", "https://sheets.example.test/admin");
    vi.stubEnv("SHEETS_ADMIN_TOKEN", "admin-token");
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({
        ok: false,
        code: "ORDER_STATE_CHANGED",
        error: "Order state changed",
        orderId: "order-sheet",
        current: { paymentStatus: "cancelled", shippingStatus: "completed" },
      }), { status: 200 }),
    );

    const error = await applyAdminOrderStatusIntentInSalesSheet("order-sheet", {
      changedFields: ["paymentStatus"],
      expectedPaymentStatus: "pending",
      requestedPaymentStatus: "confirmed",
    }).catch((caught) => caught);
    expect(error).toBeInstanceOf(AdminOrderStateChangedError);
    expect(error).toMatchObject({
      code: "ORDER_STATE_CHANGED",
      orderId: "order-sheet",
      current: { paymentStatus: "cancelled", shippingStatus: "completed" },
    });
  });
});

describe("buildSalesSheetRow", () => {
  it("maps fulfillment fields for new ventas columns", () => {
    const row = buildSalesSheetRow({
      ...baseOrder,
      fulfillment: {
        subtotalProducts: 20000,
        discountAmount: 2000,
        shippingFee: 4000,
        finalTotal: 22000,
        deliveryZone: {
          id: "rosario-zona-habilitada",
          name: "Rosario - zona de envío",
          insideZoneConfirmed: true,
        },
        deliveryAddress: {
          street: "San Lorenzo",
          number: "1234",
          floor: "2 A",
          betweenStreets: "Mitre y Entre Rios",
          notes: "Timbre Estilo",
        },
        summary: "Envío a domicilio: San Lorenzo 1234, 2 A, entre Mitre y Entre Rios",
      },
    });

    expect(row.total).toBe(22000);
    expect(row.total_final).toBe(22000);
    expect(row.subtotal_productos).toBe(20000);
    expect(row.descuento).toBe(2000);
    expect(row.costo_envio).toBe(4000);
    expect(row.delivery_zone_id).toBe("rosario-zona-habilitada");
    expect(row.delivery_inside_zone_confirmed).toBe("TRUE");
    expect(row.delivery_address_street).toBe("San Lorenzo");
    expect(row.fulfillment_summary).toContain("Envío a domicilio");
    expect(REQUIRED_SALES_FULFILLMENT_HEADERS.every((header) => header in row)).toBe(true);
  });

  it("maps pickup point fulfillment fields", () => {
    const row = buildSalesSheetRow({
      ...baseOrder,
      deliveryMethod: "pickup",
      total: 18000,
      fulfillment: {
        subtotalProducts: 20000,
        discountAmount: 2000,
        shippingFee: 0,
        finalTotal: 18000,
        pickupPoint: {
          id: "santa-fe-mitre",
          name: "Santa Fe y Mitre",
          address: "Santa Fe y Mitre",
          reference: "Coordinamos día y horario por WhatsApp",
        },
        summary: "Punto de encuentro: Santa Fe y Mitre",
      },
    });

    expect(row.total).toBe(18000);
    expect(row.total_final).toBe(18000);
    expect(row.costo_envio).toBe(0);
    expect(row.pickup_point_id).toBe("santa-fe-mitre");
    expect(row.pickup_point_name).toBe("Santa Fe y Mitre");
    expect(row.fulfillment_summary).toBe("Punto de encuentro: Santa Fe y Mitre");
  });
});

describe("AUD3 H07-E2 Admin fulfillment Sheet projection", () => {
  it("EF-E-02-01 parses the complete delivery snapshot", () => {
    const order = parseAdminOrderRow({
      nro_de_compra: "order-admin-delivery",
      forma_de_entrega: "delivery",
      total: 22000,
      subtotal_productos: 20000,
      descuento: 2000,
      costo_envio: 4000,
      total_final: 22000,
      delivery_zone_id: "rosario-zona-habilitada",
      delivery_zone_name: "Rosario - zona de envío",
      delivery_inside_zone_confirmed: "TRUE",
      delivery_address_street: "San Lorenzo",
      delivery_address_number: "1234",
      delivery_address_floor: "2 A",
      delivery_address_between_streets: "Mitre y Entre Ríos",
      delivery_address_notes: "Timbre Estilo",
      fulfillment_summary: "Envío a domicilio: San Lorenzo 1234",
    });

    expect(order).toMatchObject({
      deliveryMethod: "delivery",
      total: 22000,
      fulfillment: {
        subtotalProducts: 20000,
        discountAmount: 2000,
        shippingFee: 4000,
        finalTotal: 22000,
        deliveryZone: {
          id: "rosario-zona-habilitada",
          insideZoneConfirmed: true,
        },
        deliveryAddress: {
          street: "San Lorenzo",
          number: "1234",
          floor: "2 A",
          betweenStreets: "Mitre y Entre Ríos",
          notes: "Timbre Estilo",
        },
      },
    });
  });

  it("EF-E-02-02 parses the complete pickup snapshot", () => {
    const order = parseAdminOrderRow({
      nro_de_compra: "order-admin-pickup",
      forma_de_entrega: "pickup",
      total: 18000,
      subtotal_productos: 20000,
      descuento: 2000,
      costo_envio: 0,
      total_final: 18000,
      pickup_point_id: "santa-fe-mitre",
      pickup_point_name: "Santa Fe y Mitre",
      pickup_point_address: "Santa Fe y Mitre",
      pickup_point_reference: "Zona centro",
      fulfillment_summary: "Punto de encuentro: Santa Fe y Mitre",
    });

    expect(order).toMatchObject({
      deliveryMethod: "pickup",
      fulfillment: {
        subtotalProducts: 20000,
        discountAmount: 2000,
        shippingFee: 0,
        finalTotal: 18000,
        pickupPoint: {
          id: "santa-fe-mitre",
          name: "Santa Fe y Mitre",
          address: "Santa Fe y Mitre",
          reference: "Zona centro",
        },
      },
    });
  });
});

describe("getOrdersForAdmin", () => {
  it("reads WhatsApp values from camel-case sheet headers", async () => {
    vi.stubEnv("SHEETS_ENDPOINT", "https://sheets.example.test/catalog");
    vi.stubEnv("SHEETS_ADMIN_TOKEN", "admin-token");

    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          ok: true,
          items: [
            {
              Nro_de_compra: "es-20260615-190658-test",
              Fecha: "2026-06-15T19:06:58.000Z",
              Nombre: "Rocio",
              Apellido: "Gonzalez",
              WhatsApp: "3413432914",
              Email: "rocio@example.com",
              Forma_de_Pago: "Mercado Pago",
              Estado_de_Pago: "Confirmado",
              Estado_de_Envio: "En proceso",
              Total: 15225,
            },
          ],
        }),
        { status: 200 }
      )
    );

    const orders = await getOrdersForAdmin();

    expect(orders).toHaveLength(1);
    expect(orders[0]?.customerName).toBe("Rocio Gonzalez");
    expect(orders[0]?.whatsapp).toBe("3413432914");
  });
});

describe("inventory mutation contract", () => {
  it("sends one aggregated demand per product id", async () => {
    vi.stubEnv("SHEETS_ENDPOINT", "https://sheets.example.test/catalog");
    vi.stubEnv("SHEETS_WRITE_TOKEN", "write-token");
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({
        ok: true,
        outcome: "APPLIED",
        deduped: false,
        updated: [{ productId: "a", previousQty: 3, nextQty: 0 }],
      }), { status: 200 }),
    );

    const result = await decrementProductsStockInSheet("order-aggregate", [
      { productId: "a", qty: 1, title: "Nombre no autoritativo" },
      { productId: "a", qty: 2, title: "Otro nombre" },
    ]);

    const requestBody = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body)) as {
      items: unknown[];
    };
    expect(requestBody.items).toEqual([{ productId: "a", qty: 3 }]);
    expect(result).toEqual({
      deduped: false,
      updated: [{ productId: "a", previousQty: 3, nextQty: 0 }],
    });
  });

  it("rejects every invalid mutation payload without calling Apps Script", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch");

    await expect(decrementProductsStockInSheet("order-invalid", [
      { productId: "a", qty: 1 },
      { productId: "b", qty: 1.5 },
    ])).rejects.toMatchObject({ code: "INVALID_QUANTITY", productId: "b" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("preserves structured Apps Script inventory errors for PR 2", async () => {
    vi.stubEnv("SHEETS_ENDPOINT", "https://sheets.example.test/catalog");
    vi.stubEnv("SHEETS_WRITE_TOKEN", "write-token");
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({
        ok: false,
        error: "Insufficient stock",
        code: "INSUFFICIENT_STOCK",
        productId: "a",
      }), { status: 200 }),
    );

    const error = await decrementProductsStockInSheet("order-stock", [{ productId: "a", qty: 2 }])
      .catch((caught) => caught);
    expect(error).toBeInstanceOf(InventoryOperationError);
    expect(error).toMatchObject({ code: "INSUFFICIENT_STOCK", productId: "a" });
  });

  it("rejects incomplete successful mutation responses", async () => {
    vi.stubEnv("SHEETS_ENDPOINT", "https://sheets.example.test/catalog");
    vi.stubEnv("SHEETS_WRITE_TOKEN", "write-token");
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ ok: true, deduped: false }), { status: 200 }),
    );

    await expect(
      decrementProductsStockInSheet("order-incomplete", [{ productId: "a", qty: 1 }]),
    ).rejects.toMatchObject({ code: "INVENTORY_VALIDATION_FAILED" });
  });

  it("accepts an idempotent deduplication response without repeated updates", async () => {
    vi.stubEnv("SHEETS_ENDPOINT", "https://sheets.example.test/catalog");
    vi.stubEnv("SHEETS_WRITE_TOKEN", "write-token");
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ ok: true, deduped: true }), { status: 200 }),
    );

    await expect(
      decrementProductsStockInSheet("order-deduped", [{ productId: "a", qty: 1 }]),
    ).resolves.toEqual({ deduped: true, updated: [] });
  });

  it("accepts the explicit ALREADY_APPLIED outcome and preserves old response compatibility", async () => {
    vi.stubEnv("SHEETS_ENDPOINT", "https://sheets.example.test/catalog");
    vi.stubEnv("SHEETS_WRITE_TOKEN", "write-token");
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ ok: true, outcome: "ALREADY_APPLIED", deduped: true }), { status: 200 }),
    );

    await expect(
      decrementProductsStockInSheet("order-already-applied", [{ productId: "a", qty: 1 }]),
    ).resolves.toEqual({ deduped: true, updated: [] });
  });

  it("preserves an idempotency fingerprint conflict as a deterministic inventory error", async () => {
    vi.stubEnv("SHEETS_ENDPOINT", "https://sheets.example.test/catalog");
    vi.stubEnv("SHEETS_WRITE_TOKEN", "write-token");
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({
        ok: false,
        error: "Inventory idempotency conflict",
        code: "INVENTORY_IDEMPOTENCY_CONFLICT",
      }), { status: 200 }),
    );

    await expect(
      decrementProductsStockInSheet("order-fingerprint-conflict", [{ productId: "a", qty: 1 }]),
    ).rejects.toMatchObject({ code: "INVENTORY_IDEMPOTENCY_CONFLICT", origin: "domain" });
  });

  it("rejects inconsistent explicit inventory outcomes as uncertain response errors", async () => {
    vi.stubEnv("SHEETS_ENDPOINT", "https://sheets.example.test/catalog");
    vi.stubEnv("SHEETS_WRITE_TOKEN", "write-token");
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({
        ok: true,
        outcome: "APPLIED",
        updated: [{ productId: "a", previousQty: 2, nextQty: 1 }],
      }), { status: 200 }),
    );

    await expect(
      decrementProductsStockInSheet("order-inconsistent-outcome", [{ productId: "a", qty: 1 }]),
    ).rejects.toMatchObject({ code: "INVENTORY_VALIDATION_FAILED", origin: "response" });
  });

  it("H07D2-DUP-01 reports duplicate ventas rows without selecting a winner", async () => {
    vi.stubEnv("SHEETS_ENDPOINT", "https://sheets.example.test/catalog");
    vi.stubEnv("SHEETS_ADMIN_TOKEN", "admin-token");
    const duplicate = {
      Nro_de_compra: "es-duplicate-order",
      Fecha: "2026-06-15T19:06:58.000Z",
      Nombre: "Rocio",
      Apellido: "Gonzalez",
      WhatsApp: "3413432914",
      Email: "rocio@example.com",
      Forma_de_Pago: "Mercado Pago",
      Estado_de_Pago: "Confirmado",
      Estado_de_Envio: "En proceso",
      Total: 15225,
    };
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ ok: true, items: [duplicate, duplicate] }), {
        status: 200,
      }),
    );

    await expect(getUniqueOrderRowById("es-duplicate-order")).resolves.toEqual({
      outcome: "duplicate",
      order: null,
      count: 2,
    });
  });
});

describe("PR 2 ventas inventory persistence", () => {
  it("AUD3-H06E-ROLLOUT-02 writes eligibility only for explicitly enrolled orders", () => {
    expect(buildSalesSheetRow(baseOrder).receipt_outbox_version).toBe("");
    expect(buildSalesSheetRow({
      ...baseOrder,
      status: "approved",
      paymentStatus: "confirmed",
      receiptOutboxVersion: 1,
    }).receipt_outbox_version).toBe(1);
  });

  it("writes the ventas eligibility marker only when explicitly requested", async () => {
    vi.stubEnv("SHEETS_ENDPOINT", "https://sheets.example.test/catalog");
    vi.stubEnv("SHEETS_WRITE_TOKEN", "write-token");
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async () =>
      new Response(JSON.stringify({ ok: true }), { status: 200 }),
    );
    await updateOrderRowInSalesSheet("order-enrolled", { receiptOutboxVersion: 1 });
    const enrolledBody = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body));
    expect(enrolledBody.updates.receipt_outbox_version).toBe(1);

    await updateOrderRowInSalesSheet("order-legacy", { paymentStatus: "confirmed" });
    const legacyBody = JSON.parse(String(fetchMock.mock.calls[1]?.[1]?.body));
    expect(legacyBody.updates).not.toHaveProperty("receipt_outbox_version");
  });

  it("PR2-SHEET-01 buildSalesSheetRow writes pending", () => {
    expect(buildSalesSheetRow({ ...baseOrder, inventoryStatus: "pending" }).inventory_status).toBe("pending");
  });

  it("PR2-SHEET-02 buildSalesSheetRow writes deducted with evidence", () => {
    const row = buildSalesSheetRow({ ...baseOrder, inventoryStatus: "deducted", stockDeductedAt: 123 });
    expect(row.inventory_status).toBe("deducted");
    expect(row.stock_deducted_at).toBe(new Date(123).toISOString());
  });

  it("PR2-SHEET-03 buildSalesSheetRow writes conflict code and date", () => {
    const row = buildSalesSheetRow({
      ...baseOrder,
      inventoryStatus: "conflict",
      inventoryIssueCode: "INSUFFICIENT_STOCK",
      inventoryIssueAt: 456,
    });
    expect(row).toMatchObject({
      inventory_status: "conflict",
      inventory_issue_code: "INSUFFICIENT_STOCK",
      inventory_issue_at: new Date(456).toISOString(),
    });
  });

  it("PR2-SHEET-04 buildSalesSheetRow writes sanitized technical error metadata", () => {
    const row = buildSalesSheetRow({
      ...baseOrder,
      inventoryStatus: "error",
      inventoryIssueCode: "SHEETS_TIMEOUT",
      inventoryIssueAt: 789,
    });
    expect(row).toMatchObject({
      inventory_status: "error",
      inventory_issue_code: "SHEETS_TIMEOUT",
      inventory_issue_at: new Date(789).toISOString(),
    });
  });

  it("PR2-SHEET-05 updateOrderRow can explicitly clear issue code", async () => {
    vi.stubEnv("SHEETS_ENDPOINT", "https://sheets.example.test/catalog");
    vi.stubEnv("SHEETS_WRITE_TOKEN", "write-token");
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), { status: 200 })
    );
    await updateOrderRowInSalesSheet("order-clear-code", { inventoryIssueCode: null });
    const body = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body));
    expect(body.updates.inventory_issue_code).toBe("");
  });

  it("PR2-SHEET-06 updateOrderRow can explicitly clear issue date", async () => {
    vi.stubEnv("SHEETS_ENDPOINT", "https://sheets.example.test/catalog");
    vi.stubEnv("SHEETS_WRITE_TOKEN", "write-token");
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), { status: 200 })
    );
    await updateOrderRowInSalesSheet("order-clear-date", { inventoryIssueAt: null });
    const body = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body));
    expect(body.updates.inventory_issue_at).toBe("");
  });

  it("PR2-SHEET-07 parser recognizes exactly the four supported states", () => {
    expect(["pending", "deducted", "conflict", "error"].map(parseInventoryStatus)).toEqual([
      "pending",
      "deducted",
      "conflict",
      "error",
    ]);
  });

  it("PR2-SHEET-08 unknown tokens are not silently converted", () => {
    expect(parseInventoryStatus("descontado")).toBeUndefined();
    expect(parseInventoryStatus("successful")).toBeUndefined();
  });

  it("PR2-SHEET-09 legacy stock_deducted_at is presented as deducted", async () => {
    vi.stubEnv("SHEETS_ENDPOINT", "https://sheets.example.test/catalog");
    vi.stubEnv("SHEETS_ADMIN_TOKEN", "admin-token");
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({
      ok: true,
      items: [{ nro_de_compra: "legacy-deducted", stock_deducted_at: "2026-08-01T00:00:00.000Z" }],
    }), { status: 200 }));
    expect((await getOrdersForAdmin())[0]?.inventoryStatus).toBe("deducted");
  });

  it("PR2-SHEET-10 legacy row without inventory fields remains unregistered", async () => {
    vi.stubEnv("SHEETS_ENDPOINT", "https://sheets.example.test/catalog");
    vi.stubEnv("SHEETS_ADMIN_TOKEN", "admin-token");
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({
      ok: true,
      items: [{ nro_de_compra: "legacy-unknown" }],
    }), { status: 200 }));
    expect((await getOrdersForAdmin())[0]?.inventoryStatus).toBeUndefined();
  });

  it("PR2-SHEET-11 updateOrderRow can explicitly clear stale stock evidence", async () => {
    vi.stubEnv("SHEETS_ENDPOINT", "https://sheets.example.test/catalog");
    vi.stubEnv("SHEETS_WRITE_TOKEN", "write-token");
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), { status: 200 })
    );
    await updateOrderRowInSalesSheet("order-clear-stock", { stockDeductedAt: null });
    const body = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body));
    expect(body.updates.stock_deducted_at).toBe("");
  });
});
