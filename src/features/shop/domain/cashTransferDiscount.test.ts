import { describe, expect, it } from "vitest";
import {
  getCashTransferDiscountAmount,
  getCashTransferDiscountedTotal,
} from "./cashTransferDiscount";

describe("cash/transfer discount", () => {
  it("rounds the discounted total down when the last two digits are between 1 and 49", () => {
    expect(getCashTransferDiscountedTotal(12277)).toBe(11000);
    expect(getCashTransferDiscountAmount(12277)).toBe(1277);
  });

  it("rounds the discounted total up when the last two digits are between 50 and 99", () => {
    expect(getCashTransferDiscountedTotal(12300)).toBe(11100);
    expect(getCashTransferDiscountAmount(12300)).toBe(1200);
  });
});
