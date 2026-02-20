"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import ProductImageGalleryZoom from "@/src/features/shop/presentation/components/ProductImageGalleryZoom/ProductImageGalleryZoom";
import { useCart } from "@/src/features/shop/presentation/view-models/useCartStore";
import type { Product } from "@/src/features/shop/domain/entities/Product";

type QuickViewModalProps = {
  product: Product | null;
  open: boolean;
  onClose: () => void;
  onAddFeedback?: (params: { ok: boolean; name: string }) => void;
};

export default function QuickViewModal({
  product,
  open,
  onClose,
  onAddFeedback,
}: QuickViewModalProps) {
  const { addItem } = useCart();
  const [qty, setQty] = useState(1);
  const [currentImageIndex, setCurrentImageIndex] = useState(0);

  // Reset image index when product changes
  useEffect(() => {
    const timer = window.setTimeout(() => setCurrentImageIndex(0), 0);
    return () => window.clearTimeout(timer);
  }, [product]);

  const images = useMemo(
    () =>
      (product?.images ?? []).filter((image): image is string => {
        if (typeof image !== "string") return false;
        const trimmed = image.trim();
        if (!trimmed) return false;
        if (trimmed.startsWith("/")) return true;

        try {
          const { protocol } = new URL(trimmed);
          return protocol === "http:" || protocol === "https:";
        } catch {
          return false;
        }
      }),
    [product?.images]
  );

  const shortDescription = (product?.short_description ?? "").trim();
  const formattedPrice =
    typeof product?.price === "number" && Number.isFinite(product.price)
      ? new Intl.NumberFormat("es-AR", {
          style: "currency",
          currency: product?.currency || "ARS",
          maximumFractionDigits: 0,
        }).format(product.price)
      : "Consultar";

  // Lock body scroll when open
  useEffect(() => {
    if (!open) return;

    const originalOverflow = document.body.style.overflow;
    // Prevent background scrolling
    document.body.style.overflow = "hidden";

    return () => {
      document.body.style.overflow = originalOverflow;
    };
  }, [open]);

  // Reset local state when modal closes
  useEffect(() => {
    if (!open) {
      const timer = setTimeout(() => {
        setQty(1);
      }, 0);
      return () => clearTimeout(timer);
    }
  }, [open]);

  if (!open || !product) return null;

  const safeIndex = images.length
    ? Math.min(Math.max(currentImageIndex, 0), images.length - 1)
    : 0;
  const currentImage = images[safeIndex] || "";

  return (
    <>
      <div
        className="fixed inset-0 z-[70] flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm transition-opacity duration-300"
        role="dialog"
        aria-modal="true"
        aria-label={`Vista rápida de ${product.name}`}
        onClick={onClose} // Click outside closes modal
      >
        <div
          // MODIFICACIÓN CLAVE: max-h-[90vh], overflow-y-auto, overscroll-contain
          className="relative grid h-auto w-full max-w-4xl max-h-[90vh] overflow-y-auto overflow-x-hidden overscroll-contain rounded-lg border border-[var(--brand-violet-700)]/40 bg-[var(--brand-cream)] text-[var(--brand-violet-950)] shadow-[0_20px_80px_rgba(0,0,0,0.45)] sm:grid-cols-2 scrollbar-hide"
          // clicks inside the card should *not* close the modal
          onClick={(e) => e.stopPropagation()}
        >
          {/* Botón Cerrar */}
          <button
            className="absolute right-0 top-0 z-50 flex h-10 w-10 items-center justify-center bg-[#3b3f45] text-2xl leading-none text-[#dce548] shadow-md transition hover:brightness-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#dce548]"
            onClick={onClose}
            aria-label="Cerrar vista rápida"
          >
            <span aria-hidden="true" className="-mt-0.5">
              ×
            </span>
          </button>

          {/* Columna Izquierda: Imágenes */}
          <div className="flex h-auto flex-col bg-[#f7f7f7] p-3 sm:p-4">
            <ProductImageGalleryZoom
              images={images}
              productName={product.name}
              currentImageIndex={safeIndex}
              onImageIndexChange={setCurrentImageIndex}
              theme="quickview"
              thumbnailsDesktopOnly
            />
          </div>

          {/* Columna Derecha: Información */}
          <div className="flex flex-col gap-4 p-5 sm:p-7">
            <div>
              <h3 className="text-3xl font-bold uppercase leading-tight tracking-[0.02em] sm:text-[2.2rem]">
                {product.name}
              </h3>
              <p className="mt-4 border-b border-[#ececec] pb-4 text-3xl font-extrabold text-amber-900 sm:text-[3rem]">
                {formattedPrice}
              </p>
            </div>

            {shortDescription.length > 0 && (
              <div className="whitespace-pre-line text-sm leading-relaxed text-[#555]">
                {shortDescription}
              </div>
            )}

            {/* Acciones de compra */}
            <div className="mt-auto flex flex-col gap-4 pt-4">
              <div className="flex flex-nowrap items-center justify-between gap-3 w-full">
                <div className="inline-flex items-center rounded-2xl bg-[var(--brand-violet-950)]/10 border border-[var(--brand-violet-950)]/15 p-1 backdrop-blur-sm">
                  <button
                    type="button"
                    onClick={() => setQty((prev) => Math.max(1, prev - 1))}
                    disabled={qty <= 1}
                    className="h-11 w-11 grid place-items-center rounded-xl bg-[var(--brand-violet-950)] text-white shadow-sm border border-[var(--brand-violet-800)] hover:bg-[var(--brand-violet-800)] active:scale-[0.98] transition disabled:cursor-not-allowed disabled:opacity-50"
                    aria-label="Reducir cantidad"
                  >
                    −
                  </button>
                  <div
                    className="text-[var(--brand-violet-950)] font-semibold text-center min-w-[3rem]"
                    aria-live="polite"
                    aria-label={`Cantidad seleccionada: ${qty}`}
                  >
                    {qty}
                  </div>
                  <button
                    type="button"
                    onClick={() => setQty((prev) => prev + 1)}
                    className="h-11 w-11 grid place-items-center rounded-xl bg-[var(--brand-violet-950)] text-white shadow-sm border border-[var(--brand-violet-800)] hover:bg-[var(--brand-violet-800)] active:scale-[0.98] transition"
                    aria-label="Aumentar cantidad"
                  >
                    +
                  </button>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    try {
                      addItem({
                        productId: product.id,
                        name: product.name,
                        unitPrice: product.price,
                        qty,
                        image: currentImage,
                      });
                      onAddFeedback?.({ ok: true, name: product.name });
                    } catch {
                      onAddFeedback?.({ ok: false, name: product.name });
                    }
                    onClose();
                  }}
                  className="w-full h-12 rounded-2xl bg-gradient-to-r from-amber-300 to-yellow-200 text-[var(--brand-violet-950)] font-semibold shadow-lg shadow-black/10 ring-1 ring-amber-400/50 hover:brightness-110 active:scale-[0.99] transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400"
                >
                  Comprar
                </button>
              </div>

              <div className="mt-5 rounded-2xl bg-[var(--brand-violet-950)]/5 border border-[var(--brand-violet-950)]/15 p-4 text-[var(--brand-violet-900)]">
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

              <Link
                href={`/tienda/producto/${product.slug || encodeURIComponent(String(product.id))}`}
                onClick={onClose}
                className="block w-full text-center py-3 px-4 rounded-2xl border border-[var(--brand-violet-950)]/30 bg-[var(--brand-violet-950)]/5 text-[var(--brand-violet-900)] font-semibold hover:bg-[var(--brand-violet-950)]/10 transition"
              >
                Ver más detalles
              </Link>
            </div>
          </div>
        </div>
      </div>

    </>
  );
}
