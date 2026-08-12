export const INVENTORY_ERROR_CODES = [
  "INVALID_ITEMS",
  "INVALID_QUANTITY",
  "TOO_MANY_ITEMS",
  "AGGREGATED_QUANTITY_LIMIT",
  "PRODUCT_NOT_FOUND",
  "DUPLICATE_PRODUCT_ID",
  "PRODUCT_INACTIVE",
  "PRODUCT_NOT_AVAILABLE",
  "INVALID_STOCK_QTY",
  "INSUFFICIENT_STOCK",
  "PRICE_CHANGED",
  "INVENTORY_VALIDATION_FAILED",
  "INVALID_ORDER_ID",
  "INVENTORY_IDEMPOTENCY_CONFLICT",
  "INVENTORY_JOURNAL_INVALID",
] as const;

export type InventoryErrorCode = (typeof INVENTORY_ERROR_CODES)[number];

export type InventoryErrorDetail = {
  code: InventoryErrorCode;
  message: string;
  itemIndex?: number;
  productId?: string;
  origin?: "domain" | "response";
};

const INVENTORY_ERROR_CODE_SET = new Set<string>(INVENTORY_ERROR_CODES);

export const isInventoryErrorCode = (value: unknown): value is InventoryErrorCode =>
  typeof value === "string" && INVENTORY_ERROR_CODE_SET.has(value);

export class InventoryOperationError extends Error {
  readonly code: InventoryErrorCode;
  readonly itemIndex?: number;
  readonly productId?: string;
  readonly origin: "domain" | "response";

  constructor(detail: InventoryErrorDetail) {
    super(detail.message);
    this.name = "InventoryOperationError";
    this.code = detail.code;
    this.itemIndex = detail.itemIndex;
    this.productId = detail.productId;
    this.origin = detail.origin ?? "domain";
  }
}
