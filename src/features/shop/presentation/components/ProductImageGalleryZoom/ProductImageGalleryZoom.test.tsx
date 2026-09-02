import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import ProductImageGalleryZoom from "./ProductImageGalleryZoom";

describe("ProductImageGalleryZoom", () => {
  it("AUD5-GALLERY-01 renders only the active main image plus responsive thumbnails", () => {
    render(
      <ProductImageGalleryZoom
        images={["/one.webp", "/two.webp", "/three.webp"]}
        productName="Producto"
        currentImageIndex={1}
        onImageIndexChange={vi.fn()}
        priority
      />,
    );

    const mainImage = screen.getByRole("img", { name: "Producto, imagen 2 de 3" });
    expect(mainImage).toHaveAttribute("sizes", expect.stringContaining("44vw"));
    expect(screen.getAllByRole("img")).toHaveLength(4);
    expect(screen.getByRole("button", { name: "Ver imagen 2 de 3" })).toHaveAttribute(
      "aria-current",
      "true",
    );
    expect(screen.getByRole("img", { name: "Producto miniatura 1" })).toHaveAttribute("sizes", "56px");
  });

  it("AUD5-GALLERY-02 keeps thumbnails selectable and exposes invalid-image fallback", () => {
    const onImageIndexChange = vi.fn();
    render(
      <ProductImageGalleryZoom
        images={["/broken.webp", "/two.webp"]}
        productName="Producto"
        currentImageIndex={0}
        onImageIndexChange={onImageIndexChange}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Ver imagen 2 de 2" }));
    expect(onImageIndexChange).toHaveBeenCalledWith(1);

    fireEvent.error(screen.getByRole("img", { name: "Producto, imagen 1 de 2" }));
    expect(screen.getByRole("img", { name: "Producto, imagen 1 de 2: imagen no disponible" })).toBeInTheDocument();
  });
});
