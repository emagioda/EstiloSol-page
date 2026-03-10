import { randomUUID } from "node:crypto";
import type { CatalogProduct } from "@/src/server/catalog/getProducts";
import type {
  Order,
  OrderDeliveryMethod,
  OrderItem,
  OrderPaymentMethod,
  OrderStatus,
} from "@/src/server/orders/types";
import type { ParsedCheckoutItem } from "@/src/server/validation/payments";

type BuildOrderInput = {
  items: ParsedCheckoutItem[];
  catalog: Map<string, CatalogProduct>;
  customerName: string;
  customerPhone: string;
  customerEmail: string;
  notes: string;
  paymentMethod: OrderPaymentMethod;
  deliveryMethod: OrderDeliveryMethod;
  status?: OrderStatus;
};

type BuildOrderResult = {
  order: Order | null;
  invalidProducts: Array<{ productId: string; name: string }>;
};

const buildExternalReference = () => {
  const now = new Date();
  const year = now.getUTCFullYear();
  const month = String(now.getUTCMonth() + 1).padStart(2, "0");
  const day = String(now.getUTCDate()).padStart(2, "0");
  const hour = String(now.getUTCHours()).padStart(2, "0");
  const minute = String(now.getUTCMinutes()).padStart(2, "0");
  const second = String(now.getUTCSeconds()).padStart(2, "0");
  const entropy = randomUUID().replace(/-/g, "").slice(0, 6).toUpperCase();
  return `es-${year}${month}${day}-${hour}${minute}${second}-${entropy}`;
};

export const buildOrderFromCheckout = (input: BuildOrderInput): BuildOrderResult => {
  const orderItems: OrderItem[] = [];
  const invalidProducts: Array<{ productId: string; name: string }> = [];

  for (const requestedItem of input.items) {
    const product = input.catalog.get(requestedItem.productId);
    if (!product) {
      invalidProducts.push({
        productId: requestedItem.productId,
        name: requestedItem.name || requestedItem.productId,
      });
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
      invalidProducts: Array.from(new Map(invalidProducts.map((item) => [item.productId, item])).values()),
    };
  }

  const now = Date.now();
  const total = Number(
    orderItems
      .reduce((sum, item) => sum + item.unitPrice * item.qty, 0)
      .toFixed(2)
  );

  const order: Order = {
    externalReference: buildExternalReference(),
    status: input.status ?? "created",
    paymentStatus: "pending",
    shippingStatus: "in_process",
    paymentMethod: input.paymentMethod,
    deliveryMethod: input.deliveryMethod,
    items: orderItems,
    total,
    currency: "ARS",
    createdAt: now,
    updatedAt: now,
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
