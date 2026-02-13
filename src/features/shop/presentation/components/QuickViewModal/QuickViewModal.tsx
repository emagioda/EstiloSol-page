"use client";

import Image from "next/image";
import { type MouseEvent, useEffect, useMemo, useState } from "react";
import Lightbox from "yet-another-react-lightbox";
import Zoom from "yet-another-react-lightbox/plugins/zoom";
import "yet-another-react-lightbox/styles.css";
import { useCart } from "@/src/features/shop/presentation/view-models/useCartStore";
import type { Product } from "@/src/features/shop/presentation/view-models/useProductsStore";

type QuickViewModalProps = {
  product: Product | null;
  open: boolean;
  onClose: () => void;
};

export default function QuickViewModal({
  product,
  open,
  onClose,
}: QuickViewModalProps) {
  const { addItem } = useCart();
  const [qty, setQty] = useState(1);
  const [currentImageIndex, setCurrentImageIndex] = useState(0);
  const [zoomPosition, setZoomPosition] = useState({ x: 50, y: 50 });
  const [isLightboxOpen, setIsLightboxOpen] = useState(false);

  // Reset image index when product changes
  useEffect(() => {
    const timer = window.setTimeout(() => setCurrentImageIndex(0), 0);
    return () => window.clearTimeout(timer);
  }, [product]);

  // Lock body scroll when open
  useEffect(() => {
    if (!open) return;

    const originalOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    return () => {
      document.body.style.overflow = originalOverflow;
    };
  }, [open]);

  // Reset local state when modal closes
  // CORRECCIÓN 1: Usamos setTimeout para evitar el error "set-state-in-effect"
  useEffect(() => {
    if (!open) {
      const timer = setTimeout(() => {
        setIsLightboxOpen(false);
        setQty(1);
      }, 0);
      return () => clearTimeout(timer);
    }
  }, [open]);

  const formatter = useMemo(
    () =>
      new Intl.NumberFormat("es-AR", {
        style: "currency",
        currency: product?.currency || "ARS",
        maximumFractionDigits: 0,
      }),
    [product?.currency]
  );

  if (!open || !product) return null;

  const images = product.images ?? [];
  const currentImage = images[currentImageIndex] || "";
  const hasMultipleImages = images.length > 1;

  const nextImage = (event: MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation();
    if (!images.length) return;
    setCurrentImageIndex((prev) => (prev + 1) % images.length);
  };

  const prevImage = (event: MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation();
    if (!images.length) return;
    setCurrentImageIndex((prev) => (prev - 1 + images.length) % images.length);
  };

  return (
    <div
      className="fixed inset-0 z-[70] flex items-center justify-center bg-black/70 p-4"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label={`Vista rápida de ${product.name}`}
    >
      <div
        className="relative grid h-auto w-full max-w-4xl overflow-hidden border border-[var(--brand-violet-700)]/40 bg-[var(--brand-cream)] text-[var(--brand-violet-950)] shadow-[0_20px_80px_rgba(0,0,0,0.45)] sm:grid-cols-2"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          className="absolute right-0 top-0 z-20 flex h-10 w-10 items-center justify-center bg-[#3b3f45] text-2xl leading-none text-[#dce548] transition hover:brightness-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#dce548]"
          onClick={onClose}
          aria-label="Cerrar vista rápida"
        >
          <span aria-hidden="true" className="-mt-0.5">×</span>
        </button>

        <div className="flex h-auto flex-col bg-[#f7f7f7] p-3 sm:p-4">
          <div
            className="group relative aspect-square w-full overflow-hidden rounded-md bg-[#f7f7f7]"
            onMouseMove={(event) => {
              const rect = event.currentTarget.getBoundingClientRect();
              const x = ((event.clientX - rect.left) / rect.width) * 100;
              const y = ((event.clientY - rect.top) / rect.height) * 100;
              setZoomPosition({ x, y });
            }}
            onMouseLeave={() => setZoomPosition({ x: 50, y: 50 })}
            onClick={() => setIsLightboxOpen(true)}
            role="button"
            tabIndex={0}
            aria-label="Ampliar imagen del producto"
            onKeyDown={(event) => {
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                setIsLightboxOpen(true);
              }
            }}
          >
            {currentImage ? (
              <Image
                src={currentImage}
                alt={product.name}
                fill
                className="object-cover transition-transform duration-300 ease-out md:group-hover:scale-110"
                style={{ transformOrigin: `${zoomPosition.x}% ${zoomPosition.y}%` }}
                sizes="(max-width:640px) 100vw, 50vw"
              />
            ) : (
              <div className="flex h-full w-full items-center justify-center text-xs uppercase text-[#777]">
                Sin imagen
              </div>
            )}

            {hasMultipleImages && (
              <>
                <button
                  type="button"
                  onClick={prevImage}
                  className="absolute left-2 top-1/2 z-10 -translate-y-1/2 rounded-full bg-black/30 p-2 text-white transition hover:bg-black/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/70"
                  aria-label="Imagen anterior"
                >
                  <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M15 18 9 12l6-6" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </button>
                <button
                  type="button"
                  onClick={nextImage}
                  className="absolute right-2 top-1/2 z-10 -translate-y-1/2 rounded-full bg-black/30 p-2 text-white transition hover:bg-black/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/70"
                  aria-label="Imagen siguiente"
                >
                  <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="m9 18 6-6-6-6" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </button>
              </>
            )}
          </div>

          {images.length > 0 && (
            <div className="mt-4 hidden h-auto gap-2 md:flex md:flex-wrap">
              {images.map((image, index) => (
                <button
                  key={`${image}-${index}`}
                  type="button"
                  onClick={() => setCurrentImageIndex(index)}
                  className="relative h-16 w-16 shrink-0 cursor-pointer overflow-hidden rounded-md transition-all"
                  style={{
                    border:
                      index === currentImageIndex
                        ? "2px solid var(--brand-violet-strong)"
                        : "2px solid transparent",
                    opacity: index === currentImageIndex ? 1 : 0.6,
                  }}
                  aria-label={`Ver imagen ${index + 1} de ${images.length}`}
                >
                  <Image
                    src={image}
                    alt={`${product.name} miniatura ${index + 1}`}
                    fill
                    className="object-cover"
                    sizes="64px"
                  />
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="flex flex-col gap-4 p-5 sm:p-7">
          <div>
            <h3 className="text-4xl font-bold uppercase leading-tight tracking-[0.02em] sm:text-[2.2rem]">
              {product.name}
            </h3>
            <p className="mt-4 border-b border-[#ececec] pb-4 text-5xl font-medium sm:text-[3rem]">
              {formatter.format(product.price)}
            </p>
          </div>

          <div className="mt-auto flex flex-col gap-3">
            <div className="flex w-fit items-center gap-2">
              <button
                type="button"
                className="flex h-10 w-10 items-center justify-center border border-[#ff6767] text-lg leading-none text-[#ff6767] transition active:scale-95 active:bg-[#ff6767] active:text-white"
                onClick={() => setQty((prev) => Math.max(1, prev - 1))}
                aria-label="Reducir cantidad"
              >
                -
              </button>
              <input
                type="number"
                min={1}
                inputMode="numeric"
                className="h-10 w-12 rounded-md border border-[#d9d9d9] text-center text-sm font-semibold"
                value={qty}
                onChange={(event) => {
                  const nextQty = Number(event.target.value);
                  if (Number.isNaN(nextQty)) return;
                  setQty(Math.max(1, Math.floor(nextQty)));
                }}
                onBlur={(event) => {
                  const nextQty = Number(event.target.value);
                  if (Number.isNaN(nextQty) || nextQty < 1) {
                    setQty(1);
                  }
                }}
                aria-label="Cantidad"
              />
              <button
                type="button"
                className="flex h-10 w-10 items-center justify-center border border-[#6dc96d] text-lg leading-none text-[#4cae4c] transition active:scale-95 active:bg-[#6dc96d] active:text-white"
                onClick={() => setQty((prev) => prev + 1)}
                aria-label="Aumentar cantidad"
              >
                +
              </button>

              <button
                type="button"
                onClick={() => {
                  addItem({
                    productId: product.id,
                    name: product.name,
                    unitPrice: product.price,
                    qty,
                    image: currentImage,
                  });
                  onClose();
                }}
                className="ml-1 h-10 border border-[var(--brand-gold-400)] bg-[var(--brand-violet-800)] px-5 text-xs font-bold uppercase tracking-[0.08em] text-[var(--brand-cream)] transition hover:bg-[var(--brand-violet-700)] active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand-gold-300)]"
              >
                Comprar
              </button>
            </div>

            <div className="space-y-1 border-t border-[#ececec] pt-4 text-sm leading-relaxed text-[#222]">
              <p>
                <span className="font-semibold">SKU:</span> {product.id.toUpperCase()}
              </p>
              {product.category && (
                <p>
                  <span className="font-semibold">Categorías:</span> {product.category}
                </p>
              )}
              {product.description && (
                <p>
                  <span className="font-semibold">Etiquetas:</span> {product.description}
                </p>
              )}
            </div>
          </div>
        </div>
      </div>
      <Lightbox
        open={isLightboxOpen}
        close={() => setIsLightboxOpen(false)}
        slides={images.map((src) => ({ src }))}
        plugins={[Zoom]}
        index={currentImageIndex}
        styles={{
          container: { zIndex: 9999 },
        }}
        render={{
          buttonPrev: images.length <= 1 ? () => null : undefined,
          buttonNext: images.length <= 1 ? () => null : undefined,
        }}
        on={{
          view: ({ index }) => setCurrentImageIndex(index),
        }}
      />
    </div>
  );
}
