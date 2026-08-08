import { afterEach, describe, expect, it } from "vitest";
import {
  addPendingSalesSheetOrder,
  isPendingSalesSheetOrder,
  listPendingSalesSheetOrderIds,
  removePendingSalesSheetOrder,
} from "./salesSheetSync";

const createdIds: string[] = [];
const uniqueOrderId = (suffix: string) => {
  const orderId = `pr2-sync-index-${suffix}-${Date.now()}-${createdIds.length}`;
  createdIds.push(orderId);
  return orderId;
};

afterEach(async () => {
  await Promise.all(createdIds.splice(0).map(removePendingSalesSheetOrder));
});

describe("PR 2 pending sales Sheet index", () => {
  it("PR2-SYNC-INDEX-01 duplicate adds create one logical entry", async () => {
    const orderId = uniqueOrderId("duplicate");

    await expect(addPendingSalesSheetOrder(orderId)).resolves.toBe(true);
    await expect(addPendingSalesSheetOrder(orderId)).resolves.toBe(false);

    const matches = (await listPendingSalesSheetOrderIds()).filter(
      (candidate) => candidate === orderId
    );
    expect(matches).toEqual([orderId]);
  });

  it("PR2-SYNC-INDEX-02 repeated removal is a safe no-op", async () => {
    const orderId = uniqueOrderId("remove");
    await addPendingSalesSheetOrder(orderId);

    await expect(removePendingSalesSheetOrder(orderId)).resolves.toBe(true);
    await expect(removePendingSalesSheetOrder(orderId)).resolves.toBe(false);
    await expect(isPendingSalesSheetOrder(orderId)).resolves.toBe(false);
  });
});
