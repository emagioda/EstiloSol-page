import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import vm from "node:vm";
import { describe, expect, it } from "vitest";

type ProductRow = {
  id: string;
  name?: string;
  price?: unknown;
  active: unknown;
  stockStatus: unknown;
  stockQty: unknown;
  slug?: string;
  currency?: unknown;
};

type HarnessOptions = {
  activeHeader?: "active" | "activo" | "is_active";
  cachePut?: () => void;
};

type WriteRecord = { sheet: string; row: number; column: number; value: unknown };

const scriptSource = readFileSync(
  resolve(process.cwd(), "scripts/apps-script/estilo-sol-api-v4.gs"),
  "utf8",
);

const createHarness = (products: ProductRow[], options: HarnessOptions = {}) => {
  const productHeaders = [
    "id",
    "name",
    options.activeHeader ?? "active",
    "stock_status",
    "stock_qty",
    "slug",
    "updated_at",
    "currency",
    "price",
  ];
  const productRows = products.map((product) => [
    product.id,
    product.name ?? product.id,
    product.active,
    product.stockStatus,
    product.stockQty,
    product.slug ?? "",
    "",
    product.currency ?? "ARS",
    product.price === undefined ? 1000 : product.price,
  ]);
  const salesHeaders = ["nro_de_compra", "items_json"];
  const salesRows: unknown[][] = [];
  const writes: WriteRecord[] = [];
  const properties = new Map<string, string>([
    ["SPREADSHEET_ID", "test-spreadsheet"],
    ["SHEETS_READ_TOKEN", "read-token"],
    ["SHEETS_WRITE_TOKEN", "write-token"],
    ["SHEETS_ADMIN_TOKEN", "admin-token"],
  ]);
  const locks = { waited: 0, released: 0 };

  const buildSheet = (name: string, headers: string[], rows: unknown[][]) => ({
    getLastColumn: () => headers.length,
    getLastRow: () => rows.length + 1,
    getDataRange: () => ({ getValues: () => [headers.slice(), ...rows.map((row) => row.slice())] }),
    getRange: (row: number, column: number, rowCount = 1, columnCount = 1) => ({
      getValues: () => {
        if (row === 1) return [headers.slice(column - 1, column - 1 + columnCount)];
        return rows
          .slice(row - 2, row - 2 + rowCount)
          .map((sourceRow) => sourceRow.slice(column - 1, column - 1 + columnCount));
      },
      setValue: (value: unknown) => {
        rows[row - 2][column - 1] = value;
        writes.push({ sheet: name, row, column, value });
      },
    }),
    appendRow: (values: unknown[]) => {
      rows.push(values.slice());
    },
  });

  const productSheet = buildSheet("products", productHeaders, productRows);
  const salesSheet = buildSheet("ventas", salesHeaders, salesRows);
  const sheets = new Map<string, ReturnType<typeof buildSheet>>([
    ["products", productSheet],
    ["ventas", salesSheet],
  ]);
  const scriptProperties = {
    getProperty: (key: string) => properties.get(key) ?? null,
    setProperty: (key: string, value: string) => properties.set(key, String(value)),
  };

  const context = vm.createContext({
    SpreadsheetApp: {
      flush: () => undefined,
      openById: () => ({ getSheetByName: (name: string) => sheets.get(name) ?? null }),
      getActiveSpreadsheet: () => ({ getSheetByName: (name: string) => sheets.get(name) ?? null }),
    },
    PropertiesService: { getScriptProperties: () => scriptProperties },
    CacheService: {
      getScriptCache: () => ({
        get: () => null,
        put: options.cachePut ?? (() => undefined),
        remove: () => undefined,
      }),
    },
    LockService: {
      getScriptLock: () => ({
        waitLock: () => { locks.waited += 1; },
        releaseLock: () => { locks.released += 1; },
      }),
    },
    ContentService: {
      MimeType: { JSON: "application/json" },
      createTextOutput: (content: string) => ({
        content,
        setMimeType() { return this; },
        getContent() { return this.content; },
      }),
    },
    console: { error: () => undefined },
  });

  vm.runInContext(
    `${scriptSource}\n;globalThis.__inventoryApi = { normalizeStockItems_, handleDecrementStock, handleAppendOrderAndDecrementStock, normalizeProduct, buildProductsPayloadObject, doGet, doPost };`,
    context,
  );

  const api = (context as unknown as { __inventoryApi: Record<string, (...args: unknown[]) => unknown> })
    .__inventoryApi;
  const stockWrites = () => writes.filter((write) => write.sheet === "products" && write.column === 5);

  return {
    api,
    properties,
    productRows,
    salesRows,
    writes,
    stockWrites,
    locks,
  };
};

