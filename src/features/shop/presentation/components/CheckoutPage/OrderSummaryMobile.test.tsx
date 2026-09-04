import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import OrderSummaryMobile from "./OrderSummaryMobile";

describe("OrderSummaryMobile", () => {
  const defaultProps = {
    items: [{ lineId: "line-image", productId: "variant-2", name: "Variante azul", image: "/blue.webp", unitPrice: 100, qty: 1 }],
    subtotal: 100,
    discountAmount: 0,
    shippingFee: 0,
    finalTotal: 100,
    hasDiscount: false,
    deliveryMethod: "pickup" as const,
  };

  it("renders a compact single-line trigger with the current dynamic total", () => {
    const { rerender } = render(<OrderSummaryMobile {...defaultProps} finalTotal={3900} />);

    const trigger = screen.getByRole("button", { name: /Ver detalles de mi compra/i });
    const stickySurface = trigger.closest("section");
    expect(trigger).toHaveClass("whitespace-nowrap");
    expect(stickySurface).toHaveClass(
      "top-[var(--header-height-mobile)]",
      "bg-[var(--brand-violet-950)]",
      "pb-3",
      "pt-3",
    );
    expect(within(trigger).getByText("Ver detalles de mi compra")).toBeInTheDocument();
    expect(within(trigger).getByText("$ 3.900")).toBeInTheDocument();
    expect(within(trigger).queryByText(/Resumen de compra/i)).not.toBeInTheDocument();
    expect(trigger.children).toHaveLength(2);

    rerender(<OrderSummaryMobile {...defaultProps} finalTotal={4750} />);
    expect(within(trigger).getByText("$ 4.750")).toBeInTheDocument();
  });

  it("keeps the details action wired to the expandable summary", () => {
    render(<OrderSummaryMobile {...defaultProps} />);

    const trigger = screen.getByRole("button", { name: /Ver detalles de mi compra/i });
    const panel = document.getElementById("mobile-order-summary-panel");
    expect(trigger).toHaveAttribute("aria-expanded", "false");
    expect(panel).toHaveAttribute("aria-hidden", "true");

    fireEvent.click(trigger);

    expect(trigger).toHaveAttribute("aria-expanded", "true");
    expect(panel).toHaveAttribute("aria-hidden", "false");
  });

  it("AUD5-CHECKOUT-02 renders the exact line image at the shared summary resource size", () => {
    render(<OrderSummaryMobile {...defaultProps} />);

    fireEvent.click(screen.getByRole("button", { name: /Ver detalles de mi compra/ }));
    const image = screen.getByRole("img", { name: "Variante azul" });
    expect(image).toHaveAttribute("src", expect.stringContaining("blue.webp"));
    expect(image).toHaveAttribute("sizes", "64px");
  });
});
