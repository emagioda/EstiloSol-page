import { describe, expect, it, vi } from "vitest";
import { InventoryOperationError } from "@/src/server/inventory/errors";
import {
  attemptInventoryForPaidOrder,
  buildInventoryDemandIdentity,
  classifyInventoryFailure,
} from "./inventory";

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

  it("D2B-DEMAND-01 matches journal ordering and aggregates equivalent product ids", () => {
    expect(buildInventoryDemandIdentity([
      { productId: " P2 ", qty: 1 },
      { productId: "p1", qty: 2 },
      { productId: "p2", qty: 3 },
    ])).toBe("p1\t2\np2\t4");
    expect(buildInventoryDemandIdentity([
      { productId: "P2", qty: 4 },
      { productId: "P1", qty: 2 },
    ])).toBe("p1\t2\np2\t4");
  });

  it("D2B-DEMAND-02 rejects an incoherent fallback demand", () => {
    expect(() => buildInventoryDemandIdentity([])).toThrow("INVALID_INVENTORY_DEMAND_IDENTITY");
    expect(() => buildInventoryDemandIdentity([{ productId: "", qty: 1 }])).toThrow(
      "INVALID_INVENTORY_DEMAND_IDENTITY",
    );
    expect(() => buildInventoryDemandIdentity([{ productId: "p1", qty: 1.5 }])).toThrow(
      "INVALID_INVENTORY_DEMAND_IDENTITY",
    );
  });
});

describe("AUD3 Next inventory result contract", () => {
  it("AUD3-NEXT-INV-01 APPLIED becomes deducted", async () => {
    const result = await attemptInventoryForPaidOrder(order("aud3-next-01"), {
      decrementStock: vi.fn(async () => ({
        deduped: false,
        updated: [{ productId: "p1", previousQty: 2, nextQty: 1 }],
      })),
      invalidateCatalog: noCache,
      now: () => 101,
    });
    expect(result).toEqual({ status: "deducted", stockDeductedAt: 101, deduped: false });
  });

  it("AUD3-NEXT-INV-02 ALREADY_APPLIED becomes deducted", async () => {
    const result = await attemptInventoryForPaidOrder(order("aud3-next-02"), {
      decrementStock: vi.fn(async () => ({ deduped: true, updated: [] })),
      invalidateCatalog: noCache,
      now: () => 102,
    });
    expect(result).toEqual({ status: "deducted", stockDeductedAt: 102, deduped: true });
  });

  it("AUD3-NEXT-INV-03 INSUFFICIENT_STOCK remains a deterministic conflict", async () => {
    const result = await attemptInventoryForPaidOrder(order("aud3-next-03"), {
      decrementStock: vi.fn(async () => {
        throw new InventoryOperationError({ code: "INSUFFICIENT_STOCK", message: "insufficient" });
      }),
      invalidateCatalog: noCache,
      now: () => 103,
    });
    expect(result).toEqual({ status: "conflict", issueCode: "INSUFFICIENT_STOCK", issueAt: 103 });
  });

  it("AUD3-NEXT-INV-04 technical or uncertain failures remain error", async () => {
    const timeout = new Error("timed out after atomic commit");
    timeout.name = "AbortError";
    const result = await attemptInventoryForPaidOrder(order("aud3-next-04"), {
      decrementStock: vi.fn(async () => { throw timeout; }),
      invalidateCatalog: noCache,
      now: () => 104,
    });
    expect(result).toEqual({ status: "error", issueCode: "SHEETS_TIMEOUT", issueAt: 104 });
  });

  it("AUD3-NEXT-INV-05 deducted evidence never retries or regresses to error", async () => {
    const decrementStock = vi.fn(async () => { throw new Error("must not run"); });
    const result = await attemptInventoryForPaidOrder({
      ...order("aud3-next-05"),
      stockDeductedAt: 500,
    }, { decrementStock, invalidateCatalog: noCache, now: () => 105 });
    expect(result).toEqual({ status: "deducted", stockDeductedAt: 500, deduped: true });
    expect(decrementStock).not.toHaveBeenCalled();
  });
});
