export type OrderStatus = "created" | "preference_created" | "approved" | "rejected" | "pending";

export type OrderItem = {
  productId: string;
  title: string;
  unitPrice: number;
  qty: number;
  currency: "ARS";
};

export type Order = {
  externalReference: string;
  status: OrderStatus;
  items: OrderItem[];
  total: number;
  currency: "ARS";
  createdAt: number;
  updatedAt: number;
  mpPreferenceId?: string;
  mpPaymentId?: string;
  mpStatus?: string;
  approvedAt?: number;
  customer?: { name?: string; phone?: string; email?: string };
  notes?: string;
  receiptEmailSentAt?: number;
};
