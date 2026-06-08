const CASH_TRANSFER_DISCOUNT_RATE = 0.1;
const CASH_TRANSFER_TOTAL_ROUNDING_STEP = 100;

const normalizeAmount = (value: number) => Number(value.toFixed(2));

const roundCashTransferTotal = (value: number) => {
  if (!Number.isFinite(value) || value <= 0) return 0;
  return Math.round(value / CASH_TRANSFER_TOTAL_ROUNDING_STEP) * CASH_TRANSFER_TOTAL_ROUNDING_STEP;
};

export const getCashTransferDiscountedTotal = (subtotalProducts: number) => {
  if (!Number.isFinite(subtotalProducts) || subtotalProducts <= 0) return 0;

  const discountedTotal = roundCashTransferTotal(
    subtotalProducts * (1 - CASH_TRANSFER_DISCOUNT_RATE)
  );

  return normalizeAmount(Math.min(subtotalProducts, discountedTotal));
};

export const getCashTransferDiscountAmount = (subtotalProducts: number) => {
  if (!Number.isFinite(subtotalProducts) || subtotalProducts <= 0) return 0;

  return normalizeAmount(
    Math.max(0, subtotalProducts - getCashTransferDiscountedTotal(subtotalProducts))
  );
};
