import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import type { CartItemInput } from "@/src/features/shop/domain/cartLines";
import {
  CartProvider,
  getCartSnapshotFromItems,
  sanitizeStoredCartItems,
  useCart,
} from "@/src/features/shop/presentation/view-models/useCartStore";

const STORAGE_KEY = "es_sol_cart_v1";
const wrapper = ({ children }: { children: React.ReactNode }) => (
  <CartProvider>{children}</CartProvider>
);

const cartInput = (overrides: Partial<CartItemInput> = {}): CartItemInput => ({
  productId: "P1",
  name: "Producto 1",
  unitPrice: 1000,
  qty: 1,
  stockStatus: "in_stock",
  stockQty: 10,
  image: "/p1.webp",
  ...overrides,
});

const renderHydratedCart = async () => {
  const rendered = renderHook(() => useCart(), { wrapper });
  await act(async () => {
    await new Promise((resolve) => window.setTimeout(resolve, 0));
  });
  return rendered;
};

describe("cart line identity", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it("PR3-CART-01 creates one line with a valid lineId", async () => {
    const { result } = await renderHydratedCart();
    act(() => void result.current.addItem(cartInput()));

    expect(result.current.items).toHaveLength(1);
    expect(result.current.items[0]).toMatchObject({ productId: "P1", qty: 1 });
    expect(result.current.items[0].lineId).toEqual(expect.any(String));
    expect(result.current.items[0].lineId.length).toBeGreaterThan(0);
  });

  it("PR3-CART-02 creates two independent lines for two adds of the same product", async () => {
    const { result } = await renderHydratedCart();
    act(() => {
      result.current.addItem(cartInput());
      result.current.addItem(cartInput());
    });

    expect(result.current.items.map((item) => item.productId)).toEqual(["P1", "P1"]);
    expect(new Set(result.current.items.map((item) => item.lineId)).size).toBe(2);
  });

  it("PR3-CART-03 keeps qty3 in one line when it is one add", async () => {
    const { result } = await renderHydratedCart();
    act(() => void result.current.addItem(cartInput({ qty: 3 })));
    expect(result.current.items).toHaveLength(1);
    expect(result.current.items[0].qty).toBe(3);
  });

  it("PR3-CART-04 preserves product identity and uses distinct lineIds", async () => {
    const { result } = await renderHydratedCart();
    act(() => {
      result.current.addItem(cartInput());
      result.current.addItem(cartInput({ productId: "P2", name: "Producto 2" }));
    });
    expect(result.current.items.map((item) => item.productId)).toEqual(["P1", "P2"]);
    expect(result.current.items[0].lineId).not.toBe(result.current.items[1].lineId);
  });

  it("PR3-CART-05 removeItem removes only the requested line", async () => {
    const { result } = await renderHydratedCart();
    act(() => {
      result.current.addItem(cartInput());
      result.current.addItem(cartInput());
    });
    const [, lineB] = result.current.items;
    act(() => result.current.removeItem(result.current.items[0].lineId));
    expect(result.current.items).toEqual([lineB]);
  });

  it("PR3-CART-06 updateQty modifies only the requested line", async () => {
    const { result } = await renderHydratedCart();
    act(() => {
      result.current.addItem(cartInput());
      result.current.addItem(cartInput());
    });
    const [lineA, lineB] = result.current.items;
    act(() => result.current.updateQty(lineA.lineId, 3));
    expect(result.current.items).toEqual([{ ...lineA, qty: 3 }, lineB]);
  });

  it("PR3-CART-07 qty at or below zero removes only that line", async () => {
    const { result } = await renderHydratedCart();
    act(() => {
      result.current.addItem(cartInput());
      result.current.addItem(cartInput());
    });
    const [, lineB] = result.current.items;
    act(() => result.current.updateQty(result.current.items[0].lineId, 0));
    expect(result.current.items).toEqual([lineB]);
  });

  it("PR3-CART-08 rejects a new line when aggregate known stock is full", async () => {
    const { result } = await renderHydratedCart();
    act(() => {
      result.current.addItem(cartInput({ qty: 1, stockQty: 3 }));
      result.current.addItem(cartInput({ qty: 2, stockQty: 3 }));
    });
    let addResult: ReturnType<typeof result.current.addItem> | undefined;
    act(() => {
      addResult = result.current.addItem(cartInput({ stockQty: 3 }));
    });
    expect(addResult).toMatchObject({ ok: false, reason: "max_stock_reached", addedQty: 0 });
    expect(result.current.items).toHaveLength(2);
  });

  it("PR3-CART-09 creates a partial new line without exceeding known stock", async () => {
    const { result } = await renderHydratedCart();
    act(() => void result.current.addItem(cartInput({ qty: 2, stockQty: 3 })));
    let addResult: ReturnType<typeof result.current.addItem> | undefined;
    act(() => {
      addResult = result.current.addItem(cartInput({ qty: 2, stockQty: 3 }));
    });
    expect(addResult).toMatchObject({ ok: true, addedQty: 1, finalQty: 3 });
    expect(result.current.items.map((item) => item.qty)).toEqual([2, 1]);
  });

  it("PR3-CART-10 update maximum accounts for sibling lines", async () => {
    const { result } = await renderHydratedCart();
    act(() => {
      result.current.addItem(cartInput({ qty: 2, stockQty: 5 }));
      result.current.addItem(cartInput({ qty: 2, stockQty: 5 }));
    });
    const [lineA] = result.current.items;
    act(() => result.current.updateQty(lineA.lineId, 5));
    expect(result.current.items.map((item) => item.qty)).toEqual([3, 2]);
  });

  it("PR3-CART-11 aggregate product demand never exceeds known stock", async () => {
    const { result } = await renderHydratedCart();
    act(() => {
      result.current.addItem(cartInput({ qty: 3, stockQty: 4 }));
      result.current.addItem(cartInput({ qty: 50, stockQty: 4 }));
      result.current.addItem(cartInput({ qty: 1, stockQty: 4 }));
    });
    expect(result.current.items.reduce((sum, item) => sum + item.qty, 0)).toBe(4);
  });

  it("PR3-CART-12 applies the generic limit of 50 across all product lines", async () => {
    const { result } = await renderHydratedCart();
    act(() => {
      result.current.addItem(cartInput({ qty: 30, stockQty: null }));
      result.current.addItem(cartInput({ qty: 30, stockQty: null }));
      result.current.addItem(cartInput({ qty: 1, stockQty: null }));
    });
    expect(result.current.items.map((item) => item.qty)).toEqual([30, 20]);
  });

  it("PR3-CART-13 stock for P1 does not affect P2", async () => {
    const { result } = await renderHydratedCart();
    act(() => {
      result.current.addItem(cartInput({ qty: 1, stockQty: 1 }));
      result.current.addItem(cartInput({ productId: "P2", qty: 4, stockQty: 4 }));
    });
    expect(result.current.items.map((item) => [item.productId, item.qty])).toEqual([
      ["P1", 1],
      ["P2", 4],
    ]);
  });

  it("PR3-CART-14 sync updates metadata on every matching line", async () => {
    const { result } = await renderHydratedCart();
    act(() => {
      result.current.addItem(cartInput());
      result.current.addItem(cartInput());
      result.current.syncStockFromProducts([
        {
          id: "P1",
          name: "Producto actualizado",
          price: 1200,
          images: ["/new.webp"],
          stock_status: "in_stock",
          stock_qty: 2,
        },
      ]);
    });
    result.current.items.forEach((item) => {
      expect(item).toMatchObject({
        name: "Producto actualizado",
        unitPrice: 1200,
        image: "/new.webp",
        stockQty: 2,
      });
    });
  });

  it("PR3-CART-15 sync preserves lineIds", async () => {
    const { result } = await renderHydratedCart();
    act(() => {
      result.current.addItem(cartInput());
      result.current.addItem(cartInput());
    });
    const lineIds = result.current.items.map((item) => item.lineId);
    act(() => {
      result.current.syncStockFromProducts([
        { id: "P1", name: "Nuevo", price: 2, stock_status: "in_stock", stock_qty: 9 },
      ]);
    });
    expect(result.current.items.map((item) => item.lineId)).toEqual(lineIds);
  });

  it("PR3-CART-16 sync never merges duplicate product lines", async () => {
    const { result } = await renderHydratedCart();
    act(() => {
      result.current.addItem(cartInput());
      result.current.addItem(cartInput());
      result.current.syncStockFromProducts([
        { id: "P1", name: "Nuevo", price: 2, stock_status: "in_stock", stock_qty: 9 },
      ]);
    });
    expect(result.current.items).toHaveLength(2);
    expect(result.current.items.map((item) => item.qty)).toEqual([1, 1]);
  });

  it("PR3-CART-17 sync to zero stock keeps all lines visible", async () => {
    const { result } = await renderHydratedCart();
    act(() => {
      result.current.addItem(cartInput());
      result.current.addItem(cartInput());
      result.current.syncStockFromProducts([
        { id: "P1", name: "Nuevo", price: 2, stock_status: "out_of_stock", stock_qty: 0 },
      ]);
    });
    expect(result.current.items).toHaveLength(2);
    expect(result.current.items.every((item) => item.stockStatus === "out_of_stock")).toBe(true);
  });

  it("PR3-CART-18 getTotal sums every independent line", async () => {
    const { result } = await renderHydratedCart();
    act(() => {
      result.current.addItem(cartInput({ qty: 2, unitPrice: 1000 }));
      result.current.addItem(cartInput({ qty: 3, unitPrice: 1000 }));
    });
    expect(result.current.getTotal()).toBe(5000);
  });

  it("PR3-CART-19 cart snapshot count sums quantity rather than lines", () => {
    expect(
      getCartSnapshotFromItems([
        { qty: 2, unitPrice: 1000 },
        { qty: 3, unitPrice: 1000 },
      ]),
    ).toEqual({ count: 5, total: 5000 });
  });
});

