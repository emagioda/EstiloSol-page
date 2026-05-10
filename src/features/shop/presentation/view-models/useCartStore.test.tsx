import { renderHook, act } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { CartProvider, useCart } from "@/src/features/shop/presentation/view-models/useCartStore";

const wrapper = ({ children }: { children: React.ReactNode }) => <CartProvider>{children}</CartProvider>;

describe("cart flow", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it("adds, updates and clears items", () => {
    const { result } = renderHook(() => useCart(), { wrapper });

    act(() => {
      result.current.addItem({
        productId: "p1",
        name: "Producto 1",
        unitPrice: 1000,
        qty: 1,
      });
    });

    expect(result.current.items).toHaveLength(1);
    expect(result.current.items[0].qty).toBe(1);

    act(() => {
      result.current.updateQty("p1", 3);
    });

    expect(result.current.items[0].qty).toBe(3);

    act(() => {
      result.current.clear();
    });

    expect(result.current.items).toHaveLength(0);
  });

  it("does not add products without stock", () => {
    const { result } = renderHook(() => useCart(), { wrapper });

    let addResult: ReturnType<typeof result.current.addItem> | undefined;
    act(() => {
      addResult = result.current.addItem({
        productId: "p1",
        name: "Producto 1",
        unitPrice: 1000,
        qty: 1,
        stockStatus: "out_of_stock",
        stockQty: 0,
      });
    });

    expect(addResult).toMatchObject({ ok: false, reason: "out_of_stock" });
    expect(result.current.items).toHaveLength(0);
  });

  it("caps added and updated quantities by available stock", () => {
    const { result } = renderHook(() => useCart(), { wrapper });

    act(() => {
      result.current.addItem({
        productId: "p1",
        name: "Producto 1",
        unitPrice: 1000,
        qty: 4,
        stockStatus: "in_stock",
        stockQty: 3,
      });
    });

    expect(result.current.items[0].qty).toBe(3);

    act(() => {
      result.current.updateQty("p1", 8);
    });

    expect(result.current.items[0].qty).toBe(3);
  });

  it("allows uncontrolled stock up to the generic safety limit", () => {
    const { result } = renderHook(() => useCart(), { wrapper });

    act(() => {
      result.current.addItem({
        productId: "p1",
        name: "Producto 1",
        unitPrice: 1000,
        qty: 99,
        stockStatus: "in_stock",
        stockQty: null,
      });
    });

    expect(result.current.items[0].qty).toBe(50);
  });

  it("syncs stored cart quantities with current product stock", () => {
    const { result } = renderHook(() => useCart(), { wrapper });

    act(() => {
      result.current.addItem({
        productId: "p1",
        name: "Producto viejo",
        unitPrice: 1000,
        qty: 5,
        stockStatus: "in_stock",
        stockQty: 5,
      });
    });

    act(() => {
      result.current.syncStockFromProducts([
        {
          id: "p1",
          name: "Producto actualizado",
          price: 1200,
          stock_status: "in_stock",
          stock_qty: 2,
        },
      ]);
    });

    expect(result.current.items[0]).toMatchObject({
      name: "Producto actualizado",
      unitPrice: 1200,
      qty: 2,
      stockQty: 2,
    });
  });
});
