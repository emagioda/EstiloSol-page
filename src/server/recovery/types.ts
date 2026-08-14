import type {
  OrderDeliveryMethod,
  OrderFulfillment,
  OrderItem,
  OrderPaymentMethod,
} from "@/src/server/orders/types";

export const RECOVERY_SCHEMA_VERSION = 1 as const;
export const ORDER_RECOVERY_SNAPSHOT_SHEET = "_order_recovery_snapshots";
export const PAYMENT_RECOVERY_EVENT_SHEET = "_payment_recovery_events";

export const ORDER_RECOVERY_SNAPSHOT_HEADERS = [
  "external_reference",
  "checkout_attempt_id",
  "schema_version",
  "snapshot_hash",
  "snapshot_json",
  "created_at",
  "preference_valid_from",
  "preference_expires_at",
  "recovery_state",
  "last_checked_at",
  "last_error_code",
  "updated_at",
  "completed_at",
] as const;

export const PAYMENT_RECOVERY_EVENT_HEADERS = [
  "event_key",
  "payment_id",
  "external_reference",
  "financial_status",
  "status_detail",
  "amount",
  "currency",
  "mp_updated_at",
  "observed_at",
  "source",
  "schema_version",
  "snapshot_hash",
  "validation_state",
  "processing_state",
  "attempt_count",
  "lease_owner",
  "lease_expires_at",
  "last_attempt_at",
  "last_error_code",
  "updated_at",
  "completed_at",
] as const;

export type RecoveryOrderSnapshotV1 = {
  schemaVersion: typeof RECOVERY_SCHEMA_VERSION;
  externalReference: string;
  checkoutAttemptId: string;
  summaryToken?: string;
  items: OrderItem[];
  subtotal: number;
  total: number;
  currency: "ARS";
  paymentMethod: Extract<OrderPaymentMethod, "mercadopago">;
  deliveryMethod: OrderDeliveryMethod;
  fulfillment?: OrderFulfillment;
  customer?: { name?: string; email?: string; phone?: string };
  notes?: string;
  createdAt: number;
  preferenceValidFrom: number;
  preferenceExpiresAt: number;
};

export type RecoverySnapshotState =
  | "pending_payment"
  | "payment_observed"
  | "attention"
  | "completed"
  | "expired_unpaid";

export type StoredRecoverySnapshot = {
  externalReference: string;
  checkoutAttemptId: string;
  schemaVersion: typeof RECOVERY_SCHEMA_VERSION;
  snapshotHash: string;
  snapshotJson: string;
  createdAt: string;
  preferenceValidFrom: string;
  preferenceExpiresAt: string;
  recoveryState: RecoverySnapshotState;
  lastCheckedAt?: string;
  lastErrorCode?: string;
  updatedAt: string;
  completedAt?: string;
};

export type RecoveryFinancialStatus = "approved" | "refunded" | "charged_back";
export type RecoveryValidationState = "validated" | "missing_snapshot" | "conflict";
export type RecoveryProcessingState =
  | "pending"
  | "processing"
  | "retryable"
  | "attention"
  | "completed";

export type RecoveryPaymentSource =
  | "webhook"
  | "verify_payment_id"
  | "verify_search"
  | "snapshot_scan";

export type RecoveryPaymentEvent = {
  eventKey: string;
  paymentId: string;
  externalReference: string;
  financialStatus: RecoveryFinancialStatus;
  statusDetail?: string;
  amount: number;
  currency: string;
  mpUpdatedAt?: string;
  observedAt: string;
  source: RecoveryPaymentSource;
  schemaVersion: typeof RECOVERY_SCHEMA_VERSION;
  snapshotHash?: string;
  validationState: RecoveryValidationState;
  processingState: RecoveryProcessingState;
  attemptCount: number;
  leaseOwner?: string;
  leaseExpiresAt?: string;
  lastAttemptAt?: string;
  lastErrorCode?: string;
  updatedAt: string;
  completedAt?: string;
};

export type RecoveryAttentionItem = {
  kind: "payment_event" | "snapshot";
  externalReference: string;
  paymentId?: string;
  financialStatus?: RecoveryFinancialStatus;
  state: RecoveryProcessingState | RecoverySnapshotState;
  lastErrorCode?: string;
  updatedAt: string;
};

export type RecoveryWorkClaim = {
  events: RecoveryPaymentEvent[];
  snapshots: StoredRecoverySnapshot[];
};
