import { act, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Product } from "@/src/features/shop/domain/entities/Product";
import ProductDetail from "@/src/features/shop/presentation/pages/ProductDetail";
import { CartProvider, useCart } from "@/src/features/shop/presentation/view-models/useCartStore";
import QuickViewModal from "./QuickViewModal/QuickViewModal";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
}));

vi.mock("@/src/features/shop/presentation/view-models/useCartDrawer", () => ({
  useCartDrawer: () => ({ setOpen: vi.fn() }),
}));

vi.mock("@/src/features/shop/presentation/lib/cartToast", () => ({
  showCartAddedToast: vi.fn(),
}));

vi.mock("@/src/features/shop/presentation/lib/shopScrollRestoration", () => ({
  getLastShopListingHref: () => "/tienda",
  requestShopScrollRestoreForNextVisit: vi.fn(),
}));

vi.mock("@/src/core/presentation/hooks/useBodyScrollLock", () => ({
  useBodyScrollLock: vi.fn(),
}));

vi.mock(
  "@/src/features/shop/presentation/components/ProductImageGalleryZoom/ProductImageGalleryZoom",
  () => ({
    default: ({ images, productName }: { images: string[]; productName: string }) => (
      <div data-testid="active-gallery">{`${productName}|${images.join(",")}`}</div>
    ),
  }),
);

vi.mock(
  "@/src/features/shop/presentation/components/ProductVariantSelector/ProductVariantSelector",
  () => ({
    default: ({
      variants,
      selectedProductId,
      onSelectVariant,
    }: {
      variants: Product[];
      selectedProductId: string;
      onSelectVariant: (productId: string) => void;
    }) => (
      <div>
        {variants.map((variant) => (
          <button
            key={variant.id}
            type="button"
            aria-pressed={variant.id === selectedProductId}
            onClick={() => onSelectVariant(variant.id)}
          >
            {`select-${variant.id}`}
          </button>
        ))}
      </div>
    ),
  }),
);

const product = (overrides: Partial<Product> = {}): Product => ({
  id: "P1",
  name: "Producto Rojo",
  slug: "producto",
  departament: "PELUQUERIA",
  category: "Serums",
  price: 1000,
  currency: "ARS",
  images: ["/red.webp"],
  short_description: "Descripcion roja",
  description: "Descripcion roja completa.",
  stock_status: "in_stock",
  stock_qty: 5,
  group_id: "group-1",
  variant_name: "Rojo",
  ...overrides,
});

const redVariant = product();
const blueVariant = product({
  id: "P2",
  name: "Producto Azul",
  price: 2000,
  images: ["/blue.webp"],
  short_description: "Descripcion azul",
  description: "Descripcion azul completa.",
  stock_qty: 2,
  variant_name: "Azul",
});
const groupedProduct = { ...redVariant, variants: [redVariant, blueVariant] };

const CartProbe = () => {
  const { items } = useCart();
  return <output data-testid="cart-probe">{JSON.stringify(items)}</output>;
};

const storedLine = (lineId: string, qty: number, productId = "P1") => ({
  lineId,
  productId,
  name: "Stored product",
  unitPrice: 1000,
  qty,
  stockStatus: "in_stock",
  stockQty: 5,
});

const renderProductFlow = async (ui: React.ReactNode, storedItems: unknown[] = []) => {
  localStorage.setItem("es_sol_cart_v1", JSON.stringify(storedItems));
  const rendered = render(
    <CartProvider>
      <CartProbe />
      {ui}
    </CartProvider>,
  );
  await act(async () => {
    await new Promise((resolve) => window.setTimeout(resolve, 0));
  });
  return rendered;
};

const readCart = () => JSON.parse(screen.getByTestId("cart-probe").textContent ?? "[]") as Array<{
  lineId: string;
  productId: string;
  qty: number;
}>;

