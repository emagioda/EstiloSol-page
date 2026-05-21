import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import OrderSummaryDesktop from "./OrderSummaryDesktop";

describe("OrderSummaryDesktop", () => {
  it("marks invalid stock products without hiding them", () => {
    render(
      <OrderSummaryDesktop
        items={[
          {
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
