import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import OrderSummaryMobile from "./OrderSummaryMobile";

describe("OrderSummaryMobile", () => {
  it("AUD5-CHECKOUT-02 renders the exact line image at the shared summary resource size", () => {
    render(
      <OrderSummaryMobile
        items={[{ lineId: "line-image", productId: "variant-2", name: "Variante azul", image: "/blue.webp", unitPrice: 100, qty: 1 }]}
        subtotal={100}
        discountAmount={0}
        shippingFee={0}
        finalTotal={100}
        hasDiscount={false}
        deliveryMethod="pickup"
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /Ver detalles de mi compra/ }));
    const image = screen.getByRole("img", { name: "Variante azul" });
    expect(image).toHaveAttribute("src", expect.stringContaining("blue.webp"));
    expect(image).toHaveAttribute("sizes", "64px");
  });
});
