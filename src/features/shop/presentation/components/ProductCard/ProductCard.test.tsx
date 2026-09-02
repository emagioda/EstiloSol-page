import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { Product } from "@/src/features/shop/domain/entities/Product";
import ProductCard from "./ProductCard";

const product: Product = {
  id: "p1",
  name: "Producto principal",
  slug: "producto-principal",
  price: 1000,
  departament: "PELUQUERIA",
  stock_status: "in_stock",
  stock_qty: 2,
  images: ["/main.webp"],
  variants: [
    {
      id: "p1",
      name: "Producto principal",
      price: 1000,
      departament: "PELUQUERIA",
      images: ["/main.webp"],
    },
    {
      id: "p2",
      name: "Producto alternativo",
      price: 1200,
      departament: "PELUQUERIA",
      images: ["/alternate.webp"],
    },
  ],
};

describe("ProductCard image projection", () => {
  it("AUD5-CARD-01 preserves 3:4 space and downloads one representative variant image", () => {
    render(<ProductCard product={product} priority />);

    const image = screen.getByRole("img", { name: "Producto principal" });
    expect(image.parentElement).toHaveClass("aspect-[3/4]");
    expect(image).toHaveClass("object-cover");
    expect(image).not.toHaveClass("p-2");
    expect(screen.getAllByRole("img")).toHaveLength(1);
  });

  it("AUD5-CARD-02 replaces a broken image without collapsing the card", () => {
    render(<ProductCard product={product} />);

    fireEvent.error(screen.getByRole("img", { name: "Producto principal" }));
    expect(screen.getByRole("img", { name: "Producto principal" })).toBeInTheDocument();
    fireEvent.error(screen.getByRole("img", { name: "Producto principal" }));
    expect(
      screen.getByRole("img", { name: "Producto principal: imagen no disponible" }),
    ).toBeInTheDocument();
  });

  it("AUD5-CARD-03 eagerly loads an above-fold peer without assigning high priority", () => {
    render(<ProductCard product={product} eager />);

    const image = screen.getByRole("img", { name: "Producto principal" });
    expect(image).toHaveAttribute("loading", "eager");
    expect(image).toHaveAttribute("fetchpriority", "auto");
  });
});
