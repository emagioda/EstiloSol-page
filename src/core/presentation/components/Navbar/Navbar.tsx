"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import brandConfig from "@/src/config/brand";
import { useCartDrawer } from "@/src/features/shop/presentation/view-models/useCartDrawer";
import { useCart } from "@/src/features/shop/presentation/view-models/useCartStore";
import CartBadge from "@/src/features/shop/presentation/components/CartBadge/CartBadge";
import TopInfoTicker from "@/src/core/presentation/components/TopInfoTicker/TopInfoTicker";

export default function Navbar() {
  const { navLinks, brandName, logo } = brandConfig;
  const desktopLinks = navLinks.filter(
    (link) => link.label !== "Servicios" && link.label !== "Tienda"
  );
  const mobileLinks = [navLinks[0], navLinks[navLinks.length - 1]].filter(
    Boolean
  );

  const { open: isCartOpen, setOpen: setCartOpen } = useCartDrawer();
  const { items } = useCart();
  const pathname = usePathname();
  const pathnameSegments = (pathname ?? "").split("/").filter(Boolean);
  const isTienda = pathnameSegments.includes("tienda");
  const isHome = (pathname ?? "/") === "/";
  const isContacto = pathnameSegments.includes("contacto");
  const isHomeStyle = isHome || isContacto;
  const tickerMessages = ["Agregar texto", "Agregar texto", "Agregar texto"];
  const [showTicker, setShowTicker] = useState(true);
  const mobileRightLinks = isTienda ? [] : mobileLinks.slice(1);
  const cartCount = items.reduce((sum, item) => sum + (Number(item.qty) || 0), 0);
  const cartTotal = items.reduce((sum, item) => sum + item.unitPrice * item.qty, 0);
  const formattedTotal = new Intl.NumberFormat("es-AR", {
    style: "currency",
    currency: "ARS",
    maximumFractionDigits: 0,
  }).format(cartTotal);

  useEffect(() => {
    const root = document.documentElement;

    if (isTienda && showTicker) {
      root.style.setProperty("--header-height-mobile", "calc(var(--header-height-mobile-base) + var(--safe-area-top) + var(--shop-ticker-height-mobile))");
      root.style.setProperty("--header-height-desktop", "calc(var(--header-height-desktop-base) + var(--shop-ticker-height-desktop))");
      return;
    }

    root.style.setProperty("--header-height-mobile", "calc(var(--header-height-mobile-base) + var(--safe-area-top))");
    root.style.setProperty("--header-height-desktop", "var(--header-height-desktop-base)");

    return () => {
      root.style.setProperty("--header-height-mobile", "calc(var(--header-height-mobile-base) + var(--safe-area-top))");
      root.style.setProperty("--header-height-desktop", "var(--header-height-desktop-base)");
    };
  }, [isTienda, showTicker]);

  useEffect(() => {
    if (!isTienda) {
      setShowTicker(true);
      return;
    }

    const handleTickerVisibility = (event: Event) => {
      const customEvent = event as CustomEvent<{ visible?: boolean }>;
      if (typeof customEvent.detail?.visible !== "boolean") return;
      setShowTicker(customEvent.detail.visible);
    };

    window.addEventListener("shop:ticker-visibility", handleTickerVisibility as EventListener);
    return () => {
      window.removeEventListener("shop:ticker-visibility", handleTickerVisibility as EventListener);
    };
  }, [isTienda]);

  const cartIcon = (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden
      className="h-4.5 w-4.5"
      stroke="currentColor"
      strokeWidth="1.9"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <circle cx="9" cy="20" r="1.25" />
      <circle cx="17" cy="20" r="1.25" />
      <path d="M3 4h2l2.3 10.1a1 1 0 0 0 .97.78h8.85a1 1 0 0 0 .97-.76L20 7H7.4" />
    </svg>
  );

  return (
    <header id="main-navbar" className="fixed inset-x-0 top-0 z-[200] w-full bg-[var(--brand-violet-500)] pt-[var(--safe-area-top)]">
      {isTienda && <TopInfoTicker messages={tickerMessages} durationSeconds={72} hidden={!showTicker} />}
      <nav
        className="h-[var(--header-height-mobile-base)] border-b border-[var(--brand-gold-400)] md:h-[var(--header-height-desktop-base)]"
      >
        <div
          className={`mx-auto flex h-full w-full items-center justify-between gap-6 px-4 md:pl-8 ${
            isHomeStyle ? "md:pr-8" : "md:pr-0"
          }`}
        >
          {/* Mobile: Left links */}
          <div className="flex flex-1 items-center justify-start md:hidden">
            {isTienda ? (
              <button
                type="button"
                onClick={() => {
                  window.dispatchEvent(new CustomEvent("shop:toggle-filters"));
                }}
                className="inline-flex h-8 w-8 items-center justify-center text-[var(--brand-cream)] transition hover:text-[var(--brand-gold-300)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand-gold-300)]"
                aria-label="Abrir filtros"
              >
                <span aria-hidden className="inline-flex h-3.5 w-4 flex-col justify-between">
                  <span className="h-px w-full bg-current" />
                  <span className="h-px w-full bg-current" />
                  <span className="h-px w-full bg-current" />
                </span>
              </button>
            ) : (
              mobileLinks.slice(0, 1).map((link) => (
                <Link
                  key={link.href}
                  href={link.href}
                  className="text-xs font-semibold uppercase tracking-[0.2em] text-[var(--brand-cream)] transition hover:text-[var(--brand-gold-300)]"
                >
                  {link.label}
                </Link>
              ))
            )}
          </div>

          {/* Logo center - visible on all screens */}
          <Link
            href="/"
            aria-label={brandName}
            className="flex flex-shrink-0 items-center justify-center"
          >
            <div className="flex items-center gap-3">
              {logo?.src && logo.isAvailable ? (
                <Image
                  src={logo.src}
                  alt={logo.alt}
                  width={140}
                  height={60}
                  priority
                  className="h-10 w-auto object-contain drop-shadow-[0_4px_10px_rgba(255,215,150,0.35)] md:h-12"
                />
              ) : (
                <div className="flex flex-col items-center">
                  <span
                    className="text-xl font-semibold text-[var(--brand-gold-300)] md:text-2xl"
                    style={{ fontFamily: brandConfig.typography.display }}
                  >
                    {brandName}
                  </span>
                  <span className="hidden text-[10px] uppercase tracking-[0.2em] text-[var(--brand-cream)] md:block">
                    Estilo y Cuidado
                  </span>
                </div>
              )}
            </div>
          </Link>

          {/* Mobile: Right links */}
          <div className="flex flex-1 items-center justify-end md:hidden">
            {mobileRightLinks.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                className="text-xs font-semibold uppercase tracking-[0.2em] text-[var(--brand-cream)] transition hover:text-[var(--brand-gold-300)]"
              >
                {link.label}
              </Link>
            ))}
            {isTienda && (
                <button
                  onClick={() => setCartOpen(!isCartOpen)}
                  className="relative ml-3 inline-flex h-8 w-8 items-center justify-center rounded-full border border-[var(--brand-gold-300)] bg-[var(--brand-violet-900)] text-[var(--brand-cream)] transition hover:border-[var(--brand-gold-300)] hover:text-[var(--brand-gold-300)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand-gold-300)]"
                  aria-label={isCartOpen ? "Cerrar carrito" : "Abrir carrito"}
                >
                  {cartIcon}
                  <CartBadge className="absolute -right-1 -top-1 flex h-[1.1rem] min-w-[1.1rem] items-center justify-center rounded-full border border-[var(--brand-violet-900)] bg-[var(--brand-gold-300)] px-1 text-[9px] font-bold leading-none tabular-nums text-black shadow-[0_4px_10px_rgba(0,0,0,0.25)]" />
                </button>
            )}
          </div>

          {/* Desktop: Right links + Cart */}
          <div className="hidden ml-auto items-center gap-6 text-sm uppercase tracking-[0.2em] text-[var(--brand-cream)] md:flex">
            {desktopLinks.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                className="transition hover:text-[var(--brand-gold-300)]"
              >
                {link.label}
              </Link>
            ))}
            {isTienda && (
              <div className="-mr-5 flex items-center gap-2.5 pl-1">
                <span aria-hidden className="h-5 w-px rounded-full bg-[var(--brand-gold-300)]" />
                <button
                  onClick={() => setCartOpen(!isCartOpen)}
                  className="relative inline-flex items-center gap-2 text-[var(--brand-cream)] transition hover:text-[var(--brand-gold-300)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand-gold-300)]"
                  aria-label={isCartOpen ? "Cerrar carrito" : "Abrir carrito"}
                >
                  <svg
                    viewBox="0 0 24 24"
                    fill="none"
                    aria-hidden
                    className="h-5 w-5"
                    stroke="currentColor"
                    strokeWidth="1.9"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <circle cx="9" cy="20" r="1.25" />
                    <circle cx="17" cy="20" r="1.25" />
                    <path d="M3 4h2l2.3 10.1a1 1 0 0 0 .97.78h8.85a1 1 0 0 0 .97-.76L20 7H7.4" />
                  </svg>
                  <span className="flex min-w-[7.25rem] flex-col items-start text-left normal-case tracking-normal leading-tight">
                    <span className="text-xs font-semibold text-[var(--brand-cream)]">Carrito ({cartCount})</span>
                    <span className="text-[11px] text-[var(--brand-gold-300)]">{formattedTotal}</span>
                  </span>
                </button>
              </div>
            )}
          </div>
        </div>
      </nav>
    </header>
  );
}
