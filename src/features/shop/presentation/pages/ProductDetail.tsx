"use client";

import { useEffect, useMemo, useState } from "react";
import ProductImageGalleryZoom from "@/src/features/shop/presentation/components/ProductImageGalleryZoom/ProductImageGalleryZoom";
import { useCart } from "@/src/features/shop/presentation/view-models/useCartStore";
import type { Product } from "@/src/features/shop/domain/entities/Product";

type Props = {
  product: Product;
};

type CartNotice = {
  type: "success" | "error";
  message: string;
};

const formatMoney = (value: number) =>
  new Intl.NumberFormat("es-AR", {
    style: "currency",
    currency: "ARS",
  }).format(value);

const isValidPrice = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value);

const LONG_DESCRIPTION_PLACEHOLDER = "Sin descripción detallada por el momento.";

const getShortDescription = (shortDescription?: string, description?: string) => {
  if (typeof shortDescription === "string" && shortDescription.trim().length > 0) {
    return shortDescription.trim();
  }

  if (typeof description !== "string") {
    return "Sin descripción disponible por el momento.";
  }

  const normalizedDescription = description.trim();
  if (!normalizedDescription) {
    return "Sin descripción disponible por el momento.";
  }

  const firstSentence = normalizedDescription.match(/^.*?[.!?](?:\s|$)/)?.[0]?.trim();
  if (firstSentence && firstSentence.length <= 140) {
    return firstSentence;
  }

  const clipped = normalizedDescription.slice(0, 140).trim();
  return clipped.length < normalizedDescription.length ? `${clipped}…` : clipped;
};

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
  const [cartNotice, setCartNotice] = useState<CartNotice | null>(null);
  const { addItem } = useCart();

  const safeUnitPrice = isValidPrice(product.price) ? product.price : 0;
  const displayPrice = isValidPrice(product.price) ? formatMoney(product.price) : "Consultar";
  const shortDescription = useMemo(
    () => getShortDescription(product.short_description, product.description),
    [product.short_description, product.description]
  );
  const longDescription =
    typeof product.description === "string" && product.description.trim().length > 0
      ? product.description
      : LONG_DESCRIPTION_PLACEHOLDER;
  const isKit = String(product.product_type ?? "").trim().toLowerCase() === "kit";
  const includesText =
    typeof product.includes === "string" && product.includes.trim().length > 0
      ? product.includes
      : null;

  useEffect(() => {
    if (!cartNotice) return;
    const timer = window.setTimeout(() => setCartNotice(null), 2400);
    return () => window.clearTimeout(timer);
  }, [cartNotice]);

  const handleAddToCart = () => {
    addItem({
      productId: product.id,
      name: product.name,
      unitPrice: safeUnitPrice,
      qty,
      image: images[0] ?? "",
    });
    setQty(1);
    setCartNotice({
      type: "success",
      message: `${product.name} se agregó al carrito.`,
    });
  };

  return (
    <main className="mx-auto w-full max-w-6xl px-4 py-8 text-[var(--brand-cream)]">
      <section className="grid gap-8 rounded-3xl border border-[var(--brand-gold-400)]/20 bg-[rgba(58,31,95,0.35)] p-5 shadow-[0_20px_50px_rgba(18,8,35,0.35)] lg:grid-cols-2 lg:p-8">
        <div>
          <ProductImageGalleryZoom
            images={images}
            productName={product.name}
            currentImageIndex={currentImageIndex}
            onImageIndexChange={setCurrentImageIndex}
            theme="pdp"
          />
        </div>

        <div className="flex flex-col gap-4">
          <p className="text-xs uppercase tracking-[0.22em] text-[var(--brand-gold-300)]">
            {product.category || "General"}
          </p>
          <h1 className="text-3xl font-semibold leading-tight">{product.name}</h1>
          <p className="text-2xl font-semibold text-[var(--brand-cream)]">
            {displayPrice}
          </p>

          <p className="text-sm leading-relaxed text-[var(--brand-cream)]/85">{shortDescription}</p>

          <div className="mt-3 flex flex-nowrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setQty((prev) => Math.max(1, prev - 1))}
                disabled={qty <= 1}
                className="h-10 w-10 rounded-lg border border-[#ff6767] text-[#ff6767] transition active:scale-95 disabled:cursor-not-allowed disabled:border-[#ff6767]/40 disabled:text-[#ff6767]/45 disabled:active:scale-100 sm:h-12 sm:w-12"
                aria-label="Reducir"
              >
                -
              </button>
              <div
                className="flex h-10 w-12 items-center justify-center rounded-lg border border-white/20 text-center font-semibold sm:h-12 sm:w-16"
                aria-live="polite"
                aria-label={`Cantidad seleccionada: ${qty}`}
              >
                {qty}
              </div>
              <button
                type="button"
                onClick={() => setQty((prev) => prev + 1)}
                className="h-10 w-10 rounded-lg border border-[#6dc96d] text-[#4cae4c] transition active:scale-95 sm:h-12 sm:w-12"
                aria-label="Aumentar"
              >
                +
              </button>
            </div>
            <button
              type="button"
              onClick={handleAddToCart}
              className="h-10 flex-1 rounded-xl border border-[var(--brand-gold-400)] bg-[var(--brand-violet-800)] px-4 text-sm font-semibold text-[var(--brand-cream)] shadow-[0_10px_25px_rgba(26,10,48,0.35)] transition hover:bg-[var(--brand-violet-700)] active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand-gold-300)] sm:h-12 sm:min-w-[170px] sm:flex-none sm:px-6"
            >
              Comprar
            </button>
          </div>
        </div>
      </section>

      {cartNotice && (
        <div className="pointer-events-none fixed inset-x-0 top-24 z-[70] flex justify-center px-4">
          <div
            className={`rounded-xl border px-4 py-2.5 text-sm font-medium shadow-[0_12px_30px_rgba(10,4,20,0.35)] backdrop-blur ${
              cartNotice.type === "success"
                ? "border-emerald-200/60 bg-emerald-600/85 text-white"
                : "border-rose-200/60 bg-rose-600/85 text-white"
            }`}
            role="status"
            aria-live="polite"
          >
            {cartNotice.message}
          </div>
        </div>
      )}

      <section className="mt-8 rounded-3xl border border-[var(--brand-gold-400)]/20 bg-[rgba(58,31,95,0.25)] p-5 shadow-[0_14px_32px_rgba(18,8,35,0.28)] lg:p-8">
        <h2 className="text-lg font-semibold text-[var(--brand-gold-300)]">Descripción</h2>
        <p className="mt-3 whitespace-pre-line text-sm leading-relaxed text-[var(--brand-cream)]/85">
          {longDescription}
        </p>

        {isKit && includesText && (
          <div className="mt-6 border-t border-[var(--brand-gold-400)]/20 pt-5">
            <h3 className="text-base font-semibold text-[var(--brand-gold-300)]">Incluye</h3>
            <p className="mt-2 whitespace-pre-line text-sm leading-relaxed text-[var(--brand-cream)]/85">
              {includesText}
            </p>
          </div>
        )}
      </section>
    </main>
  );
}
