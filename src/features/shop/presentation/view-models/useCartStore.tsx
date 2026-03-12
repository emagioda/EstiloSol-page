"use client";
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";

export type CartItem = {
  productId: string;
  name: string;
  unitPrice: number;
  qty: number;
  image?: string;
};

export type PaymentMethod = "mercadopago" | "transfer" | "cash";

type CartContextValue = {
  items: CartItem[];
  paymentMethod: PaymentMethod;
  addItem: (item: CartItem) => void;
  removeItem: (productId: string) => void;
  updateQty: (productId: string, qty: number) => void;
  clear: () => void;
  setPaymentMethod: (method: PaymentMethod) => void;
  getTotal: () => number;
  getDiscountedTotal: () => number;
};

const STORAGE_KEY = "es_sol_cart_v1";
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
        unitPrice: normalizePrice(it.unitPrice),
        qty: normalizeQty(it.qty),
        image: it.image ? String(it.image) : undefined,
      }))
      .filter((it) => it.qty > 0);

    return sanitized;
  } catch {
    return [];
  }
};

export const CartProvider = ({ children }: { children: React.ReactNode }) => {
  const [items, setItems] = useState<CartItem[]>(() => readItemsFromStorage());
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>("mercadopago");

  useEffect(() => {
    try {
      // Persist only valid items (qty > 0)
      const toPersist = items.filter((it) => it && typeof it.productId === "string" && Number(it.qty) > 0);
      localStorage.setItem(STORAGE_KEY, JSON.stringify(toPersist));
    } catch {}
  }, [items]);

  const addItem = useCallback((item: CartItem) => {
    const safeQty = normalizeQty(item.qty);
    if (!item.productId || safeQty <= 0) return;

    const safePrice = normalizePrice(item.unitPrice);

    setItems((prev) => {
      const found = prev.find((p) => p.productId === item.productId);
      if (found) {
        return prev.map((p) =>
          p.productId === item.productId
            ? { ...p, qty: Math.min(MAX_ITEM_QTY, p.qty + safeQty), unitPrice: safePrice }
            : p
        );
      }
      return [
        ...prev,
        {
          ...item,
          unitPrice: safePrice,
          qty: safeQty,
        },
      ];
    });
  }, []);

  const removeItem = useCallback(
    (productId: string) => setItems((prev) => prev.filter((p) => p.productId !== productId)),
    []
  );

  const updateQty = useCallback((productId: string, qty: number) => {
    const safeQty = normalizeQty(qty);
    setItems((prev) =>
      safeQty <= 0
        ? prev.filter((p) => p.productId !== productId)
        : prev.map((p) => (p.productId === productId ? { ...p, qty: safeQty } : p))
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
