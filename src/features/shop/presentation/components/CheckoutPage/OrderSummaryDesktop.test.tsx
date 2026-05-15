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
        finalTotal={10800}
        hasDiscount
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
        finalTotal={13500}
        hasDiscount
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
});
