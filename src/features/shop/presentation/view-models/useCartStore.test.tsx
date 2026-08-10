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

  it("PR3-CART-02 adds the same product into one line and preserves its lineId", async () => {
    const { result } = await renderHydratedCart();
    act(() => void result.current.addItem(cartInput()));
    const lineId = result.current.items[0].lineId;
    act(() => void result.current.addItem(cartInput()));

    expect(result.current.items).toHaveLength(1);
    expect(result.current.items[0]).toMatchObject({ lineId, productId: "P1", qty: 2 });
  });

  it("PR3-CART-03 keeps qty3 in one line when it is one add", async () => {
    const { result } = await renderHydratedCart();
    act(() => void result.current.addItem(cartInput({ qty: 3 })));
    expect(result.current.items).toHaveLength(1);
    expect(result.current.items[0].qty).toBe(3);
  });

  it("PR3-CART-04 combines qty2 and qty3 into one line with qty5", async () => {
    const { result } = await renderHydratedCart();
    act(() => {
      result.current.addItem(cartInput({ qty: 2 }));
      result.current.addItem(cartInput({ qty: 3 }));
    });
    expect(result.current.items).toHaveLength(1);
    expect(result.current.items[0]).toMatchObject({ productId: "P1", qty: 5 });
  });

  it("PR3-CART-05 keeps distinct productIds in distinct lines", async () => {
    const { result } = await renderHydratedCart();
    act(() => {
      result.current.addItem(cartInput());
      result.current.addItem(cartInput({ productId: "P2", name: "Producto 2" }));
    });
    expect(result.current.items.map((item) => item.productId)).toEqual(["P1", "P2"]);
    expect(result.current.items[0].lineId).not.toBe(result.current.items[1].lineId);
  });

  it("PR3-CART-06 shared product metadata never merges distinct productIds", async () => {
    const { result } = await renderHydratedCart();
    act(() => {
      result.current.addItem(cartInput());
      result.current.addItem(cartInput({ productId: "P2" }));
    });
    expect(result.current.items).toHaveLength(2);
    expect(result.current.items.map((item) => item.productId)).toEqual(["P1", "P2"]);
  });

  it("productId identity is exact and does not merge different casing", async () => {
    const { result } = await renderHydratedCart();
    act(() => {
      result.current.addItem(cartInput({ productId: "P1" }));
      result.current.addItem(cartInput({ productId: "p1" }));
    });
    expect(result.current.items.map((item) => item.productId)).toEqual(["P1", "p1"]);
  });

  it("PR3-CART-07 removeItem removes only the requested lineId", async () => {
    const { result } = await renderHydratedCart();
    act(() => {
      result.current.addItem(cartInput());
      result.current.addItem(cartInput({ productId: "P2", name: "Producto 2" }));
    });
    const [, lineB] = result.current.items;
    act(() => result.current.removeItem(result.current.items[0].lineId));
    expect(result.current.items).toEqual([lineB]);
  });

  it("PR3-CART-08 re-adding a removed product creates a new lineId", async () => {
    const { result } = await renderHydratedCart();
    act(() => void result.current.addItem(cartInput()));
    const originalLineId = result.current.items[0].lineId;
    act(() => result.current.removeItem(originalLineId));
    act(() => void result.current.addItem(cartInput()));
    expect(result.current.items).toHaveLength(1);
    expect(result.current.items[0].lineId).not.toBe(originalLineId);
  });

  it("PR3-CART-09 caps repeated additions at known stock in the existing line", async () => {
    const { result } = await renderHydratedCart();
    act(() => void result.current.addItem(cartInput({ qty: 2, stockQty: 3 })));
    let addResult: ReturnType<typeof result.current.addItem> | undefined;
    act(() => {
      addResult = result.current.addItem(cartInput({ qty: 2, stockQty: 3 }));
    });
    expect(addResult).toMatchObject({
      ok: true,
      reason: "max_stock_reached",
      addedQty: 1,
      finalQty: 3,
    });
    expect(result.current.items).toHaveLength(1);
    expect(result.current.items[0].qty).toBe(3);
  });

  it("PR3-CART-10 full stock rejects another add without creating a line", async () => {
    const { result } = await renderHydratedCart();
    act(() => void result.current.addItem(cartInput({ qty: 3, stockQty: 3 })));
    const lineId = result.current.items[0].lineId;
    let addResult: ReturnType<typeof result.current.addItem> | undefined;
    act(() => {
      addResult = result.current.addItem(cartInput({ stockQty: 3 }));
    });
    expect(addResult).toMatchObject({ ok: false, reason: "max_stock_reached", addedQty: 0 });
    expect(result.current.items).toEqual([expect.objectContaining({ lineId, qty: 3 })]);
  });

  it("PR3-CART-11 repeated additions never exceed the generic limit of 50", async () => {
    const { result } = await renderHydratedCart();
    act(() => {
      result.current.addItem(cartInput({ qty: 30, stockQty: null }));
      result.current.addItem(cartInput({ qty: 30, stockQty: null }));
      result.current.addItem(cartInput({ qty: 1, stockQty: null }));
    });
    expect(result.current.items).toHaveLength(1);
    expect(result.current.items[0].qty).toBe(50);
  });

  it("PR3-CART-12 updateQty modifies only the requested lineId", async () => {
    const { result } = await renderHydratedCart();
    act(() => {
      result.current.addItem(cartInput());
      result.current.addItem(cartInput({ productId: "P2", name: "Producto 2" }));
    });
    const [lineA, lineB] = result.current.items;
    act(() => result.current.updateQty(lineA.lineId, 3));
    expect(result.current.items).toEqual([{ ...lineA, qty: 3 }, lineB]);
  });

  it("updateQty at or below zero removes only the requested lineId", async () => {
    const { result } = await renderHydratedCart();
    act(() => {
      result.current.addItem(cartInput());
      result.current.addItem(cartInput({ productId: "P2", name: "Producto 2" }));
    });
    const [, lineB] = result.current.items;
    act(() => result.current.updateQty(result.current.items[0].lineId, 0));
    expect(result.current.items).toEqual([lineB]);
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

  it("PR3-CART-14 sync updates metadata on the matching product line", async () => {
    const { result } = await renderHydratedCart();
    act(() => {
      result.current.addItem(cartInput({ qty: 2 }));
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
    expect(result.current.items).toEqual([
      expect.objectContaining({
        productId: "P1",
        qty: 2,
        name: "Producto actualizado",
        unitPrice: 1200,
        image: "/new.webp",
        stockQty: 2,
      }),
    ]);
  });

  it("PR3-CART-15 sync preserves lineId and qty", async () => {
    const { result } = await renderHydratedCart();
    act(() => void result.current.addItem(cartInput({ qty: 2 })));
    const line = result.current.items[0];
    act(() => {
      result.current.syncStockFromProducts([
        { id: "P1", name: "Nuevo", price: 2, stock_status: "in_stock", stock_qty: 9 },
      ]);
    });
    expect(result.current.items[0]).toMatchObject({ lineId: line.lineId, productId: "P1", qty: 2 });
  });

  it("PR3-CART-17 sync to zero stock keeps the line and requested qty visible", async () => {
    const { result } = await renderHydratedCart();
    act(() => {
      result.current.addItem(cartInput({ qty: 2 }));
      result.current.syncStockFromProducts([
        { id: "P1", name: "Nuevo", price: 2, stock_status: "out_of_stock", stock_qty: 0 },
      ]);
    });
    expect(result.current.items).toEqual([
      expect.objectContaining({ productId: "P1", qty: 2, stockStatus: "out_of_stock" }),
    ]);
  });

  it("PR3-CART-18 getTotal sums every product line", async () => {
    const { result } = await renderHydratedCart();
    act(() => {
      result.current.addItem(cartInput({ qty: 2, unitPrice: 1000 }));
      result.current.addItem(
        cartInput({ productId: "P2", name: "Producto 2", qty: 3, unitPrice: 1000 }),
      );
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

  it("PR3-STORAGE-MERGE-01 consolidates repeated P1 rows and sums qty", () => {
    const migrated = sanitizeStoredCartItems([legacyItem({ qty: 1 }), legacyItem({ qty: 2 })]);
    expect(migrated).toEqual([
      expect.objectContaining({ productId: "P1", qty: 3, lineId: expect.any(String) }),
    ]);
  });

  it("PR3-STORAGE-MERGE-02 keeps P1 and P2 in distinct lines", () => {
    const migrated = sanitizeStoredCartItems([
      legacyItem({ productId: "P1" }),
      legacyItem({ productId: "P2" }),
    ]);
    expect(migrated.map((item) => item.productId)).toEqual(["P1", "P2"]);
    expect(migrated[0].lineId).not.toBe(migrated[1].lineId);
  });

  it("PR3-STORAGE-MERGE-03 keeps variants with shared metadata but distinct IDs separate", () => {
    const migrated = sanitizeStoredCartItems([
      legacyItem({ productId: "P1", name: "Arito corazÃ³n", image: "/shared.webp" }),
      legacyItem({ productId: "P2", name: "Arito corazÃ³n", image: "/shared.webp" }),
    ]);
    expect(migrated).toHaveLength(2);
    expect(migrated.map((item) => item.productId)).toEqual(["P1", "P2"]);
  });

  it("PR3-STORAGE-MERGE-04 preserves the first valid unique lineId from merged rows", () => {
    const migrated = sanitizeStoredCartItems([
      legacyItem({ lineId: "   ", qty: 1 }),
      legacyItem({ lineId: "stable-line", qty: 2 }),
      legacyItem({ lineId: "later-line", qty: 1 }),
    ]);
    expect(migrated).toEqual([
      expect.objectContaining({ lineId: "stable-line", productId: "P1", qty: 4 }),
    ]);
  });

  it("PR3-STORAGE-MERGE-05 generates a lineId when merged rows have none", () => {
    const migrated = sanitizeStoredCartItems([
      legacyItem({ lineId: undefined }),
      legacyItem({ lineId: "   " }),
    ]);
    expect(migrated).toHaveLength(1);
    expect(migrated[0].lineId).toEqual(expect.any(String));
    expect(migrated[0].lineId.length).toBeGreaterThan(0);
  });

  it("PR3-STORAGE-MERGE-06 persists consolidation so duplicates do not reappear", async () => {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify([
        legacyItem({ lineId: "line-a", qty: 1 }),
        legacyItem({ lineId: "line-b", qty: 2 }),
      ]),
    );
    const first = await renderHydratedCart();
    expect(first.result.current.items).toEqual([
      expect.objectContaining({ lineId: "line-a", productId: "P1", qty: 3 }),
    ]);
    await waitFor(() =>
      expect(JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "[]")).toHaveLength(1),
    );
    first.unmount();

    const second = await renderHydratedCart();
    expect(second.result.current.items).toEqual([
      expect.objectContaining({ lineId: "line-a", productId: "P1", qty: 3 }),
    ]);
  });

  it("PR3-STORAGE-MERGE-07 caps merged qty at the generic limit", () => {
    const migrated = sanitizeStoredCartItems([
      legacyItem({ qty: 30, stockQty: null }),
      legacyItem({ qty: 30, stockQty: null }),
    ]);
    expect(migrated).toEqual([expect.objectContaining({ productId: "P1", qty: 50 })]);
  });

  it("PR3-STORAGE-MERGE-08 preserves first-row metadata and allows catalog sync", async () => {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify([
        legacyItem({ lineId: "stable-line", qty: 1 }),
        legacyItem({ name: "Metadata descartada", unitPrice: 9999, qty: 2 }),
      ]),
    );
    const { result } = await renderHydratedCart();
    expect(result.current.items[0]).toMatchObject({
      lineId: "stable-line",
      productId: "P1",
      qty: 3,
      name: "Producto legacy",
      unitPrice: 2500,
      image: "/legacy.webp",
      stockStatus: "in_stock",
      stockQty: 5,
    });

    act(() =>
      result.current.syncStockFromProducts([
        {
          id: "P1",
          name: "Producto autoritativo",
          price: 3000,
          images: ["/authoritative.webp"],
          stock_status: "in_stock",
          stock_qty: 9,
        },
      ]),
    );
    expect(result.current.items[0]).toMatchObject({
      lineId: "stable-line",
      productId: "P1",
      qty: 3,
      name: "Producto autoritativo",
      unitPrice: 3000,
      image: "/authoritative.webp",
      stockQty: 9,
    });
  });

  it("invalid JSON does not break hydration", async () => {
    localStorage.setItem(STORAGE_KEY, "{invalid");
    const { result } = await renderHydratedCart();
    expect(result.current.items).toEqual([]);
  });

  it("migration preserves all cart business fields", () => {
    const migrated = sanitizeStoredCartItems([legacyItem()])[0];
    expect(migrated).toMatchObject(legacyItem());
  });

  it("pageshow and focus do not regenerate migrated lineIds", async () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify([legacyItem()]));
    const { result } = await renderHydratedCart();
    const migratedLineId = result.current.items[0].lineId;
    act(() => {
      window.dispatchEvent(new Event("pageshow"));
      window.dispatchEvent(new Event("focus"));
    });
    expect(result.current.items[0].lineId).toBe(migratedLineId);
  });

  it("duplicate lineIds across different products are repaired without dropping a product", () => {
    const migrated = sanitizeStoredCartItems([
      legacyItem({ productId: "P1", lineId: "duplicate" }),
      legacyItem({ productId: "P2", lineId: "duplicate" }),
    ]);
    expect(migrated).toHaveLength(2);
    expect(migrated[0].lineId).toBe("duplicate");
    expect(migrated[1].lineId).not.toBe("duplicate");
  });

  it("storage refresh consolidates repeated productIds", async () => {
    const { result } = await renderHydratedCart();
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify([
        legacyItem({ lineId: "line-a", qty: 1 }),
        legacyItem({ lineId: "line-b", qty: 2 }),
      ]),
    );
    act(() => window.dispatchEvent(new Event("pageshow")));
    await waitFor(() => expect(result.current.items).toHaveLength(1));
    expect(result.current.items[0]).toMatchObject({ lineId: "line-a", productId: "P1", qty: 3 });
  });
});

