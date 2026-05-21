"use client";
import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { Product, StockStatus } from "@/src/features/shop/domain/entities/Product";

export type CartItem = {
  productId: string;
  name: string;
  unitPrice: number;
  qty: number;
  image?: string;
  stockStatus?: StockStatus;
  stockQty?: number | null;
};

export type PaymentMethod = "mercadopago" | "transfer" | "cash";
export type AddItemResult = {
  ok: boolean;
  reason?: "invalid_item" | "out_of_stock" | "max_stock_reached";
  addedQty: number;
  finalQty: number;
  maxQty: number | null;
};

type CartContextValue = {
  items: CartItem[];
  paymentMethod: PaymentMethod;
  addItem: (item: CartItem) => AddItemResult;
  removeItem: (productId: string) => void;
  updateQty: (productId: string, qty: number) => void;
  syncStockFromProducts: (products: Product[]) => void;
  clear: () => void;
  setPaymentMethod: (method: PaymentMethod) => void;
  getTotal: () => number;
  getDiscountedTotal: () => number;
};

const STORAGE_KEY = "es_sol_cart_v1";
export const CART_UPDATED_EVENT = "es:cart-updated";
const MAX_ITEM_QTY = 50;

const normalizeQty = (value: unknown): number => {
  const qty = Number(value);
  if (!Number.isFinite(qty)) return 0;
  const intQty = Math.trunc(qty);
  if (intQty < 1) return 0;
  return Math.min(intQty, MAX_ITEM_QTY);
};

const normalizePrice = (value: unknown): number => {
  const price = Number(value);
  if (!Number.isFinite(price) || price < 0) return 0;
  return Number(price.toFixed(2));
};

const normalizeStockQty = (value: unknown): number | null | undefined => {
  if (value === undefined) return undefined;
  if (value === null || value === "") return null;

  const qty = Number(value);
  if (!Number.isFinite(qty)) return null;
  return Math.max(0, Math.trunc(qty));
};

const normalizeStockStatus = (value: unknown): StockStatus | undefined => {
  if (value === "in_stock" || value === "out_of_stock" || value === "preorder") {
    return value;
  }

  return undefined;
};

const normalizeStoredUnitPrice = (item: Record<string, unknown>): number => {
  const candidates = [item.unitPrice, item.unit_price, item.price, item.precio];

  for (const candidate of candidates) {
    const price = normalizePrice(candidate);
    if (price > 0) return price;
  }

  return normalizePrice(candidates[0]);
};

export const getCartItemMaxQty = (item: Pick<CartItem, "stockStatus" | "stockQty">): number | null => {
  if (item.stockStatus === "out_of_stock") return 0;
  if (typeof item.stockQty === "number") return Math.max(0, Math.trunc(item.stockQty));
  return null;
};

export const canIncreaseCartItem = (item: Pick<CartItem, "qty" | "stockStatus" | "stockQty">): boolean => {
  const maxQty = getCartItemMaxQty(item);
  if (maxQty === 0) return false;
  if (maxQty === null) return item.qty < MAX_ITEM_QTY;
  return item.qty < maxQty;
};

const clampQtyForStock = (
  qty: number,
  item: Pick<CartItem, "stockStatus" | "stockQty">
): number => {
  const maxQty = getCartItemMaxQty(item);
  if (maxQty === 0) return 0;
  if (maxQty === null) return Math.min(qty, MAX_ITEM_QTY);
  return Math.min(qty, maxQty);
};

const CartContext = createContext<CartContextValue | undefined>(undefined);

