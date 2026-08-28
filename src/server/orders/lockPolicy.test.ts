import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  SHEETS_GET_WORST_CASE_MS,
  SHEETS_MUTATION_WORST_CASE_MS,
  UPDATE_ORDER_ROW_WORST_CASE_MS,
} from "@/src/server/sheets/repository";
import {
  ORDER_WRITE_LOCK_MINIMUM_MARGIN_MS,
  ORDER_WRITE_LOCK_TTL_SECONDS,
  orderWriteLockCoversAuthorityHandoff,
  orderWriteLockCoversWorstCaseSheetUpdate,
} from "./store";

describe("PR 2 order write lock policy", () => {
  it("PR2-CONC-LOCK-TTL-STRUCTURAL exceeds both mutation forms and its safety margin", () => {
    expect(SHEETS_MUTATION_WORST_CASE_MS).toBe(24_400);
    expect(UPDATE_ORDER_ROW_WORST_CASE_MS).toBe(48_800);
    expect(ORDER_WRITE_LOCK_TTL_SECONDS).toBe(75);
    expect(ORDER_WRITE_LOCK_TTL_SECONDS * 1000).toBeGreaterThanOrEqual(
      UPDATE_ORDER_ROW_WORST_CASE_MS + ORDER_WRITE_LOCK_MINIMUM_MARGIN_MS
    );
    expect(orderWriteLockCoversWorstCaseSheetUpdate()).toBe(true);
  });

  it("H07D2-LOCK-TTL-01 covers the final Sheet read, journal mutation and margin", () => {
    expect(SHEETS_GET_WORST_CASE_MS).toBe(20_300);
    expect(
      SHEETS_GET_WORST_CASE_MS +
        SHEETS_MUTATION_WORST_CASE_MS +
        ORDER_WRITE_LOCK_MINIMUM_MARGIN_MS,
    ).toBeLessThanOrEqual(ORDER_WRITE_LOCK_TTL_SECONDS * 1000);
    expect(orderWriteLockCoversAuthorityHandoff()).toBe(true);
  });

  it("H07D1-NESTED-LOCK-01 locked sales projection never calls updateOrder", () => {
    const source = readFileSync(resolve(process.cwd(), "src/server/orders/store.ts"), "utf8");
    const start = source.indexOf("export async function reconcileCurrentOrderSalesProjection");
    const end = source.indexOf("export async function projectCurrentOrderSalesState", start);
    const implementation = source.slice(start, end);

    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    expect(implementation).toContain("withOrderWriteLock");
    expect(implementation).toContain("persistSalesProjectionStateWithinLock");
    expect(implementation).toContain("clearPendingSalesProjectionWithinLock");
    expect(implementation).not.toContain("updateOrder(");
  });

  it("H07D1-LOCK-ORDER-01 normal Order paths never acquire the recovery worker lock", () => {
    const storeSource = readFileSync(
      resolve(process.cwd(), "src/server/orders/store.ts"),
      "utf8",
    );
    const recoverySource = readFileSync(
      resolve(process.cwd(), "src/server/orders/salesSheetRecovery.ts"),
      "utf8",
    );
    const adminSource = readFileSync(
      resolve(process.cwd(), "src/server/orders/admin.ts"),
      "utf8",
    );

    expect(storeSource).not.toContain("sales-sheet-recovery-lock");
    expect(recoverySource).toContain("sales-sheet-recovery-lock");
    expect(recoverySource).toContain("reconcileCurrentOrderSalesProjection");
    expect(recoverySource).not.toContain("removePendingSalesSheetOrder");
    expect(adminSource).not.toContain("removePendingSalesSheetOrder");
  });

  it("H07D2-NESTED-LOCK-01 missing-KV fallback never enters another Order mutation", () => {
    const source = readFileSync(resolve(process.cwd(), "src/server/orders/store.ts"), "utf8");
    const start = source.indexOf("export async function runMissingOrderSheetFallback");
    const end = source.indexOf("const buildCurrentSalesSheetUpdates", start);
    const implementation = source.slice(start, end);

    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    expect(implementation).toContain("withOrderWriteLock");
    expect(implementation).not.toContain("applyAdminOrderStatusIntent(");
    expect(implementation).not.toContain("updateOrder(");
  });

  it("H07D2-NOSEED-01 H06 missing-KV paths no longer publish with ensureOrderExists", () => {
    const recoverySource = readFileSync(
      resolve(process.cwd(), "src/server/recovery/service.ts"),
      "utf8",
    );
    const reconciliationSource = readFileSync(
      resolve(process.cwd(), "src/server/payments/reconciliation.ts"),
      "utf8",
    );

    expect(recoverySource).toContain("reconstructOrderFromAuthorityEvidence");
    expect(reconciliationSource).toContain("reconstructOrderFromAuthorityEvidence");
    expect(recoverySource).not.toContain("ensureOrderExists");
    expect(reconciliationSource).not.toContain("ensureOrderExists");
  });

  it("D2B-LOCK-01 all three writer families use the shared destination arbitration", () => {
    const storeSource = readFileSync(
      resolve(process.cwd(), "src/server/orders/store.ts"),
      "utf8",
    );
    const actionsSource = readFileSync(
      resolve(process.cwd(), "app/admin/actions.ts"),
      "utf8",
    );
    const reconciliationSource = readFileSync(
      resolve(process.cwd(), "src/server/payments/reconciliation.ts"),
      "utf8",
    );
    const start = storeSource.indexOf(
      "export async function runMissingOrderDestinationArbitration",
    );
    const end = storeSource.indexOf("const buildCurrentSalesSheetUpdates", start);
    const implementation = storeSource.slice(start, end);

    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    expect(implementation).toContain("withOrderWriteLock");
    expect(implementation).toContain("getJson<StoredOrder>");
    expect(implementation).toContain("getUniqueOrderRowById");
    expect(implementation).not.toContain("attemptInventoryForPaidOrder");
    expect(actionsSource.match(/runMissingOrderDestinationArbitration\(/g)).toHaveLength(3);
    expect(reconciliationSource.match(/runMissingOrderDestinationArbitration\(/g)).toHaveLength(1);
  });
});
