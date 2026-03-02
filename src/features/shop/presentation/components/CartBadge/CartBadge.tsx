"use client";
import { useCart } from "@/src/features/shop/presentation/view-models/useCartStore";
import { useCartBadgeVisibility } from "@/src/features/shop/presentation/view-models/useCartBadgeVisibility";

export default function CartBadge({ className }: { className?: string }) {
  const { items } = useCart();
  const { suppressBadge } = useCartBadgeVisibility();
  const count = items.reduce((s, it) => s + (Number(it.qty) || 0), 0);
  const visibleCount = count > 99 ? "99+" : String(count);
  const hidden = count <= 0 || suppressBadge;
  return (
    <span
      suppressHydrationWarning
      aria-hidden={hidden}
      className={
        className
          ? `${className}${hidden ? " opacity-0 pointer-events-none" : ""}`
          : `absolute -top-2 -right-2 flex h-5 min-w-5 items-center justify-center rounded-full border border-[var(--brand-violet-900)] bg-[var(--brand-gold-300)] px-1 text-[10px] font-bold leading-none tabular-nums text-black${
              hidden ? " opacity-0 pointer-events-none" : ""
            }`
      }
    >
      {hidden ? "" : visibleCount}
    </span>
  );
}
