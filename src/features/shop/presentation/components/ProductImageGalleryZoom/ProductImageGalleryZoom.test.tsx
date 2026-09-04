import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import ProductImageGalleryZoom from "./ProductImageGalleryZoom";

describe("ProductImageGalleryZoom", () => {
  beforeEach(() => {
    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      value: vi.fn().mockImplementation((query: string) => ({
        matches: false,
        media: query,
        onchange: null,
        addListener: vi.fn(),
        removeListener: vi.fn(),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        dispatchEvent: vi.fn(),
      })),
    });
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
      callback(0);
      return 1;
    });
    vi.stubGlobal("cancelAnimationFrame", vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("AUD5-GALLERY-01 renders only the active main image plus responsive thumbnails", () => {
    const { container } = render(
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
    expect(mainImage).toHaveClass("object-cover");
    expect(mainImage).not.toHaveClass("p-2");
    expect(screen.getAllByRole("img")).toHaveLength(4);
    expect(screen.getByRole("button", { name: "Ver imagen 2 de 3" })).toHaveAttribute(
      "aria-current",
      "true",
    );
    expect(screen.getByRole("img", { name: "Producto miniatura 1" })).toHaveAttribute("sizes", "56px");
    expect(container.querySelectorAll('[data-gallery-slide="active"]')).toHaveLength(1);
  });

  it("renders square, centered thumbnail crops without changing the selected border size", () => {
    render(
      <ProductImageGalleryZoom
        images={["/one.webp", "/two.webp"]}
        productName="Producto"
        currentImageIndex={0}
        onImageIndexChange={vi.fn()}
      />,
    );

    const selectedThumbnail = screen.getByRole("button", { name: "Ver imagen 1 de 2" });
    const unselectedThumbnail = screen.getByRole("button", { name: "Ver imagen 2 de 2" });
    const thumbnailImage = screen.getByRole("img", { name: "Producto miniatura 1" });

    expect(selectedThumbnail).toHaveStyle({ width: "3.5rem", height: "3.5rem" });
    expect(unselectedThumbnail).toHaveStyle({ width: "3.5rem", height: "3.5rem" });
    expect(selectedThumbnail.style.border).toMatch(/^2px solid/);
    expect(unselectedThumbnail.style.border).toMatch(/^2px solid/);
    expect(thumbnailImage).toHaveClass("object-cover");
    expect(thumbnailImage).not.toHaveClass("object-contain", "p-0.5");
  });

  it("moves left for next and right for previous, leaving only the active slide", () => {
    const { container } = render(
      <ProductImageGalleryZoom
        images={["/one.webp", "/two.webp", "/three.webp"]}
        productName="Producto"
        currentImageIndex={1}
        onImageIndexChange={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Imagen siguiente" }));
    const nextOutgoing = container.querySelector<HTMLElement>('[data-gallery-slide="outgoing"]');
    const nextIncoming = container.querySelector<HTMLElement>('[data-gallery-slide="incoming"]');
    expect(nextOutgoing).toHaveStyle({ transform: "translate3d(-100%, 0, 0)" });
    expect(container.querySelector("[data-carousel-direction='next']")).toBeInTheDocument();

    fireEvent.transitionEnd(nextIncoming!, { propertyName: "transform" });
    expect(container.querySelectorAll("[data-gallery-slide]")).toHaveLength(1);
    expect(container.querySelector('[data-gallery-slide="active"]')).toContainElement(
      screen.getByRole("img", { name: "Producto, imagen 3 de 3" }),
    );

    fireEvent.click(screen.getByRole("button", { name: "Imagen anterior" }));
    const previousOutgoing = container.querySelector<HTMLElement>(
      '[data-gallery-slide="outgoing"]',
    );
    expect(previousOutgoing).toHaveStyle({ transform: "translate3d(100%, 0, 0)" });
    expect(container.querySelector("[data-carousel-direction='previous']")).toBeInTheDocument();
  });

  it("derives thumbnail transition direction from the displayed index", () => {
    const { container } = render(
      <ProductImageGalleryZoom
        images={["/one.webp", "/two.webp", "/three.webp"]}
        productName="Producto"
        currentImageIndex={0}
        onImageIndexChange={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Ver imagen 3 de 3" }));
    expect(container.querySelector("[data-carousel-direction='next']")).toBeInTheDocument();
    fireEvent.transitionEnd(container.querySelector('[data-gallery-slide="incoming"]')!, {
      propertyName: "transform",
    });

    fireEvent.click(screen.getByRole("button", { name: "Ver imagen 1 de 3" }));
    expect(container.querySelector("[data-carousel-direction='previous']")).toBeInTheDocument();
  });

  it("replaces rapid transitions and settles on the final requested image", () => {
    const onImageIndexChange = vi.fn();
    const { container } = render(
      <ProductImageGalleryZoom
        images={["/one.webp", "/two.webp", "/three.webp"]}
        productName="Producto"
        currentImageIndex={0}
        onImageIndexChange={onImageIndexChange}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Imagen siguiente" }));
    fireEvent.click(screen.getByRole("button", { name: "Imagen siguiente" }));

    expect(onImageIndexChange).toHaveBeenNthCalledWith(1, 1);
    expect(onImageIndexChange).toHaveBeenNthCalledWith(2, 2);
    expect(container.querySelectorAll("[data-gallery-slide]")).toHaveLength(2);
    const incoming = container.querySelector('[data-gallery-slide="incoming"]');
    expect(incoming).toContainElement(
      screen.getByRole("img", { name: "Producto, imagen 3 de 3" }),
    );

    fireEvent.transitionEnd(incoming!, { propertyName: "transform" });
    expect(container.querySelectorAll("[data-gallery-slide]")).toHaveLength(1);
    expect(container.querySelector('[data-gallery-slide="active"]')).toContainElement(
      screen.getByRole("img", { name: "Producto, imagen 3 de 3" }),
    );
  });

  it("keeps swipe index changes aligned with the carousel direction", () => {
    const onImageIndexChange = vi.fn();
    const { container } = render(
      <ProductImageGalleryZoom
        images={["/one.webp", "/two.webp"]}
        productName="Producto"
        currentImageIndex={0}
        onImageIndexChange={onImageIndexChange}
      />,
    );
    const surface = screen.getByRole("button", { name: "Ampliar imagen del producto" });
    surface.setPointerCapture = vi.fn();
    surface.hasPointerCapture = vi.fn().mockReturnValue(true);
    surface.releasePointerCapture = vi.fn();

    fireEvent.pointerDown(surface, {
      pointerId: 1,
      pointerType: "touch",
      clientX: 100,
      clientY: 20,
    });
    fireEvent.pointerMove(surface, {
      pointerId: 1,
      pointerType: "touch",
      clientX: 45,
      clientY: 22,
    });

    expect(onImageIndexChange).toHaveBeenCalledWith(1);
    expect(container.querySelector("[data-carousel-direction='next']")).toBeInTheDocument();
  });

  it("does not animate the initial render, the active thumbnail, or a single image", () => {
    const onImageIndexChange = vi.fn();
    const firstRender = render(
      <ProductImageGalleryZoom
        images={["/one.webp", "/two.webp"]}
        productName="Producto"
        currentImageIndex={0}
        onImageIndexChange={onImageIndexChange}
      />,
    );

    expect(firstRender.container.querySelectorAll("[data-gallery-slide]")).toHaveLength(1);
    fireEvent.click(screen.getByRole("button", { name: "Ver imagen 1 de 2" }));
    expect(firstRender.container.querySelector('[data-gallery-slide="incoming"]')).toBeNull();
    firstRender.unmount();

    const singleRender = render(
      <ProductImageGalleryZoom
        images={["/only.webp"]}
        productName="Unico"
        currentImageIndex={0}
        onImageIndexChange={vi.fn()}
      />,
    );
    expect(screen.queryByRole("button", { name: "Imagen siguiente" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Imagen anterior" })).toBeNull();
    expect(singleRender.container.querySelector('[data-gallery-slide="incoming"]')).toBeNull();
  });

  it("switches immediately when reduced motion is preferred", () => {
    vi.mocked(window.matchMedia).mockImplementation((query: string) => ({
      matches: true,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }));
    const onImageIndexChange = vi.fn();
    const { container } = render(
      <ProductImageGalleryZoom
        images={["/one.webp", "/two.webp"]}
        productName="Producto"
        currentImageIndex={0}
        onImageIndexChange={onImageIndexChange}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Imagen siguiente" }));
    expect(onImageIndexChange).toHaveBeenCalledWith(1);
    expect(container.querySelector('[data-gallery-slide="incoming"]')).toBeNull();
    expect(screen.getByRole("img", { name: "Producto, imagen 2 de 2" })).toBeInTheDocument();
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

    fireEvent.error(screen.getByRole("img", { name: "Producto, imagen 1 de 2" }));
    expect(screen.getByRole("img", { name: "Producto, imagen 1 de 2" })).toBeInTheDocument();
    fireEvent.error(screen.getByRole("img", { name: "Producto, imagen 1 de 2" }));
    expect(screen.getByRole("img", { name: "Producto, imagen 1 de 2: imagen no disponible" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Ver imagen 2 de 2" }));
    expect(onImageIndexChange).toHaveBeenCalledWith(1);
  });

  it("HOTFIX-GALLERY-03 keeps the Quick View main image full-bleed", () => {
    render(
      <ProductImageGalleryZoom
        images={["/quick-view.webp"]}
        productName="Vista rapida"
        currentImageIndex={0}
        onImageIndexChange={vi.fn()}
        theme="quickview"
        alwaysColumn
      />,
    );

    const mainImage = screen.getByRole("img", { name: "Vista rapida, imagen 1 de 1" });
    expect(mainImage.closest('[role="button"]')).toHaveClass("aspect-[3/4]");
    expect(mainImage).toHaveClass("object-cover");
    expect(mainImage).not.toHaveClass("p-2");
  });
});