describe("legacy cart storage migration", () => {
  beforeEach(() => window.localStorage.clear());

  const legacyItem = (overrides: Record<string, unknown> = {}) => ({
    productId: "P1",
    name: "Producto legacy",
    unitPrice: 2500,
    qty: 1,
    image: "/legacy.webp",
    stockStatus: "in_stock",
    stockQty: 5,
    ...overrides,
  });

  it("PR3-STORAGE-01 hydrates a legacy row with a lineId", async () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify([legacyItem()]));
    const { result } = await renderHydratedCart();
    expect(result.current.items[0].lineId).toEqual(expect.any(String));
  });

  it("PR3-STORAGE-02 keeps legacy qty3 as one line", () => {
    const migrated = sanitizeStoredCartItems([legacyItem({ qty: 3 })]);
    expect(migrated).toHaveLength(1);
    expect(migrated[0].qty).toBe(3);
  });

  it("PR3-STORAGE-03 preserves two legacy rows for the same product", () => {
    expect(sanitizeStoredCartItems([legacyItem(), legacyItem({ qty: 2 })])).toHaveLength(2);
  });

  it("PR3-STORAGE-04 assigns distinct lineIds to legacy rows", () => {
    const migrated = sanitizeStoredCartItems([legacyItem(), legacyItem()]);
    expect(migrated[0].lineId).not.toBe(migrated[1].lineId);
  });

  it("PR3-STORAGE-05 preserves a valid existing lineId", () => {
    expect(sanitizeStoredCartItems([legacyItem({ lineId: "existing-line" })])[0].lineId).toBe(
      "existing-line",
    );
  });

  it("PR3-STORAGE-06 replaces an empty lineId", () => {
    expect(sanitizeStoredCartItems([legacyItem({ lineId: "   " })])[0].lineId).not.toBe("");
  });

  it("PR3-STORAGE-07 repairs duplicate lineIds without dropping rows", () => {
    const migrated = sanitizeStoredCartItems([
      legacyItem({ lineId: "duplicate" }),
      legacyItem({ lineId: "duplicate" }),
    ]);
    expect(migrated).toHaveLength(2);
    expect(migrated[0].lineId).toBe("duplicate");
    expect(migrated[1].lineId).not.toBe("duplicate");
  });

  it("PR3-STORAGE-08 invalid JSON does not break hydration", async () => {
    localStorage.setItem(STORAGE_KEY, "{invalid");
    const { result } = await renderHydratedCart();
    expect(result.current.items).toEqual([]);
  });

  it("PR3-STORAGE-09 migration preserves all cart business fields", () => {
    const migrated = sanitizeStoredCartItems([legacyItem()])[0];
    expect(migrated).toMatchObject(legacyItem());
  });

  it("PR3-STORAGE-10 persisted migration keeps its lineId after rehydration", async () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify([legacyItem()]));
    const first = await renderHydratedCart();
    const lineId = first.result.current.items[0].lineId;
    await waitFor(() =>
      expect(JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "[]")[0].lineId).toBe(lineId),
    );
    first.unmount();

    const second = await renderHydratedCart();
    expect(second.result.current.items[0].lineId).toBe(lineId);
  });

  it("PR3-STORAGE-11 pageshow and focus do not regenerate migrated lineIds", async () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify([legacyItem()]));
    const { result } = await renderHydratedCart();
    const migratedLineId = result.current.items[0].lineId;
    act(() => {
      window.dispatchEvent(new Event("pageshow"));
      window.dispatchEvent(new Event("focus"));
    });
    expect(result.current.items[0].lineId).toBe(migratedLineId);
  });

  it("PR3-STORAGE-12 storage refresh preserves independent lines", async () => {
    const { result } = await renderHydratedCart();
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify([
        legacyItem({ lineId: "line-a", qty: 1 }),
        legacyItem({ lineId: "line-b", qty: 2 }),
      ]),
    );
    act(() => window.dispatchEvent(new Event("pageshow")));
    await waitFor(() => expect(result.current.items).toHaveLength(2));
    expect(result.current.items.map((item) => item.lineId)).toEqual(["line-a", "line-b"]);
  });
});

