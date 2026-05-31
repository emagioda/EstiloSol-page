/* eslint-disable @next/next/no-img-element */
"use client";

import type { CartItem } from "../../view-models/useCartStore";
import type { CheckoutInvalidProduct } from "./CheckoutSteps";
import { deliveryMethodLabel, formatMoney, fulfillmentFeeLabel, type DeliveryMethod } from "./checkoutUtils";

type OrderSummaryDesktopProps = {
  items: CartItem[];
  subtotal: number;
  discountAmount: number;
  shippingFee: number;
  finalTotal: number;
  hasDiscount: boolean;
  deliveryMethod: DeliveryMethod;
  invalidProducts?: CheckoutInvalidProduct[];
};

export default function OrderSummaryDesktop({
  items,
  subtotal,
  discountAmount,
  shippingFee,
  finalTotal,
  hasDiscount,
  deliveryMethod,
  invalidProducts = [],
}: OrderSummaryDesktopProps) {
  const basePath = process.env.NEXT_PUBLIC_BASE_PATH ?? "";
  const invalidProductsById = new Map(invalidProducts.map((product) => [product.productId, product]));
  const shippingLabel = deliveryMethod === "pickup" ? "Punto de encuentro" : deliveryMethodLabel(deliveryMethod);
  const shouldShowFulfillmentLine = subtotal > 0 || items.length > 0;

  return (
    <div className="sticky top-[calc(var(--header-height-desktop)+1rem)] rounded-3xl border border-[rgba(122,89,177,0.36)] bg-[rgba(246,236,252,0.95)] p-5 shadow-[0_26px_48px_rgba(89,52,128,0.34)]">
      <div className="border-b border-[rgba(122,89,177,0.24)] pb-4">
        <p className="text-xs uppercase tracking-[0.12em] text-[var(--brand-violet-500)]/80">Resumen de orden</p>
        <h2 className="[font-family:var(--font-brand-display)] text-2xl text-[var(--brand-violet-500)]">
          Tu compra
        </h2>
      </div>

      <div className="elegant-scrollbar mt-4 max-h-[45vh] space-y-3 overflow-y-auto pr-1">
        {items.map((item) => {
          const invalidProduct = invalidProductsById.get(item.productId);
          const hasStockProblem =
            Boolean(invalidProduct) ||
            item.stockStatus === "out_of_stock" ||
            (typeof item.stockQty === "number" && item.qty > item.stockQty);
          const stockMessage =
            invalidProduct?.reason === "price_changed" && typeof invalidProduct.currentPrice === "number"
              ? `El precio cambio a ${formatMoney(invalidProduct.currentPrice)}. Revisa el total antes de continuar.`
              : item.stockStatus === "out_of_stock" || item.stockQty === 0
              ? "Sin stock. Quitalo del carrito para continuar."
              : typeof item.stockQty === "number" && item.qty > item.stockQty
                ? `Solo quedan ${item.stockQty}. Ajusta la cantidad.`
                : "No disponible para esta compra.";

          return (
            <article
              key={item.productId}
              className={`flex gap-3 rounded-2xl border p-3 ${
                hasStockProblem
                  ? "border-red-300 bg-red-50/80 shadow-[0_0_0_1px_rgba(248,113,113,0.18)]"
                  : "border-[rgba(122,89,177,0.2)] bg-[rgba(255,255,255,0.46)]"
              }`}
            >
              <div className="h-16 w-16 overflow-hidden rounded-xl bg-black/20">
                {item.image ? (
                  <img
                    src={item.image.startsWith("/") ? `${basePath}${item.image}` : item.image}
                    alt={item.name}
                    className={`h-full w-full object-cover ${hasStockProblem ? "grayscale" : ""}`}
                  />
                ) : null}
              </div>
              <div className="flex-1">
                <p className="line-clamp-2 text-sm text-[var(--brand-violet-500)]">{item.name}</p>
                <p className="mt-1 text-xs text-[var(--brand-violet-500)]/75">Cantidad: {item.qty}</p>
                {hasStockProblem ? (
                  <p className="mt-1 rounded-lg bg-red-100 px-2 py-1 text-xs font-semibold leading-snug text-red-700">
                    {stockMessage}
                  </p>
                ) : null}
                <p className={`mt-2 text-sm font-semibold ${hasStockProblem ? "text-red-700" : "text-[var(--brand-gold-600)]"}`}>
                  {formatMoney(item.unitPrice * item.qty)}
                </p>
              </div>
            </article>
          );
        })}
      </div>

      <div className="mt-5 space-y-2 border-t border-[rgba(122,89,177,0.24)] pt-4">
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
              {fulfillmentFeeLabel(deliveryMethod, shippingFee)}
            </span>
          </div>
        ) : null}
        <div className="mt-3 flex items-end justify-between rounded-2xl border border-[rgba(212,175,55,0.22)] bg-white/40 px-3 py-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.35)]">
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
