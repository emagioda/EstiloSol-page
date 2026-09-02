import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import OrderSummaryDesktop from "./OrderSummaryDesktop";

describe("OrderSummaryDesktop", () => {
  it("AUD5-CHECKOUT-01 renders the exact selected line image at summary size", () => {
    render(
      <OrderSummaryDesktop
        items={[{ lineId: "line-image", productId: "variant-2", name: "Variante azul", image: "/blue.webp", unitPrice: 100, qty: 1 }]}
        subtotal={100}
        discountAmount={0}
        shippingFee={0}
        finalTotal={100}
        hasDiscount={false}
        deliveryMethod="pickup"
      />,
    );

    const image = screen.getByRole("img", { name: "Variante azul" });
    expect(image).toHaveAttribute("src", expect.stringContaining("blue.webp"));
    expect(image).toHaveAttribute("sizes", "64px");
  });

  it("PR3-CHECKOUT-01 shows one normal product line with its consolidated qty", () => {
    render(
      <OrderSummaryDesktop
        items={[
          { lineId: "line-a", productId: "p1", name: "Linea consolidada", unitPrice: 100, qty: 3 },
        ]}
        subtotal={300}
        discountAmount={0}
        shippingFee={0}
        finalTotal={300}
        hasDiscount={false}
        deliveryMethod="pickup"
      />,
    );
    expect(screen.getAllByText("Linea consolidada")).toHaveLength(1);
    expect(screen.getByText("Cantidad: 3")).toBeInTheDocument();
  });

  it("PR3-CHECKOUT-02 uses distinct variant lineIds without React key collisions", () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    render(
      <OrderSummaryDesktop
        items={[
          { lineId: "line-a", productId: "p1", name: "Variante dorada", unitPrice: 100, qty: 1 },
          { lineId: "line-b", productId: "p2", name: "Variante plateada", unitPrice: 100, qty: 1 },
        ]}
        subtotal={200}
        discountAmount={0}
        shippingFee={0}
        finalTotal={200}
        hasDiscount={false}
        deliveryMethod="pickup"
      />,
    );
    expect(consoleError.mock.calls.flat().join(" ")).not.toMatch(/same key|unique.*key/i);
    consoleError.mockRestore();
  });

  it("marks invalid stock products without hiding them", () => {
    render(
      <OrderSummaryDesktop
        items={[
          {
            lineId: "line-p1-out",
            productId: "p1",
            name: "Serum Reparador",
            unitPrice: 12000,
            qty: 1,
            stockStatus: "out_of_stock",
            stockQty: 0,
          },
        ]}
        subtotal={12000}
        discountAmount={1200}
        shippingFee={4000}
        finalTotal={14800}
        hasDiscount
        deliveryMethod="delivery"
        invalidProducts={[{ productId: "p1", name: "Serum Reparador", reason: "out_of_stock" }]}
      />
    );

    expect(screen.getByText("Serum Reparador")).toBeInTheDocument();
    expect(screen.getByText(/Sin stock/i)).toBeInTheDocument();
    expect(screen.getByText(/Quitalo del carrito/i)).toBeInTheDocument();
  });

  it("marks products with changed prices", () => {
    render(
      <OrderSummaryDesktop
        items={[
          {
            lineId: "line-p1-price",
            productId: "p1",
            name: "Serum Reparador",
            unitPrice: 15000,
            qty: 1,
            stockStatus: "in_stock",
            stockQty: 2,
          },
        ]}
        subtotal={15000}
        discountAmount={1500}
        shippingFee={0}
        finalTotal={13500}
        hasDiscount
        deliveryMethod="pickup"
        invalidProducts={[
          {
            productId: "p1",
            name: "Serum Reparador",
            reason: "price_changed",
            requestedPrice: 12000,
            currentPrice: 15000,
          },
        ]}
      />
    );

    expect(screen.getByText("Serum Reparador")).toBeInTheDocument();
    expect(screen.getByText(/El precio cambio/i)).toBeInTheDocument();
  });

  it("shows shipping separately from product discount", () => {
    render(
      <OrderSummaryDesktop
        items={[]}
        subtotal={20000}
        discountAmount={2000}
        shippingFee={4000}
        finalTotal={22000}
        hasDiscount
        deliveryMethod="delivery"
      />
    );

    expect(screen.getByText("Subtotal productos")).toBeInTheDocument();
    expect(screen.getAllByText(/2\.000/).length).toBeGreaterThan(0);
    expect(screen.getByText("Envío a domicilio")).toBeInTheDocument();
    expect(screen.getByText(/4\.000/)).toBeInTheDocument();
    expect(screen.getAllByText(/22\.000/).length).toBeGreaterThan(0);
  });

  it("does not show a fulfillment line when the cart is empty", () => {
    render(
      <OrderSummaryDesktop
        items={[]}
        subtotal={0}
        discountAmount={0}
        shippingFee={0}
        finalTotal={0}
        hasDiscount={false}
        deliveryMethod="delivery"
      />
    );

    expect(screen.getByText("Subtotal productos")).toBeInTheDocument();
    expect(screen.queryByText(/domicilio/i)).not.toBeInTheDocument();
    expect(screen.queryByText("Gratis")).not.toBeInTheDocument();
  });
});
