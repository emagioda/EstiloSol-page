"use client";

import { useMemo } from "react";
import CheckoutLayout from "../components/CheckoutPage/CheckoutLayout";
import CheckoutSteps from "../components/CheckoutPage/CheckoutSteps";
import OrderSummaryDesktop from "../components/CheckoutPage/OrderSummaryDesktop";
import OrderSummaryMobile from "../components/CheckoutPage/OrderSummaryMobile";
import { isDiscountPaymentMethod } from "../components/CheckoutPage/checkoutUtils";
import { useCart } from "../view-models/useCartStore";

export default function CheckoutPage() {
  const { items, paymentMethod, getTotal, getDiscountedTotal } = useCart();

  const subtotal = useMemo(() => Math.round(getTotal()), [getTotal]);
  const discountedTotal = useMemo(() => Math.round(getDiscountedTotal()), [getDiscountedTotal]);
  const hasDiscount = isDiscountPaymentMethod(paymentMethod);
  const finalTotal = hasDiscount ? discountedTotal : subtotal;

  return (
    <CheckoutLayout
      mobileSummary={
        <OrderSummaryMobile
          items={items}
          subtotal={subtotal}
          finalTotal={finalTotal}
          hasDiscount={hasDiscount}
        />
      }
      desktopSummary={
        <OrderSummaryDesktop
          items={items}
          subtotal={subtotal}
          finalTotal={finalTotal}
          hasDiscount={hasDiscount}
        />
      }
    >
      <CheckoutSteps subtotal={subtotal} discountedTotal={discountedTotal} />
    </CheckoutLayout>
  );
}
