import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import OptimizedImageWithFallback from "./OptimizedImageWithFallback";

const REMOTE_IMAGE = "https://i.ibb.co/W4qQ40C8/P-111.webp";

const renderImage = (src: string | null = REMOTE_IMAGE) =>
  render(
    <div className="relative h-40 w-32">
      <OptimizedImageWithFallback
        src={src}
        alt="Producto 111"
        fill
        sizes="128px"
        loading="lazy"
        fetchPriority="auto"
      />
    </div>,
  );

describe("OptimizedImageWithFallback", () => {
  it("HOTFIX-IMAGE-01 keeps the normal path optimized without starting a direct duplicate", () => {
    renderImage();

    const image = screen.getByRole("img", { name: "Producto 111" });
    expect(image).toHaveAttribute("src", expect.stringContaining("/_next/image"));
    expect(image).not.toHaveAttribute("src", REMOTE_IMAGE);
    expect(image).toHaveAttribute("sizes", "128px");
    expect(screen.getAllByRole("img")).toHaveLength(1);
  });

  it("HOTFIX-IMAGE-02 retries the same source directly after the optimized request errors", () => {
    renderImage();

    fireEvent.error(screen.getByRole("img", { name: "Producto 111" }));

    const directImage = screen.getByRole("img", { name: "Producto 111" });
    expect(directImage).toHaveAttribute("src", REMOTE_IMAGE);
    expect(directImage).not.toHaveAttribute("srcset");
    expect(directImage).toHaveAttribute("data-nimg", "fill");
    expect(directImage).toHaveAttribute("loading", "lazy");
    expect(directImage).toHaveStyle({ position: "absolute", height: "100%", width: "100%" });
  });

  it("HOTFIX-IMAGE-03 exposes the accessible fallback only after the direct retry also errors", () => {
    renderImage();

    fireEvent.error(screen.getByRole("img", { name: "Producto 111" }));
    fireEvent.error(screen.getByRole("img", { name: "Producto 111" }));

    expect(
      screen.getByRole("img", { name: "Producto 111: imagen no disponible" }),
    ).toHaveTextContent("Sin imagen");
  });

  it("HOTFIX-IMAGE-04 gives a different src a clean optimized loading state", () => {
    const rendered = renderImage();

    fireEvent.error(screen.getByRole("img", { name: "Producto 111" }));
    fireEvent.error(screen.getByRole("img", { name: "Producto 111" }));
    rendered.rerender(
      <div className="relative h-40 w-32">
        <OptimizedImageWithFallback
          src="https://res.cloudinary.com/demo/image/upload/alternate.webp"
          alt="Producto alternativo"
          fill
          sizes="128px"
        />
      </div>,
    );

    const nextImage = screen.getByRole("img", { name: "Producto alternativo" });
    expect(nextImage).toHaveAttribute("src", expect.stringContaining("/_next/image"));
    expect(nextImage).not.toHaveAttribute(
      "src",
      "https://res.cloudinary.com/demo/image/upload/alternate.webp",
    );
  });

  it("HOTFIX-IMAGE-05 exposes an accessible fallback for a missing source", () => {
    renderImage(null);

    expect(
      screen.getByRole("img", { name: "Producto 111: imagen no disponible" }),
    ).toBeInTheDocument();
  });
});
