"use client";

import { useEffect, useMemo, useState } from "react";
import { fallbackFulfillmentConfig, type FulfillmentConfig } from "@/src/config/fulfillment";
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
  const [pickupPointId, setPickupPointId] = useState("");
  const [fulfillmentConfig, setFulfillmentConfig] = useState<FulfillmentConfig>(fallbackFulfillmentConfig);

  useEffect(() => {
    let active = true;

    fetch("/api/fulfillment")
      .then((response) => (response.ok ? response.json() : null))
      .then((config: FulfillmentConfig | null) => {
        if (active && config?.delivery && config?.pickup && Array.isArray(config.pickupPoints)) {
          setFulfillmentConfig(config);
        }
      })
      .catch(() => {});

    return () => {
      active = false;
    };
  }, []);

  const subtotal = useMemo(() => Math.round(getTotal()), [getTotal]);
  const totals = useMemo(
    () =>
      getCheckoutTotals({
        subtotalProducts: subtotal,
        paymentMethod,
        deliveryMethod,
        fulfillmentConfig,
        pickupPointId,
      }),
    [deliveryMethod, fulfillmentConfig, paymentMethod, pickupPointId, subtotal]
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
        fulfillmentConfig={fulfillmentConfig}
        onDeliveryMethodChange={setDeliveryMethod}
        onPickupPointChange={setPickupPointId}
        onInvalidProductsChange={setInvalidProducts}
      />
    </CheckoutLayout>
  );
}
