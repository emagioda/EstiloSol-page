"use client";

import { useMemo, useState } from "react";
import CheckoutLayout from "../components/CheckoutPage/CheckoutLayout";
import CheckoutSteps, { type CheckoutInvalidProduct } from "../components/CheckoutPage/CheckoutSteps";
import OrderSummaryDesktop from "../components/CheckoutPage/OrderSummaryDesktop";
import OrderSummaryMobile from "../components/CheckoutPage/OrderSummaryMobile";
import { getCheckoutTotals, isDiscountPaymentMethod, type DeliveryMethod } from "../components/CheckoutPage/checkoutUtils";
import { useCart } from "../view-models/useCartStore";

export default function CheckoutPage() {
  const { items, paymentMethod, getTotal } = useCart();
  const [invalidProducts, setInvalidProducts] = useState<CheckoutInvalidProduct[]>([]);
  const [deliveryMethod, setDeliveryMethod] = useState<DeliveryMethod>("delivery");

  const subtotal = useMemo(() => Math.round(getTotal()), [getTotal]);
  const totals = useMemo(
    () => getCheckoutTotals({ subtotalProducts: subtotal, paymentMethod, deliveryMethod }),
    [deliveryMethod, paymentMethod, subtotal]
  );
  const hasDiscount = isDiscountPaymentMethod(paymentMethod);

  return (
    <CheckoutLayout
      mobileSummary={
        <OrderSummaryMobile
          items={items}
          subtotal={subtotal}
          discountAmount={totals.discountAmount}
          shippingFee={totals.shippingFee}
          finalTotal={totals.finalTotal}
          hasDiscount={hasDiscount}
          deliveryMethod={deliveryMethod}
          invalidProducts={invalidProducts}
        />
      }
      desktopSummary={
        <OrderSummaryDesktop
          items={items}
          subtotal={subtotal}
          discountAmount={totals.discountAmount}
          shippingFee={totals.shippingFee}
          finalTotal={totals.finalTotal}
          hasDiscount={hasDiscount}
          deliveryMethod={deliveryMethod}
          invalidProducts={invalidProducts}
        />
      }
    >
      <CheckoutSteps
        subtotal={subtotal}
        discountedTotal={subtotal - totals.discountAmount}
        onDeliveryMethodChange={setDeliveryMethod}
        onInvalidProductsChange={setInvalidProducts}
      />
    </CheckoutLayout>
  );
}