describe("checkout line operations", () => {
  beforeEach(() => localStorage.clear());

  it("PR3-CHECKOUT-03 removing one product line leaves the other product", async () => {
    const { result } = await renderHydratedCart();
    act(() => {
      result.current.addItem(cartInput());
      result.current.addItem(cartInput({ productId: "P2", name: "Producto 2" }));
    });
    const [lineA, lineB] = result.current.items;
    act(() => result.current.removeItem(lineA.lineId));
    expect(result.current.items).toEqual([lineB]);
  });

  it("PR3-CHECKOUT-04 modifying one product line leaves the other unchanged", async () => {
    const { result } = await renderHydratedCart();
    act(() => {
      result.current.addItem(cartInput());
      result.current.addItem(cartInput({ productId: "P2", name: "Producto 2" }));
    });
    const [lineA, lineB] = result.current.items;
    act(() => result.current.updateQty(lineA.lineId, 2));
    expect(result.current.items).toEqual([{ ...lineA, qty: 2 }, lineB]);
  });

  it("PR3-CHECKOUT-08 revalidation updates each product by productId", async () => {
    const { result } = await renderHydratedCart();
    act(() => {
      result.current.addItem(cartInput());
      result.current.addItem(cartInput({ productId: "P2", name: "Producto 2" }));
    });
    const lineIds = result.current.items.map((item) => item.lineId);
    act(() =>
      result.current.syncStockFromProducts([
        { id: "P1", name: "Autoritativo", price: 1500, stock_status: "in_stock", stock_qty: 7 },
        { id: "P2", name: "Autoritativo 2", price: 1600, stock_status: "in_stock", stock_qty: 8 },
      ]),
    );
    expect(result.current.items).toHaveLength(2);
    expect(result.current.items.map((item) => item.lineId)).toEqual(lineIds);
    expect(result.current.items.map((item) => [item.unitPrice, item.stockQty])).toEqual([
      [1500, 7],
      [1600, 8],
    ]);
  });
});
