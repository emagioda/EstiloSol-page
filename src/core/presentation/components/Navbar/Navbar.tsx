"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import brandConfig from "@/src/config/brand";
import { useCartDrawer } from "@/src/features/shop/presentation/view-models/useCartDrawer";
import { useCart } from "@/src/features/shop/presentation/view-models/useCartStore";
import CartBadge from "@/src/features/shop/presentation/components/CartBadge/CartBadge";

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
  const mobileRightLinks = isTienda ? [] : mobileLinks.slice(1);
  const cartCount = items.reduce((sum, item) => sum + (Number(item.qty) || 0), 0);
  const cartTotal = items.reduce((sum, item) => sum + item.unitPrice * item.qty, 0);
  const formattedTotal = new Intl.NumberFormat("es-AR", {
    style: "currency",
    currency: "ARS",
    maximumFractionDigits: 0,
  }).format(cartTotal);

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
    <header className="fixed inset-x-0 top-0 z-[200] w-full">
      <nav id="main-navbar" className="backdrop-blur-sm bg-[rgba(58,31,95,0.75)] border-b border-[var(--brand-gold-400)]/60">
        <div
          className={`mx-auto flex w-full items-center justify-between gap-6 px-4 py-3 md:pl-8 ${
            isHome ? "md:pr-8" : "md:pr-0"
          }`}
        >
          {/* Mobile: Left links */}
          <div className="flex flex-1 items-center justify-start md:hidden">
            {mobileLinks.slice(0, 1).map((link) => (
              <Link
                key={link.href}
                href={link.href}
                className="text-xs font-semibold uppercase tracking-[0.2em] text-[var(--brand-cream)] transition hover:text-[var(--brand-gold-300)]"
              >
                {link.label}
              </Link>
            ))}
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
                  <span className="hidden text-[10px] uppercase tracking-[0.2em] text-[var(--brand-cream)]/80 md:block">
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
                  className="relative ml-3 inline-flex h-8 w-8 items-center justify-center rounded-full border border-[var(--brand-gold-300)]/45 bg-[var(--brand-violet-900)]/85 text-[var(--brand-cream)] shadow-[0_10px_24px_rgba(18,8,35,0.35)] transition hover:border-[var(--brand-gold-300)] hover:text-[var(--brand-gold-300)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand-gold-300)]"
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
                <span aria-hidden className="h-5 w-px rounded-full bg-[var(--brand-gold-300)]/45" />
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
