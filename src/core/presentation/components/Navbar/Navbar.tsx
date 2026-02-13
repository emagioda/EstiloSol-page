"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import brandConfig from "@/src/config/brand";
import { useCartDrawer } from "@/src/features/shop/presentation/view-models/useCartDrawer";
import CartBadge from "@/src/features/shop/presentation/components/CartBadge/CartBadge";

export default function Navbar() {
  const { navLinks, brandName, logo } = brandConfig;
  const leftLinks = navLinks.slice(0, 2);
  const rightLinks = navLinks.slice(2);
  const mobileLinks = [navLinks[0], navLinks[navLinks.length - 1]].filter(
    Boolean
  );

  const { setOpen: setCartOpen } = useCartDrawer();
  const pathname = usePathname();
  const isTienda = pathname?.startsWith("/tienda");

  return (
    <header className="w-full">
      <nav id="main-navbar" className="backdrop-blur-sm bg-[rgba(58,31,95,0.75)] border-b border-[var(--brand-gold-400)]/60">
        <div className="mx-auto flex w-full items-center justify-between gap-6 px-4 py-3 md:px-8">
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
            {mobileLinks.slice(1).map((link) => (
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
                  onClick={() => setCartOpen(true)}
                  className="relative ml-3 text-xl"
                  aria-label="Abrir carrito"
                >
                  🛒
                  <CartBadge />
                </button>
            )}
          </div>

          {/* Desktop: Left links */}
          <div className="hidden flex-1 items-center justify-start gap-6 text-sm uppercase tracking-[0.2em] text-[var(--brand-cream)] md:flex">
            {leftLinks.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                className="transition hover:text-[var(--brand-gold-300)]"
              >
                {link.label}
              </Link>
            ))}
          </div>

          {/* Desktop: Right links + Cart */}
          <div className="hidden flex-1 items-center justify-end gap-6 text-sm uppercase tracking-[0.2em] text-[var(--brand-cream)] md:flex">
            {rightLinks.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                className="transition hover:text-[var(--brand-gold-300)]"
              >
                {link.label === "Tienda" ? "Tienda Híbrida" : link.label}
              </Link>
            ))}
            {isTienda && (
                <button
                  onClick={() => setCartOpen(true)}
                  className="relative flex items-center gap-2 transition hover:text-[var(--brand-gold-300)]"
                  aria-label="Abrir carrito"
                >
                  <span className="text-xl">🛒</span>
                  <CartBadge />
                </button>
            )}
          </div>
        </div>
      </nav>
    </header>
  );
}
