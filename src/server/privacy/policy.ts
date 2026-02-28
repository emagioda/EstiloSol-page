import type { OrderStatus } from "@/src/server/orders/types";

const DAY = 24 * 3600;

export const ORDER_TTL_SECONDS = 30 * DAY;
const SHORT_LIVED_ORDER_TTL_SECONDS = 7 * DAY;

const anonymizeName = (name: string) => {
  const trimmed = name.trim();
  if (!trimmed) return "";
  const [firstWord] = trimmed.split(/\s+/);
  return firstWord.slice(0, 1).toUpperCase();
};

const anonymizePhone = (phone: string) => {
  const digits = phone.replace(/\D/g, "");
  if (!digits) return "";
  if (digits.length <= 4) return digits;
  return `${"*".repeat(Math.max(0, digits.length - 4))}${digits.slice(-4)}`;
};

export const privacyPolicy = {
  retentionDays: {
    approved: ORDER_TTL_SECONDS / DAY,
    pending: SHORT_LIVED_ORDER_TTL_SECONDS / DAY,
    rejected: SHORT_LIVED_ORDER_TTL_SECONDS / DAY,
    created: SHORT_LIVED_ORDER_TTL_SECONDS / DAY,
    preference_created: SHORT_LIVED_ORDER_TTL_SECONDS / DAY,
  },
  piiRules: {
    customerName: "Stored for checkout operations; anonymized after approval",
    customerPhone: "Stored for checkout operations; masked after approval",
    notes: "Stored only while payment is in progress; removed after approval",
  },
  minimizeApprovedOrderPII: true,
  ttlSecondsForStatus(status: OrderStatus): number {
    if (status === "approved") return ORDER_TTL_SECONDS;
    return SHORT_LIVED_ORDER_TTL_SECONDS;
  },
  anonymizeCustomer(input?: { name?: string; phone?: string }) {
    if (!input) return undefined;

    const name = input.name ? anonymizeName(input.name) : "";
    const phone = input.phone ? anonymizePhone(input.phone) : "";

    if (!name && !phone) return undefined;
    return {
      ...(name ? { name } : {}),
      ...(phone ? { phone } : {}),
    };
  },
} as const;