describe("ProductDetail aggregate cart demand", () => {
  beforeEach(() => localStorage.clear());

  it("PR3-PDP-01 sums qty1 plus qty2 for the current product", async () => {
    await renderProductFlow(
      <ProductDetail product={product({ stock_qty: 4 })} />,
      [storedLine("a", 1), storedLine("b", 2)],
    );
    expect(screen.getByRole("button", { name: "Aumentar cantidad" })).toBeDisabled();
    expect(screen.getByRole("button", { name: /Comprar ahora/ })).toBeEnabled();
  });

  it("PR3-PDP-02 derives remainingQty from aggregate demand", async () => {
    await renderProductFlow(
      <ProductDetail product={product({ stock_qty: 3 })} />,
      [storedLine("a", 1), storedLine("b", 2)],
    );
    expect(screen.getByRole("button", { name: /máximo disponible/i })).toBeDisabled();
  });

  it("PR3-PDP-03 adding the active product increments its existing line", async () => {
    await renderProductFlow(<ProductDetail product={product()} />, [storedLine("a", 1)]);
    fireEvent.click(screen.getByRole("button", { name: /Comprar ahora/ }));
    expect(readCart()).toEqual([expect.objectContaining({ lineId: "a", productId: "P1", qty: 2 })]);
  });

  it("PR3-PDP-04 selected variant adds its real productId in a distinct line", async () => {
    await renderProductFlow(<ProductDetail product={groupedProduct} />, [storedLine("a", 1)]);
    fireEvent.click(screen.getByText("select-P2"));
    fireEvent.click(screen.getByRole("button", { name: /Comprar ahora/ }));
    expect(readCart().map((item) => item.productId)).toEqual(["P1", "P2"]);
    expect(readCart()[0].lineId).not.toBe(readCart()[1].lineId);
  });

  it("PR3-PDP-05 selected variant changes price, stock, image and purchase identity", async () => {
    await renderProductFlow(<ProductDetail product={groupedProduct} />);
    fireEvent.click(screen.getByText("select-P2"));
    expect(screen.getByRole("heading", { name: "Producto Azul" })).toBeInTheDocument();
    expect(screen.getByText(/2\.000/)).toBeInTheDocument();
    expect(screen.getByTestId("active-gallery")).toHaveTextContent("Producto Azul|/blue.webp");
    expect(screen.getByText(/2 disponibles/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Comprar ahora/ }));
    expect(readCart()[0].productId).toBe("P2");
  });
});

describe("QuickView aggregate cart demand", () => {
  beforeEach(() => localStorage.clear());

  const quickView = (activeProduct: Product) => (
    <QuickViewModal product={activeProduct} open onClose={vi.fn()} />
  );

  it("PR3-QV-01 sums every cart line for the active product", async () => {
    await renderProductFlow(quickView(product({ stock_qty: 4 })), [
      storedLine("a", 1),
      storedLine("b", 2),
    ]);
    expect(screen.getByRole("button", { name: "Aumentar cantidad" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Comprar" })).toBeEnabled();
  });

  it("PR3-QV-02 respects remaining aggregate stock", async () => {
    await renderProductFlow(quickView(product({ stock_qty: 3 })), [
      storedLine("a", 1),
      storedLine("b", 2),
    ]);
    expect(screen.getByRole("button", { name: /carrito/i })).toBeDisabled();
  });

  it("PR3-QV-03 adding the active product increments its existing line", async () => {
    await renderProductFlow(quickView(product()), [storedLine("a", 1)]);
    fireEvent.click(screen.getByRole("button", { name: "Comprar" }));
    expect(readCart()).toEqual([expect.objectContaining({ lineId: "a", productId: "P1", qty: 2 })]);
  });

  it("PR3-QV-04 selected variant adds the correct productId in its own line", async () => {
    await renderProductFlow(quickView(groupedProduct), [storedLine("a", 1)]);
    fireEvent.click(screen.getByText("select-P2"));
    fireEvent.click(screen.getByRole("button", { name: "Comprar" }));
    expect(readCart().map((item) => item.productId)).toEqual(["P1", "P2"]);
    expect(readCart()[0].lineId).not.toBe(readCart()[1].lineId);
  });
});
