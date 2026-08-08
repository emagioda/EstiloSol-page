import { invalidateProductsCatalogCache } from "@/src/server/catalog/getProducts";
import { InventoryOperationError } from "@/src/server/inventory/errors";
import { logEvent } from "@/src/server/observability/log";
import { decrementProductsStockInSheet } from "@/src/server/sheets/repository";
import type { Order, OrderInventoryStatus } from "./types";

export type InventoryTechnicalIssueCode =
  | "SHEETS_TIMEOUT"
  | "SHEETS_UNAVAILABLE"
  | "INVENTORY_RESPONSE_INVALID"
  | "INVENTORY_UNKNOWN_ERROR";

export type InventoryAttemptResult =
  | {
      status: "deducted";
      stockDeductedAt: number;
      deduped: boolean;
    }
  | {
      status: "conflict" | "error";
      issueCode: string;
      issueAt: number;
    };

type InventoryAttemptDependencies = {
  decrementStock?: typeof decrementProductsStockInSheet;
  invalidateCatalog?: typeof invalidateProductsCatalogCache;
  now?: () => number;
};

const INVENTORY_STATUS_SET = new Set<OrderInventoryStatus>([
  "pending",
  "deducted",
  "conflict",
  "error",
]);

export const isOrderInventoryStatus = (value: unknown): value is OrderInventoryStatus =>
  typeof value === "string" && INVENTORY_STATUS_SET.has(value as OrderInventoryStatus);

export const resolveOrderInventoryStatus = (
  order: Pick<Order, "inventoryStatus" | "stockDeductedAt">
): OrderInventoryStatus | undefined => {
  if (order.inventoryStatus === "deducted") {
    return order.stockDeductedAt ? "deducted" : undefined;
  }
  if (order.inventoryStatus === "pending" || order.inventoryStatus === "conflict" || order.inventoryStatus === "error") {
    return order.inventoryStatus;
  }
  return order.stockDeductedAt ? "deducted" : undefined;
};

export const shouldAttemptInventoryAutomatically = (
  order: Pick<Order, "inventoryStatus" | "stockDeductedAt">
) => {
  const status = resolveOrderInventoryStatus(order);
  return status === undefined || status === "pending";
};

export const isInventoryBlockingShipping = (
  order: Pick<Order, "inventoryStatus" | "stockDeductedAt">
) => {
  const status = resolveOrderInventoryStatus(order);
  return status === "conflict" || status === "error";
};

const technicalIssueCode = (error: unknown): InventoryTechnicalIssueCode => {
  if (error instanceof InventoryOperationError && error.origin === "response") {
    return "INVENTORY_RESPONSE_INVALID";
  }

  if (error instanceof Error) {
    const name = error.name.toLowerCase();
    const message = error.message.toLowerCase();
    if (name.includes("abort") || message.includes("timeout") || message.includes("timed out")) {
      return "SHEETS_TIMEOUT";
    }
    if (
      error instanceof TypeError ||
      message.includes("fetch") ||
      message.includes("network") ||
      message.includes("status 5") ||
      message.includes("unavailable")
    ) {
      return "SHEETS_UNAVAILABLE";
    }
  }

  return "INVENTORY_UNKNOWN_ERROR";
};

export const classifyInventoryFailure = (
  error: unknown,
  issueAt: number
): Extract<InventoryAttemptResult, { status: "conflict" | "error" }> => {
  if (error instanceof InventoryOperationError && error.origin === "domain") {
    return { status: "conflict", issueCode: error.code, issueAt };
  }
  return { status: "error", issueCode: technicalIssueCode(error), issueAt };
};

export const inventoryResultToOrderPatch = (
  result: InventoryAttemptResult
): Pick<Order, "inventoryStatus" | "inventoryIssueCode" | "inventoryIssueAt" | "stockDeductedAt"> => {
  if (result.status === "deducted") {
    return {
      inventoryStatus: "deducted",
      inventoryIssueCode: undefined,
      inventoryIssueAt: undefined,
      stockDeductedAt: result.stockDeductedAt,
    };
  }
  return {
    inventoryStatus: result.status,
    inventoryIssueCode: result.issueCode,
    inventoryIssueAt: result.issueAt,
    stockDeductedAt: undefined,
  };
};

export async function attemptInventoryForPaidOrder(
  order: Pick<Order, "externalReference" | "items" | "stockDeductedAt">,
  dependencies: InventoryAttemptDependencies = {}
): Promise<InventoryAttemptResult> {
  if (order.stockDeductedAt) {
    return {
      status: "deducted",
      stockDeductedAt: order.stockDeductedAt,
      deduped: true,
    };
  }

  const now = dependencies.now ?? Date.now;
  const decrementStock = dependencies.decrementStock ?? decrementProductsStockInSheet;
  const invalidateCatalog = dependencies.invalidateCatalog ?? invalidateProductsCatalogCache;

  try {
    const result = await decrementStock(
      order.externalReference,
      order.items.map((item) => ({
        productId: item.productId,
        qty: item.qty,
        title: item.title,
      }))
    );
    const stockDeductedAt = now();

    try {
      await invalidateCatalog();
    } catch (error) {
      logEvent("warn", "inventory.catalog_cache_invalidation_failed", {
        orderId: order.externalReference,
        errorName: error instanceof Error ? error.name : "unknown",
      });
    }

    return {
      status: "deducted",
      stockDeductedAt,
      deduped: result.deduped,
    };
  } catch (error) {
    return classifyInventoryFailure(error, now());
  }
}
