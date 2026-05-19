"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import ProductImageGalleryZoom from "@/src/features/shop/presentation/components/ProductImageGalleryZoom/ProductImageGalleryZoom";
import { useCart } from "@/src/features/shop/presentation/view-models/useCartStore";
import type { Product } from "@/src/features/shop/domain/entities/Product";
import { useBodyScrollLock } from "@/src/core/presentation/hooks/useBodyScrollLock";
import {
  getStockLabel,
  isProductPurchasable,
} from "@/src/features/shop/infrastructure/data/productAdapter";

type QuickViewModalProps = {
  product: Product | null;
  open: boolean;
  onClose: () => void;
  onAddFeedback?: (params: { ok: boolean; name: string; image?: string }) => void;
};

export default function QuickViewModal({
  product,
  open,
  onClose,
  onAddFeedback,
}: QuickViewModalProps) {
  const { addItem, items } = useCart();
  const [qty, setQty] = useState(1);
  const [currentImageIndex, setCurrentImageIndex] = useState(0);
  const closeButtonRef = useRef<HTMLButtonElement | null>(null);

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
  const stockLabel = product ? getStockLabel(product) : "";
  const canBuy = product ? isProductPurchasable(product) : false;
  const isLastUnit = canBuy && product?.stock_qty === 1;
  const cartQty = product
    ? items.find((item) => item.productId === product.id)?.qty ?? 0
    : 0;
  const maxQty = typeof product?.stock_qty === "number" ? product.stock_qty : null;
  const remainingQty = maxQty === null ? null : Math.max(0, maxQty - cartQty);
  const canAddToCart = canBuy && (remainingQty === null || remainingQty > 0);
  const effectiveQty =
    remainingQty === null ? qty : Math.max(1, Math.min(qty, Math.max(remainingQty, 1)));
  const formattedPrice =
    typeof product?.price === "number" && Number.isFinite(product.price)
      ? new Intl.NumberFormat("es-AR", {
          style: "currency",
          currency: product?.currency || "ARS",
          maximumFractionDigits: 0,
        }).format(product.price)
      : "Consultar";

  useBodyScrollLock(open);

  useEffect(() => {
    if (!open) return;

    document.body.classList.add("shop-modal-open");
    return () => {
      document.body.classList.remove("shop-modal-open");
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;

    closeButtonRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, onClose]);

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
        className="fixed inset-0 z-[70] flex items-center justify-center bg-black/70 p-4 pb-[calc(1rem+var(--safe-area-bottom))] pt-[calc(1rem+var(--safe-area-top))] backdrop-blur-sm transition-opacity duration-300"
        role="dialog"
        aria-modal="true"
        aria-label={`Vista rápida de ${product.name}`}
        onClick={onClose}
      >
        <div
          className="relative h-auto w-full max-w-4xl max-h-[90vh] overflow-hidden rounded-lg border border-[var(--brand-violet-700)]/40 bg-[var(--brand-cream)] text-[var(--brand-violet-950)] shadow-[0_20px_80px_rgba(0,0,0,0.45)]"
          onClick={(e) => e.stopPropagation()}
        >
          <button
            ref={closeButtonRef}
            className="absolute right-0 top-0 z-50 flex h-10 w-10 items-center justify-center bg-[var(--brand-violet-900)] text-2xl leading-none text-[var(--brand-gold-300)] shadow-md transition hover:brightness-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand-gold-300)]"
            onClick={onClose}
            aria-label="Cerrar vista rápida"
          >
            <span aria-hidden="true" className="-mt-0.5">
              ×
            </span>
          </button>

          <div className="grid max-h-[90vh] overflow-y-auto overflow-x-hidden overscroll-contain sm:grid-cols-2 scrollbar-hide">
            <div className="flex h-auto flex-col bg-[var(--brand-cream)] p-3 sm:p-4">
              <ProductImageGalleryZoom
                key={`${product.id}-${open ? "open" : "closed"}`}
                images={images}
                productName={product.name}
                currentImageIndex={safeIndex}
                onImageIndexChange={setCurrentImageIndex}
                theme="quickview"
                thumbnailsDesktopOnly={false}
                alwaysColumn
              />
            </div>

          <div className="flex flex-col gap-4 p-5 sm:p-7 text-[var(--brand-violet-950)]">
            <div>
              <h3 className="text-3xl font-bold uppercase leading-tight tracking-[0.02em] text-[var(--brand-violet-950)] sm:text-[2.2rem]">
                {product.name}
              </h3>
              <p className="mt-4 border-b border-[var(--brand-violet-700)]/25 pb-4 text-3xl font-extrabold text-[var(--brand-violet-950)] sm:text-[3rem]">
                {formattedPrice}
              </p>
              <div
                className={`mt-4 inline-flex w-fit items-center gap-2 rounded-full border px-3.5 py-2 text-sm font-bold leading-none shadow-sm ${
                  !canBuy
                    ? "border-rose-300 bg-rose-100 text-rose-700"
                    : isLastUnit
                    ? "border-amber-300 bg-gradient-to-r from-amber-100 to-rose-100 text-[var(--brand-violet-950)] shadow-[0_8px_18px_rgba(180,83,9,0.16)]"
                    : product.stock_status === "preorder"
                    ? "border-amber-200 bg-amber-50 text-amber-700"
                    : "border-emerald-200 bg-emerald-50 text-emerald-700"
                }`}
              >
                {isLastUnit && (
                  <span className="h-2 w-2 rounded-full bg-amber-500 shadow-[0_0_10px_rgba(245,158,11,0.85)]" />
                )}
                {stockLabel}
              </div>
            </div>

            {shortDescription.length > 0 && (
              <div className="whitespace-pre-line text-sm leading-relaxed text-[var(--brand-violet-950)]/90">
                {shortDescription}
              </div>
            )}

            <div className="mt-auto flex flex-col gap-4 pt-4">
              <div className="flex flex-nowrap items-center justify-between gap-3 w-full">
                <div className="inline-flex items-center rounded-2xl bg-[var(--brand-violet-950)]/10 border border-[var(--brand-violet-950)]/15 p-1 backdrop-blur-sm">
                  <button
                    type="button"
                    onClick={() => setQty((prev) => Math.max(1, prev - 1))}
                    disabled={effectiveQty <= 1 || !canAddToCart}
                    className="h-11 w-11 grid place-items-center rounded-xl bg-[var(--brand-violet-950)] text-white shadow-sm border border-[var(--brand-violet-800)] hover:bg-[var(--brand-violet-800)] active:scale-[0.98] transition disabled:cursor-not-allowed disabled:opacity-50"
                    aria-label="Reducir cantidad"
                  >
                    −
                  </button>
                  <div
                    className="text-[var(--brand-violet-950)] font-semibold text-center min-w-[3rem]"
                    aria-live="polite"
                    aria-label={`Cantidad seleccionada: ${effectiveQty}`}
                  >
                    {effectiveQty}
                  </div>
                  <button
                    type="button"
                    onClick={() =>
                      setQty((prev) =>
                        remainingQty === null ? prev + 1 : Math.min(remainingQty, prev + 1)
                      )
                    }
                    disabled={!canAddToCart || (remainingQty !== null && effectiveQty >= remainingQty)}
                    className="h-11 w-11 grid place-items-center rounded-xl bg-[var(--brand-violet-950)] text-white shadow-sm border border-[var(--brand-violet-800)] hover:bg-[var(--brand-violet-800)] active:scale-[0.98] transition disabled:cursor-not-allowed disabled:opacity-50"
                    aria-label="Aumentar cantidad"
                  >
                    +
                  </button>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    if (!canAddToCart) return;
                    try {
                      const result = addItem({
                        productId: product.id,
                        name: product.name,
                        unitPrice: product.price,
                        qty: effectiveQty,
                        image: currentImage,
                        stockStatus: product.stock_status,
                        stockQty: product.stock_qty ?? null,
                      });
                      if (!result.ok) {
                        onAddFeedback?.({ ok: false, name: product.name });
                        return;
                      }
                      onAddFeedback?.({ ok: true, name: product.name, image: currentImage });
                    } catch {
                      onAddFeedback?.({ ok: false, name: product.name });
                    }
                    onClose();
                  }}
                  disabled={!canAddToCart}
                  className="w-full h-12 rounded-2xl bg-gradient-to-r from-amber-300 to-yellow-200 text-[var(--brand-violet-950)] font-semibold shadow-lg shadow-black/10 ring-1 ring-amber-400/50 hover:brightness-110 active:scale-[0.99] transition disabled:cursor-not-allowed disabled:from-slate-300 disabled:to-slate-400 disabled:text-slate-700 disabled:hover:brightness-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400 focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--brand-cream)]"
                >
                  {canAddToCart ? "Comprar" : canBuy ? "Máximo en carrito" : "Sin stock"}
                </button>
              </div>

              <div className="mt-5 rounded-2xl bg-[var(--brand-violet-950)]/5 border border-[var(--brand-violet-950)]/15 p-4 text-[var(--brand-violet-950)]/95">
                <ul className="space-y-2 text-sm">
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
                className="block w-full text-center py-3 px-4 rounded-2xl border border-[var(--brand-violet-950)]/30 bg-[var(--brand-violet-950)]/5 text-[var(--brand-violet-900)] font-semibold hover:bg-[var(--brand-violet-950)]/10 transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand-violet-900)]/70 focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--brand-cream)]"
              >
                Ver más detalles
              </Link>
            </div>
          </div>
        </div>
        </div>
      </div>

    </>
  );
}
