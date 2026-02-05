"use client";
import React, { createContext, useContext, useEffect, useState } from "react";

export type CartItem = {
  productId: string;
  name: string;
  unitPrice: number;
  qty: number;
  image?: string;
};

type CartContextValue = {
  items: CartItem[];
  addItem: (item: CartItem) => void;
  removeItem: (productId: string) => void;
  updateQty: (productId: string, qty: number) => void;
  clear: () => void;
};

const STORAGE_KEY = "es_sol_cart_v1";

const CartContext = createContext<CartContextValue | undefined>(undefined);

export const CartProvider = ({ children }: { children: React.ReactNode }) => {
  const [items, setItems] = useState<CartItem[]>(() => {
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
          unitPrice: typeof it.unitPrice === "number" ? it.unitPrice : Number(it.unitPrice) || 0,
          qty: Number(it.qty) || 0,
          image: it.image ? String(it.image) : undefined,
        }))
        .filter((it) => it.qty > 0);

      return sanitized;
    } catch {
      return [];
    }
  });

  useEffect(() => {
    try {
      // Persist only valid items (qty > 0)
      const toPersist = items.filter((it) => it && typeof it.productId === "string" && Number(it.qty) > 0);
      localStorage.setItem(STORAGE_KEY, JSON.stringify(toPersist));
    } catch {}
  }, [items]);

  const addItem = (item: CartItem) => {
    setItems((prev) => {
      const found = prev.find((p) => p.productId === item.productId);
      if (found) {
        return prev.map((p) => (p.productId === item.productId ? { ...p, qty: p.qty + item.qty } : p));
      }
      return [...prev, item];
    });
  };

  const removeItem = (productId: string) => setItems((prev) => prev.filter((p) => p.productId !== productId));

  const updateQty = (productId: string, qty: number) => {
    setItems((prev) => prev.map((p) => (p.productId === productId ? { ...p, qty } : p)));
  };

  const clear = () => setItems([]);

  return (
    <CartContext.Provider value={{ items, addItem, removeItem, updateQty, clear }}>{children}</CartContext.Provider>
  );
};

export const useCart = () => {
  const ctx = useContext(CartContext);
  if (!ctx) {
    throw new Error("useCart must be used within a CartProvider");
  }
  return ctx;
};
