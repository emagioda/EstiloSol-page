/* eslint-disable @next/next/no-img-element */
"use client";

import { useState } from "react";
import type { CartItem } from "../../view-models/useCartStore";
import { formatMoney } from "./checkoutUtils";

type OrderSummaryMobileProps = {
  items: CartItem[];
  subtotal: number;
  finalTotal: number;
  hasDiscount: boolean;
};

export default function OrderSummaryMobile({
  items,
  subtotal,
  finalTotal,
  hasDiscount,
}: OrderSummaryMobileProps) {
  const [open, setOpen] = useState(false);
  const basePath = process.env.NEXT_PUBLIC_BASE_PATH ?? "";

  return (
    <section className="rounded-3xl border border-[rgba(122,89,177,0.36)] bg-[rgba(246,236,252,0.95)] p-4 shadow-[0_16px_32px_rgba(89,52,128,0.3)] lg:hidden">
      <button
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        className="flex w-full items-center justify-between gap-3 text-left"
        aria-expanded={open}
      >
        <div>
          <p className="text-[11px] uppercase tracking-[0.12em] text-[var(--brand-violet-500)]/80">Resumen de compra</p>
          <p className="text-sm font-medium text-[var(--brand-violet-500)]">
            {open ? "Ocultar detalle" : "Ver detalles de mi compra"}
          </p>
        </div>
        <div className="text-right">
          {hasDiscount ? (
            <p className="text-xs text-[var(--brand-violet-500)]/55 line-through">{formatMoney(subtotal)}</p>
          ) : null}
          <p className="text-lg font-semibold text-[var(--brand-gold-600)]">{formatMoney(finalTotal)}</p>
        </div>
      </button>

      <div
        className={`grid transition-all duration-300 ease-out ${open ? "mt-4 grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0"}`}
      >
        <div className="overflow-hidden">
          <div className="elegant-scrollbar max-h-[44vh] space-y-2 overflow-y-auto pr-1">
            {items.map((item) => (
              <article
                key={item.productId}
                className="flex items-center justify-between rounded-2xl border border-[rgba(122,89,177,0.2)] bg-[rgba(255,255,255,0.46)] px-3 py-2"
              >
                <div className="flex min-w-0 items-center gap-2">
                  <div className="h-10 w-10 overflow-hidden rounded-lg bg-black/20">
                    {item.image ? (
                      <img
                        src={item.image.startsWith("/") ? `${basePath}${item.image}` : item.image}
                        alt={item.name}
                        className="h-full w-full object-cover"
                      />
                    ) : null}
                  </div>
                  <div className="min-w-0">
                    <p className="truncate text-sm text-[var(--brand-violet-500)]">{item.name}</p>
                    <p className="text-xs text-[var(--brand-violet-500)]/75">x {item.qty}</p>
                  </div>
                </div>
                <p className="text-sm font-semibold text-[var(--brand-gold-600)]">
                  {formatMoney(item.unitPrice * item.qty)}
                </p>
              </article>
            ))}
          </div>

          <div className="mt-3 space-y-2 border-t border-[rgba(122,89,177,0.24)] pt-3">
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
            <div className="flex items-end justify-between border-t border-[rgba(122,89,177,0.24)] pt-2">
              <span className="text-sm text-[var(--brand-violet-500)]/85">Total</span>
              <div className="text-right">
                {hasDiscount ? (
                  <p className="text-xs text-[var(--brand-violet-500)]/55 line-through">{formatMoney(subtotal)}</p>
                ) : null}
                <p className="text-lg font-semibold text-[var(--brand-gold-600)]">{formatMoney(finalTotal)}</p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
