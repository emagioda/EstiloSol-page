import type { OrderItem } from "@/src/server/orders/types";

export const EMAIL_OUTBOX_SHEET = "_email_outbox_events";
export const EMAIL_OUTBOX_SCHEMA_VERSION = 1 as const;
export const PURCHASE_RECEIPT_NOTIFICATION_TYPE = "purchase_receipt" as const;
export const PURCHASE_RECEIPT_TEMPLATE_VERSION = 1 as const;

export const EMAIL_OUTBOX_HEADERS = [
  "event_key",
  "external_reference",
  "notification_type",
  "schema_version",
  "template_version",
  "payload_hash",
  "payload_json",
  "idempotency_key",
  "state",
  "attempt_count",
  "lease_owner",
  "lease_expires_at",
  "next_attempt_at",
  "provider_first_attempt_at",
  "provider_outcome_unknown_since",
  "last_attempt_at",
  "last_error_code",
  "provider_message_id",
  "accepted_at",
  "created_at",
  "updated_at",
  "completed_at",
] as const;

export type EmailOutboxState =
  | "pending"
  | "processing"
  | "retryable"
  | "accepted"
  | "attention"
  | "skipped";

export type PurchaseReceiptPayloadV1 = {
  externalReference: string;
  recipientEmail: string;
  customerName: string;
  paymentId: string;
  approvedAt: number;
  items: Array<Pick<OrderItem, "title" | "qty" | "unitPrice" | "currency">>;
  total: number;
  currency: "ARS";
  fromEmail: string;
  brandName: string;
  supportEmail: string;
  supportWhatsappLabel: string;
  logoUrl: string;
  logoAlt: string;
  orderDetailUrl: string;
  templateVersion: typeof PURCHASE_RECEIPT_TEMPLATE_VERSION;
};
export type EmailOutboxEvent = {
  eventKey: string;
  externalReference: string;
  notificationType: typeof PURCHASE_RECEIPT_NOTIFICATION_TYPE;
  schemaVersion: typeof EMAIL_OUTBOX_SCHEMA_VERSION;
  templateVersion: typeof PURCHASE_RECEIPT_TEMPLATE_VERSION;
  payloadHash: string;
  payloadJson: string;
  idempotencyKey: string;
  state: EmailOutboxState;
  attemptCount: number;
  leaseOwner?: string;
  leaseExpiresAt?: string;
  nextAttemptAt?: string;
  providerFirstAttemptAt?: string;
  providerOutcomeUnknownSince?: string;
  lastAttemptAt?: string;
  lastErrorCode?: string;
  providerMessageId?: string;
  acceptedAt?: string;
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
};

export type EmailOutboxAttentionItem = {
  externalReference: string;
  state: Extract<EmailOutboxState, "retryable" | "attention">;
  attemptCount: number;
  lastErrorCode?: string;
  updatedAt: string;
};

export type MissingReceiptCandidate = {
  externalReference: string;
  recipientEmail: string;
  customerName: string;
  paymentId: string;
  approvedAt: string;
  itemsJson: string;
  total: number;
  currency: "ARS";
};

export type AcceptedMarkerRepair = {
  externalReference: string;
  acceptedAt: string;
};

export type MissingReceiptDiscovery = {
  rolloutAt: string;
  candidates: MissingReceiptCandidate[];
  markerRepairs: AcceptedMarkerRepair[];
};
