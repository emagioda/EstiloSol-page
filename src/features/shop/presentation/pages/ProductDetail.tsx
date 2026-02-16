"use client";

import Image from "next/image";
import { useMemo, useState } from "react";
import { useCart } from "@/src/features/shop/presentation/view-models/useCartStore";
import { useCartDrawer } from "@/src/features/shop/presentation/view-models/useCartDrawer";
import type { Product } from "@/src/features/shop/presentation/view-models/useProductsStore";

type Props = {
  product: Product;
};

const formatMoney = (value: number) =>
  new Intl.NumberFormat("es-AR", {
    style: "currency",
    currency: "ARS",
  }).format(value);

const isValidPrice = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value);

export default function ProductDetail({ product }: Props) {
  const images = useMemo(
    () =>
      Array.isArray(product.images)
        ? product.images.filter((image): image is string => typeof image === "string" && image.trim().length > 0)
        : [],
    [product.images]
  );
  const [currentImageIndex, setCurrentImageIndex] = useState(0);
  const [qty, setQty] = useState(1);
  const { addItem } = useCart();
  const { setOpen: setCartOpen } = useCartDrawer();

  const currentImage = images[currentImageIndex] ?? images[0] ?? null;
  const safeUnitPrice = isValidPrice(product.price) ? product.price : 0;
  const displayPrice = isValidPrice(product.price) ? formatMoney(product.price) : "Consultar";

  const handleAddToCart = () => {
    addItem({
      productId: product.id,
      name: product.name,
      unitPrice: safeUnitPrice,
      qty,
      image: images[0] ?? "",
    });
    setCartOpen(true);
  };

  return (
    <main className="mx-auto w-full max-w-6xl px-4 py-8 text-[var(--brand-cream)]">
      <section className="grid gap-8 rounded-3xl border border-[var(--brand-gold-400)]/20 bg-[rgba(58,31,95,0.35)] p-5 shadow-[0_20px_50px_rgba(18,8,35,0.35)] lg:grid-cols-2 lg:p-8">
        <div>
          <div className="relative aspect-square w-full overflow-hidden rounded-2xl border border-[var(--brand-gold-400)]/30 bg-[rgba(255,255,255,0.03)]">
            {currentImage ? (
              <Image
                src={currentImage}
                alt={product.name}
                fill
                priority
                className="object-cover"
                sizes="(max-width:1024px) 100vw, 50vw"
              />
            ) : (
              <div className="flex h-full w-full items-center justify-center text-xs uppercase text-[var(--brand-gold-300)]">
                Sin imagen
              </div>
            )}
          </div>

          {images.length > 1 && (
            <div className="mt-4 grid grid-cols-5 gap-2">
              {images.map((image, index) => (
                <button
                  key={`${image}-${index}`}
                  type="button"
                  onClick={() => setCurrentImageIndex(index)}
                  className={`relative aspect-square overflow-hidden rounded-lg border transition ${
                    index === currentImageIndex
                      ? "border-[var(--brand-gold-400)]"
                      : "border-white/10"
                  }`}
                  aria-label={`Ver imagen ${index + 1} de ${product.name}`}
                >
                  <Image
                    src={image}
                    alt={`${product.name} miniatura ${index + 1}`}
                    fill
                    className="object-cover"
                    sizes="120px"
                  />
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="flex flex-col gap-4">
          <p className="text-xs uppercase tracking-[0.22em] text-[var(--brand-gold-300)]">
            {product.category || "General"}
          </p>
          <h1 className="text-3xl font-semibold leading-tight">{product.name}</h1>
          <p className="text-2xl font-semibold text-[var(--brand-cream)]">
            {displayPrice}
          </p>

          <p className="text-sm leading-relaxed text-[var(--brand-cream)]/85">
            {product.description || "Sin descripción disponible por el momento."}
          </p>

          <dl className="grid gap-2 rounded-2xl border border-white/10 bg-black/10 p-4 text-sm">
            <div className="flex items-center justify-between gap-4">
              <dt className="text-[var(--brand-gold-300)]">SKU</dt>
              <dd className="font-medium">{product.id || "N/A"}</dd>
            </div>
            <div className="flex items-center justify-between gap-4">
              <dt className="text-[var(--brand-gold-300)]">Slug</dt>
              <dd className="font-medium">{product.slug || "(fallback por ID)"}</dd>
            </div>
          </dl>

          <div className="mt-2 flex flex-wrap items-center gap-3">
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={() => setQty((prev) => Math.max(1, prev - 1))}
                className="h-12 w-12 rounded-lg border border-[#ff6767] text-[#ff6767] transition active:scale-95"
                aria-label="Reducir"
              >
                -
              </button>
              <div
                className="flex h-12 w-16 items-center justify-center rounded-lg border border-white/20 text-center font-semibold"
                aria-live="polite"
                aria-label={`Cantidad seleccionada: ${qty}`}
              >
                {qty}
              </div>
              <button
                type="button"
                onClick={() => setQty((prev) => prev + 1)}
                className="h-12 w-12 rounded-lg border border-[#6dc96d] text-[#4cae4c] transition active:scale-95"
                aria-label="Aumentar"
              >
                +
              </button>
            </div>
            <button
              type="button"
              onClick={handleAddToCart}
              className="ml-auto h-12 min-w-[170px] rounded-xl border border-[var(--brand-gold-400)] bg-[var(--brand-violet-800)] px-6 text-sm font-semibold text-[var(--brand-cream)] shadow-[0_10px_25px_rgba(26,10,48,0.35)] transition hover:bg-[var(--brand-violet-700)] active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand-gold-300)]"
            >
              Comprar
            </button>
          </div>
        </div>
      </section>
    </main>
  );
}
