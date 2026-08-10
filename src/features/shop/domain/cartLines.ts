import type { StockStatus } from "@/src/features/shop/domain/entities/Product";

export const MAX_CART_QUANTITY_PER_PRODUCT = 50;

export type CartItem = {
  lineId: string;
  productId: string;
  name: string;
  unitPrice: number;
  qty: number;
  image?: string;
  stockStatus?: StockStatus;
  stockQty?: number | null;
};

export type CartItemInput = Omit<CartItem, "lineId">;

let fallbackLineIdSequence = 0;

const createLineIdCandidate = (): string => {
  const runtimeCrypto = typeof globalThis === "undefined" ? undefined : globalThis.crypto;

  if (typeof runtimeCrypto?.randomUUID === "function") {
    return runtimeCrypto.randomUUID();
  }

  if (typeof runtimeCrypto?.getRandomValues === "function") {
    const values = new Uint32Array(4);
    runtimeCrypto.getRandomValues(values);
    return Array.from(values, (value) => value.toString(16).padStart(8, "0")).join("");
  }

  fallbackLineIdSequence += 1;
  return `cart-line-${Date.now().toString(36)}-${fallbackLineIdSequence.toString(36)}-${Math.random()
    .toString(36)
    .slice(2)}`;
};

export const createUniqueCartLineId = (usedLineIds: ReadonlySet<string> = new Set()): string => {
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const candidate = createLineIdCandidate();
    if (candidate && !usedLineIds.has(candidate)) return candidate;
  }

  let candidate = "";
  do {
    fallbackLineIdSequence += 1;
    candidate = `cart-line-fallback-${Date.now().toString(36)}-${fallbackLineIdSequence.toString(36)}`;
  } while (usedLineIds.has(candidate));

  return candidate;
};

export const normalizeCartQty = (value: unknown): number => {
  const qty = Number(value);
  if (!Number.isFinite(qty)) return 0;
  const intQty = Math.trunc(qty);
  if (intQty < 1) return 0;
  return Math.min(intQty, MAX_CART_QUANTITY_PER_PRODUCT);
};

export const normalizeCartPrice = (value: unknown): number => {
  const price = Number(value);
  if (!Number.isFinite(price) || price < 0) return 0;
  return Number(price.toFixed(2));
};

export const normalizeCartStockQty = (value: unknown): number | null | undefined => {
  if (value === undefined) return undefined;
  if (value === null || value === "") return null;
  const qty = Number(value);
  if (!Number.isFinite(qty)) return null;
  return Math.max(0, Math.trunc(qty));
};

export const normalizeCartStockStatus = (value: unknown): StockStatus | undefined => {
  if (value === "in_stock" || value === "out_of_stock" || value === "preorder") return value;
  return undefined;
};

const normalizeStoredUnitPrice = (item: Record<string, unknown>): number => {
  const candidates = [item.unitPrice, item.unit_price, item.price, item.precio];
  for (const candidate of candidates) {
    const price = normalizeCartPrice(candidate);
    if (price > 0) return price;
  }
  return normalizeCartPrice(candidates[0]);
};

export const getCartItemMaxQty = (
  item: Pick<CartItem, "stockStatus" | "stockQty">,
): number | null => {
  if (item.stockStatus === "out_of_stock") return 0;
  if (typeof item.stockQty === "number") return Math.max(0, Math.trunc(item.stockQty));
  return null;
};

export const getCartProductMaxQty = (
  item: Pick<CartItem, "stockStatus" | "stockQty">,
): number => {
  const stockMaxQty = getCartItemMaxQty(item);
  return stockMaxQty === null
    ? MAX_CART_QUANTITY_PER_PRODUCT
    : Math.min(stockMaxQty, MAX_CART_QUANTITY_PER_PRODUCT);
};

export const getCartProductDemand = (
  items: ReadonlyArray<Pick<CartItem, "productId" | "qty">>,
  productId: string,
): number =>
  items.reduce(
    (total, item) => total + (item.productId === productId ? normalizeCartQty(item.qty) : 0),
    0,
  );

export const getOtherCartLinesDemand = (
  items: ReadonlyArray<Pick<CartItem, "lineId" | "productId" | "qty">>,
  productId: string,
  lineId: string,
): number =>
  items.reduce(
    (total, item) =>
      total +
      (item.productId === productId && item.lineId !== lineId ? normalizeCartQty(item.qty) : 0),
    0,
  );

export const getCartProductRemainingQty = (
  items: ReadonlyArray<Pick<CartItem, "productId" | "qty">>,
  productId: string,
  stock: Pick<CartItem, "stockStatus" | "stockQty">,
): number => Math.max(0, getCartProductMaxQty(stock) - getCartProductDemand(items, productId));

export const getCartLineMaxQty = (items: ReadonlyArray<CartItem>, lineId: string): number => {
  const item = items.find((candidate) => candidate.lineId === lineId);
  if (!item) return 0;
  return Math.max(
    0,
    getCartProductMaxQty(item) - getOtherCartLinesDemand(items, item.productId, item.lineId),
  );
};

export const canIncreaseCartLine = (items: ReadonlyArray<CartItem>, lineId: string): boolean => {
  const item = items.find((candidate) => candidate.lineId === lineId);
  return Boolean(item && item.qty < getCartLineMaxQty(items, lineId));
};

export const sanitizeStoredCartItems = (value: unknown): CartItem[] => {
  if (!Array.isArray(value)) return [];
  const usedLineIds = new Set<string>();

  return value
    .filter(
      (candidate): candidate is Record<string, unknown> =>
        Boolean(candidate) && typeof candidate === "object" && typeof candidate.productId === "string",
    )
    .map((item) => {
      const storedLineId = typeof item.lineId === "string" ? item.lineId.trim() : "";
      const lineId =
        storedLineId && !usedLineIds.has(storedLineId)
          ? storedLineId
          : createUniqueCartLineId(usedLineIds);
      usedLineIds.add(lineId);

      return {
        lineId,
        productId: String(item.productId),
        name: item.name ? String(item.name) : "",
        unitPrice: normalizeStoredUnitPrice(item),
        qty: normalizeCartQty(item.qty),
        image: item.image ? String(item.image) : undefined,
        stockStatus: normalizeCartStockStatus(item.stockStatus ?? item.stock_status),
        stockQty: normalizeCartStockQty(item.stockQty ?? item.stock_qty) ?? null,
      } satisfies CartItem;
    })
    .filter((item) => item.qty > 0);
};
