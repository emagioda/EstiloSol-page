import { randomBytes } from "node:crypto";
import {
  DELIVERY_ZONE,
  fallbackFulfillmentConfig,
  getActivePickupPointById,
  getShippingFeeForDeliveryMethod,
  type FulfillmentConfig,
} from "@/src/config/fulfillment";
import type { CatalogProduct } from "@/src/server/catalog/getProducts";
import type {
  Order,
  OrderDeliveryMethod,
  OrderFulfillment,
  OrderItem,
  OrderPaymentMethod,
  OrderStatus,
} from "@/src/server/orders/types";
import type { ParsedCheckoutFulfillment, ParsedCheckoutItem } from "@/src/server/validation/payments";
import {
  dedupeInvalidProducts,
  type InvalidCheckoutProduct,
  validateCatalogItem,
} from "@/src/server/catalog/stock";

type BuildOrderInput = {
  items: ParsedCheckoutItem[];
  catalog: Map<string, CatalogProduct>;
  customerName: string;
  customerPhone: string;
  customerEmail: string;
  notes: string;
  paymentMethod: OrderPaymentMethod;
  deliveryMethod: OrderDeliveryMethod;
  fulfillment: ParsedCheckoutFulfillment;
  fulfillmentConfig?: FulfillmentConfig;
  status?: OrderStatus;
};

type BuildOrderResult = {
  order: Order | null;
  invalidProducts: InvalidCheckoutProduct[];
};

const buildExternalReference = () => {
  const now = new Date();
  const year = now.getUTCFullYear();
  const month = String(now.getUTCMonth() + 1).padStart(2, "0");
  const day = String(now.getUTCDate()).padStart(2, "0");
  const hour = String(now.getUTCHours()).padStart(2, "0");
  const minute = String(now.getUTCMinutes()).padStart(2, "0");
  const second = String(now.getUTCSeconds()).padStart(2, "0");
  const entropy = randomBytes(8).toString("hex").toUpperCase();
  return `es-${year}${month}${day}-${hour}${minute}${second}-${entropy}`;
};

const buildSummaryToken = () => randomBytes(16).toString("hex");

export const getPaymentDiscountAmount = (subtotalProducts: number, paymentMethod: OrderPaymentMethod) => {
  if (paymentMethod === "cash" || paymentMethod === "transfer") {
    return Math.round(subtotalProducts * 0.1);
  }
  return 0;
};

const buildOrderFulfillment = ({
  deliveryMethod,
  fulfillment,
  subtotalProducts,
  discountAmount,
  shippingFee,
  finalTotal,
  fulfillmentConfig,
}: {
  deliveryMethod: OrderDeliveryMethod;
  fulfillment: ParsedCheckoutFulfillment;
  subtotalProducts: number;
  discountAmount: number;
  shippingFee: number;
  finalTotal: number;
  fulfillmentConfig: FulfillmentConfig;
}): OrderFulfillment | null => {
  if (deliveryMethod === "delivery") {
    const address = fulfillment.deliveryAddress;
    if (!address?.street || !address.number || !address.betweenStreets || address.insideZoneConfirmed !== true) {
      return null;
    }

    const floorSuffix = address.floor ? `, ${address.floor}` : "";

    return {
      subtotalProducts,
      discountAmount,
      shippingFee,
      finalTotal,
      deliveryZone: {
        id: DELIVERY_ZONE.id,
        name: DELIVERY_ZONE.name,
        insideZoneConfirmed: true,
      },
      deliveryAddress: {
        street: address.street,
        number: address.number,
        ...(address.floor ? { floor: address.floor } : {}),
        betweenStreets: address.betweenStreets,
        ...(address.notes ? { notes: address.notes } : {}),
      },
      summary: `Envío a domicilio: ${address.street} ${address.number}${floorSuffix}, entre ${address.betweenStreets}`,
    };
  }

  const pickupPoint = getActivePickupPointById(fulfillmentConfig, fulfillment.pickupPointId || "");
  if (!pickupPoint) return null;

  return {
    subtotalProducts,
    discountAmount,
    shippingFee,
    finalTotal,
    pickupPoint: {
      id: pickupPoint.id,
      name: pickupPoint.name,
      address: pickupPoint.name,
      reference: pickupPoint.subtitle,
    },
    summary: `Punto de encuentro: ${pickupPoint.name}`,
  };
};

export const buildOrderFromCheckout = (input: BuildOrderInput): BuildOrderResult => {
  const orderItems: OrderItem[] = [];
  const invalidProducts: InvalidCheckoutProduct[] = [];

  for (const requestedItem of input.items) {
    const product = input.catalog.get(requestedItem.productId);
    const invalidProduct = validateCatalogItem(input.catalog, requestedItem);

    if (!product || invalidProduct) {
      if (invalidProduct) invalidProducts.push(invalidProduct);
      continue;
    }

    orderItems.push({
      productId: product.id,
      title: product.name,
      unitPrice: product.price,
      qty: requestedItem.qty,
      currency: "ARS",
    });
  }

  if (invalidProducts.length > 0) {
    return {
      order: null,
      invalidProducts: dedupeInvalidProducts(invalidProducts),
    };
  }

  const now = Date.now();
  const subtotalProducts = Number(
    orderItems
      .reduce((sum, item) => sum + item.unitPrice * item.qty, 0)
      .toFixed(2)
  );
  const discountAmount = getPaymentDiscountAmount(subtotalProducts, input.paymentMethod);
  const fulfillmentConfig = input.fulfillmentConfig ?? fallbackFulfillmentConfig;
  const shippingFee = getShippingFeeForDeliveryMethod(
    input.deliveryMethod,
    fulfillmentConfig,
    input.fulfillment.pickupPointId
  );
  const finalTotal = Number((subtotalProducts - discountAmount + shippingFee).toFixed(2));
  const fulfillment = buildOrderFulfillment({
    deliveryMethod: input.deliveryMethod,
    fulfillment: input.fulfillment,
    subtotalProducts,
    discountAmount,
    shippingFee,
    finalTotal,
    fulfillmentConfig,
  });

  if (!fulfillment) {
    return {
      order: null,
      invalidProducts: [],
    };
  }

  const order: Order = {
    externalReference: buildExternalReference(),
    summaryToken: buildSummaryToken(),
    status: input.status ?? "created",
    paymentStatus: "pending",
    shippingStatus: "in_process",
    paymentMethod: input.paymentMethod,
    deliveryMethod: input.deliveryMethod,
    items: orderItems,
    total: finalTotal,
    currency: "ARS",
    createdAt: now,
    updatedAt: now,
    fulfillment,
    ...(input.customerName || input.customerPhone || input.customerEmail
      ? {
          customer: {
            ...(input.customerName ? { name: input.customerName } : {}),
            ...(input.customerPhone ? { phone: input.customerPhone } : {}),
            ...(input.customerEmail ? { email: input.customerEmail } : {}),
          },
        }
      : {}),
    ...(input.notes ? { notes: input.notes } : {}),
  };

  return {
    order,
    invalidProducts: [],
  };
};
