"use client";

import { useEffect, useMemo, useState } from "react";
import { useProductsStore } from "../view-models/useProductsStore";
import ProductImageGalleryZoom from "@/src/features/shop/presentation/components/ProductImageGalleryZoom/ProductImageGalleryZoom";
import Breadcrumbs from "@/src/features/shop/presentation/components/Breadcrumbs";
import FormattedDescription from "@/src/features/shop/presentation/components/FormattedDescription";
import { useCart } from "@/src/features/shop/presentation/view-models/useCartStore";
import type { Product } from "@/src/features/shop/domain/entities/Product";

type Props = {
  product: Product;
  // slug is passed by the route; used to re-find product after a reload
  slug?: string;
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

export default function ProductDetail({ product, slug }: Props) {
  // keep a local copy that we can update when the catalog arrives from the
  // sheet. this ensures a manual reload on a detail page will fetch the
  // latest catalog and refresh the displayed item.
  const [currentProduct, setCurrentProduct] = useState<Product>(product);

  // load full catalog and sync; slug param is optional fallback if we
  // don't have the original product prop (e.g. client-side navigation).
  const { products, status } = useProductsStore({
    initialProducts: product ? [product] : []
  });

  useEffect(() => {
    if (status === "success" && products.length > 0) {
      const idMatch = (p: Product) => p.id === product.id;
      const slugMatch = slug
        ? (p: Product) => p.slug === slug
        : () => false;
      const updated = products.find((p) => idMatch(p) || slugMatch(p));
      if (updated) setCurrentProduct(updated);
    }
  }, [status, products, product.id, slug]);
  const images = useMemo(
    () =>
      Array.isArray(currentProduct.images)
        ? currentProduct.images.filter((image): image is string => typeof image === "string" && image.trim().length > 0)
        : [],
    [currentProduct.images]
  );
  const [currentImageIndex, setCurrentImageIndex] = useState(0);
  const [qty, setQty] = useState(1);
  const [cartNotice, setCartNotice] = useState<CartNotice | null>(null);
  const { addItem } = useCart();

  const safeUnitPrice = isValidPrice(currentProduct.price) ? currentProduct.price : 0;
  const displayPrice = isValidPrice(currentProduct.price) ? formatMoney(currentProduct.price) : "Consultar";
  const shortDescription = useMemo(
    () => getShortDescription(currentProduct.short_description, currentProduct.description),
    [currentProduct.short_description, currentProduct.description]
  );
  const longDescription =
    typeof currentProduct.description === "string" && currentProduct.description.trim().length > 0
      ? currentProduct.description
      : LONG_DESCRIPTION_PLACEHOLDER;

  useEffect(() => {
    if (!cartNotice) return;
    const timer = window.setTimeout(() => setCartNotice(null), 2400);
    return () => window.clearTimeout(timer);
  }, [cartNotice]);

  const handleAddToCart = () => {
    addItem({
      productId: currentProduct.id,
      name: currentProduct.name,
      unitPrice: safeUnitPrice,
      qty,
      image: images[0] ?? "",
    });
    setQty(1);
    setCartNotice({
      type: "success",
      message: `${currentProduct.name} se agregó al carrito.`,
    });
  };

  return (
    <main className="mx-auto w-full max-w-6xl px-4 py-8 text-[var(--brand-cream)]">
      <Breadcrumbs
        items={[
          { label: "Tienda", href: "/tienda" },
          { label: currentProduct.departament || "Productos", href: `/tienda?departament=${currentProduct.departament}` },
          { label: currentProduct.name },
        ]}
      />
      <section className="grid gap-8 rounded-3xl border border-[var(--brand-gold-400)]/20 bg-[rgba(58,31,95,0.35)] p-5 shadow-[0_20px_50px_rgba(18,8,35,0.35)] lg:grid-cols-2 lg:p-8">
        <div>
          <ProductImageGalleryZoom
            images={images}
            productName={currentProduct.name}
            currentImageIndex={currentImageIndex}
            onImageIndexChange={setCurrentImageIndex}
            theme="pdp"
          />
        </div>

        <div className="flex flex-col gap-5">
          <p className="text-xs uppercase tracking-[0.22em] text-[var(--brand-gold-300)]">
            {currentProduct.category || "General"}
          </p>
          <h1 className="text-3xl font-semibold leading-tight">{currentProduct.name}</h1>
          <p className="text-3xl font-extrabold text-yellow-100">
            {displayPrice}
          </p>

          <p className="text-sm leading-relaxed text-[var(--brand-cream)]/85">{shortDescription}</p>

          <div className="mt-3 flex flex-nowrap items-center justify-between gap-3">
            <div className="inline-flex items-center rounded-2xl bg-white/10 border border-white/15 p-1 backdrop-blur-sm">
              <button
                type="button"
                onClick={() => setQty((prev) => Math.max(1, prev - 1))}
                disabled={qty <= 1}
                className="h-11 w-11 grid place-items-center rounded-xl bg-white/85 text-violet-900 shadow-sm border border-white/60 hover:bg-white active:scale-[0.98] transition disabled:cursor-not-allowed disabled:opacity-50"
                aria-label="Reducir cantidad"
              >
                −
              </button>
              <div
                className="text-white font-semibold text-center min-w-[3rem]"
                aria-live="polite"
                aria-label={`Cantidad seleccionada: ${qty}`}
              >
                {qty}
              </div>
              <button
                type="button"
                onClick={() => setQty((prev) => prev + 1)}
                className="h-11 w-11 grid place-items-center rounded-xl bg-white/85 text-violet-900 shadow-sm border border-white/60 hover:bg-white active:scale-[0.98] transition"
                aria-label="Aumentar cantidad"
              >
                +
              </button>
            </div>
            <button
              type="button"
              onClick={handleAddToCart}
              className="w-full h-12 rounded-2xl bg-gradient-to-r from-yellow-200 to-amber-100 text-violet-950 font-semibold shadow-lg shadow-black/20 ring-1 ring-white/30 hover:brightness-105 active:scale-[0.99] transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand-gold-300)]"
            >
              Comprar
            </button>
          </div>

          {/* info panel below buy button */}
          <div className="mt-5 rounded-2xl bg-white/10 border border-white/15 p-4 text-white/90">
            <ul className="space-y-2 text-sm">
              <li className="flex items-center gap-2">
                <span className="text-lg">✔</span>
                <span>Stock disponible</span>
              </li>
              <li className="flex items-center gap-2">
                <span className="text-lg">🚚</span>
                <span>Entrega en Rosario</span>
              </li>
              <li className="flex items-center gap-2">
                <span className="text-lg">💳</span>
                <span>Pago por transferencia o efectivo</span>
              </li>
            </ul>
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

      {currentProduct.product_type === "KIT" && Array.isArray(currentProduct.includes) && currentProduct.includes.length > 0 && (
        <section className="mt-8 rounded-3xl border border-[var(--brand-gold-400)]/20 bg-[rgba(58,31,95,0.25)] p-5 shadow-[0_14px_32px_rgba(18,8,35,0.28)] lg:p-8">
          <h2 className="text-lg font-semibold text-[var(--brand-gold-300)] mb-4">INCLUYE</h2>
          <div className="h-px bg-gradient-to-r from-[var(--brand-gold-400)]/40 via-[var(--brand-gold-300)]/20 to-transparent mb-6" />
          <FormattedDescription description={currentProduct.includes.join("\n")} />
        </section>
      )}

      <section className="mt-8 rounded-3xl border border-[var(--brand-gold-400)]/20 bg-[rgba(58,31,95,0.25)] p-5 shadow-[0_14px_32px_rgba(18,8,35,0.28)] lg:p-8">
        <h2 className="text-lg font-semibold text-[var(--brand-gold-300)] mb-4">DESCRIPCIÓN</h2>
        <div className="h-px bg-gradient-to-r from-[var(--brand-gold-400)]/40 via-[var(--brand-gold-300)]/20 to-transparent mb-6" />
        <FormattedDescription description={longDescription} />
      </section>
    </main>
  );
}
