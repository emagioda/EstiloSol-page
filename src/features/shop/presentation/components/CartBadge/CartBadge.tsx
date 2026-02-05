"use client";
import React from "react";
import { useCart } from "@/src/features/shop/presentation/view-models/useCartStore";

export default function CartBadge({ className }: { className?: string }) {
  const { items } = useCart();
  const count = items.reduce((s, it) => s + (Number(it.qty) || 0), 0);
  if (count <= 0) return null;
  return (
    <span className={className ? className : "absolute -top-2 -right-2 flex h-5 w-5 items-center justify-center rounded-full bg-[var(--brand-gold-300)] text-xs font-bold text-black"}>
      {count}
    </span>
  );
}
