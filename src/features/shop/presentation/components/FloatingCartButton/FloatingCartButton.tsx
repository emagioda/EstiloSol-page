"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import CartBadge from "@/src/features/shop/presentation/components/CartBadge/CartBadge";
import { useCartDrawer } from "@/src/features/shop/presentation/view-models/useCartDrawer";
import { useCartBadgeVisibility } from "@/src/features/shop/presentation/view-models/useCartBadgeVisibility";

const NAVBAR_ID = "main-navbar";

export default function FloatingCartButton() {
  const [showFloating, setShowFloating] = useState(false);
  const pathname = usePathname();
  const isTienda = pathname?.startsWith("/tienda");
  const { open: isCartOpen, setOpen: setCartOpen } = useCartDrawer();
  const { suppressFloatingCart } = useCartBadgeVisibility();

  useEffect(() => {
    if (!isTienda) {
      return;
    }

    const navbar = document.getElementById(NAVBAR_ID);
  
    if (!navbar) {
      return;
    }

    const observer = new IntersectionObserver(
      ([entry]) => {
        setShowFloating(!entry.isIntersecting);
      },
      {
        threshold: 0,
      }
    );

    observer.observe(navbar);

    return () => {
      observer.disconnect();
    };
  }, [isTienda]);

  if (!isTienda) return null;

  return (
    <button
      onClick={() => setCartOpen(true)}
      className={`fixed right-5 top-5 z-[120] flex h-14 w-14 items-center justify-center rounded-full border border-[var(--brand-gold-300)] bg-[var(--brand-violet-800)] text-2xl text-[var(--brand-cream)] shadow-[0_14px_30px_rgba(26,10,48,0.5)] transition-all duration-300 ease-out ${
        showFloating && !isCartOpen && !suppressFloatingCart
          ? "pointer-events-auto translate-y-0 opacity-100"
          : "pointer-events-none -translate-y-2 opacity-0"
      }`}
      aria-label="Abrir carrito flotante"
      aria-hidden={!showFloating || isCartOpen || suppressFloatingCart}
    >
      <span aria-hidden>🛒</span>
      <CartBadge className="absolute -right-1 -top-1 flex h-5 min-w-5 items-center justify-center rounded-full bg-[var(--brand-gold-300)] px-1 text-[10px] font-bold text-black" />
    </button>
  );
}
