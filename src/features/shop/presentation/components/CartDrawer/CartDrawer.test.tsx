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
      Add test line
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

const renderDrawer = async (item = productLine()) => {
  const rendered = render(
    <CartProvider>
      <AddLine item={item} />
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

  it("PR3-DRAWER-01 renders both lines with the same productId", async () => {
    await renderDrawer();
    fireEvent.click(screen.getByText("Add test line"));
    fireEvent.click(screen.getByText("Add test line"));
    expect(screen.getAllByText("Producto repetido")).toHaveLength(2);
  });

  it("PR3-DRAWER-02 does not emit a React key collision for duplicate products", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    await renderDrawer();
    fireEvent.click(screen.getByText("Add test line"));
    fireEvent.click(screen.getByText("Add test line"));
    expect(consoleError.mock.calls.flat().join(" ")).not.toMatch(/same key|unique.*key/i);
    consoleError.mockRestore();
  });

  it("PR3-DRAWER-03 deleting the first line leaves the second one", async () => {
    await renderDrawer();
    fireEvent.click(screen.getByText("Add test line"));
    fireEvent.click(screen.getByText("Add test line"));
    fireEvent.click(screen.getAllByText("Eliminar")[0]);
    expect(screen.getAllByText("Producto repetido")).toHaveLength(1);
  });

  it("PR3-DRAWER-04 incrementing the first line changes only that line", async () => {
    await renderDrawer();
    fireEvent.click(screen.getByText("Add test line"));
    fireEvent.click(screen.getByText("Add test line"));
    fireEvent.click(screen.getAllByRole("button", { name: /Aumentar cantidad/ })[0]);
    expect(screen.getAllByText("2")).toHaveLength(1);
    expect(screen.getAllByText("1")).toHaveLength(1);
  });

  it("PR3-DRAWER-05 disables increment when aggregate stock is full", async () => {
    await renderDrawer(productLine({ qty: 2, stockQty: 4 }));
    fireEvent.click(screen.getByText("Add test line"));
    fireEvent.click(screen.getByText("Add test line"));
    screen.getAllByRole("button", { name: /No hay m.s stock disponible/ }).forEach((button) => {
      expect(button).toBeDisabled();
    });
  });

  it("PR3-DRAWER-06 reducing one line releases capacity for the other", async () => {
    await renderDrawer(productLine({ qty: 2, stockQty: 4 }));
    fireEvent.click(screen.getByText("Add test line"));
    fireEvent.click(screen.getByText("Add test line"));
    fireEvent.click(screen.getAllByRole("button", { name: /Reducir cantidad/ })[0]);
    expect(screen.getAllByRole("button", { name: /Aumentar cantidad/ })[1]).toBeEnabled();
  });

  it("PR3-DRAWER-07 reducing qty1 keeps the line while Eliminar still removes it", async () => {
    await renderDrawer(productLine({ qty: 1 }));
    fireEvent.click(screen.getByText("Add test line"));

    fireEvent.click(screen.getByRole("button", { name: /Reducir cantidad/ }));
    expect(screen.getByText("Producto repetido")).toBeInTheDocument();
    expect(screen.getByText("1")).toBeInTheDocument();

    fireEvent.click(screen.getByText("Eliminar"));
    expect(screen.queryByText("Producto repetido")).not.toBeInTheDocument();
  });
});
