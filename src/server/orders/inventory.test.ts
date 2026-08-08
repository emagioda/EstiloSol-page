import { describe, expect, it, vi } from "vitest";
import { InventoryOperationError } from "@/src/server/inventory/errors";
import { attemptInventoryForPaidOrder, classifyInventoryFailure } from "./inventory";

const order = (externalReference: string) => ({
  externalReference,
  items: [{ productId: "p1", title: "Producto", unitPrice: 1000, qty: 1, currency: "ARS" as const }],
  stockDeductedAt: undefined,
});

const noCache = vi.fn(async () => undefined);

describe("PR 2 inventory classification", () => {
  it("distinguishes malformed Apps Script responses from deterministic validation conflicts", () => {
    expect(classifyInventoryFailure(new InventoryOperationError({
      code: "INVENTORY_VALIDATION_FAILED",
      message: "malformed response",
      origin: "response",
    }), 10)).toEqual({ status: "error", issueCode: "INVENTORY_RESPONSE_INVALID", issueAt: 10 });

    expect(classifyInventoryFailure(new InventoryOperationError({
      code: "INVENTORY_VALIDATION_FAILED",
      message: "catalog conflict",
    }), 11)).toEqual({ status: "conflict", issueCode: "INVENTORY_VALIDATION_FAILED", issueAt: 11 });
  });
});

describe("PR 2 authoritative concurrency simulations", () => {
  it("PR2-CONC-01 two different orders competing for the last unit produce one deducted and one conflict", async () => {
    let stock = 1;
    const decrementStock = vi.fn(async () => {
      if (stock < 1) throw new InventoryOperationError({ code: "INSUFFICIENT_STOCK", message: "none" });
      stock -= 1;
      return { deduped: false, updated: [{ productId: "p1", previousQty: 1, nextQty: 0 }] };
    });

    const results = await Promise.all([
      attemptInventoryForPaidOrder(order("order-a"), { decrementStock, invalidateCatalog: noCache }),
      attemptInventoryForPaidOrder(order("order-b"), { decrementStock, invalidateCatalog: noCache }),
    ]);
    expect(results.map((result) => result.status).sort()).toEqual(["conflict", "deducted"]);
    expect(stock).toBe(0);
  });

  it("PR2-CONC-02 concurrent webhook and verify attempts with one order id do not double-decrement", async () => {
    let stock = 2;
    const processed = new Set<string>();
    const decrementStock = vi.fn(async (orderId: string) => {
      if (processed.has(orderId)) return { deduped: true, updated: [] };
      processed.add(orderId);
      stock -= 1;
      return { deduped: false, updated: [{ productId: "p1", previousQty: 2, nextQty: 1 }] };
    });
    const results = await Promise.all([
      attemptInventoryForPaidOrder(order("same-order"), { decrementStock, invalidateCatalog: noCache }),
      attemptInventoryForPaidOrder(order("same-order"), { decrementStock, invalidateCatalog: noCache }),
    ]);
    expect(results.every((result) => result.status === "deducted")).toBe(true);
    expect(stock).toBe(1);
  });

  it("PR2-CONC-03 duplicated webhook order id is idempotent", async () => {
    let applied = 0;
    const processed = new Set<string>();
    const decrementStock = vi.fn(async (orderId: string) => {
      if (processed.has(orderId)) return { deduped: true, updated: [] };
      processed.add(orderId);
      applied += 1;
      return { deduped: false, updated: [{ productId: "p1", previousQty: 2, nextQty: 1 }] };
    });
    await attemptInventoryForPaidOrder(order("duplicate"), { decrementStock, invalidateCatalog: noCache });
    await attemptInventoryForPaidOrder(order("duplicate"), { decrementStock, invalidateCatalog: noCache });
    expect(applied).toBe(1);
  });

  it("PR2-CONC-04 admin retry concurrent with a late webhook keeps one authoritative decrement", async () => {
    let applied = 0;
    const processed = new Set<string>();
    const decrementStock = vi.fn(async (orderId: string) => {
      if (processed.has(orderId)) return { deduped: true, updated: [] };
      processed.add(orderId);
      applied += 1;
      return { deduped: false, updated: [{ productId: "p1", previousQty: 1, nextQty: 0 }] };
    });
    await Promise.all([
      attemptInventoryForPaidOrder(order("late-webhook"), { decrementStock, invalidateCatalog: noCache }),
      attemptInventoryForPaidOrder(order("late-webhook"), { decrementStock, invalidateCatalog: noCache }),
    ]);
    expect(applied).toBe(1);
  });

  it("PR2-CONC-05 timeout after a real decrement becomes deducted on deduped retry", async () => {
    let applied = 0;
    const processed = new Set<string>();
    const decrementStock = vi.fn(async (orderId: string) => {
      if (processed.has(orderId)) return { deduped: true, updated: [] };
      processed.add(orderId);
      applied += 1;
      const timeout = new Error("timed out after commit");
      timeout.name = "AbortError";
      throw timeout;
    });
    const first = await attemptInventoryForPaidOrder(order("lost-response"), {
      decrementStock,
      invalidateCatalog: noCache,
    });
    const retry = await attemptInventoryForPaidOrder(order("lost-response"), {
      decrementStock,
      invalidateCatalog: noCache,
    });
    expect(first.status).toBe("error");
    expect(retry).toMatchObject({ status: "deducted", deduped: true });
    expect(applied).toBe(1);
  });
});