describe("checkout line operations", () => {
  beforeEach(() => localStorage.clear());

  it("PR3-CHECKOUT-03 removing one visual line leaves its sibling", async () => {
    const { result } = await renderHydratedCart();
    act(() => {
      result.current.addItem(cartInput());
      result.current.addItem(cartInput());
    });
    const [lineA, lineB] = result.current.items;
    act(() => result.current.removeItem(lineA.lineId));
    expect(result.current.items).toEqual([lineB]);
  });

  it("PR3-CHECKOUT-04 modifying one visual line leaves its sibling unchanged", async () => {
    const { result } = await renderHydratedCart();
    act(() => {
      result.current.addItem(cartInput());
      result.current.addItem(cartInput());
    });
    const [lineA, lineB] = result.current.items;
    act(() => result.current.updateQty(lineA.lineId, 2));
    expect(result.current.items).toEqual([{ ...lineA, qty: 2 }, lineB]);
  });

  it("PR3-CHECKOUT-08 revalidation updates every line without merging", async () => {
    const { result } = await renderHydratedCart();
    act(() => {
      result.current.addItem(cartInput());
      result.current.addItem(cartInput());
    });
    const lineIds = result.current.items.map((item) => item.lineId);
    act(() =>
      result.current.syncStockFromProducts([
        { id: "P1", name: "Autoritativo", price: 1500, stock_status: "in_stock", stock_qty: 7 },
      ]),
    );
    expect(result.current.items).toHaveLength(2);
    expect(result.current.items.map((item) => item.lineId)).toEqual(lineIds);
    expect(result.current.items.every((item) => item.unitPrice === 1500 && item.stockQty === 7)).toBe(true);
  });
});
