import { getJson, setJson } from "@/src/server/kv";
import type { Order, OrderStatus } from "./types";

export const ORDER_TTL_SECONDS = 30 * 24 * 3600;
export const WEBHOOK_DEDUPE_TTL_SECONDS = 7 * 24 * 3600;

const orderKey = (externalReference: string) => `es:order:${externalReference}`;

export const webhookDedupeKey = (eventId: string) => `es:mp:webhook:${eventId}`;
export const paymentDedupeKey = (paymentId: string) => `es:mp:payment:${paymentId}`;

export async function createOrder(order: Order): Promise<void> {
  await setJson(orderKey(order.externalReference), order, ORDER_TTL_SECONDS);
}

export async function getOrder(externalReference: string): Promise<Order | null> {
  return getJson<Order>(orderKey(externalReference));
}

export async function updateOrder(
  externalReference: string,
  patch: Partial<Omit<Order, "externalReference" | "createdAt">>
): Promise<Order | null> {
  const current = await getOrder(externalReference);
  if (!current) return null;

  const updated: Order = {
    ...current,
    ...patch,
    externalReference: current.externalReference,
    createdAt: current.createdAt,
    updatedAt: Date.now(),
  };

  await setJson(orderKey(externalReference), updated, ORDER_TTL_SECONDS);
  return updated;
}

export async function markApproved(
  externalReference: string,
  input: { paymentId: string; mpStatus: string; approvedAt?: number }
): Promise<Order | null> {
  return updateOrder(externalReference, {
    status: "approved",
    mpPaymentId: input.paymentId,
    mpStatus: input.mpStatus,
    approvedAt: input.approvedAt ?? Date.now(),
  });
}

export async function markPreferenceCreated(
  externalReference: string,
  input: { preferenceId: string; status?: OrderStatus }
): Promise<Order | null> {
  return updateOrder(externalReference, {
    status: input.status ?? "preference_created",
    mpPreferenceId: input.preferenceId,
  });
}
