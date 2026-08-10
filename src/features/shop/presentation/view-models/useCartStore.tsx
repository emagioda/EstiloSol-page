"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  createUniqueCartLineId,
  getCartLineMaxQty,
  getCartProductDemand,
  getCartProductMaxQty,
  normalizeCartPrice,
  normalizeCartQty,
  normalizeCartStockQty,
  normalizeCartStockStatus,
  sanitizeStoredCartItems,
  type CartItem,
  type CartItemInput,
} from "@/src/features/shop/domain/cartLines";
import { getCashTransferDiscountedTotal } from "@/src/features/shop/domain/cashTransferDiscount";
import type { Product } from "@/src/features/shop/domain/entities/Product";

export {
  MAX_CART_QUANTITY_PER_PRODUCT,
  canIncreaseCartLine,
  createUniqueCartLineId,
  getCartItemMaxQty,
  getCartLineMaxQty,
  getCartProductDemand,
  getCartProductMaxQty,
  getCartProductRemainingQty,
  getOtherCartLinesDemand,
  sanitizeStoredCartItems,
} from "@/src/features/shop/domain/cartLines";
export type { CartItem, CartItemInput } from "@/src/features/shop/domain/cartLines";

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
  addItem: (item: CartItemInput) => AddItemResult;
  removeItem: (lineId: string) => void;
  updateQty: (lineId: string, qty: number) => void;
  syncStockFromProducts: (products: Product[]) => void;
  clear: () => void;
  setPaymentMethod: (method: PaymentMethod) => void;
  getTotal: () => number;
  getDiscountedTotal: () => number;
};

const STORAGE_KEY = "es_sol_cart_v1";
export const CART_UPDATED_EVENT = "es:cart-updated";

const CartContext = createContext<CartContextValue | undefined>(undefined);

const readItemsFromStorage = (): CartItem[] => {
  try {
    const raw = typeof window !== "undefined" ? localStorage.getItem(STORAGE_KEY) : null;
    if (!raw) return [];
    const sanitizedItems = sanitizeStoredCartItems(JSON.parse(raw));
    const serializedItems = JSON.stringify(sanitizedItems);
    if (serializedItems !== raw) {
      try {
        localStorage.setItem(STORAGE_KEY, serializedItems);
      } catch {}
    }
    return sanitizedItems;
  } catch {
    return [];
  }
};

const cartItemsSignature = (items: CartItem[]) =>
  items
    .map((item) =>
      [
        item.lineId,
        item.productId,
        item.name,
        item.unitPrice,
        item.qty,
        item.image || "",
        item.stockStatus || "",
        item.stockQty ?? "",
      ].join("|"),
    )
    .join("~");

export const getCartSnapshotFromItems = (
  items: Array<Pick<CartItem, "qty" | "unitPrice">>,
) => ({
  count: items.reduce((sum, item) => sum + (Number(item.qty) || 0), 0),
  total: items.reduce(
    (sum, item) => sum + normalizeCartPrice(item.unitPrice) * normalizeCartQty(item.qty),
    0,
  ),
});

export const readCartSnapshotFromStorage = () => getCartSnapshotFromItems(readItemsFromStorage());

const emitCartUpdated = (items: CartItem[]) => {
  if (typeof window === "undefined") return;

  try {
    window.dispatchEvent(
      new CustomEvent(CART_UPDATED_EVENT, { detail: getCartSnapshotFromItems(items) }),
    );
  } catch {
    try {
      window.dispatchEvent(new CustomEvent(CART_UPDATED_EVENT));
    } catch {}
  }
};