const readItemsFromStorage = (): CartItem[] => {
  try {
    const raw = typeof window !== "undefined" ? localStorage.getItem(STORAGE_KEY) : null;
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    // sanitize stored items: ensure required fields and qty>0
    const sanitized = parsed
      .filter((it) => it && typeof it.productId === "string")
      .map((it) => ({
        productId: String(it.productId),
        name: it.name ? String(it.name) : "",
        unitPrice: normalizeStoredUnitPrice(it),
        qty: normalizeQty(it.qty),
        image: it.image ? String(it.image) : undefined,
        stockStatus: normalizeStockStatus(it.stockStatus ?? it.stock_status),
        stockQty: normalizeStockQty(it.stockQty ?? it.stock_qty) ?? null,
      }))
      .filter((it) => it.qty > 0);

    return sanitized;

    return sanitized;
  } catch {
    return [];
  }
};

const cartItemsSignature = (items: CartItem[]) =>
  items
    .map((item) =>
      [
        item.productId,
        item.name,
        item.unitPrice,
        item.qty,
        item.image || "",
        item.stockStatus || "",
        item.stockQty ?? "",
      ].join("|")
    )
    .sort()
    .join("~");

export const getCartSnapshotFromItems = (
  items: Array<Pick<CartItem, "qty" | "unitPrice">>
) => ({
  count: items.reduce((sum, item) => sum + (Number(item.qty) || 0), 0),
  total: items.reduce(
    (sum, item) => sum + normalizePrice(item.unitPrice) * normalizeQty(item.qty),
    0
  ),
});

export const readCartSnapshotFromStorage = () => getCartSnapshotFromItems(readItemsFromStorage());

const emitCartUpdated = (items: CartItem[]) => {
  if (typeof window === "undefined") return;

  try {
    const snapshot = getCartSnapshotFromItems(items);
    window.dispatchEvent(
      new CustomEvent(CART_UPDATED_EVENT, {
        detail: snapshot,
      })
    );
  } catch {
    try {
      window.dispatchEvent(new CustomEvent(CART_UPDATED_EVENT));
    } catch {}
  }
};

