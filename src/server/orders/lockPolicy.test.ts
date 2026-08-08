import { describe, expect, it } from "vitest";
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
});
