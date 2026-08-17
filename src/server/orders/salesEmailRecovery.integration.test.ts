import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { EmailOutboxEvent, MissingReceiptCandidate } from "@/src/server/emailOutbox/types";
import type { Order, OrderPaymentMethod } from "./types";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect: vi.fn() }));
vi.mock("next-auth", () => ({
  getServerSession: vi.fn(async () => ({ user: { email: "admin@example.test" } })),
}));
vi.mock("@/src/server/auth/adminEmail", () => ({ isAdminEmail: vi.fn(() => true) }));
vi.mock("@/src/server/catalog/getProducts", () => ({
  invalidateProductsCatalogCache: vi.fn(async () => undefined),
}));
vi.mock("@/src/server/observability/metrics", () => ({ trackBusinessEvent: vi.fn() }));
vi.mock("@/src/server/emailOutbox/service", () => ({
  ensurePurchaseReceiptEventSafely: vi.fn(async () => null),
}));
vi.mock("@/src/server/payments/mpClient", () => ({
  fetchPaymentByIdFromMp: vi.fn(),
  searchPaymentsByExternalReference: vi.fn(),
}));
vi.mock("@/src/server/sheets/repository", () => ({
  appendOrderToSalesSheet: vi.fn(),
  decrementProductsStockInSheet: vi.fn(),
  getOrderRowById: vi.fn(),
  updateOrderRowInSalesSheet: vi.fn(),
  updateProductRowInSheet: vi.fn(),
  UPDATE_ORDER_ROW_WORST_CASE_MS: 48_800,
}));

import { saveOrderStatusesBatchAction } from "@/app/admin/actions";
import { ensurePurchaseReceiptEventSafely } from "@/src/server/emailOutbox/service";
import { processClaimedEmailOutboxEvent } from "@/src/server/emailOutbox/processor";
import { runEmailOutboxWorker } from "@/src/server/emailOutbox/worker";
import {
  appendOrderToSalesSheet,
  decrementProductsStockInSheet,
  getOrderRowById,
  updateOrderRowInSalesSheet,
} from "@/src/server/sheets/repository";
import { createOrder, getOrder } from "./store";
import { isPendingSalesSheetOrder } from "./salesSheetSync";

let sequence = 0;
const providerNow = Date.parse("2026-08-17T12:00:00.000Z");

const makeOrder = (paymentMethod: OrderPaymentMethod): Order => {
  sequence += 1;
  const createdAt = providerNow - sequence * 1_000;
  return {
    externalReference: `aud3-sales-integration-${paymentMethod}-${sequence}`,
    status: "created",
    paymentStatus: "pending",
    shippingStatus: "in_process",
    paymentMethod,
    inventoryStatus: "pending",
    items: [{ productId: "p1", title: "Producto", qty: 1, unitPrice: 1_000, currency: "ARS" }],
    total: 1_000,
    currency: "ARS",
    customer: { name: "Cliente", email: "customer@example.test" },
    createdAt,
    updatedAt: createdAt,
  };
};

beforeEach(() => {
  vi.clearAllMocks();
  process.env.RESEND_API_KEY = "re_test_synthetic_only";
  vi.mocked(appendOrderToSalesSheet).mockResolvedValue(undefined);
  vi.mocked(getOrderRowById).mockResolvedValue({} as never);
  vi.mocked(updateOrderRowInSalesSheet).mockResolvedValue(undefined);
  vi.mocked(decrementProductsStockInSheet).mockResolvedValue({
    deduped: false,
    updated: [{ productId: "p1", previousQty: 2, nextQty: 1 }],
  });
});

afterEach(() => {
  delete process.env.RESEND_API_KEY;
  vi.unstubAllGlobals();
});