const availableProduct = (overrides: Partial<ProductRow> = {}): ProductRow => ({
  id: "a",
  name: "Producto A",
  active: true,
  stockStatus: "Disponible",
  stockQty: 3,
  ...overrides,
});

const decrement = (api: Record<string, (...args: unknown[]) => unknown>, orderId: string, items: unknown[]) =>
  api.handleDecrementStock({ sheet: "products", orderId, items }) as Record<string, unknown>;

const expectInventoryError = (operation: () => unknown, code: string) => {
  try {
    operation();
    throw new Error("Expected inventory operation to fail");
  } catch (error) {
    expect(error).toMatchObject({ code });
  }
};

describe("Apps Script authoritative inventory planning", () => {
  it("AS-00 returns the public catalog when CacheService rejects an oversized payload", () => {
    const harness = createHarness(
      [availableProduct()],
      { cachePut: () => { throw new Error("Argument too large: value"); } },
    );

    expect(harness.api.buildProductsPayloadObject({ force: true })).toMatchObject({
      ok: true,
      meta: { count: 1 },
      items: [{ id: "a", name: "Producto A" }],
    });
  });

  it("AS-01 rejects repeated demand above stock before writing", () => {
    const harness = createHarness([availableProduct({ stockQty: 1 })]);
    expectInventoryError(
      () => decrement(harness.api, "order-1", [{ productId: "a", qty: 1 }, { productId: "a", qty: 1 }]),
      "INSUFFICIENT_STOCK",
    );
    expect(harness.stockWrites()).toHaveLength(0);
  });

  it("AS-02 creates one 3 to 0 update for repeated demand", () => {
    const harness = createHarness([availableProduct({ stockQty: 3 })]);
    const result = decrement(harness.api, "order-2", [
      { productId: "a", qty: 1 },
      { productId: "a", qty: 2 },
    ]);
    expect(result.updated).toEqual([{ productId: "a", previousQty: 3, nextQty: 0 }]);
    expect(harness.stockWrites()).toEqual([{ sheet: "products", row: 2, column: 5, value: 0 }]);
  });

  it("AS-03 rejects aggregate demand above stock without writing", () => {
    const harness = createHarness([availableProduct({ stockQty: 2 })]);
    expectInventoryError(
      () => decrement(harness.api, "order-3", [{ productId: "a", qty: 2 }, { productId: "a", qty: 1 }]),
      "INSUFFICIENT_STOCK",
    );
    expect(harness.stockWrites()).toHaveLength(0);
  });

  it("AS-04 creates one update per product id", () => {
    const harness = createHarness([
      availableProduct({ id: "a", stockQty: 2 }),
      availableProduct({ id: "b", stockQty: 2 }),
    ]);
    decrement(harness.api, "order-4", [{ productId: "a", qty: 1 }, { productId: "b", qty: 1 }]);
    expect(harness.stockWrites()).toHaveLength(2);
  });

  it("AS-05 keeps variants with the same slug independent", () => {
    const harness = createHarness([
      availableProduct({ id: "125", slug: "shared", stockQty: 1 }),
      availableProduct({ id: "126", slug: "shared", stockQty: 1 }),
    ]);
    const result = decrement(harness.api, "order-5", [
      { productId: "125", qty: 1 },
      { productId: "126", qty: 1 },
    ]);
    expect((result.updated as Array<{ productId: string }>).map((item) => item.productId)).toEqual(["125", "126"]);
  });

  it("AS-06 rejects duplicate requested product rows", () => {
    const harness = createHarness([availableProduct(), availableProduct({ name: "Duplicado" })]);
    expectInventoryError(() => decrement(harness.api, "order-6", [{ productId: "a", qty: 1 }]), "DUPLICATE_PRODUCT_ID");
    expect(harness.stockWrites()).toHaveLength(0);
  });

  it("AS-07 rejects empty stock", () => {
    const harness = createHarness([availableProduct({ stockQty: "" })]);
    expectInventoryError(() => decrement(harness.api, "order-7", [{ productId: "a", qty: 1 }]), "INVALID_STOCK_QTY");
  });

  it("AS-08 rejects null stock", () => {
    const harness = createHarness([availableProduct({ stockQty: null })]);
    expectInventoryError(() => decrement(harness.api, "order-8", [{ productId: "a", qty: 1 }]), "INVALID_STOCK_QTY");
  });

  it("AS-09 rejects decimal stock", () => {
    const harness = createHarness([availableProduct({ stockQty: 1.5 })]);
    expectInventoryError(() => decrement(harness.api, "order-9", [{ productId: "a", qty: 1 }]), "INVALID_STOCK_QTY");
  });

  it("AS-10 rejects negative stock", () => {
    const harness = createHarness([availableProduct({ stockQty: -1 })]);
    expectInventoryError(() => decrement(harness.api, "order-10", [{ productId: "a", qty: 1 }]), "INVALID_STOCK_QTY");
  });

  it("AS-11 rejects unknown stock status", () => {
    const harness = createHarness([availableProduct({ stockStatus: "quizas" })]);
    expectInventoryError(() => decrement(harness.api, "order-11", [{ productId: "a", qty: 1 }]), "PRODUCT_NOT_AVAILABLE");
  });

  it("AS-12 rejects inactive products", () => {
    const harness = createHarness([availableProduct({ active: false })]);
    expectInventoryError(() => decrement(harness.api, "order-12", [{ productId: "a", qty: 1 }]), "PRODUCT_INACTIVE");
  });

  it("AS-13 rejects empty or unknown active values", () => {
    const empty = createHarness([availableProduct({ active: "" })]);
    const unknown = createHarness([availableProduct({ active: "quizas" })]);
    expectInventoryError(() => decrement(empty.api, "order-13a", [{ productId: "a", qty: 1 }]), "PRODUCT_INACTIVE");
    expectInventoryError(() => decrement(unknown.api, "order-13b", [{ productId: "a", qty: 1 }]), "PRODUCT_INACTIVE");
  });

  it("AS-14 rejects the whole operation when one item is invalid", () => {
    const harness = createHarness([availableProduct()]);
    expectInventoryError(
      () => decrement(harness.api, "order-14", [{ productId: "a", qty: 1 }, { productId: "b", qty: -1 }]),
      "INVALID_QUANTITY",
    );
    expect(harness.stockWrites()).toHaveLength(0);
  });

  it("AS-15 insufficient stock does not write or create dedupe", () => {
    const harness = createHarness([availableProduct({ stockQty: 1 })]);
    expectInventoryError(() => decrement(harness.api, "order-15", [{ productId: "a", qty: 2 }]), "INSUFFICIENT_STOCK");
    expect(harness.stockWrites()).toHaveLength(0);
    expect(harness.properties.has("stock_deducted:order-15")).toBe(false);
  });

  it("AS-16 success writes once per product and creates dedupe last", () => {
    const harness = createHarness([availableProduct({ stockQty: 2 })]);
    const result = decrement(harness.api, "order-16", [{ productId: "a", qty: 1 }]);
    expect(result).toMatchObject({ ok: true, deduped: false });
    expect(harness.stockWrites()).toHaveLength(1);
    expect(harness.properties.has("stock_deducted:order-16")).toBe(true);
  });

  it("AS-17 replays a successful order id without another write", () => {
    const harness = createHarness([availableProduct({ stockQty: 2 })]);
    decrement(harness.api, "order-17", [{ productId: "a", qty: 1 }]);
    const second = decrement(harness.api, "order-17", [{ productId: "a", qty: 1 }]);
    expect(second).toMatchObject({ ok: true, deduped: true });
    expect(harness.stockWrites()).toHaveLength(1);
  });

  it("AS-18 retries a failed order id because no dedupe property exists", () => {
    const harness = createHarness([availableProduct({ stockQty: 1 })]);
    expectInventoryError(() => decrement(harness.api, "order-18", [{ productId: "a", qty: 2 }]), "INSUFFICIENT_STOCK");
    harness.productRows[0][4] = 2;
    const retried = decrement(harness.api, "order-18", [{ productId: "a", qty: 2 }]);
    expect(retried).toMatchObject({ ok: true, deduped: false });
    expect(harness.stockWrites()).toHaveLength(1);
  });

  it("AS-19 decrements only the kit id", () => {
    const harness = createHarness([
      availableProduct({ id: "kit-1", stockQty: 1 }),
      availableProduct({ id: "component-1", stockQty: 5 }),
    ]);
    decrement(harness.api, "order-19", [{ productId: "kit-1", qty: 1 }]);
    expect(harness.productRows[0][4]).toBe(0);
    expect(harness.productRows[1][4]).toBe(5);
  });

  it("AS-20 combined append uses the same aggregation and strict stock plan", () => {
    const harness = createHarness([availableProduct({ stockQty: 3 })]);
    const result = harness.api.handleAppendOrderAndDecrementStock({
      sheet: "ventas",
      orderId: "order-20",
      row: { nro_de_compra: "order-20", items_json: "[]" },
      items: [{ productId: "a", qty: 1 }, { productId: "a", qty: 2 }],
    }) as Record<string, unknown>;
    expect(result).toMatchObject({ ok: true, deduped: false });
    expect(harness.salesRows).toHaveLength(1);
    expect(harness.stockWrites()).toEqual([{ sheet: "products", row: 2, column: 5, value: 0 }]);
  });

  it("does not append a sales row when combined planning fails", () => {
    const harness = createHarness([availableProduct({ stockQty: 1 })]);
    expectInventoryError(
      () => harness.api.handleAppendOrderAndDecrementStock({
        sheet: "ventas",
        orderId: "order-combined-fail",
        row: { nro_de_compra: "order-combined-fail" },
        items: [{ productId: "a", qty: 2 }],
      }),
      "INSUFFICIENT_STOCK",
    );
    expect(harness.salesRows).toHaveLength(0);
    expect(harness.stockWrites()).toHaveLength(0);
  });

  it("rejects decimal quantities instead of truncating them", () => {
    const harness = createHarness([availableProduct()]);
    expectInventoryError(() => decrement(harness.api, "order-decimal", [{ productId: "a", qty: 1.8 }]), "INVALID_QUANTITY");
    expectInventoryError(() => decrement(harness.api, "order-string", [{ productId: "a", qty: "1" }]), "INVALID_QUANTITY");
  });

  it("enforces aggregate and line limits", () => {
    const harness = createHarness([availableProduct({ stockQty: 100 })]);
    expectInventoryError(
      () => decrement(harness.api, "order-limit", [{ productId: "a", qty: 30 }, { productId: "a", qty: 21 }]),
      "AGGREGATED_QUANTITY_LIMIT",
    );
    expectInventoryError(
      () => decrement(
        harness.api,
        "order-lines",
        Array.from({ length: 31 }, (_, index) => ({ productId: `p-${index}`, qty: 1 })),
      ),
      "TOO_MANY_ITEMS",
    );
  });

  it("returns structured errors and keeps stock work inside LockService", () => {
    const harness = createHarness([availableProduct({ stockQty: 1 })]);
    const output = harness.api.doPost({
      postData: {
        contents: JSON.stringify({
          action: "decrementStock",
          token: "write-token",
          sheet: "products",
          orderId: "order-lock",
          items: [{ productId: "a", qty: 2 }],
        }),
      },
    }) as { getContent: () => string };
    expect(JSON.parse(output.getContent())).toMatchObject({
      ok: false,
      code: "INSUFFICIENT_STOCK",
      productId: "a",
    });
    expect(harness.locks).toEqual({ waited: 1, released: 1 });
    expect(harness.stockWrites()).toHaveLength(0);
  });

  it("emits strict authoritative catalog metadata without changing display fallbacks", () => {
    const harness = createHarness([]);
    const normalized = harness.api.normalizeProduct({
      id: "a",
      name: "A",
      price: 1000,
      currency: "ARS",
      active: "quizas",
      stock_status: "quizas",
      stock_qty: "abc",
    }) as Record<string, unknown>;
    expect(normalized).toMatchObject({
      authoritative_price: 1000,
      authoritative_currency: "ARS",
      authoritative_active: null,
      authoritative_stock_status: null,
      authoritative_stock_qty: null,
    });

    const missingCurrency = harness.api.normalizeProduct({
      id: "b",
      name: "B",
      price: 1000,
      active: true,
      stock_status: "in_stock",
      stock_qty: 1,
    }) as Record<string, unknown>;
    expect(missingCurrency.authoritative_currency).toBeNull();

    const aliasedId = harness.api.normalizeProduct({
      product_id: "alias-id",
      name: "Alias",
      price: 1000,
      currency: "ARS",
      active: true,
      stock_status: "in_stock",
      stock_qty: 1,
    }) as Record<string, unknown>;
    expect(aliasedId.id).toBe("alias-id");
  });

  it("TEST-HF-01/02/09 preserves malformed duplicate rows in authoritative reads", () => {
    const missingName = createHarness([
      availableProduct({ id: "125", name: "Aros" }),
      availableProduct({ id: "125", name: "" }),
    ]);
    const missingPrice = createHarness([
      availableProduct({ id: "125", name: "Aros" }),
      availableProduct({ id: "125", name: "Duplicado", price: "" }),
    ]);

    const namePayload = missingName.api.buildProductsPayloadObject({
      authoritative: true,
      includeInactive: true,
      force: true,
    }) as { items: Array<Record<string, unknown>> };
    const pricePayload = missingPrice.api.buildProductsPayloadObject({
      authoritative: true,
      includeInactive: true,
      force: true,
    }) as { items: Array<Record<string, unknown>> };

    expect(namePayload.items).toHaveLength(2);
    expect(namePayload.items[1]).toMatchObject({ id: "125", name: null });
    expect(pricePayload.items).toHaveLength(2);
    expect(pricePayload.items[1]).toMatchObject({ id: "125", authoritative_price: null });
    expect(missingName.writes).toHaveLength(0);
    expect(missingPrice.writes).toHaveLength(0);
  });

  it("TEST-HF-09 exposes authoritative rows through doGet only with an admin token", () => {
    const harness = createHarness([
      availableProduct({ id: "125", name: "Aros" }),
      availableProduct({ id: "125", name: "" }),
    ]);
    const readOutput = harness.api.doGet({
      parameter: {
        sheet: "products",
        token: "read-token",
        authoritative: "1",
        force: "1",
      },
    }) as { getContent: () => string };
    const adminOutput = harness.api.doGet({
      parameter: {
        sheet: "products",
        token: "admin-token",
        authoritative: "1",
        includeInactive: "1",
        force: "1",
      },
    }) as { getContent: () => string };

    expect(JSON.parse(readOutput.getContent())).toEqual({ ok: false, error: "Unauthorized" });
    expect(JSON.parse(adminOutput.getContent())).toHaveLength(2);
    expect(harness.writes).toHaveLength(0);
  });

  it("TEST-HF-04/05 preserves a unique malformed row for fail-closed validation", () => {
    const missingName = createHarness([availableProduct({ id: "125", name: "" })]);
    const missingPrice = createHarness([availableProduct({ id: "126", price: "" })]);

    const namePayload = missingName.api.buildProductsPayloadObject({
      authoritative: true,
      includeInactive: true,
      force: true,
    }) as { items: Array<Record<string, unknown>> };
    const pricePayload = missingPrice.api.buildProductsPayloadObject({
      authoritative: true,
      includeInactive: true,
      force: true,
    }) as { items: Array<Record<string, unknown>> };

    expect(namePayload.items).toEqual([
      expect.objectContaining({ id: "125", name: null }),
    ]);
    expect(pricePayload.items).toEqual([
      expect.objectContaining({ id: "126", authoritative_price: null }),
    ]);
  });

  it("TEST-HF-08 keeps malformed rows out of the public catalog", () => {
    const harness = createHarness([
      availableProduct({ id: "valid", name: "Valido" }),
      availableProduct({ id: "missing-name", name: "" }),
      availableProduct({ id: "missing-price", price: "" }),
    ]);

    const payload = harness.api.buildProductsPayloadObject({ force: true }) as {
      items: Array<{ id: string }>;
    };

    expect(payload.items.map((item) => item.id)).toEqual(["valid"]);
  });

  it("TEST-HF-18 final stock planning still detects a malformed duplicate without writes", () => {
    const harness = createHarness([
      availableProduct({ id: "125", name: "Aros" }),
      availableProduct({ id: "125", name: "" }),
    ]);

    expectInventoryError(
      () => decrement(harness.api, "order-hf-duplicate", [{ productId: "125", qty: 1 }]),
      "DUPLICATE_PRODUCT_ID",
    );
    expect(harness.stockWrites()).toHaveLength(0);
  });

  it.each([
    ["active", true, true],
    ["activo", true, true],
    ["is_active", true, true],
    ["is_active", false, false],
    ["is_active", "", null],
    ["is_active", "quizas", null],
    ["is_active", "si", true],
    ["is_active", "no", false],
  ] as const)(
    "TEST-HF-10/15 reads %s=%s as strict authoritative active %s",
    (activeHeader, active, expected) => {
      const harness = createHarness(
        [availableProduct({ active })],
        { activeHeader },
      );
      const payload = harness.api.buildProductsPayloadObject({
        authoritative: true,
        includeInactive: true,
        force: true,
      }) as { items: Array<{ authoritative_active: boolean | null }> };

      expect(payload.items).toHaveLength(1);
      expect(payload.items[0].authoritative_active).toBe(expected);
    },
  );
});
