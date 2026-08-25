import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  SHEETS_MUTATION_WORST_CASE_MS,
  UPDATE_ORDER_ROW_WORST_CASE_MS,
} from "@/src/server/sheets/repository";
import {
  ORDER_WRITE_LOCK_MINIMUM_MARGIN_MS,
  ORDER_WRITE_LOCK_TTL_SECONDS,
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
});