describe("AUD3-H06-E enrolled sales projection and email recovery", () => {
  it.each([
    ["AUD3-H06E-AUTO-SALES-01 cash with AUTO-SALES-03/04 full Cron lifecycle", "cash"],
    ["AUD3-H06E-AUTO-SALES-02 transfer with AUTO-SALES-03/04 full Cron lifecycle", "transfer"],
  ] as const)("%s", async (_name, paymentMethod) => {
    const original = makeOrder(paymentMethod);
    await createOrder(original);
    vi.mocked(updateOrderRowInSalesSheet).mockRejectedValueOnce(new Error("synthetic Sheets outage"));
    vi.mocked(ensurePurchaseReceiptEventSafely).mockResolvedValueOnce(null);

    const confirmation = await saveOrderStatusesBatchAction([{
      orderId: original.externalReference,
      paymentStatus: "confirmed",
      shippingStatus: "in_process",
    }]);

    expect(confirmation).toMatchObject({
      ok: true,
      results: [{ orderId: original.externalReference, inventoryStatus: "deducted" }],
    });
    const failedProjection = await getOrder(original.externalReference);
    expect(failedProjection).toMatchObject({
      paymentStatus: "confirmed",
      receiptOutboxVersion: 1,
      inventoryStatus: "deducted",
      salesSheetSyncedAt: expect.any(Number),
      salesSheetSyncFailedAt: expect.any(Number),
    });
    expect(await isPendingSalesSheetOrder(original.externalReference)).toBe(true);
    expect(ensurePurchaseReceiptEventSafely).toHaveBeenCalledTimes(1);

    vi.mocked(updateOrderRowInSalesSheet).mockResolvedValue(undefined);
    const events = new Map<string, EmailOutboxEvent>();
    let discoveryRuns = 0;
    const discover = vi.fn(async () => {
      discoveryRuns += 1;
      const approved = await getOrder(original.externalReference);
      expect(approved).toMatchObject({
        paymentStatus: "confirmed",
        receiptOutboxVersion: 1,
        salesSheetSyncFailedAt: undefined,
      });
      expect(await isPendingSalesSheetOrder(original.externalReference)).toBe(false);
      const discoveryCandidate: MissingReceiptCandidate = {
        externalReference: original.externalReference,
        recipientEmail: original.customer!.email!,
        customerName: original.customer!.name!,
        paymentId: approved!.mpPaymentId!,
        approvedAt: new Date(approved!.approvedAt!).toISOString(),
        itemsJson: JSON.stringify(original.items),
        total: original.total,
        currency: "ARS",
      };
      return {
        rolloutAt: "2026-08-15T00:00:00.000Z",
        candidates: [discoveryCandidate],
        markerRepairs: [],
      };
    });
    const upsert = vi.fn(async (input: {
      eventKey: string;
      externalReference: string;
      payloadHash: string;
      payloadJson: string;
      idempotencyKey: string;
    }) => {
      const existing = events.get(input.eventKey);
      if (existing) return { outcome: "already_exists" as const, event: existing };
      const createdAt = new Date(providerNow).toISOString();
      const event: EmailOutboxEvent = {
        eventKey: input.eventKey,
        externalReference: input.externalReference,
        notificationType: "purchase_receipt",
        schemaVersion: 1,
        templateVersion: 1,
        payloadHash: input.payloadHash,
        payloadJson: input.payloadJson,
        idempotencyKey: input.idempotencyKey,
        state: "pending",
        attemptCount: 0,
        createdAt,
        updatedAt: createdAt,
      };
      events.set(event.eventKey, event);
      return { outcome: "stored" as const, event };
    });
    const claim = vi.fn(async (input: {
      leaseOwner: string;
      claimedAt: string;
      leaseExpiresAt: string;
      maxEvents: number;
      eventKey?: string;
    }) => {
      const pending = [...events.values()].find((event) => event.state === "pending");
      if (!pending) return [];
      const claimed: EmailOutboxEvent = {
        ...pending,
        state: "processing",
        attemptCount: pending.attemptCount + 1,
        leaseOwner: input.leaseOwner,
        leaseExpiresAt: input.leaseExpiresAt,
        providerFirstAttemptAt: input.claimedAt,
        lastAttemptAt: input.claimedAt,
        updatedAt: input.claimedAt,
      };
      events.set(claimed.eventKey, claimed);
      return [claimed];
    });
    const providerFetch = vi.fn(async () => new Response(
      JSON.stringify({ id: `provider-${paymentMethod}-0001` }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    ));
    vi.stubGlobal("fetch", providerFetch);

    const processClaimed = vi.fn(async (event: EmailOutboxEvent, leaseOwner: string) =>
      processClaimedEmailOutboxEvent(event, leaseOwner, {
        now: () => providerNow,
        getEvent: async (eventKey) => events.get(eventKey) ?? null,
        markProviderOutcomeUnknown: async ({ eventKey, unknownSince }) => {
          const current = events.get(eventKey)!;
          const updated = {
            ...current,
            providerOutcomeUnknownSince: current.providerOutcomeUnknownSince ?? unknownSince,
          };
          events.set(eventKey, updated);
          return updated;
        },
        clearProviderOutcomeUnknown: async ({ eventKey }) => {
          const current = events.get(eventKey)!;
          const updated = { ...current, providerOutcomeUnknownSince: undefined };
          events.set(eventKey, updated);
          return updated;
        },
        markAccepted: async ({ eventKey, providerMessageId, acceptedAt }) => {
          const current = events.get(eventKey)!;
          const accepted: EmailOutboxEvent = {
            ...current,
            state: "accepted",
            leaseOwner: undefined,
            leaseExpiresAt: undefined,
            providerOutcomeUnknownSince: undefined,
            providerMessageId,
            acceptedAt,
            completedAt: acceptedAt,
            updatedAt: acceptedAt,
          };
          events.set(eventKey, accepted);
          return accepted;
        },
        markRetryable: vi.fn(async () => { throw new Error("unexpected retryable outcome"); }),
        markAttention: vi.fn(async () => { throw new Error("unexpected attention outcome"); }),
        markSkipped: vi.fn(async () => { throw new Error("unexpected skipped outcome"); }),
        projectMarker: vi.fn(async () => true),
      })
    );

    const creationRun = await runEmailOutboxWorker({
      now: () => providerNow,
      owner: () => "email-worker-create",
      discover,
      upsert,
      claim,
      processClaimed,
      projectMarker: vi.fn(async () => true),
    });
    const processingRun = await runEmailOutboxWorker({
      now: () => providerNow,
      owner: () => "email-worker-process",
      discover,
      upsert,
      claim,
      processClaimed,
      projectMarker: vi.fn(async () => true),
    });

    expect(creationRun).toMatchObject({
      existingWork: { claimed: 0 },
      salesRecovery: { ok: true, attempted: 1, recovered: 1 },
      discovery: { candidatesFound: 1, eventsCreated: 1 },
    });
    expect(processingRun).toMatchObject({
      existingWork: { claimed: 1, accepted: 1 },
      salesRecovery: { ok: true, attempted: 0, recovered: 0 },
      discovery: { candidatesFound: 1, eventsCreated: 0 },
    });
    expect(updateOrderRowInSalesSheet).toHaveBeenLastCalledWith(
      original.externalReference,
      expect.objectContaining({
        paymentStatus: "confirmed",
        approvedAt: expect.any(Number),
        receiptOutboxVersion: 1,
        inventoryStatus: "deducted",
      }),
    );
    expect(appendOrderToSalesSheet).toHaveBeenCalledTimes(1);
    expect(discoveryRuns).toBe(2);
    expect(events).toHaveLength(1);
    expect(events.get(`purchase-receipt/${original.externalReference}/v1`)).toMatchObject({
      state: "accepted",
      providerMessageId: `provider-${paymentMethod}-0001`,
      providerOutcomeUnknownSince: undefined,
    });
    expect(providerFetch).toHaveBeenCalledTimes(1);
    expect(providerFetch).toHaveBeenCalledWith(
      "https://api.resend.com/emails",
      expect.objectContaining({
        headers: expect.objectContaining({
          "Idempotency-Key": `purchase-receipt/${original.externalReference}/v1`,
        }),
      }),
    );
    expect(decrementProductsStockInSheet).toHaveBeenCalledTimes(1);
    expect(ensurePurchaseReceiptEventSafely).toHaveBeenCalledTimes(1);
  });
});
