export type OrderStatus =
  | "created"
  | "preference_created"
  | "approved"
  | "rejected"
  | "pending"
  | "cancelled"
  | "refunded"
  | "charged_back";

export type OrderPaymentStatus = "pending" | "confirmed" | "cancelled" | "refunded" | "charged_back";
export type OrderShippingStatus = "in_process" | "completed";
export type OrderPaymentMethod = "mercadopago" | "transfer" | "cash";
export type OrderDeliveryMethod = "delivery" | "pickup";

export type OrderItem = {
  productId: string;
  title: string;
  unitPrice: number;
  qty: number;
  currency: "ARS";
};

export type OrderFulfillment = {
  subtotalProducts: number;
  discountAmount: number;
  shippingFee: number;
  finalTotal: number;
  deliveryZone?: {
    id: string;
    name: string;
    insideZoneConfirmed: boolean;
  };
  deliveryAddress?: {
    street: string;
    number: string;
    floor?: string;
    betweenStreets: string;
    notes?: string;
  };
  pickupPoint?: {
    id: string;
    name: string;
    address: string;
    reference: string;
  };
  summary: string;
};

export type Order = {
  externalReference: string;
  summaryToken?: string;
  status: OrderStatus;
  paymentStatus: OrderPaymentStatus;
  shippingStatus: OrderShippingStatus;
  items: OrderItem[];
  total: number;
  currency: "ARS";
  createdAt: number;
  updatedAt: number;
  paymentMethod?: OrderPaymentMethod;
  deliveryMethod?: OrderDeliveryMethod;
  mpPreferenceId?: string;
  mpPaymentId?: string;
  mpStatus?: string;
  approvedAt?: number;
  stockDeductedAt?: number;
  salesSheetSyncedAt?: number;
  salesSheetDeferredUntilApprovedAt?: number;
  salesSheetSyncFailedAt?: number;
  customer?: { name?: string; phone?: string; email?: string };
  notes?: string;
  fulfillment?: OrderFulfillment;
  receiptEmailSentAt?: number;
};
