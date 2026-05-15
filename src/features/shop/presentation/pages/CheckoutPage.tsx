"use client";

import { useMemo, useState } from "react";
import CheckoutLayout from "../components/CheckoutPage/CheckoutLayout";
import CheckoutSteps, { type CheckoutInvalidProduct } from "../components/CheckoutPage/CheckoutSteps";
import OrderSummaryDesktop from "../components/CheckoutPage/OrderSummaryDesktop";
import OrderSummaryMobile from "../components/CheckoutPage/OrderSummaryMobile";
import { isDiscountPaymentMethod } from "../components/CheckoutPage/checkoutUtils";
import { useCart } from "../view-models/useCartStore";

export default function CheckoutPage() {
  const { items, paymentMethod, getTotal, getDiscountedTotal } = useCart();
  const [invalidProducts, setInvalidProducts] = useState<CheckoutInvalidProduct[]>([]);

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
          invalidProducts={invalidProducts}
        />
      }
      desktopSummary={
        <OrderSummaryDesktop
          items={items}
          subtotal={subtotal}
          finalTotal={finalTotal}
          hasDiscount={hasDiscount}
          invalidProducts={invalidProducts}
        />
      }
    >
      <CheckoutSteps
        subtotal={subtotal}
        discountedTotal={discountedTotal}
        onInvalidProductsChange={setInvalidProducts}
      />
    </CheckoutLayout>
  );
}
