"use client";

import Image from "next/image";
import { useEffect, useMemo, useState } from "react";
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

  useEffect(() => {
    if (!open) return;

    const originalOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    return () => {
      document.body.style.overflow = originalOverflow;
    };
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
        className="relative grid w-full max-w-4xl overflow-hidden border border-[var(--brand-violet-700)]/40 bg-[var(--brand-cream)] text-[var(--brand-violet-950)] shadow-[0_20px_80px_rgba(0,0,0,0.45)] sm:grid-cols-2"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          className="absolute right-0 top-0 z-20 flex h-10 w-10 items-center justify-center bg-[#3b3f45] text-2xl leading-none text-[#dce548] transition hover:brightness-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#dce548]"
          onClick={onClose}
          aria-label="Cerrar vista rápida"
        >
          <span aria-hidden="true" className="-mt-0.5">×</span>
        </button>

        <div className="relative h-60 overflow-hidden bg-[#f7f7f7] sm:h-full sm:min-h-[420px]">
          {thumb ? (
            <Image
              src={thumb}
              alt={product.name}
              fill
              className="object-cover"
              sizes="(max-width:640px) 100vw, 50vw"
            />
          ) : (
            <div className="flex h-full w-full items-center justify-center text-xs uppercase text-[#777]">
              Sin imagen
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
                className="flex h-10 w-10 items-center justify-center border border-[#ff6767] text-lg leading-none text-[#ff6767]"
                onClick={() => setQty((prev) => Math.max(1, prev - 1))}
                aria-label="Reducir cantidad"
              >
                -
              </button>
              <span className="flex h-10 w-10 items-center justify-center border border-[#d9d9d9] text-sm font-semibold">
                {qty}
              </span>
              <button
                type="button"
                className="flex h-10 w-10 items-center justify-center border border-[#6dc96d] text-lg leading-none text-[#4cae4c]"
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
                    image: thumb,
                  });
                  onClose();
                }}
                className="ml-1 h-10 border border-[var(--brand-gold-400)] bg-[var(--brand-violet-800)] px-5 text-xs font-bold uppercase tracking-[0.08em] text-[var(--brand-cream)] transition hover:bg-[var(--brand-violet-700)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand-gold-300)]"
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
    </div>
  );
}
