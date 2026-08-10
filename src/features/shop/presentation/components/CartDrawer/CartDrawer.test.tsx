import { act, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CartItemInput } from "@/src/features/shop/domain/cartLines";
import { CartProvider, useCart } from "../../view-models/useCartStore";
import CartDrawer from "./CartDrawer";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
}));

vi.mock("@/src/core/presentation/hooks/useBodyScrollLock", () => ({
  useBodyScrollLock: vi.fn(),
}));

vi.mock("../../view-models/useProductsStore", () => ({
  useProductsStore: () => ({ products: [], loadProducts: vi.fn() }),
}));

const AddLine = ({ item }: { item: CartItemInput }) => {
  const { addItem } = useCart();
  return (
    <button type="button" onClick={() => addItem(item)}>
      {`Add ${item.productId}`}
    </button>
  );
};

const productLine = (overrides: Partial<CartItemInput> = {}): CartItemInput => ({
  productId: "P1",
  name: "Producto repetido",
  unitPrice: 1000,
  qty: 1,
  stockStatus: "in_stock",
  stockQty: 5,
  ...overrides,
});

const renderDrawer = async (items: CartItemInput[] = [productLine()]) => {
  const rendered = render(
    <CartProvider>
      {items.map((item) => (
        <AddLine key={item.productId} item={item} />
      ))}
      <CartDrawer open onClose={vi.fn()} />
    </CartProvider>,
  );
  await act(async () => {
    await new Promise((resolve) => window.setTimeout(resolve, 0));
  });
  return rendered;
};

describe("CartDrawer line identity", () => {
  beforeEach(() => localStorage.clear());

  it("PR3-DRAWER-01 renders one row after repeated adds of the same product", async () => {
    await renderDrawer();
    fireEvent.click(screen.getByText("Add P1"));
    fireEvent.click(screen.getByText("Add P1"));
    expect(screen.getAllByText("Producto repetido")).toHaveLength(1);
  });

  it("PR3-DRAWER-02 shows the total qty added to the unique product row", async () => {
    await renderDrawer();
    fireEvent.click(screen.getByText("Add P1"));
    fireEvent.click(screen.getByText("Add P1"));
    expect(screen.getByText("2")).toBeInTheDocument();
  });

  it("PR3-DRAWER-03 renders distinct variants as distinct rows without key collisions", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    await renderDrawer([productLine(), productLine({ productId: "P2" })]);
    fireEvent.click(screen.getByText("Add P1"));
    fireEvent.click(screen.getByText("Add P2"));
    expect(screen.getAllByText("Producto repetido")).toHaveLength(2);
    expect(consoleError.mock.calls.flat().join(" ")).not.toMatch(/same key|unique.*key/i);
    consoleError.mockRestore();
  });

  it("PR3-DRAWER-04 deleting one variant leaves the other one", async () => {
    await renderDrawer([
      productLine({ name: "Variante P1" }),
      productLine({ productId: "P2", name: "Variante P2" }),
    ]);
    fireEvent.click(screen.getByText("Add P1"));
    fireEvent.click(screen.getByText("Add P2"));
    fireEvent.click(screen.getAllByText("Eliminar")[0]);
    expect(screen.queryByText("Variante P1")).not.toBeInTheDocument();
    expect(screen.getByText("Variante P2")).toBeInTheDocument();
  });

  it("PR3-DRAWER-05 incrementing one variant changes only that line", async () => {
    await renderDrawer([productLine(), productLine({ productId: "P2" })]);
    fireEvent.click(screen.getByText("Add P1"));
    fireEvent.click(screen.getByText("Add P2"));
    fireEvent.click(screen.getAllByRole("button", { name: /Aumentar cantidad/ })[0]);
    expect(screen.getAllByText("2")).toHaveLength(1);
    expect(screen.getAllByText("1")).toHaveLength(1);
  });

  it("PR3-DRAWER-06 reducing from full stock releases capacity on the same line", async () => {
    await renderDrawer([productLine({ qty: 2, stockQty: 4 })]);
    fireEvent.click(screen.getByText("Add P1"));
    fireEvent.click(screen.getByText("Add P1"));
    expect(screen.getByRole("button", { name: /No hay m.s stock disponible/ })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: /Reducir cantidad/ }));
    expect(screen.getByRole("button", { name: /Aumentar cantidad/ })).toBeEnabled();
  });

  it("PR3-DRAWER-07 reducing qty1 keeps the line while Eliminar still removes it", async () => {
    await renderDrawer([productLine({ qty: 1 })]);
    fireEvent.click(screen.getByText("Add P1"));

    fireEvent.click(screen.getByRole("button", { name: /Reducir cantidad/ }));
    expect(screen.getByText("Producto repetido")).toBeInTheDocument();
    expect(screen.getByText("1")).toBeInTheDocument();

    fireEvent.click(screen.getByText("Eliminar"));
    expect(screen.queryByText("Producto repetido")).not.toBeInTheDocument();
  });
});
