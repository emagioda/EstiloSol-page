import { createHash } from "node:crypto";
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
  batchFailure?: "before-commit" | "after-commit";
  batchFailureAtRequest?: number;
  cachePut?: () => void;
  journalHeaders?: string[];
  journalRows?: unknown[][];
  journalReadFailure?: boolean;
  lockFailure?: boolean;
  recoverySnapshotHeaders?: string[];
  recoverySnapshotRows?: unknown[][];
  recoveryEventHeaders?: string[];
  recoveryEventRows?: unknown[][];
  emailOutboxHeaders?: string[];
  emailOutboxRows?: unknown[][];
  emailOutboxRolloutAt?: string;
  salesHeaders?: string[];
  salesRows?: unknown[][];
  sheetsServiceEnabled?: boolean;
};

type WriteRecord = { sheet: string; row: number; column: number; value: unknown };
type SheetState = {
  id: number;
  name: string;
  headers: unknown[];
  rows: unknown[][];
  hidden?: boolean;
  frozenRows?: number;
};

const scriptSource = readFileSync(
  resolve(process.cwd(), "scripts/apps-script/estilo-sol-api-v4.gs"),
  "utf8",
);
const scriptManifest = JSON.parse(readFileSync(
  resolve(process.cwd(), "scripts/apps-script/appsscript.json"),
  "utf8",
)) as Record<string, unknown>;

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
  const salesHeaders = options.salesHeaders ?? [
    "nro_de_compra",
    "items_json",
    ...(options.emailOutboxHeaders || options.emailOutboxRows ? ["receipt_outbox_version"] : []),
  ];
  const salesRows: unknown[][] = options.salesRows ?? [];
  const writes: WriteRecord[] = [];
  const batchCalls: Array<{ requests: Array<Record<string, unknown>> }> = [];
  const logs: Array<Record<string, unknown>> = [];
  let batchFailure = options.batchFailure;
  const properties = new Map<string, string>([
    ["SPREADSHEET_ID", "test-spreadsheet"],
    ["SHEETS_READ_TOKEN", "read-token"],
    ["SHEETS_WRITE_TOKEN", "write-token"],
    ["SHEETS_ADMIN_TOKEN", "admin-token"],
    ...(options.emailOutboxRolloutAt
      ? [["EMAIL_OUTBOX_ROLLOUT_AT", options.emailOutboxRolloutAt] as [string, string]]
      : []),
  ]);
  const locks = { waited: 0, released: 0 };
  const states = new Map<string, SheetState>([
    ["products", { id: 101, name: "products", headers: productHeaders, rows: productRows }],
    ["ventas", { id: 102, name: "ventas", headers: salesHeaders, rows: salesRows }],
  ]);
  if (options.journalHeaders || options.journalRows) {
    states.set("_inventory_transactions", {
      id: 103,
      name: "_inventory_transactions",
      headers: options.journalHeaders ?? ["order_id", "demand_fingerprint", "applied_at", "state"],
      rows: options.journalRows ?? [],
      hidden: true,
    });
  }
  if (options.recoverySnapshotHeaders || options.recoverySnapshotRows) {
    states.set("_order_recovery_snapshots", {
      id: 104,
      name: "_order_recovery_snapshots",
      headers: options.recoverySnapshotHeaders ?? [],
      rows: options.recoverySnapshotRows ?? [],
      hidden: true,
    });
  }
  if (options.recoveryEventHeaders || options.recoveryEventRows) {
    states.set("_payment_recovery_events", {
      id: 105,
      name: "_payment_recovery_events",
      headers: options.recoveryEventHeaders ?? [],
      rows: options.recoveryEventRows ?? [],
      hidden: true,
    });
  }
  if (options.emailOutboxHeaders || options.emailOutboxRows) {
    states.set("_email_outbox_events", {
      id: 106,
      name: "_email_outbox_events",
      headers: options.emailOutboxHeaders ?? [],
      rows: options.emailOutboxRows ?? [],
      hidden: true,
    });
  }

  const buildSheet = (state: SheetState) => ({
    getSheetId: () => state.id,
    getLastColumn: () => state.headers.length,
    getLastRow: () => state.headers.length === 0 ? 0 : state.rows.length + 1,
    getDataRange: () => ({
      getValues: () => [state.headers.slice(), ...state.rows.map((row) => row.slice())],
    }),
    getRange: (row: number, column: number, rowCount = 1, columnCount = 1) => ({
      getValues: () => {
        if (options.journalReadFailure && state.name === "_inventory_transactions") {
          throw new Error("simulated journal read crash");
        }
        if (row === 1) return [state.headers.slice(column - 1, column - 1 + columnCount)];
        return state.rows
          .slice(row - 2, row - 2 + rowCount)
          .map((sourceRow) => sourceRow.slice(column - 1, column - 1 + columnCount));
      },
      setValue: (value: unknown) => {
        if (row === 1) {
          state.headers[column - 1] = value;
        } else {
          state.rows[row - 2][column - 1] = value;
        }
        writes.push({ sheet: state.name, row, column, value });
      },
      setValues: (values: unknown[][]) => {
        values.forEach((sourceRow, rowOffset) => {
          if (row + rowOffset === 1) {
            state.headers = sourceRow.slice();
          } else {
            const targetIndex = row + rowOffset - 2;
            state.rows[targetIndex] ??= [];
            sourceRow.forEach((value, columnOffset) => {
              state.rows[targetIndex][column + columnOffset - 1] = value;
            });
          }
        });
      },
    }),
    setFrozenRows: (count: number) => { state.frozenRows = count; },
    hideSheet: () => { state.hidden = true; },
    isSheetHidden: () => state.hidden === true,
    appendRow: (values: unknown[]) => {
      state.rows.push(values.slice());
    },
  });

  const spreadsheet = {
    getSheetByName: (name: string) => {
      const state = states.get(name);
      return state ? buildSheet(state) : null;
    },
    getSheets: () => [...states.values()].map(buildSheet),
    insertSheet: (name: string) => {
      if (states.has(name)) throw new Error("duplicate sheet");
      const id = Math.max(100, ...[...states.values()].map((state) => state.id)) + 1;
      const state: SheetState = { id, name, headers: [], rows: [] };
      states.set(name, state);
      return buildSheet(state);
    },
  };

  const decodeCell = (cell: { userEnteredValue?: Record<string, unknown> }) => {
    const value = cell.userEnteredValue ?? {};
    if (Object.hasOwn(value, "numberValue")) return value.numberValue;
    if (Object.hasOwn(value, "boolValue")) return value.boolValue;
    return value.stringValue ?? "";
  };

  const applyBatch = (body: { requests: Array<Record<string, unknown>> }) => {
    batchCalls.push(structuredClone(body));
    if (batchFailure === "before-commit") {
      batchFailure = undefined;
      throw new Error("simulated batch failure before commit");
    }
    if (typeof options.batchFailureAtRequest === "number") {
      throw new Error(`simulated invalid subrequest ${options.batchFailureAtRequest}`);
    }

    const staged = new Map<string, SheetState>();
    for (const [name, state] of states) {
      staged.set(name, {
        ...state,
        headers: state.headers.slice(),
        rows: state.rows.map((row) => row.slice()),
      });
    }
    const findById = (sheetId: number) => [...staged.values()].find((state) => state.id === sheetId);
    const stagedWrites: WriteRecord[] = [];

    body.requests.forEach((request) => {
      const addSheet = request.addSheet as { properties: { sheetId: number; title: string; hidden?: boolean } } | undefined;
      if (addSheet) {
        if (staged.has(addSheet.properties.title) || findById(addSheet.properties.sheetId)) throw new Error("duplicate sheet");
        staged.set(addSheet.properties.title, {
          id: addSheet.properties.sheetId,
          name: addSheet.properties.title,
          headers: [],
          rows: [],
          hidden: addSheet.properties.hidden,
        });
        return;
      }

      const appendCells = request.appendCells as {
        sheetId: number;
        rows: Array<{ values: Array<{ userEnteredValue?: Record<string, unknown> }> }>;
      } | undefined;
      if (appendCells) {
        const state = findById(appendCells.sheetId);
        if (!state) throw new Error("missing sheet for append");
        appendCells.rows.forEach((row) => {
          const values = row.values.map(decodeCell);
          if (state.headers.length === 0) state.headers = values;
          else state.rows.push(values);
        });
        return;
      }

      const updateCells = request.updateCells as {
        start: { sheetId: number; rowIndex: number; columnIndex: number };
        rows: Array<{ values: Array<{ userEnteredValue?: Record<string, unknown> }> }>;
      } | undefined;
      if (!updateCells) throw new Error("unsupported request");
      const state = findById(updateCells.start.sheetId);
      if (!state) throw new Error("missing sheet for update");
      updateCells.rows.forEach((row, rowOffset) => {
        row.values.forEach((cell, columnOffset) => {
          const rowIndex = updateCells.start.rowIndex + rowOffset;
          const columnIndex = updateCells.start.columnIndex + columnOffset;
          const target = rowIndex === 0 ? state.headers : state.rows[rowIndex - 1];
          if (!target) throw new Error("invalid update row");
          const value = decodeCell(cell);
          target[columnIndex] = value;
          stagedWrites.push({ sheet: state.name, row: rowIndex + 1, column: columnIndex + 1, value });
        });
      });
    });

    for (const name of [...states.keys()]) {
      if (!staged.has(name)) states.delete(name);
    }
    for (const [name, stagedState] of staged) {
      const existing = states.get(name);
      if (existing) {
        existing.headers.splice(0, existing.headers.length, ...stagedState.headers);
        existing.rows.splice(0, existing.rows.length, ...stagedState.rows.map((row) => row.slice()));
        existing.hidden = stagedState.hidden;
      } else {
        states.set(name, stagedState);
      }
    }
    writes.push(...stagedWrites);
    if (batchFailure === "after-commit") {
      batchFailure = undefined;
      throw new Error("simulated response loss after commit");
    }
  };
  const scriptProperties = {
    getProperty: (key: string) => properties.get(key) ?? null,
    setProperty: (key: string, value: string) => properties.set(key, String(value)),
  };

  const context = vm.createContext({
    SpreadsheetApp: {
      flush: () => undefined,
      openById: () => spreadsheet,
      getActiveSpreadsheet: () => spreadsheet,
    },
    Sheets: options.sheetsServiceEnabled === false ? undefined : {
      Spreadsheets: { batchUpdate: applyBatch },
    },
    Utilities: {
      DigestAlgorithm: { SHA_256: "SHA_256" },
      Charset: { UTF_8: "UTF_8" },
      computeDigest: (_algorithm: string, value: string) => [...createHash("sha256").update(value, "utf8").digest()],
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
        waitLock: () => {
          locks.waited += 1;
          if (options.lockFailure) throw new Error("simulated crash before lock acquisition");
        },
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
    console: {
      error: () => undefined,
      info: (content: string) => logs.push(JSON.parse(content) as Record<string, unknown>),
    },
  });

  vm.runInContext(
    `${scriptSource}\n;globalThis.__inventoryApi = { normalizeStockItems_, inventoryDemandFingerprint_, resolveInventoryJournal_, planStockDecrement_, buildAtomicInventoryRequests_, commitAtomicInventoryRequests_, handleAppendRow, handleDecrementStock, handleAppendOrderAndDecrementStock, normalizeProduct, buildProductsPayloadObject, ensureRecoverySchema_, handleUpsertRecoverySnapshot_, handleAppendRecoveryPaymentEvent_, handleClaimRecoveryWork_, handleMarkRecoveryWork_, doGet, doPost };`,
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
    batchCalls,
    logs,
    states,
    journalRows: () => states.get("_inventory_transactions")?.rows ?? [],
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

const postDecrement = (harness: ReturnType<typeof createHarness>, orderId: string, items: unknown[]) => {
  const output = harness.api.doPost({
    postData: { contents: JSON.stringify({
      action: "decrementStock",
      token: "write-token",
      sheet: "products",
      orderId,
      items,
    }) },
  }) as { getContent: () => string };
  return JSON.parse(output.getContent()) as Record<string, unknown>;
};

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

  it("AS-16 success writes once per product and creates the durable journal marker atomically", () => {
    const harness = createHarness([availableProduct({ stockQty: 2 })]);
    const result = decrement(harness.api, "order-16", [{ productId: "a", qty: 1 }]);
    expect(result).toMatchObject({ ok: true, outcome: "APPLIED", deduped: false });
    expect(harness.stockWrites()).toHaveLength(1);
    expect(harness.properties.has("stock_deducted:order-16")).toBe(false);
    expect(harness.journalRows()).toEqual([
      ["order-16", expect.stringMatching(/^[a-f0-9]{64}$/), expect.any(String), "APPLIED"],
    ]);
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

describe("AUD3-H06 Apps Script recovery journal", () => {
  it("AUD3-H06-10 keeps one ventas row when an append response is lost and retried", () => {
    const harness = createHarness([]);
    const payload = {
      sheet: "ventas",
      row: { nro_de_compra: "es-recovery-response-loss-000001", items_json: "[]" },
    };

    harness.api.handleAppendRow(payload);
    const retry = harness.api.handleAppendRow(payload) as Record<string, unknown>;

    expect(retry).toMatchObject({ ok: true, deduped: true, rowNumber: 2 });
    expect(harness.salesRows).toEqual([["es-recovery-response-loss-000001", "[]"]]);
  });

  it("bootstraps exact hidden schemas with frozen headers under ScriptLock", () => {
    const harness = createHarness([]);
    const result = recoveryPost(harness, "ensureRecoverySchema");

    expect(result).toMatchObject({ ok: true, result: "RECOVERY_SCHEMA_READY" });
    expect(harness.states.get("_order_recovery_snapshots")).toMatchObject({
      headers: recoverySnapshotHeaders,
      hidden: true,
      frozenRows: 1,
    });
    expect(harness.states.get("_payment_recovery_events")).toMatchObject({
      headers: recoveryEventHeaders,
      hidden: true,
      frozenRows: 1,
    });
    expect(harness.states.get("_email_outbox_events")).toMatchObject({
      headers: emailOutboxHeaders,
      hidden: true,
      frozenRows: 1,
    });
    expect(harness.properties.get("EMAIL_OUTBOX_ROLLOUT_AT")).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(harness.locks).toEqual({ waited: 1, released: 1 });
  });

  it("rejects recovery bootstrap without the admin token", () => {
    const harness = createHarness([]);
    expect(recoveryPost(harness, "ensureRecoverySchema", {}, "write-token")).toMatchObject({
      ok: false,
      error: "Unauthorized",
    });
    expect(harness.states.has("_order_recovery_snapshots")).toBe(false);
  });

  it("fails closed on malformed recovery headers", () => {
    const harness = createHarness([], { recoverySnapshotHeaders: ["wrong"] });
    expect(recoveryPost(harness, "ensureRecoverySchema")).toMatchObject({
      ok: false,
      code: "RECOVERY_SCHEMA_INVALID",
    });
  });

  it("stores and same-hash replays one immutable snapshot", () => {
    const harness = createHarness([]);
    const snapshot = recoverySnapshot();
    expect(recoveryPost(harness, "upsertRecoverySnapshot", { snapshot }).result).toBe("SNAPSHOT_STORED");
    expect(recoveryPost(harness, "upsertRecoverySnapshot", { snapshot }).result).toBe("SNAPSHOT_ALREADY_EXISTS");
    expect(harness.states.get("_order_recovery_snapshots")?.rows).toHaveLength(1);
    expect(harness.logs.map((entry) => entry.event)).toContain("recovery.snapshot.replayed");
  });

  it("AUD3-H06-SNAP-04 marks a different valid snapshot hash as attention and never overwrites content", () => {
    const harness = createHarness([]);
    const original = recoverySnapshot();
    recoveryPost(harness, "upsertRecoverySnapshot", { snapshot: original });
    const conflict = recoverySnapshot({ marker: "different" });

    expect(recoveryPost(harness, "upsertRecoverySnapshot", { snapshot: conflict })).toMatchObject({
      ok: false,
      code: "RECOVERY_SNAPSHOT_CONFLICT",
    });
    const row = harness.states.get("_order_recovery_snapshots")?.rows[0] ?? [];
    expect(row[4]).toBe(original.snapshot_json);
    expect(row[8]).toBe("attention");
    expect(row[10]).toBe("RECOVERY_SNAPSHOT_CONFLICT");
  });

  it("fails closed when duplicate snapshot identities already exist", () => {
    const snapshot = recoverySnapshot();
    const row = recoverySnapshotHeaders.map((header) => snapshot[header as keyof typeof snapshot]);
    const harness = createHarness([], {
      recoverySnapshotHeaders,
      recoverySnapshotRows: [row, row.slice()],
    });
    expect(recoveryPost(harness, "getRecoverySnapshot", { externalReference: snapshot.external_reference })).toMatchObject({
      ok: false,
      code: "RECOVERY_SCHEMA_INVALID",
    });
  });

  it("stores and exactly replays one minimized financial event", () => {
    const harness = createHarness([]);
    const event = recoveryEvent();
    expect(recoveryPost(harness, "appendRecoveryPaymentEvent", { event }).result).toBe("EVENT_STORED");
    expect(recoveryPost(harness, "appendRecoveryPaymentEvent", { event }).result).toBe("EVENT_ALREADY_STORED");
    expect(harness.states.get("_payment_recovery_events")?.rows).toHaveLength(1);
  });

  it("marks an inconsistent event-key payload as attention", () => {
    const harness = createHarness([]);
    recoveryPost(harness, "appendRecoveryPaymentEvent", { event: recoveryEvent() });
    expect(recoveryPost(harness, "appendRecoveryPaymentEvent", {
      event: recoveryEvent({ amount: 999 }),
    })).toMatchObject({ ok: false, code: "RECOVERY_EVENT_CONFLICT" });
    const row = harness.states.get("_payment_recovery_events")?.rows[0] ?? [];
    expect(row[13]).toBe("attention");
    expect(row[18]).toBe("RECOVERY_EVENT_CONFLICT");
  });

  it("keeps Admin recovery attention listings free of snapshot JSON and customer PII", () => {
    const harness = createHarness([]);
    const original = recoverySnapshot();
    recoveryPost(harness, "upsertRecoverySnapshot", { snapshot: original });
    recoveryPost(harness, "upsertRecoverySnapshot", {
      snapshot: recoverySnapshot({ marker: "conflict" }),
    });

    const response = recoveryPost(harness, "listRecoveryAttention", { limit: 20 });
    const serialized = JSON.stringify(response).toLowerCase();

    expect(response).toMatchObject({
      ok: true,
      result: "RECOVERY_ATTENTION_LISTED",
      items: [expect.objectContaining({ kind: "snapshot", state: "attention" })],
    });
    expect(serialized).not.toContain("snapshot_json");
    expect(serialized).not.toContain("customer");
    expect(serialized).not.toContain("email");
    expect(serialized).not.toContain("phone");
    expect(serialized).not.toContain("address");
  });

  it("fails closed when duplicate event keys already exist", () => {
    const event = recoveryEvent();
    const row = recoveryEventHeaders.map((header) => event[header as keyof typeof event]);
    const harness = createHarness([], {
      recoveryEventHeaders,
      recoveryEventRows: [row, row.slice()],
    });
    expect(recoveryPost(harness, "getRecoveryPaymentEvent", { eventKey: event.event_key })).toMatchObject({
      ok: false,
      code: "RECOVERY_SCHEMA_INVALID",
    });
  });

  it("claims once, replays the same lease response, and reclaims an expired lease", () => {
    const event = recoveryEvent();
    const harness = createHarness([]);
    recoveryPost(harness, "appendRecoveryPaymentEvent", { event });
    const first = recoveryPost(harness, "claimRecoveryWork", {
      leaseOwner: "worker:recovery:one",
      claimedAt: "2026-08-13T12:00:00.000Z",
      leaseExpiresAt: "2026-08-13T12:05:00.000Z",
      maxEvents: 20,
      maxSnapshots: 20,
    }) as { events?: Array<Record<string, unknown>> };
    const replay = recoveryPost(harness, "claimRecoveryWork", {
      leaseOwner: "worker:recovery:one",
      claimedAt: "2026-08-13T12:00:00.000Z",
      leaseExpiresAt: "2026-08-13T12:05:00.000Z",
      maxEvents: 20,
      maxSnapshots: 20,
    }) as { events?: Array<Record<string, unknown>> };
    const reclaimed = recoveryPost(harness, "claimRecoveryWork", {
      leaseOwner: "worker:recovery:two",
      claimedAt: "2026-08-13T12:06:00.000Z",
      leaseExpiresAt: "2026-08-13T12:11:00.000Z",
      maxEvents: 20,
      maxSnapshots: 20,
    }) as { events?: Array<Record<string, unknown>> };

    expect(first.events?.[0]).toMatchObject({ attempt_count: 1, lease_owner: "worker:recovery:one" });
    expect(replay.events?.[0]).toMatchObject({ attempt_count: 1, lease_owner: "worker:recovery:one" });
    expect(reclaimed.events?.[0]).toMatchObject({ attempt_count: 2, lease_owner: "worker:recovery:two" });
  });

  it("coordinates snapshot claims and fairly selects the least recently checked row", () => {
    const first = recoverySnapshot({
      external_reference: "es-recovery-000001",
      last_checked_at: "2026-08-13T11:50:00.000Z",
    });
    const second = recoverySnapshot({
      external_reference: "es-recovery-000002",
      checkout_attempt_id: "attempt-recovery-000002",
      snapshot_json: "",
      snapshot_hash: "c".repeat(64),
      last_checked_at: "",
    });
    const firstRow = recoverySnapshotHeaders.map((header) => first[header as keyof typeof first]);
    const secondRow = recoverySnapshotHeaders.map((header) => second[header as keyof typeof second]);
    const harness = createHarness([], {
      recoverySnapshotHeaders,
      recoverySnapshotRows: [firstRow, secondRow],
      recoveryEventHeaders,
    });

    const fairClaim = recoveryPost(harness, "claimRecoveryWork", {
      leaseOwner: "worker:snapshot:one",
      claimedAt: "2026-08-13T12:00:00.000Z",
      leaseExpiresAt: "2026-08-13T12:05:00.000Z",
      maxEvents: 20,
      maxSnapshots: 1,
    }) as { snapshots?: Array<Record<string, unknown>> };
    const overlap = recoveryPost(harness, "claimRecoveryWork", {
      leaseOwner: "worker:snapshot:two",
      claimedAt: "2026-08-13T12:01:00.000Z",
      leaseExpiresAt: "2026-08-13T12:06:00.000Z",
      maxEvents: 20,
      maxSnapshots: 2,
    }) as { snapshots?: Array<Record<string, unknown>> };
    const reclaimed = recoveryPost(harness, "claimRecoveryWork", {
      leaseOwner: "worker:snapshot:three",
      claimedAt: "2026-08-13T12:06:00.000Z",
      leaseExpiresAt: "2026-08-13T12:11:00.000Z",
      maxEvents: 20,
      maxSnapshots: 2,
    }) as { snapshots?: Array<Record<string, unknown>> };

    expect(fairClaim.snapshots?.map((row) => row.external_reference)).toEqual([
      "es-recovery-000002",
    ]);
    expect(overlap.snapshots?.map((row) => row.external_reference)).toEqual([
      "es-recovery-000001",
    ]);
    expect(reclaimed.snapshots?.map((row) => row.external_reference)).toEqual([
      "es-recovery-000002",
      "es-recovery-000001",
    ]);
  });

  it("keeps completed work monotonic", () => {
    const harness = createHarness([]);
    const event = recoveryEvent();
    recoveryPost(harness, "appendRecoveryPaymentEvent", { event });
    recoveryPost(harness, "markRecoveryWorkCompleted", { eventKey: event.event_key });
    expect(recoveryPost(harness, "markRecoveryWorkRetryable", {
      eventKey: event.event_key,
      errorCode: "LATE_FAILURE",
    })).toMatchObject({ ok: false, code: "RECOVERY_WORK_LEASE_CONFLICT" });
    const row = harness.states.get("_payment_recovery_events")?.rows[0] ?? [];
    expect(row[13]).toBe("completed");
  });

  it("normalizes free-form recovery failures instead of persisting sensitive error text", () => {
    const harness = createHarness([]);
    const event = recoveryEvent();
    recoveryPost(harness, "appendRecoveryPaymentEvent", { event });

    recoveryPost(harness, "markRecoveryWorkRetryable", {
      eventKey: event.event_key,
      errorCode: "failure for customer@example.test",
    });

    const row = harness.states.get("_payment_recovery_events")?.rows[0] ?? [];
    expect(row[18]).toBe("RECOVERY_TECHNICAL_FAILURE");
    expect(JSON.stringify(row)).not.toContain("customer@example.test");
  });
});

const recoverySnapshotHeaders = [
  "external_reference", "checkout_attempt_id", "schema_version", "snapshot_hash",
  "snapshot_json", "created_at", "preference_valid_from", "preference_expires_at",
  "recovery_state", "last_checked_at", "last_error_code", "updated_at", "completed_at",
];
const recoveryEventHeaders = [
  "event_key", "payment_id", "external_reference", "financial_status", "status_detail",
  "amount", "currency", "mp_updated_at", "observed_at", "source", "schema_version",
  "snapshot_hash", "validation_state", "processing_state", "attempt_count", "lease_owner",
  "lease_expires_at", "last_attempt_at", "last_error_code", "updated_at", "completed_at",
];
const recoverySnapshot = (patch: Record<string, unknown> = {}) => {
  const { marker = "original", ...rowPatch } = patch;
  const snapshotJson = JSON.stringify({
    schemaVersion: 1,
    externalReference: "es-recovery-000001",
    checkoutAttemptId: "attempt-recovery-000001",
    marker,
  });
  return {
    external_reference: "es-recovery-000001",
    checkout_attempt_id: "attempt-recovery-000001",
    schema_version: 1,
    snapshot_hash: createHash("sha256").update(snapshotJson).digest("hex"),
    snapshot_json: snapshotJson,
    created_at: "2026-08-13T10:00:00.000Z",
    preference_valid_from: "2026-08-13T10:00:00.000Z",
    preference_expires_at: "2026-08-15T10:00:00.000Z",
    recovery_state: "pending_payment",
    last_checked_at: "",
    last_error_code: "",
    updated_at: "2026-08-13T10:00:00.000Z",
    completed_at: "",
    ...rowPatch,
  };
};
const recoveryEvent = (patch: Record<string, unknown> = {}) => ({
  event_key: "a".repeat(64),
  payment_id: "pay_1",
  external_reference: "es-recovery-000001",
  financial_status: "approved",
  status_detail: "accredited",
  amount: 1000,
  currency: "ARS",
  mp_updated_at: "2026-08-13T11:00:00.000Z",
  observed_at: "2026-08-13T11:00:01.000Z",
  source: "webhook",
  schema_version: 1,
  snapshot_hash: "b".repeat(64),
  validation_state: "validated",
  processing_state: "pending",
  attempt_count: 0,
  lease_owner: "",
  lease_expires_at: "",
  last_attempt_at: "",
  last_error_code: "",
  updated_at: "2026-08-13T11:00:01.000Z",
  completed_at: "",
  ...patch,
});
const recoveryPost = (
  harness: ReturnType<typeof createHarness>,
  action: string,
  payload: Record<string, unknown> = {},
  token = "admin-token",
) => JSON.parse((harness.api.doPost({
  postData: { contents: JSON.stringify({ action, token, ...payload }) },
}) as { getContent: () => string }).getContent()) as Record<string, unknown>;

const emailOutboxHeaders = [
  "event_key", "external_reference", "notification_type", "schema_version", "template_version",
  "payload_hash", "payload_json", "idempotency_key", "state", "attempt_count", "lease_owner",
  "lease_expires_at", "next_attempt_at", "provider_first_attempt_at", "provider_outcome_unknown_since", "last_attempt_at",
  "last_error_code", "provider_message_id", "accepted_at", "created_at", "updated_at", "completed_at",
];

const emailOutboxEvent = (patch: Record<string, unknown> = {}) => {
  const externalReference = String(patch.external_reference ?? "es-email-000001");
  const payloadJson = String(patch.payload_json ?? JSON.stringify({
    externalReference,
    recipientEmail: "customer@example.test",
    customerName: "Cliente",
    paymentId: "pay-email-1",
    approvedAt: Date.parse("2026-08-16T10:00:00.000Z"),
    items: [{ title: "Producto", qty: 1, unitPrice: 1000, currency: "ARS" }],
    total: 1000,
    currency: "ARS",
    fromEmail: "Estilo Sol <ventas@example.test>",
    templateVersion: 1,
  }));
  const eventKey = `purchase-receipt/${externalReference}/v1`;
  return {
    event_key: eventKey,
    external_reference: externalReference,
    notification_type: "purchase_receipt",
    schema_version: 1,
    template_version: 1,
    payload_hash: createHash("sha256").update(payloadJson).digest("hex"),
    payload_json: payloadJson,
    idempotency_key: eventKey,
    state: "pending",
    attempt_count: 0,
    lease_owner: "",
    lease_expires_at: "",
    next_attempt_at: "",
    provider_first_attempt_at: "",
    provider_outcome_unknown_since: "",
    last_attempt_at: "",
    last_error_code: "",
    provider_message_id: "",
    accepted_at: "",
    created_at: "2026-08-16T10:00:00.000Z",
    updated_at: "2026-08-16T10:00:00.000Z",
    completed_at: "",
    ...patch,
  };
};

const emailOutboxRow = (patch: Record<string, unknown> = {}) => {
  const event = emailOutboxEvent(patch);
  return emailOutboxHeaders.map((header) => event[header as keyof typeof event]);
};

describe("AUD3-H06-E Apps Script durable receipt outbox", () => {
  it("does not create the outbox implicitly before the explicit recovery bootstrap", () => {
    const harness = createHarness([]);
    expect(recoveryPost(harness, "upsertEmailOutboxEvent", { event: emailOutboxEvent() })).toMatchObject({
      ok: false,
      code: "EMAIL_OUTBOX_SCHEMA_NOT_READY",
    });
    expect(harness.states.has("_email_outbox_events")).toBe(false);
  });

  it("keeps the first rollout boundary stable across repeated bootstrap calls", () => {
    const harness = createHarness([]);
    const first = recoveryPost(harness, "ensureRecoverySchema");
    const boundary = harness.properties.get("EMAIL_OUTBOX_ROLLOUT_AT");
    const second = recoveryPost(harness, "ensureRecoverySchema");
    expect(first.email_outbox_rollout_at).toBe(boundary);
    expect(second.email_outbox_rollout_at).toBe(boundary);
    expect(harness.states.get("ventas")?.headers.filter((header) => header === "receipt_outbox_version")).toHaveLength(1);
  });

  it("stores one immutable event, replays the same payload, and fails closed on conflict", () => {
    const harness = createHarness([]);
    recoveryPost(harness, "ensureRecoverySchema");
    const event = emailOutboxEvent();
    expect(recoveryPost(harness, "upsertEmailOutboxEvent", { event }).result).toBe("EMAIL_EVENT_STORED");
    expect(recoveryPost(harness, "upsertEmailOutboxEvent", { event }).result).toBe("EMAIL_EVENT_ALREADY_EXISTS");
    const conflict = emailOutboxEvent({ payload_json: JSON.stringify({
      externalReference: "es-email-000001",
      items: [],
      currency: "ARS",
      templateVersion: 1,
    }) });
    expect(recoveryPost(harness, "upsertEmailOutboxEvent", { event: conflict })).toMatchObject({
      ok: false,
      code: "EMAIL_OUTBOX_EVENT_CONFLICT",
    });
    const row = harness.states.get("_email_outbox_events")?.rows[0] ?? [];
    expect(row[emailOutboxHeaders.indexOf("state")]).toBe("attention");
    expect(row[emailOutboxHeaders.indexOf("payload_json")]).toBe(event.payload_json);
  });

  it("claims with an owned lease, replays the same claim, and excludes overlapping workers", () => {
    const harness = createHarness([]);
    recoveryPost(harness, "ensureRecoverySchema");
    recoveryPost(harness, "upsertEmailOutboxEvent", { event: emailOutboxEvent() });
    const claim = {
      leaseOwner: "email-worker-one",
      claimedAt: "2026-08-16T10:01:00.000Z",
      leaseExpiresAt: "2026-08-16T10:06:00.000Z",
      maxEvents: 20,
    };
    const first = recoveryPost(harness, "claimEmailOutboxWork", claim) as { events?: Array<Record<string, unknown>> };
    const replay = recoveryPost(harness, "claimEmailOutboxWork", claim) as { events?: Array<Record<string, unknown>> };
    const overlap = recoveryPost(harness, "claimEmailOutboxWork", {
      ...claim,
      leaseOwner: "email-worker-two",
      claimedAt: "2026-08-16T10:02:00.000Z",
      leaseExpiresAt: "2026-08-16T10:07:00.000Z",
    }) as { events?: unknown[] };
    expect(first.events?.[0]).toMatchObject({ attempt_count: 1, lease_owner: "email-worker-one" });
    expect(first.events?.[0]).toMatchObject({ provider_first_attempt_at: claim.claimedAt });
    expect(first.events?.[0]).toMatchObject({ provider_outcome_unknown_since: "" });
    expect(replay.events?.[0]).toMatchObject({ attempt_count: 1, lease_owner: "email-worker-one" });
    expect(overlap.events).toEqual([]);
  });

  it("reclaims an expired processing lease without changing the stable event identity", () => {
    const harness = createHarness([]);
    recoveryPost(harness, "ensureRecoverySchema");
    const event = emailOutboxEvent();
    recoveryPost(harness, "upsertEmailOutboxEvent", { event });
    recoveryPost(harness, "claimEmailOutboxWork", {
      leaseOwner: "email-worker-one",
      claimedAt: "2026-08-16T10:01:00.000Z",
      leaseExpiresAt: "2026-08-16T10:06:00.000Z",
      maxEvents: 1,
    });
    const reclaimed = recoveryPost(harness, "claimEmailOutboxWork", {
      leaseOwner: "email-worker-two",
      claimedAt: "2026-08-16T10:07:00.000Z",
      leaseExpiresAt: "2026-08-16T10:12:00.000Z",
      maxEvents: 1,
    }) as { events?: Array<Record<string, unknown>> };
    expect(reclaimed.events).toEqual([
      expect.objectContaining({
        event_key: event.event_key,
        idempotency_key: event.event_key,
        attempt_count: 2,
        lease_owner: "email-worker-two",
      }),
    ]);
  });

  it("AUD3-H06E-UNCERTAINTY-03 durably marks provider uncertainty under the active lease", () => {
    const harness = createHarness([]);
    recoveryPost(harness, "ensureRecoverySchema");
    const event = emailOutboxEvent();
    recoveryPost(harness, "upsertEmailOutboxEvent", { event });
    recoveryPost(harness, "claimEmailOutboxWork", {
      leaseOwner: "email-worker-one",
      claimedAt: "2026-08-16T10:01:00.000Z",
      leaseExpiresAt: "2026-08-16T10:06:00.000Z",
      maxEvents: 1,
    });

    const marked = recoveryPost(harness, "markEmailOutboxProviderOutcomeUnknown", {
      eventKey: event.event_key,
      leaseOwner: "email-worker-one",
      unknownSince: "2026-08-16T10:01:30.000Z",
    });
    expect(marked).toMatchObject({
      result: "EMAIL_PROVIDER_OUTCOME_UNKNOWN",
      event: { provider_outcome_unknown_since: "2026-08-16T10:01:30.000Z" },
    });

    const cleared = recoveryPost(harness, "clearEmailOutboxProviderOutcomeUnknown", {
      eventKey: event.event_key,
      leaseOwner: "email-worker-one",
    });
    expect(cleared).toMatchObject({
      result: "EMAIL_PROVIDER_OUTCOME_KNOWN",
      event: { provider_outcome_unknown_since: "" },
    });
  });

  it("AUD3-H06E-UNCERTAINTY-02 does not cutoff an old prepared attempt without unresolved uncertainty", () => {
    const row = emailOutboxRow({
      state: "processing",
      attempt_count: 1,
      lease_owner: "email-worker-one",
      lease_expires_at: "2026-08-15T10:05:00.000Z",
      provider_first_attempt_at: "2026-08-15T10:00:00.000Z",
      provider_outcome_unknown_since: "",
      last_attempt_at: "2026-08-15T10:00:00.000Z",
      last_error_code: "RESEND_NOT_CONFIGURED",
    });
    const harness = createHarness([], {
      emailOutboxHeaders,
      emailOutboxRows: [row],
      emailOutboxRolloutAt: "2026-08-15T00:00:00.000Z",
    });
    const result = recoveryPost(harness, "claimEmailOutboxWork", {
      leaseOwner: "email-worker-two",
      claimedAt: "2026-08-17T10:00:00.000Z",
      leaseExpiresAt: "2026-08-17T10:05:00.000Z",
      maxEvents: 1,
    }) as { events?: Array<Record<string, unknown>> };
    expect(result.events?.[0]).toMatchObject({
      state: "processing",
      attempt_count: 2,
      provider_outcome_unknown_since: "",
    });
  });

  it("AUD3-H06E-CRASH-06 reclaims blank-error ambiguous processing inside 24h", () => {
    const payloadJson = String(emailOutboxEvent().payload_json);
    const row = emailOutboxRow({
      state: "processing",
      attempt_count: 1,
      lease_owner: "email-worker-one",
      lease_expires_at: "2026-08-16T10:05:00.000Z",
      provider_first_attempt_at: "2026-08-16T10:00:00.000Z",
      provider_outcome_unknown_since: "2026-08-16T10:00:00.000Z",
      last_attempt_at: "2026-08-16T10:00:00.000Z",
      last_error_code: "",
    });
    const harness = createHarness([], {
      emailOutboxHeaders,
      emailOutboxRows: [row],
      emailOutboxRolloutAt: "2026-08-15T00:00:00.000Z",
    });
    const result = recoveryPost(harness, "claimEmailOutboxWork", {
      leaseOwner: "email-worker-two",
      claimedAt: "2026-08-16T11:00:00.000Z",
      leaseExpiresAt: "2026-08-16T11:05:00.000Z",
      maxEvents: 1,
    }) as { events?: Array<Record<string, unknown>> };
    expect(result.events).toEqual([
      expect.objectContaining({
        payload_json: payloadJson,
        idempotency_key: "purchase-receipt/es-email-000001/v1",
        provider_first_attempt_at: "2026-08-16T10:00:00.000Z",
        attempt_count: 2,
      }),
    ]);
  });

  it("AUD3-H06E-CRASH-07 refuses blank-error ambiguous processing at 24h", () => {
    const row = emailOutboxRow({
      state: "processing",
      attempt_count: 1,
      lease_owner: "email-worker-one",
      lease_expires_at: "2026-08-16T10:05:00.000Z",
      provider_first_attempt_at: "2026-08-16T10:00:00.000Z",
      provider_outcome_unknown_since: "2026-08-16T10:00:00.000Z",
      last_attempt_at: "2026-08-16T10:00:00.000Z",
      last_error_code: "",
    });
    const harness = createHarness([], {
      emailOutboxHeaders,
      emailOutboxRows: [row],
      emailOutboxRolloutAt: "2026-08-15T00:00:00.000Z",
    });
    const result = recoveryPost(harness, "claimEmailOutboxWork", {
      leaseOwner: "email-worker-two",
      claimedAt: "2026-08-17T10:00:00.000Z",
      leaseExpiresAt: "2026-08-17T10:05:00.000Z",
      maxEvents: 1,
    }) as { events?: unknown[] };
    expect(result.events).toEqual([]);
    const stored = harness.states.get("_email_outbox_events")?.rows[0] ?? [];
    expect(stored[emailOutboxHeaders.indexOf("state")]).toBe("attention");
    expect(stored[emailOutboxHeaders.indexOf("last_error_code")]).toBe("RESEND_OUTCOME_UNKNOWN");
  });

  it("claims retryable work only when next_attempt_at is due", () => {
    const rolloutAt = "2026-08-15T00:00:00.000Z";
    const future = emailOutboxRow({
      state: "retryable",
      attempt_count: 1,
      next_attempt_at: "2026-08-16T10:10:00.000Z",
      provider_first_attempt_at: "2026-08-16T10:00:00.000Z",
      last_attempt_at: "2026-08-16T10:00:00.000Z",
      last_error_code: "RESEND_RATE_LIMITED",
    });
    const harness = createHarness([], {
      emailOutboxHeaders,
      emailOutboxRows: [future],
      emailOutboxRolloutAt: rolloutAt,
    });
    const early = recoveryPost(harness, "claimEmailOutboxWork", {
      leaseOwner: "email-worker-one",
      claimedAt: "2026-08-16T10:09:00.000Z",
      leaseExpiresAt: "2026-08-16T10:14:00.000Z",
      maxEvents: 1,
    }) as { events?: unknown[] };
    const due = recoveryPost(harness, "claimEmailOutboxWork", {
      leaseOwner: "email-worker-one",
      claimedAt: "2026-08-16T10:10:00.000Z",
      leaseExpiresAt: "2026-08-16T10:15:00.000Z",
      maxEvents: 1,
    }) as { events?: Array<Record<string, unknown>> };
    expect(early.events).toEqual([]);
    expect(due.events?.[0]).toMatchObject({ state: "processing", attempt_count: 2 });
  });

  it("persists accepted state and provider id before redacting the payload, then stays terminal", () => {
    const harness = createHarness([]);
    recoveryPost(harness, "ensureRecoverySchema");
    const event = emailOutboxEvent();
    recoveryPost(harness, "upsertEmailOutboxEvent", { event });
    recoveryPost(harness, "claimEmailOutboxWork", {
      leaseOwner: "email-worker-one",
      claimedAt: "2026-08-16T10:01:00.000Z",
      leaseExpiresAt: "2026-08-16T10:06:00.000Z",
      maxEvents: 1,
    });
    recoveryPost(harness, "markEmailOutboxProviderOutcomeUnknown", {
      eventKey: event.event_key,
      leaseOwner: "email-worker-one",
      unknownSince: "2026-08-16T10:01:30.000Z",
    });
    const accepted = recoveryPost(harness, "markEmailOutboxAccepted", {
      eventKey: event.event_key,
      leaseOwner: "email-worker-one",
      providerMessageId: "provider-message-123",
      acceptedAt: "2026-08-16T10:02:00.000Z",
    });
    expect(accepted).toMatchObject({
      result: "EMAIL_EVENT_ACCEPTED",
      event: {
        state: "accepted",
        provider_message_id: "provider-message-123",
        provider_outcome_unknown_since: "",
        payload_json: "",
      },
    });
    expect(recoveryPost(harness, "markEmailOutboxRetryable", {
      eventKey: event.event_key,
      leaseOwner: "email-worker-one",
      errorCode: "LATE_FAILURE",
      nextAttemptAt: "2026-08-16T10:10:00.000Z",
    })).toMatchObject({ ok: false, code: "EMAIL_OUTBOX_LEASE_CONFLICT" });
  });

  it("enforces lease ownership for terminal state mutations", () => {
    const harness = createHarness([]);
    recoveryPost(harness, "ensureRecoverySchema");
    const event = emailOutboxEvent();
    recoveryPost(harness, "upsertEmailOutboxEvent", { event });
    recoveryPost(harness, "claimEmailOutboxWork", {
      leaseOwner: "email-worker-one",
      claimedAt: "2026-08-16T10:01:00.000Z",
      leaseExpiresAt: "2026-08-16T10:06:00.000Z",
      maxEvents: 1,
    });
    expect(recoveryPost(harness, "markEmailOutboxAccepted", {
      eventKey: event.event_key,
      leaseOwner: "email-worker-two",
      providerMessageId: "provider-message-123",
      acceptedAt: "2026-08-16T10:02:00.000Z",
    })).toMatchObject({ ok: false, code: "EMAIL_OUTBOX_LEASE_CONFLICT" });
  });

  it("keeps accepted replay idempotent and provider identity immutable", () => {
    const harness = createHarness([]);
    recoveryPost(harness, "ensureRecoverySchema");
    const event = emailOutboxEvent();
    recoveryPost(harness, "upsertEmailOutboxEvent", { event });
    recoveryPost(harness, "claimEmailOutboxWork", {
      leaseOwner: "email-worker-one",
      claimedAt: "2026-08-16T10:01:00.000Z",
      leaseExpiresAt: "2026-08-16T10:06:00.000Z",
      maxEvents: 1,
    });
    const input = {
      eventKey: event.event_key,
      leaseOwner: "email-worker-one",
      providerMessageId: "provider-message-123",
      acceptedAt: "2026-08-16T10:02:00.000Z",
    };
    expect(recoveryPost(harness, "markEmailOutboxAccepted", input).result).toBe("EMAIL_EVENT_ACCEPTED");
    expect(recoveryPost(harness, "markEmailOutboxAccepted", input).result).toBe("EMAIL_EVENT_ACCEPTED");
    expect(recoveryPost(harness, "markEmailOutboxAccepted", {
      ...input,
      providerMessageId: "provider-message-456",
    })).toMatchObject({ ok: false, code: "EMAIL_OUTBOX_EVENT_CONFLICT" });
  });

  it("stores missing-email work as an explicit terminal skipped event", () => {
    const harness = createHarness([]);
    recoveryPost(harness, "ensureRecoverySchema");
    const event = emailOutboxEvent();
    recoveryPost(harness, "upsertEmailOutboxEvent", { event });
    recoveryPost(harness, "claimEmailOutboxWork", {
      leaseOwner: "email-worker-one",
      claimedAt: "2026-08-16T10:01:00.000Z",
      leaseExpiresAt: "2026-08-16T10:06:00.000Z",
      maxEvents: 1,
    });
    expect(recoveryPost(harness, "markEmailOutboxSkipped", {
      eventKey: event.event_key,
      leaseOwner: "email-worker-one",
      errorCode: "MISSING_CUSTOMER_EMAIL",
    })).toMatchObject({
      result: "EMAIL_EVENT_SKIPPED",
      event: { state: "skipped", last_error_code: "MISSING_CUSTOMER_EMAIL" },
    });
    const laterClaim = recoveryPost(harness, "claimEmailOutboxWork", {
      leaseOwner: "email-worker-two",
      claimedAt: "2026-08-17T10:01:00.000Z",
      leaseExpiresAt: "2026-08-17T10:06:00.000Z",
      maxEvents: 1,
    }) as { events?: unknown[] };
    expect(laterClaim.events).toEqual([]);
  });

  it("respects next_attempt_at and moves an expired fifth attempt to attention", () => {
    const rolloutAt = "2026-08-15T00:00:00.000Z";
    const retryable = emailOutboxRow({
      state: "retryable",
      attempt_count: 5,
      next_attempt_at: "2026-08-16T10:00:00.000Z",
      provider_first_attempt_at: "2026-08-15T10:00:00.000Z",
      last_attempt_at: "2026-08-16T09:00:00.000Z",
      last_error_code: "RESEND_SERVER_ERROR",
    });
    const harness = createHarness([], {
      emailOutboxHeaders,
      emailOutboxRows: [retryable],
      emailOutboxRolloutAt: rolloutAt,
    });
    const claimed = recoveryPost(harness, "claimEmailOutboxWork", {
      leaseOwner: "email-worker-one",
      claimedAt: "2026-08-16T10:01:00.000Z",
      leaseExpiresAt: "2026-08-16T10:06:00.000Z",
      maxEvents: 20,
    }) as { events?: unknown[] };
    expect(claimed.events).toEqual([]);
    const row = harness.states.get("_email_outbox_events")?.rows[0] ?? [];
    expect(row[emailOutboxHeaders.indexOf("state")]).toBe("attention");
    expect(row[emailOutboxHeaders.indexOf("last_error_code")]).toBe("EMAIL_OUTBOX_ATTEMPTS_EXHAUSTED");
  });

  it("AUD3-H06E-ROLLOUT-01/02/04 uses per-order enrollment and repairs accepted markers", () => {
    const rolloutAt = "2026-08-15T00:00:00.000Z";
    const salesHeaders = [
      "nro_de_compra", "estado_de_pago", "approved_at", "customer_email", "customer_name",
      "mp_payment_id", "items_json", "total", "currency", "receipt_email_sent_at",
      "receipt_outbox_version",
    ];
    const itemJson = JSON.stringify([{ title: "Producto", qty: 1, unitPrice: 1000 }]);
    const salesRows = [
      ["es-bootstrap-gap-000001", "Confirmado", "2026-08-16T10:00:00.000Z", "legacy@example.test", "Legacy", "pay-1", itemJson, 1000, "ARS", "", ""],
      ["es-enrolled-000001", "Confirmado", "2026-08-14T10:00:00.000Z", "new@example.test", "Nuevo", "pay-2", itemJson, 1000, "ARS", "", 1],
      ["es-sent-000001", "Confirmado", "2026-08-16T10:30:00.000Z", "sent@example.test", "Enviado", "pay-3", itemJson, 1000, "ARS", "2026-08-16T10:31:00.000Z", 1],
      ["es-repair-000001", "Confirmado", "2026-08-16T11:00:00.000Z", "repair@example.test", "Reparar", "pay-4", itemJson, 1000, "ARS", "", 1],
    ];
    const acceptedRow = emailOutboxRow({
      external_reference: "es-repair-000001",
      payload_json: "",
      state: "accepted",
      attempt_count: 1,
      provider_message_id: "provider-message-123",
      accepted_at: "2026-08-16T11:02:00.000Z",
      completed_at: "2026-08-16T11:02:00.000Z",
    });
    const harness = createHarness([], {
      salesHeaders,
      salesRows,
      emailOutboxHeaders,
      emailOutboxRows: [acceptedRow],
      emailOutboxRolloutAt: rolloutAt,
    });
    const result = recoveryPost(harness, "listMissingReceiptCandidates", { limit: 20 }) as {
      candidates?: Array<Record<string, unknown>>;
      marker_repairs?: Array<Record<string, unknown>>;
    };
    expect(result.candidates).toEqual([
      expect.objectContaining({ external_reference: "es-enrolled-000001", recipient_email: "new@example.test" }),
    ]);
    expect(result.marker_repairs).toEqual([
      { external_reference: "es-repair-000001", accepted_at: "2026-08-16T11:02:00.000Z" },
    ]);
  });

  it("AUD3-H06E-ROLLOUT-05 appends the exact ventas eligibility column once", () => {
    const harness = createHarness([], {
      salesHeaders: ["nro_de_compra", "estado_de_pago", "approved_at"],
    });
    expect(recoveryPost(harness, "ensureRecoverySchema")).toMatchObject({ ok: true });
    expect(recoveryPost(harness, "ensureRecoverySchema")).toMatchObject({ ok: true });
    expect(harness.states.get("ventas")?.headers).toEqual([
      "nro_de_compra",
      "estado_de_pago",
      "approved_at",
      "receipt_outbox_version",
    ]);
  });

  it("AUD3-H06E-ROLLOUT-06 fails closed on ambiguous eligibility headers", () => {
    const harness = createHarness([], {
      salesHeaders: [
        "nro_de_compra",
        "estado_de_pago",
        "approved_at",
        "receipt_outbox_version",
        "Receipt Outbox Version",
      ],
    });
    expect(recoveryPost(harness, "ensureRecoverySchema")).toMatchObject({
      ok: false,
      code: "EMAIL_OUTBOX_SCHEMA_INVALID",
    });
    expect(recoveryPost(harness, "listMissingReceiptCandidates", { limit: 20 })).toMatchObject({
      ok: false,
      code: "EMAIL_OUTBOX_SCHEMA_INVALID",
    });
    expect(harness.states.get("_email_outbox_events")?.rows).toEqual([]);
  });

  it("keeps Admin email attention output free of payload JSON and recipient PII", () => {
    const harness = createHarness([]);
    recoveryPost(harness, "ensureRecoverySchema");
    const event = emailOutboxEvent();
    recoveryPost(harness, "upsertEmailOutboxEvent", { event });
    recoveryPost(harness, "claimEmailOutboxWork", {
      leaseOwner: "email-worker-one",
      claimedAt: "2026-08-16T10:01:00.000Z",
      leaseExpiresAt: "2026-08-16T10:06:00.000Z",
      maxEvents: 1,
    });
    recoveryPost(harness, "markEmailOutboxAttention", {
      eventKey: event.event_key,
      leaseOwner: "email-worker-one",
      errorCode: "CUSTOMER_EMAIL_INVALID",
    });
    const result = recoveryPost(harness, "listEmailOutboxAttention", { limit: 20 });
    const serialized = JSON.stringify(result);
    expect(result).toMatchObject({
      items: [expect.objectContaining({
        external_reference: "es-email-000001",
        state: "attention",
        last_error_code: "CUSTOMER_EMAIL_INVALID",
      })],
    });
    expect(serialized).not.toContain("payload_json");
    expect(serialized).not.toContain("customer@example.test");
  });

  it("stores independent events for two different Orders", () => {
    const harness = createHarness([]);
    recoveryPost(harness, "ensureRecoverySchema");
    const first = emailOutboxEvent({ external_reference: "es-email-first-000001" });
    const second = emailOutboxEvent({ external_reference: "es-email-second-000001" });
    expect(recoveryPost(harness, "upsertEmailOutboxEvent", { event: first }).result).toBe("EMAIL_EVENT_STORED");
    expect(recoveryPost(harness, "upsertEmailOutboxEvent", { event: second }).result).toBe("EMAIL_EVENT_STORED");
    expect(harness.states.get("_email_outbox_events")?.rows).toHaveLength(2);
  });

  it("fails closed on duplicate event_key rows and rejects non-admin tokens", () => {
    const row = emailOutboxRow();
    const duplicate = createHarness([], {
      emailOutboxHeaders,
      emailOutboxRows: [row, row.slice()],
      emailOutboxRolloutAt: "2026-08-15T00:00:00.000Z",
    });
    expect(recoveryPost(duplicate, "getEmailOutboxEvent", {
      eventKey: "purchase-receipt/es-email-000001/v1",
    })).toMatchObject({ ok: false, code: "EMAIL_OUTBOX_SCHEMA_INVALID" });

    const protectedHarness = createHarness([]);
    recoveryPost(protectedHarness, "ensureRecoverySchema");
    expect(recoveryPost(
      protectedHarness,
      "listEmailOutboxAttention",
      { limit: 20 },
      "read-token",
    )).toEqual({ ok: false, error: "Unauthorized" });
    expect(recoveryPost(
      protectedHarness,
      "listEmailOutboxAttention",
      { limit: 20 },
      "write-token",
    )).toEqual({ ok: false, error: "Unauthorized" });
  });

  it("fails closed on malformed outbox headers and duplicate ventas identities", () => {
    const malformed = createHarness([], {
      emailOutboxHeaders: ["wrong"],
      emailOutboxRolloutAt: "2026-08-15T00:00:00.000Z",
    });
    expect(recoveryPost(malformed, "listEmailOutboxAttention", { limit: 20 })).toMatchObject({
      ok: false,
      code: "RECOVERY_SCHEMA_INVALID",
    });

    const duplicateSales = createHarness([], {
      salesHeaders: ["nro_de_compra", "estado_de_pago", "approved_at", "receipt_outbox_version"],
      salesRows: [
        ["es-duplicate-000001", "Confirmado", "2026-08-16T00:00:00.000Z", 1],
        ["es-duplicate-000001", "Confirmado", "2026-08-16T00:00:00.000Z", 1],
      ],
      emailOutboxHeaders,
      emailOutboxRolloutAt: "2026-08-15T00:00:00.000Z",
    });
    expect(recoveryPost(duplicateSales, "listMissingReceiptCandidates", { limit: 20 })).toMatchObject({
      ok: false,
      code: "EMAIL_OUTBOX_SCHEMA_INVALID",
    });
  });
});

describe("AUD3 crash-safe inventory matrix", () => {
  it("preserves the production web app config while enabling the Advanced Sheets Service", () => {
    expect(scriptManifest).toEqual({
      timeZone: "America/Argentina/Buenos_Aires",
      dependencies: {
        enabledAdvancedServices: [
          {
            userSymbol: "Sheets",
            serviceId: "sheets",
            version: "v4",
          },
        ],
      },
      exceptionLogging: "STACKDRIVER",
      runtimeVersion: "V8",
      webapp: {
        executeAs: "USER_DEPLOYING",
        access: "ANYONE_ANONYMOUS",
      },
    });
  });

  it("AUD3-INV-01 applies one valid item", () => {
    const harness = createHarness([availableProduct({ stockQty: 2 })]);
    expect(decrement(harness.api, "aud3-inv-01", [{ productId: "a", qty: 1 }])).toMatchObject({
      outcome: "APPLIED",
      deduped: false,
      updated: [{ productId: "a", previousQty: 2, nextQty: 1 }],
    });
    expect(harness.productRows[0][4]).toBe(1);
  });

  it("AUD3-INV-02 applies every item in a valid multi-item demand", () => {
    const harness = createHarness([
      availableProduct({ id: "a", stockQty: 3 }),
      availableProduct({ id: "b", stockQty: 2 }),
      availableProduct({ id: "c", stockQty: 4 }),
    ]);
    const result = decrement(harness.api, "aud3-inv-02", [
      { productId: "a", qty: 1 },
      { productId: "b", qty: 2 },
      { productId: "c", qty: 3 },
    ]);
    expect(result).toMatchObject({ outcome: "APPLIED", deduped: false });
    expect(harness.productRows.map((row) => row[4])).toEqual([2, 0, 1]);
  });

  it("AUD3-INV-03 aggregates repeated product ids before validation and commit", () => {
    const harness = createHarness([availableProduct({ stockQty: 5 })]);
    const result = decrement(harness.api, "aud3-inv-03", [
      { productId: "a", qty: 2 },
      { productId: "A", qty: 3 },
    ]);
    expect(result.updated).toEqual([{ productId: "a", previousQty: 5, nextQty: 0 }]);
    expect(harness.stockWrites()).toHaveLength(1);
  });

  it("AUD3-INV-04 insufficient stock on the first item produces zero writes", () => {
    const harness = createHarness([
      availableProduct({ id: "a", stockQty: 1 }),
      availableProduct({ id: "b", stockQty: 2 }),
      availableProduct({ id: "c", stockQty: 2 }),
    ]);
    expectInventoryError(() => decrement(harness.api, "aud3-inv-04", [
      { productId: "a", qty: 2 },
      { productId: "b", qty: 1 },
      { productId: "c", qty: 1 },
    ]), "INSUFFICIENT_STOCK");
    expect(harness.batchCalls).toHaveLength(0);
    expect(harness.productRows.map((row) => row[4])).toEqual([1, 2, 2]);
  });

  it("AUD3-INV-05 insufficient stock on the middle item produces zero writes", () => {
    const harness = createHarness([
      availableProduct({ id: "a", stockQty: 2 }),
      availableProduct({ id: "b", stockQty: 1 }),
      availableProduct({ id: "c", stockQty: 2 }),
    ]);
    expectInventoryError(() => decrement(harness.api, "aud3-inv-05", [
      { productId: "a", qty: 1 },
      { productId: "b", qty: 2 },
      { productId: "c", qty: 1 },
    ]), "INSUFFICIENT_STOCK");
    expect(harness.batchCalls).toHaveLength(0);
    expect(harness.productRows.map((row) => row[4])).toEqual([2, 1, 2]);
  });

  it("AUD3-INV-06 insufficient stock on the last item produces zero writes", () => {
    const harness = createHarness([
      availableProduct({ id: "a", stockQty: 2 }),
      availableProduct({ id: "b", stockQty: 2 }),
      availableProduct({ id: "c", stockQty: 1 }),
    ]);
    expectInventoryError(() => decrement(harness.api, "aud3-inv-06", [
      { productId: "a", qty: 1 },
      { productId: "b", qty: 1 },
      { productId: "c", qty: 2 },
    ]), "INSUFFICIENT_STOCK");
    expect(harness.batchCalls).toHaveLength(0);
    expect(harness.productRows.map((row) => row[4])).toEqual([2, 2, 1]);
  });

  it("AUD3-INV-07 inactive demand produces zero writes", () => {
    const harness = createHarness([availableProduct({ active: false })]);
    expectInventoryError(
      () => decrement(harness.api, "aud3-inv-07", [{ productId: "a", qty: 1 }]),
      "PRODUCT_INACTIVE",
    );
    expect(harness.batchCalls).toHaveLength(0);
  });

  it("AUD3-INV-08 missing product demand produces zero writes", () => {
    const harness = createHarness([availableProduct()]);
    expectInventoryError(
      () => decrement(harness.api, "aud3-inv-08", [{ productId: "missing", qty: 1 }]),
      "PRODUCT_NOT_FOUND",
    );
    expect(harness.batchCalls).toHaveLength(0);
  });

  it("AUD3-INV-09 duplicate catalog ids produce zero writes", () => {
    const harness = createHarness([availableProduct(), availableProduct({ name: "duplicate" })]);
    expectInventoryError(
      () => decrement(harness.api, "aud3-inv-09", [{ productId: "a", qty: 1 }]),
      "DUPLICATE_PRODUCT_ID",
    );
    expect(harness.batchCalls).toHaveLength(0);
  });

  it("AUD3-INV-10 invalid stock produces zero writes", () => {
    const harness = createHarness([availableProduct({ stockQty: "NaN" })]);
    expectInventoryError(
      () => decrement(harness.api, "aud3-inv-10", [{ productId: "a", qty: 1 }]),
      "INVALID_STOCK_QTY",
    );
    expect(harness.batchCalls).toHaveLength(0);
  });

  it("AUD3-INV-11 builds one atomic request containing every stock update", () => {
    const harness = createHarness([
      availableProduct({ id: "a", stockQty: 2 }),
      availableProduct({ id: "b", stockQty: 3 }),
    ]);
    decrement(harness.api, "aud3-inv-11", [
      { productId: "a", qty: 1 },
      { productId: "b", qty: 2 },
    ]);
    const stockRequests = harness.batchCalls[0].requests.filter((request) => {
      const update = request.updateCells as { start?: { sheetId?: number; columnIndex?: number } } | undefined;
      return update?.start?.sheetId === 101 && update.start.columnIndex === 4;
    });
    expect(harness.batchCalls).toHaveLength(1);
    expect(stockRequests).toHaveLength(2);
    expect(harness.productRows.map((row) => row[4])).toEqual([1, 1]);
  });

  it("AUD3-INV-12 puts the durable order marker in the atomic request", () => {
    const harness = createHarness([availableProduct()]);
    decrement(harness.api, "aud3-inv-12", [{ productId: "a", qty: 1 }]);
    expect(JSON.stringify(harness.batchCalls[0])).toContain("aud3-inv-12");
    expect(harness.journalRows()).toEqual([
      ["aud3-inv-12", expect.stringMatching(/^[a-f0-9]{64}$/), expect.any(String), "APPLIED"],
    ]);
  });

  it("AUD3-INV-13 commits marker and all stock cells through one batchUpdate call", () => {
    const harness = createHarness([
      availableProduct({ id: "a" }),
      availableProduct({ id: "b" }),
    ]);
    decrement(harness.api, "aud3-inv-13", [
      { productId: "a", qty: 1 },
      { productId: "b", qty: 1 },
    ]);
    expect(harness.batchCalls).toHaveLength(1);
    expect(harness.stockWrites()).toHaveLength(2);
    expect(harness.journalRows()).toHaveLength(1);
  });

  it("AUD3-INV-14 rejects an invalid atomic subrequest without partial application", () => {
    const harness = createHarness([
      availableProduct({ id: "a", stockQty: 2 }),
      availableProduct({ id: "b", stockQty: 2 }),
    ], { batchFailureAtRequest: 3 });
    expect(() => decrement(harness.api, "aud3-inv-14", [
      { productId: "a", qty: 1 },
      { productId: "b", qty: 1 },
    ])).toThrow("simulated invalid subrequest");
    expect(harness.productRows.map((row) => row[4])).toEqual([2, 2]);
    expect(harness.journalRows()).toHaveLength(0);
  });

  it("AUD3-INV-15 response loss after commit retries as ALREADY_APPLIED", () => {
    const harness = createHarness([availableProduct({ stockQty: 2 })], { batchFailure: "after-commit" });
    expect(() => decrement(harness.api, "aud3-inv-15", [{ productId: "a", qty: 1 }]))
      .toThrow("simulated response loss");
    const retry = decrement(harness.api, "aud3-inv-15", [{ productId: "a", qty: 1 }]);
    expect(retry).toMatchObject({ outcome: "ALREADY_APPLIED", deduped: true });
    expect(harness.productRows[0][4]).toBe(1);
    expect(harness.stockWrites()).toHaveLength(1);
  });

  it("AUD3-INV-16 same-order retry leaves stock unchanged", () => {
    const harness = createHarness([availableProduct({ stockQty: 3 })]);
    decrement(harness.api, "aud3-inv-16", [{ productId: "a", qty: 2 }]);
    const retry = decrement(harness.api, "aud3-inv-16", [{ productId: "a", qty: 2 }]);
    expect(retry).toMatchObject({ outcome: "ALREADY_APPLIED", deduped: true });
    expect(harness.productRows[0][4]).toBe(1);
    expect(harness.batchCalls).toHaveLength(1);
  });

  it("AUD3-INV-17 same order with a different fingerprint conflicts without writes", () => {
    const harness = createHarness([availableProduct({ stockQty: 5 })]);
    decrement(harness.api, "aud3-inv-17", [{ productId: "a", qty: 1 }]);
    expectInventoryError(
      () => decrement(harness.api, "aud3-inv-17", [{ productId: "a", qty: 2 }]),
      "INVENTORY_IDEMPOTENCY_CONFLICT",
    );
    expect(harness.productRows[0][4]).toBe(4);
    expect(harness.batchCalls).toHaveLength(1);
  });

  it("AUD3-CRASH-01 crash before lock applies nothing", () => {
    const harness = createHarness([availableProduct()], { lockFailure: true });
    const output = harness.api.doPost({
      postData: { contents: JSON.stringify({
        action: "decrementStock",
        token: "write-token",
        orderId: "aud3-crash-01",
        items: [{ productId: "a", qty: 1 }],
      }) },
    }) as { getContent: () => string };
    expect(JSON.parse(output.getContent())).toMatchObject({ ok: false });
    expect(harness.batchCalls).toHaveLength(0);
    expect(harness.productRows[0][4]).toBe(3);
  });

  it("AUD3-CRASH-02 crash after lock and before validation applies nothing", () => {
    const harness = createHarness([availableProduct()], {
      journalHeaders: ["order_id", "demand_fingerprint", "applied_at", "state"],
      journalReadFailure: true,
    });
    const output = harness.api.doPost({
      postData: { contents: JSON.stringify({
        action: "decrementStock",
        token: "write-token",
        orderId: "aud3-crash-02",
        items: [{ productId: "a", qty: 1 }],
      }) },
    }) as { getContent: () => string };
    expect(JSON.parse(output.getContent())).toMatchObject({ ok: false });
    expect(harness.locks).toEqual({ waited: 1, released: 1 });
    expect(harness.batchCalls).toHaveLength(0);
  });

  it("AUD3-CRASH-03 crash after validation but before commit applies nothing", () => {
    const harness = createHarness([availableProduct()]);
    const normalized = harness.api.normalizeStockItems_([{ productId: "a", qty: 1 }]);
    const fingerprint = harness.api.inventoryDemandFingerprint_(normalized);
    const plan = harness.api.planStockDecrement_(normalized);
    const journal = harness.api.resolveInventoryJournal_(
      { getSheetByName: () => null, getSheets: () => [{ getSheetId: () => 101 }] },
      "aud3-crash-03",
      fingerprint,
    );
    expect(harness.api.buildAtomicInventoryRequests_(
      plan,
      journal,
      "aud3-crash-03",
      fingerprint,
      new Date().toISOString(),
      null,
    )).not.toHaveLength(0);
    expect(() => { throw new Error("simulated crash before commit"); }).toThrow("before commit");
    expect(harness.productRows[0][4]).toBe(3);
    expect(harness.batchCalls).toHaveLength(0);
  });

  it("AUD3-CRASH-04 successful commit with lost response is resolved by its marker", () => {
    const harness = createHarness([availableProduct({ stockQty: 2 })], { batchFailure: "after-commit" });
    expect(() => decrement(harness.api, "aud3-crash-04", [{ productId: "a", qty: 1 }])).toThrow();
    expect(decrement(harness.api, "aud3-crash-04", [{ productId: "a", qty: 1 }])).toMatchObject({
      outcome: "ALREADY_APPLIED",
    });
    expect(harness.productRows[0][4]).toBe(1);
  });

  it("AUD3-CRASH-05 definite atomic commit failure applies nothing", () => {
    const harness = createHarness([
      availableProduct({ id: "a", stockQty: 2 }),
      availableProduct({ id: "b", stockQty: 2 }),
    ], { batchFailure: "before-commit" });
    expect(() => decrement(harness.api, "aud3-crash-05", [
      { productId: "a", qty: 1 },
      { productId: "b", qty: 1 },
    ])).toThrow("before commit");
    expect(harness.productRows.map((row) => row[4])).toEqual([2, 2]);
    expect(harness.journalRows()).toHaveLength(0);
  });

  it("AUD3-CONC-INV-01 serializes last-unit competitors to one applied and one insufficient", () => {
    const harness = createHarness([availableProduct({ stockQty: 1 })]);
    expect(postDecrement(harness, "aud3-conc-01-a", [{ productId: "a", qty: 1 }])).toMatchObject({
      outcome: "APPLIED",
    });
    expect(postDecrement(harness, "aud3-conc-01-b", [{ productId: "a", qty: 1 }])).toMatchObject({
      ok: false,
      code: "INSUFFICIENT_STOCK",
    });
    expect(harness.productRows[0][4]).toBe(0);
    expect(harness.journalRows()).toHaveLength(1);
    expect(harness.locks).toEqual({ waited: 2, released: 2 });
  });

  it("AUD3-CONC-INV-02 preserves multi-item all-or-nothing for either winner", () => {
    const aWins = createHarness([
      availableProduct({ id: "p1", stockQty: 1 }),
      availableProduct({ id: "p2", stockQty: 1 }),
    ]);
    expect(postDecrement(aWins, "aud3-conc-02-a", [
      { productId: "p1", qty: 1 },
      { productId: "p2", qty: 1 },
    ])).toMatchObject({ outcome: "APPLIED" });
    expect(postDecrement(aWins, "aud3-conc-02-b", [{ productId: "p2", qty: 1 }])).toMatchObject({
      ok: false,
      code: "INSUFFICIENT_STOCK",
    });
    expect(aWins.productRows.map((row) => row[4])).toEqual([0, 0]);
    expect(aWins.locks).toEqual({ waited: 2, released: 2 });

    const bWins = createHarness([
      availableProduct({ id: "p1", stockQty: 1 }),
      availableProduct({ id: "p2", stockQty: 1 }),
    ]);
    expect(postDecrement(bWins, "aud3-conc-02-b", [{ productId: "p2", qty: 1 }])).toMatchObject({
      outcome: "APPLIED",
    });
    expect(postDecrement(bWins, "aud3-conc-02-a", [
      { productId: "p1", qty: 1 },
      { productId: "p2", qty: 1 },
    ])).toMatchObject({ ok: false, code: "INSUFFICIENT_STOCK" });
    expect(bWins.productRows.map((row) => row[4])).toEqual([1, 0]);
    expect(bWins.locks).toEqual({ waited: 2, released: 2 });
  });

  it("AUD3-CONC-INV-03 same order reaches one mutation and one safe replay", () => {
    const harness = createHarness([availableProduct({ stockQty: 2 })]);
    const first = postDecrement(harness, "aud3-conc-03", [{ productId: "a", qty: 1 }]);
    const second = postDecrement(harness, "aud3-conc-03", [{ productId: "a", qty: 1 }]);
    expect(first).toMatchObject({ outcome: "APPLIED" });
    expect(second).toMatchObject({ outcome: "ALREADY_APPLIED" });
    expect(harness.batchCalls).toHaveLength(1);
    expect(harness.productRows[0][4]).toBe(1);
    expect(harness.locks).toEqual({ waited: 2, released: 2 });
  });

  it("AUD3-LEGACY-INV-01 legacy marker makes historical retries safe", () => {
    const harness = createHarness([availableProduct({ stockQty: 2 })]);
    harness.properties.set("stock_deducted:aud3-legacy-01", "2026-07-01T00:00:00.000Z");
    expect(decrement(harness.api, "aud3-legacy-01", [{ productId: "a", qty: 2 }])).toMatchObject({
      outcome: "ALREADY_APPLIED",
      deduped: true,
      legacyMarker: true,
    });
    expect(harness.productRows[0][4]).toBe(2);
    expect(harness.batchCalls).toHaveLength(0);
  });

  it("AUD3-LEGACY-INV-02 new journal is authoritative without creating a second legacy marker", () => {
    const harness = createHarness([availableProduct({ stockQty: 2 })]);
    decrement(harness.api, "aud3-legacy-02", [{ productId: "a", qty: 1 }]);
    expect(harness.properties.has("stock_deducted:aud3-legacy-02")).toBe(false);
    expect(harness.journalRows()).toHaveLength(1);
    expect(decrement(harness.api, "aud3-legacy-02", [{ productId: "a", qty: 1 }])).toMatchObject({
      outcome: "ALREADY_APPLIED",
      legacyMarker: false,
    });
  });

  it("fails closed when the journal is corrupt or the Advanced Sheets service is missing", () => {
    const corrupt = createHarness([availableProduct()], { journalHeaders: ["wrong"] });
    expectInventoryError(
      () => decrement(corrupt.api, "aud3-corrupt", [{ productId: "a", qty: 1 }]),
      "INVENTORY_JOURNAL_INVALID",
    );
    expect(corrupt.productRows[0][4]).toBe(3);

    const noService = createHarness([availableProduct()], { sheetsServiceEnabled: false });
    expect(() => decrement(noService.api, "aud3-no-service", [{ productId: "a", qty: 1 }]))
      .toThrow("Advanced Sheets service");
    expect(noService.productRows[0][4]).toBe(3);
  });

  it("uses an order-independent SHA-256 demand fingerprint and structured non-PII events", () => {
    const harness = createHarness([availableProduct({ id: "a" }), availableProduct({ id: "b" })]);
    const first = harness.api.inventoryDemandFingerprint_([
      { productId: "b", qty: 1 },
      { productId: "a", qty: 2 },
    ]);
    const second = harness.api.inventoryDemandFingerprint_([
      { productId: "A", qty: 2 },
      { productId: "B", qty: 1 },
    ]);
    expect(first).toBe(second);
    expect(first).toMatch(/^[a-f0-9]{64}$/);
    decrement(harness.api, "aud3-logging", [{ productId: "a", qty: 1 }]);
    expect(harness.logs.map((entry) => entry.event)).toEqual([
      "inventory.apply.started",
      "inventory.apply.applied",
    ]);
    expect(JSON.stringify(harness.logs)).not.toContain("token");
  });

  it("emits structured conflict and technical error outcomes", () => {
    const conflict = createHarness([availableProduct({ stockQty: 1 })]);
    expectInventoryError(
      () => decrement(conflict.api, "aud3-log-conflict", [{ productId: "a", qty: 2 }]),
      "INSUFFICIENT_STOCK",
    );
    expect(conflict.logs).toEqual([
      { event: "inventory.apply.started", orderId: "aud3-log-conflict", productCount: 1 },
      {
        event: "inventory.apply.conflict",
        orderId: "aud3-log-conflict",
        productCount: 1,
        code: "INSUFFICIENT_STOCK",
      },
    ]);

    const uncertain = createHarness([availableProduct()], { batchFailure: "after-commit" });
    expect(() => decrement(uncertain.api, "aud3-log-error", [{ productId: "a", qty: 1 }])).toThrow();
    expect(uncertain.logs.at(-1)).toEqual({
      event: "inventory.apply.error",
      orderId: "aud3-log-error",
      productCount: 1,
      code: "INVENTORY_COMMIT_FAILED",
    });
    decrement(uncertain.api, "aud3-log-error", [{ productId: "a", qty: 1 }]);
    expect(uncertain.logs.at(-1)).toEqual({
      event: "inventory.apply.already_applied",
      orderId: "aud3-log-error",
    });
  });

  it("requires a valid orderId for every mutating inventory path", () => {
    const harness = createHarness([availableProduct()]);
    expectInventoryError(() => decrement(harness.api, "", [{ productId: "a", qty: 1 }]), "INVALID_ORDER_ID");
    expectInventoryError(
      () => decrement(harness.api, "invalid order id", [{ productId: "a", qty: 1 }]),
      "INVALID_ORDER_ID",
    );
    expectInventoryError(
      () => harness.api.handleAppendOrderAndDecrementStock({
        orderId: "",
        row: { nro_de_compra: "" },
        items: [{ productId: "a", qty: 1 }],
      }),
      "INVALID_ORDER_ID",
    );
    expect(harness.batchCalls).toHaveLength(0);
  });
});
