"use client";
import React from "react";
import { useCart } from "@/src/features/shop/presentation/view-models/useCartStore";

export default function CartCounter() {
  const { items } = useCart();
  const count = items.reduce((s, it) => s + (Number(it.qty) || 0), 0);

  if (count === 0) return null;

  return (
    <div className="fixed bottom-6 right-6 z-50 flex items-center gap-2 rounded-full bg-[var(--brand-violet-900)]/90 px-3 py-2 text-sm text-[var(--brand-cream)] shadow-lg md:bottom-8 md:right-8">
      <span className="text-lg">🛒</span>
      <span className="font-semibold">{count}</span>
    </div>
  );
}
