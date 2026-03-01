import { renderHook, act } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { CartProvider, useCart } from "@/src/features/shop/presentation/view-models/useCartStore";

const wrapper = ({ children }: { children: React.ReactNode }) => <CartProvider>{children}</CartProvider>;

describe("cart flow", () => {
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
});
