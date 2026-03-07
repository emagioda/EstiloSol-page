/* eslint-disable @next/next/no-img-element */
"use client";

import type { CartItem } from "../../view-models/useCartStore";
import { formatMoney } from "./checkoutUtils";

type OrderSummaryDesktopProps = {
  items: CartItem[];
  subtotal: number;
  finalTotal: number;
  hasDiscount: boolean;
};

export default function OrderSummaryDesktop({
  items,
  subtotal,
  finalTotal,
  hasDiscount,
}: OrderSummaryDesktopProps) {
  const basePath = process.env.NEXT_PUBLIC_BASE_PATH ?? "";

  return (
    <div className="sticky top-[calc(var(--header-height-desktop)+1rem)] rounded-3xl border border-[rgba(122,89,177,0.36)] bg-[rgba(246,236,252,0.95)] p-5 shadow-[0_26px_48px_rgba(89,52,128,0.34)]">
      <div className="border-b border-[rgba(122,89,177,0.24)] pb-4">
        <p className="text-xs uppercase tracking-[0.12em] text-[var(--brand-violet-500)]/80">Resumen de orden</p>
        <h2 className="[font-family:var(--font-brand-display)] text-2xl text-[var(--brand-violet-500)]">
          Tu compra
        </h2>
      </div>

      <div className="elegant-scrollbar mt-4 max-h-[45vh] space-y-3 overflow-y-auto pr-1">
        {items.map((item) => (
          <article
            key={item.productId}
            className="flex gap-3 rounded-2xl border border-[rgba(122,89,177,0.2)] bg-[rgba(255,255,255,0.46)] p-3"
          >
            <div className="h-16 w-16 overflow-hidden rounded-xl bg-black/20">
              {item.image ? (
                <img
                  src={item.image.startsWith("/") ? `${basePath}${item.image}` : item.image}
                  alt={item.name}
                  className="h-full w-full object-cover"
                />
              ) : null}
            </div>
            <div className="flex-1">
              <p className="line-clamp-2 text-sm text-[var(--brand-violet-500)]">{item.name}</p>
              <p className="mt-1 text-xs text-[var(--brand-violet-500)]/75">Cantidad: {item.qty}</p>
              <p className="mt-2 text-sm font-semibold text-[var(--brand-gold-600)]">
                {formatMoney(item.unitPrice * item.qty)}
              </p>
            </div>
          </article>
        ))}
      </div>

      <div className="mt-5 space-y-2 border-t border-[rgba(122,89,177,0.24)] pt-4">
        <div className="flex items-center justify-between text-sm text-[var(--brand-violet-500)]/85">
          <span>Subtotal</span>
          <span>{formatMoney(subtotal)}</span>
        </div>
        {hasDiscount ? (
          <div className="flex items-center justify-between text-sm text-[var(--brand-violet-500)]/85">
            <span>Descuento (10%)</span>
            <span>- {formatMoney(subtotal - finalTotal)}</span>
          </div>
        ) : null}
        <div className="mt-2 flex items-end justify-between border-t border-[rgba(122,89,177,0.24)] pt-3">
          <span className="text-sm text-[var(--brand-violet-500)]/85">Total</span>
          <div className="text-right">
            {hasDiscount ? (
              <p className="text-xs text-[var(--brand-violet-500)]/55 line-through">{formatMoney(subtotal)}</p>
            ) : null}
            <p className="text-2xl font-semibold text-[var(--brand-gold-600)]">{formatMoney(finalTotal)}</p>
          </div>
        </div>
      </div>
    </div>
  );
}
