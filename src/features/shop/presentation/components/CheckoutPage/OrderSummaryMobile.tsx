/* eslint-disable @next/next/no-img-element */
"use client";

import { useState } from "react";
import type { CartItem } from "../../view-models/useCartStore";
import type { CheckoutInvalidProduct } from "./CheckoutSteps";
import { deliveryMethodLabel, formatMoney, type DeliveryMethod } from "./checkoutUtils";

type OrderSummaryMobileProps = {
  items: CartItem[];
  subtotal: number;
  discountAmount: number;
  shippingFee: number;
  finalTotal: number;
  hasDiscount: boolean;
  deliveryMethod: DeliveryMethod;
  invalidProducts?: CheckoutInvalidProduct[];
};

export default function OrderSummaryMobile({
  items,
  subtotal,
  discountAmount,
  shippingFee,
  finalTotal,
  hasDiscount,
  deliveryMethod,
  invalidProducts = [],
}: OrderSummaryMobileProps) {
  const [open, setOpen] = useState(false);
  const basePath = process.env.NEXT_PUBLIC_BASE_PATH ?? "";
  const invalidProductsById = new Map(invalidProducts.map((product) => [product.productId, product]));
  const shippingLabel = deliveryMethod === "pickup" ? "Punto de encuentro" : deliveryMethodLabel(deliveryMethod);
  const shouldShowFulfillmentLine = subtotal > 0 || items.length > 0;

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
            {items.map((item) => {
              const invalidProduct = invalidProductsById.get(item.productId);
              const hasStockProblem =
                Boolean(invalidProduct) ||
                item.stockStatus === "out_of_stock" ||
                (typeof item.stockQty === "number" && item.qty > item.stockQty);
              const stockMessage =
                invalidProduct?.reason === "price_changed" && typeof invalidProduct.currentPrice === "number"
                  ? `Precio actualizado: ${formatMoney(invalidProduct.currentPrice)}.`
                  : item.stockStatus === "out_of_stock" || item.stockQty === 0
                  ? "Sin stock. Quitalo del carrito."
                  : typeof item.stockQty === "number" && item.qty > item.stockQty
                    ? `Solo quedan ${item.stockQty}.`
                    : "No disponible.";

              return (
                <article
                  key={item.productId}
                  className={`rounded-2xl border px-3 py-2 ${
                    hasStockProblem
                      ? "border-red-300 bg-red-50/80"
                      : "border-[rgba(122,89,177,0.2)] bg-[rgba(255,255,255,0.46)]"
                  }`}
                >
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex min-w-0 items-center gap-2">
                      <div className="h-10 w-10 overflow-hidden rounded-lg bg-black/20">
                        {item.image ? (
                          <img
                            src={item.image.startsWith("/") ? `${basePath}${item.image}` : item.image}
                            alt={item.name}
                            className={`h-full w-full object-cover ${hasStockProblem ? "grayscale" : ""}`}
                          />
                        ) : null}
                      </div>
                      <div className="min-w-0">
                        <p className="truncate text-sm text-[var(--brand-violet-500)]">{item.name}</p>
                        <p className="text-xs text-[var(--brand-violet-500)]/75">x {item.qty}</p>
                      </div>
                    </div>
                    <p className={`text-sm font-semibold ${hasStockProblem ? "text-red-700" : "text-[var(--brand-gold-600)]"}`}>
                      {formatMoney(item.unitPrice * item.qty)}
                    </p>
                  </div>
                  {hasStockProblem ? (
                    <p className="mt-2 rounded-lg bg-red-100 px-2 py-1 text-xs font-semibold leading-snug text-red-700">
                      {stockMessage}
                    </p>
                  ) : null}
                </article>
              );
            })}
          </div>

          <div className="mt-3 space-y-2 border-t border-[rgba(122,89,177,0.24)] pt-3">
            <div className="flex items-center justify-between text-sm text-[var(--brand-violet-500)]/85">
              <span>Subtotal productos</span>
              <span className="font-medium text-[var(--brand-violet-500)]">{formatMoney(subtotal)}</span>
            </div>
            {hasDiscount ? (
              <div className="flex items-center justify-between text-sm text-[var(--brand-violet-500)]/85">
                <span>Descuento (10%)</span>
                <span className="font-medium text-[var(--brand-violet-500)]/78">- {formatMoney(discountAmount)}</span>
              </div>
            ) : null}
            {shouldShowFulfillmentLine ? (
              <div className="flex items-center justify-between text-sm text-[var(--brand-violet-500)]/85">
                <span>{shippingLabel}</span>
                <span
                  className={
                    shippingFee > 0
                      ? "font-medium text-[var(--brand-violet-500)]"
                      : "text-xs font-semibold uppercase tracking-[0.08em] text-[var(--brand-violet-500)]/62"
                  }
                >
                  {shippingFee > 0 ? formatMoney(shippingFee) : "Gratis"}
                </span>
              </div>
            ) : null}
            <div className="flex items-end justify-between rounded-2xl border border-[rgba(212,175,55,0.22)] bg-white/40 px-3 py-2.5 shadow-[inset_0_1px_0_rgba(255,255,255,0.35)]">
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