export const CartProvider = ({ children }: { children: React.ReactNode }) => {
  const [items, setItems] = useState<CartItem[]>([]);
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>("mercadopago");
  const [storageHydrated, setStorageHydrated] = useState(false);
  const itemsRef = useRef<CartItem[]>([]);
  const itemsSignatureRef = useRef(cartItemsSignature([]));

  const commitItems = useCallback((nextItems: CartItem[]) => {
    itemsRef.current = nextItems;
    itemsSignatureRef.current = cartItemsSignature(nextItems);
    setItems(nextItems);
  }, []);

  useEffect(() => {
    itemsRef.current = items;
    itemsSignatureRef.current = cartItemsSignature(items);
  }, [items]);

  useLayoutEffect(() => {
    const hydrateTimer = window.setTimeout(() => {
      commitItems(readItemsFromStorage());
      setStorageHydrated(true);
    }, 0);

    return () => window.clearTimeout(hydrateTimer);
  }, [commitItems]);

  useEffect(() => {
    if (!storageHydrated) return;

    try {
      const toPersist = items.filter(
        (item) => item && typeof item.productId === "string" && Number(item.qty) > 0,
      );
      localStorage.setItem(STORAGE_KEY, JSON.stringify(toPersist));
      emitCartUpdated(toPersist);
    } catch {}
  }, [items, storageHydrated]);

  const refreshItemsFromStorage = useCallback(() => {
    const storedItems = readItemsFromStorage();
    if (cartItemsSignature(storedItems) !== itemsSignatureRef.current) {
      commitItems(storedItems);
    }
  }, [commitItems]);

  useEffect(() => {
    const handlePageShow = () => refreshItemsFromStorage();
    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") refreshItemsFromStorage();
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

  const addItem = useCallback(
    (item: CartItemInput): AddItemResult => {
      const safeQty = normalizeCartQty(item.qty);
      const productId = typeof item.productId === "string" ? item.productId.trim() : "";
      if (!productId || safeQty <= 0) {
        return {
          ok: false,
          reason: "invalid_item",
          addedQty: 0,
          finalQty: 0,
          maxQty: null,
        };
      }

      const normalizedItem: CartItemInput = {
        ...item,
        productId,
        unitPrice: normalizeCartPrice(item.unitPrice),
        stockStatus: normalizeCartStockStatus(item.stockStatus),
        stockQty: normalizeCartStockQty(item.stockQty) ?? null,
      };
      const currentItems = itemsRef.current;
      const maxQty = getCartProductMaxQty(normalizedItem);
      const currentQty = getCartProductDemand(currentItems, productId);
      const availableQty = Math.max(0, maxQty - currentQty);

      if (maxQty <= 0) {
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
      const existingLine = currentItems.find((candidate) => candidate.productId === productId);
      if (existingLine) {
        const finalQty = currentQty + addedQty;
        commitItems(
          currentItems
            .filter(
              (candidate) =>
                candidate.productId !== productId || candidate.lineId === existingLine.lineId,
            )
            .map((candidate) =>
              candidate.lineId === existingLine.lineId
                ? { ...candidate, ...normalizedItem, lineId: existingLine.lineId, qty: finalQty }
                : candidate,
            ),
        );

        return {
          ok: true,
          addedQty,
          finalQty,
          maxQty,
          reason: addedQty < safeQty ? "max_stock_reached" : undefined,
        };
      }

      const lineId = createUniqueCartLineId(
        new Set(currentItems.map((candidate) => candidate.lineId)),
      );
      commitItems([...currentItems, { ...normalizedItem, lineId, qty: addedQty }]);

      return {
        ok: true,
        addedQty,
        finalQty: currentQty + addedQty,
        maxQty,
        reason: addedQty < safeQty ? "max_stock_reached" : undefined,
      };
    },
    [commitItems],
  );

  const removeItem = useCallback(
    (lineId: string) => {
      commitItems(itemsRef.current.filter((item) => item.lineId !== lineId));
    },
    [commitItems],
  );

  const updateQty = useCallback(
    (lineId: string, qty: number) => {
      const currentItems = itemsRef.current;
      if (!currentItems.some((item) => item.lineId === lineId)) return;

      const requestedQty = normalizeCartQty(qty);
      if (requestedQty <= 0) {
        commitItems(currentItems.filter((item) => item.lineId !== lineId));
        return;
      }

      const safeQty = Math.min(requestedQty, getCartLineMaxQty(currentItems, lineId));
      if (safeQty <= 0) {
        commitItems(currentItems.filter((item) => item.lineId !== lineId));
        return;
      }

      commitItems(
        currentItems.map((item) => (item.lineId === lineId ? { ...item, qty: safeQty } : item)),
      );
    },
    [commitItems],
  );

  const syncStockFromProducts = useCallback(
    (products: Product[]) => {
      const productsById = new Map(products.map((product) => [product.id, product]));
      commitItems(
        itemsRef.current.map((item) => {
          const product = productsById.get(item.productId);
          if (!product) return item;

          return {
            ...item,
            name: product.variant_name
              ? `${product.name} - ${product.variant_name}`
              : product.name || item.name,
            unitPrice: normalizeCartPrice(product.price),
            image: product.images?.[0] || item.image,
            stockStatus: normalizeCartStockStatus(product.stock_status),
            stockQty: normalizeCartStockQty(product.stock_qty) ?? null,
            qty: item.qty,
          };
        }),
      );
    },
    [commitItems],
  );

  const clear = useCallback(() => commitItems([]), [commitItems]);
  const getTotal = useCallback(
    () => items.reduce((sum, item) => sum + item.unitPrice * item.qty, 0),
    [items],
  );
  const getDiscountedTotal = useCallback(
    () => getCashTransferDiscountedTotal(getTotal()),
    [getTotal],
  );

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
    ],
  );

  return <CartContext.Provider value={value}>{children}</CartContext.Provider>;
};

export const useCart = () => {
  const context = useContext(CartContext);
  if (!context) throw new Error("useCart must be used within a CartProvider");
  return context;
};
