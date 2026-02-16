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

    let intersectionObserver: IntersectionObserver | null = null;
    let mutationObserver: MutationObserver | null = null;

    const attachIntersection = () => {
      const navbar = document.getElementById(NAVBAR_ID);
      if (!navbar) {
        return false;
      }

      intersectionObserver?.disconnect();
      intersectionObserver = new IntersectionObserver(
        ([entry]) => {
          setShowFloating(!entry.isIntersecting);
        },
        {
          threshold: 0,
        }
      );

      intersectionObserver.observe(navbar);
      return true;
    };

    const isAttached = attachIntersection();
    let fallbackTimer: number | null = null;

    if (!isAttached) {
      fallbackTimer = window.setTimeout(() => {
        setShowFloating(true);
      }, 0);

      mutationObserver = new MutationObserver(() => {
        const attached = attachIntersection();
        if (attached) {
          mutationObserver?.disconnect();
          mutationObserver = null;
        }
      });

      mutationObserver.observe(document.body, {
        childList: true,
        subtree: true,
      });
    }

    return () => {
      intersectionObserver?.disconnect();
      mutationObserver?.disconnect();
      if (fallbackTimer !== null) {
        window.clearTimeout(fallbackTimer);
      }
    };
  }, [isTienda]);

  const isVisible = showFloating && !isCartOpen && !suppressFloatingCart;

  if (!isTienda) return null;

  return (
    <button
      onClick={() => setCartOpen(true)}
      className={`fixed right-5 top-5 z-[120] flex h-14 w-14 items-center justify-center rounded-full border border-[var(--brand-gold-300)] bg-[var(--brand-violet-800)] text-2xl text-[var(--brand-cream)] shadow-[0_14px_30px_rgba(26,10,48,0.5)] transition-all duration-300 ease-out ${
        isVisible
          ? "pointer-events-auto translate-y-0 opacity-100"
          : "pointer-events-none -translate-y-2 opacity-0"
      }`}
      aria-label="Abrir carrito flotante"
      aria-hidden={!isVisible}
    >
      <span aria-hidden>🛒</span>
      <CartBadge className="absolute -right-1 -top-1 flex h-5 min-w-5 items-center justify-center rounded-full bg-[var(--brand-gold-300)] px-1 text-[10px] font-bold text-black" />
    </button>
  );
}