export const CartProvider = ({ children }: { children: React.ReactNode }) => {
  const [items, setItems] = useState<CartItem[]>(() =>
    typeof window !== "undefined" ? readItemsFromStorage() : []
  );
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>("mercadopago");
  const [storageHydrated, setStorageHydrated] = useState(false);
  const itemsSignatureRef = useRef(cartItemsSignature([]));

  useEffect(() => {
    itemsSignatureRef.current = cartItemsSignature(items);
  }, [items]);

  useLayoutEffect(() => {
    const hydrateTimer = window.setTimeout(() => {
      const storedItems = readItemsFromStorage();
      itemsSignatureRef.current = cartItemsSignature(storedItems);
      setItems(storedItems);
      setStorageHydrated(true);
    }, 0);

    return () => window.clearTimeout(hydrateTimer);
  }, []);

  useEffect(() => {
    if (!storageHydrated) return;

    try {
      // Persist only valid items (qty > 0)
      const toPersist = items.filter((it) => it && typeof it.productId === "string" && Number(it.qty) > 0);
      localStorage.setItem(STORAGE_KEY, JSON.stringify(toPersist));
      emitCartUpdated(toPersist);
    } catch {}
  }, [items, storageHydrated]);

  const refreshItemsFromStorage = useCallback(() => {
    const storedItems = readItemsFromStorage();
    itemsSignatureRef.current = cartItemsSignature(storedItems);
    setItems(storedItems);
  }, []);

  useEffect(() => {
    const handlePageShow = () => {
      refreshItemsFromStorage();
    };

    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        refreshItemsFromStorage();
      }
    };

    window.addEventListener("pageshow", handlePageShow);
    window.addEventListener("focus", handlePageShow);
    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      window.removeEventListener("pageshow", handlePageShow);
      window.removeEventListener("focus", handlePageShow);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [refreshItemsFromStorage]);

  const addItem = useCallback((item: CartItem): AddItemResult => {
    const safeQty = normalizeQty(item.qty);
    if (!item.productId || safeQty <= 0) {
      return {
        ok: false,
        reason: "invalid_item",
        addedQty: 0,
        finalQty: 0,
        maxQty: null,
      };
    }

    const safePrice = normalizePrice(item.unitPrice);
    const stockStatus = normalizeStockStatus(item.stockStatus);
    const stockQty = normalizeStockQty(item.stockQty);
    const normalizedItem: CartItem = {
      ...item,
      unitPrice: safePrice,
      stockStatus,
      stockQty: stockQty === undefined ? null : stockQty,
    };
    const maxQty = getCartItemMaxQty(normalizedItem);
    const found = items.find((p) => p.productId === item.productId);
    const currentQty = found?.qty ?? 0;
    const absoluteMaxQty = maxQty ?? MAX_ITEM_QTY;
    const availableQty = Math.max(0, absoluteMaxQty - currentQty);

    if (absoluteMaxQty <= 0) {
      return {
        ok: false,
        reason: "out_of_stock",
        addedQty: 0,
        finalQty: currentQty,
        maxQty,
      };
    }

    if (availableQty <= 0) {
      return {
        ok: false,
        reason: "max_stock_reached",
        addedQty: 0,
        finalQty: currentQty,
        maxQty,
      };
    }

    const addedQty = Math.min(safeQty, availableQty);
    const finalQty = currentQty + addedQty;

    setItems((prev) => {
      const found = prev.find((p) => p.productId === item.productId);
      if (found) {
        return prev.map((p) =>
          p.productId === item.productId
            ? {
                ...p,
                ...normalizedItem,
                qty: clampQtyForStock(p.qty + safeQty, normalizedItem),
              }
            : p
        );
      }
      return [
        ...prev,
        {
          ...normalizedItem,
          qty: addedQty,
        },
      ];
    });

    return {
      ok: true,
      addedQty,
      finalQty,
      maxQty,
      reason: addedQty < safeQty ? "max_stock_reached" : undefined,
    };
  }, [items]);

  const removeItem = useCallback(
    (productId: string) => setItems((prev) => prev.filter((p) => p.productId !== productId)),
    []
  );

  const updateQty = useCallback((productId: string, qty: number) => {
    const safeQty = normalizeQty(qty);
    setItems((prev) =>
      safeQty <= 0
        ? prev.filter((p) => p.productId !== productId)
        : prev.map((p) =>
            p.productId === productId
              ? { ...p, qty: safeQty }
              : p
          )
    );
  }, []);

  const syncStockFromProducts = useCallback((products: Product[]) => {
    const productsById = new Map(products.map((product) => [product.id, product]));

    setItems((prev) =>
      prev
        .map((item) => {
          const product = productsById.get(item.productId);
          if (!product) return item;

          const syncedItem: CartItem = {
            ...item,
            name: product.name || item.name,
            unitPrice: normalizePrice(product.price),
            image: item.image || product.images?.[0],
            stockStatus: normalizeStockStatus(product.stock_status),
            stockQty: normalizeStockQty(product.stock_qty) ?? null,
          };

          return {
            ...syncedItem,
            qty: item.qty,
          };
        })
        .filter((item) => item.qty > 0)
    );
  }, []);

  const clear = useCallback(() => setItems([]), []);
  const getTotal = useCallback(
    () => items.reduce((sum, item) => sum + item.unitPrice * item.qty, 0),
    [items]
  );
  const getDiscountedTotal = useCallback(() => Math.round(getTotal() * 0.9), [getTotal]);

  const value = useMemo(
    () => ({
      items,
      paymentMethod,
      addItem,
      removeItem,
      updateQty,
      syncStockFromProducts,
      clear,
      setPaymentMethod,
      getTotal,
      getDiscountedTotal,
    }),
    [
      items,
      paymentMethod,
      addItem,
      removeItem,
      updateQty,
      syncStockFromProducts,
      clear,
      getTotal,
      getDiscountedTotal,
    ]
  );

  return <CartContext.Provider value={value}>{children}</CartContext.Provider>;
};

export const useCart = () => {
  const ctx = useContext(CartContext);
  if (!ctx) {
    throw new Error("useCart must be used within a CartProvider");
  }
  return ctx;
};
