"use client";

import Image from "next/image";
import { useMemo, useState } from "react";
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

  const thumb = product.images?.[0] || "";

  return (
    <div
      className="fixed inset-0 z-[70] flex items-center justify-center bg-black/70 p-4"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label={`Vista rápida de ${product.name}`}
    >
      <div
        className="relative grid w-full max-w-3xl gap-4 rounded-3xl border border-[var(--brand-gold-400)]/30 bg-[var(--brand-violet-strong)] p-4 text-[var(--brand-cream)] shadow-[0_20px_80px_rgba(6,3,14,0.7)] sm:grid-cols-2 sm:gap-6 sm:p-6"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          className="absolute right-3 top-3 flex h-9 w-9 items-center justify-center rounded-full border border-[var(--brand-gold-400)]/40 text-lg transition hover:brightness-125 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand-gold-300)]"
          onClick={onClose}
          aria-label="Cerrar vista rápida"
        >
          ×
        </button>

        <div className="relative h-64 overflow-hidden rounded-2xl border border-[var(--brand-gold-400)]/30 bg-black/20 sm:h-full sm:min-h-[320px]">
          {thumb ? (
            <Image
              src={thumb}
              alt={product.name}
              fill
              className="object-cover"
              sizes="(max-width:640px) 100vw, 50vw"
            />
          ) : (
            <div className="flex h-full w-full items-center justify-center text-xs uppercase text-[var(--brand-gold-300)]">
              Sin imagen
            </div>
          )}
        </div>

        <div className="flex flex-col gap-4">
          <div>
            <h3 className="text-2xl font-semibold">{product.name}</h3>
            <p className="mt-2 text-xl font-semibold text-[var(--brand-gold-300)]">
              {formatter.format(product.price)}
            </p>
          </div>

          {product.description && (
            <p className="text-sm leading-relaxed text-[var(--brand-cream)]/90">
              {product.description}
            </p>
          )}

          {product.category && (
            <p className="text-xs uppercase tracking-[0.12em] text-[var(--brand-gold-200)]">
              Categoría: {product.category}
            </p>
          )}

          <div className="mt-auto flex flex-col gap-3">
            <div className="flex w-fit items-center overflow-hidden rounded-full border border-[var(--brand-gold-400)]/40 bg-black/20">
              <button
                type="button"
                className="flex h-10 w-10 items-center justify-center text-lg"
                onClick={() => setQty((prev) => Math.max(1, prev - 1))}
                aria-label="Reducir cantidad"
              >
                -
              </button>
              <span className="w-12 text-center text-sm font-semibold">{qty}</span>
              <button
                type="button"
                className="flex h-10 w-10 items-center justify-center text-lg"
                onClick={() => setQty((prev) => prev + 1)}
                aria-label="Aumentar cantidad"
              >
                +
              </button>
            </div>

            <button
              type="button"
              onClick={() => {
                addItem({
                  productId: product.id,
                  name: product.name,
                  unitPrice: product.price,
                  qty,
                  image: thumb,
                });
                onClose();
              }}
              className="rounded-full border border-[var(--brand-gold-400)] bg-[var(--brand-gold-300)] px-5 py-3 text-sm font-semibold uppercase tracking-[0.08em] text-[var(--brand-violet-strong)] transition hover:brightness-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand-cream)]"
            >
              Agregar al carrito
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
