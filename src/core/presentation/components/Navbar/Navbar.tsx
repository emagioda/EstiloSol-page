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
import NavDrawer from "@/src/core/presentation/components/NavDrawer/NavDrawer";

export default function Navbar() {
  const { brandName, logo } = brandConfig;

  const { open: isCartOpen, setOpen: setCartOpen } = useCartDrawer();
  const { items } = useCart();
  const pathname = usePathname();
  const pathnameSegments = (pathname ?? "").split("/").filter(Boolean);
  const isAdmin = pathnameSegments[0] === "admin";
  const isTienda = pathnameSegments.includes("tienda");
  const isAdminVentas = pathname?.startsWith("/admin/ventas") || pathname === "/admin";
  const isAdminProductos = pathname?.startsWith("/admin/productos");
  const adminSections = [
    { href: "/admin/ventas", label: "Ventas", active: isAdminVentas, disabled: false },
    { href: "/admin/productos", label: "Productos", active: isAdminProductos, disabled: false },
    { href: "#", label: "Servicios", active: false, disabled: true },
  ];
  const tickerMessages = ["Agregar texto", "Agregar texto", "Agregar texto"];
  const [showTicker, setShowTicker] = useState(true);
  const [navMenuOpen, setNavMenuOpen] = useState(false);
  const [pendingAdminHref, setPendingAdminHref] = useState<string | null>(null);
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

    if (isAdmin) {
      root.style.setProperty("--header-height-mobile", "calc(var(--header-height-mobile-base) + var(--safe-area-top) + var(--admin-nav-height-mobile))");
      root.style.setProperty("--header-height-desktop", "var(--header-height-desktop-base)");
      return;
    }

    root.style.setProperty("--header-height-mobile", "calc(var(--header-height-mobile-base) + var(--safe-area-top))");
    root.style.setProperty("--header-height-desktop", "var(--header-height-desktop-base)");

    return () => {
      root.style.setProperty("--header-height-mobile", "calc(var(--header-height-mobile-base) + var(--safe-area-top))");
      root.style.setProperty("--header-height-desktop", "var(--header-height-desktop-base)");
    };
  }, [isAdmin, isTienda, showTicker]);

  useEffect(() => {
    if (!isTienda) {
      const resetTickerTimer = window.setTimeout(() => {
        setShowTicker(true);
      }, 0);
      return () => window.clearTimeout(resetTickerTimer);
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

  const visiblePendingAdminHref =
    pendingAdminHref && pendingAdminHref !== pathname ? pendingAdminHref : null;

  const handleAdminLinkClick = (href: string) => {
    if (!href || href === "#" || href === pathname || pendingAdminHref === href) {
      return;
    }
    setPendingAdminHref(href);
  };

  const adminLinkClass = (active: boolean, href: string) => {
    const isPending = visiblePendingAdminHref === href;
    if (isPending) {
      return "text-[var(--brand-gold-300)] opacity-75";
    }
    return active ? "text-[var(--brand-gold-300)]" : "text-[var(--brand-cream)]";
  };

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

  const hamburgerIcon = (
    <span aria-hidden className="inline-flex h-3.5 w-4 flex-col justify-between">
      <span className="h-px w-full bg-current" />
      <span className="h-px w-full bg-current" />
      <span className="h-px w-full bg-current" />
    </span>
  );

  return (
    <>
      <header id="main-navbar" className="fixed inset-x-0 top-0 z-[200] w-full bg-[var(--brand-violet-500)] pt-[var(--safe-area-top)]">
        {isTienda && <TopInfoTicker messages={tickerMessages} durationSeconds={72} hidden={!showTicker} />}
        <nav className="h-[var(--header-height-mobile-base)] border-b border-[var(--brand-gold-400)] md:h-[var(--header-height-desktop-base)]">
          <div className="mx-auto flex h-full w-full items-center justify-between gap-6 px-4 md:px-8">

            {/* Left: hamburger, all pages, all sizes */}
            <div className="flex items-center">
              <button
                type="button"
                onClick={() => setNavMenuOpen(true)}
                className="inline-flex h-8 w-8 items-center justify-center text-[var(--brand-cream)] transition hover:text-[var(--brand-gold-300)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand-gold-300)]"
                aria-label="Abrir menú"
              >
                {hamburgerIcon}
              </button>
            </div>

            {/* Center: Logo */}
            <Link
              href="/"
              aria-label={brandName}
              className="absolute left-1/2 -translate-x-1/2 flex flex-shrink-0 items-center justify-center"
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

            {/* Right: admin links or cart */}
            <div className="flex flex-1 items-center justify-end">
              {isAdmin ? (
                <div className="flex items-center gap-2">
                  <div className="hidden items-center gap-2 text-xs font-semibold uppercase tracking-[0.12em] text-[var(--brand-cream)] md:flex">
                    {adminSections.map((link, index) => (
                      <span key={link.label} className="inline-flex items-center gap-2">
                        {index > 0 ? <span aria-hidden className="text-[var(--brand-gold-300)]/80">|</span> : null}
                        {link.disabled ? (
                          <span className="cursor-not-allowed text-[var(--brand-cream)]/45">{link.label}</span>
                        ) : link.active ? (
                          <span className={`cursor-default ${adminLinkClass(link.active, link.href)}`}>
                            {link.label}
                          </span>
                        ) : (
                          <Link
                            href={link.href}
                            onClick={() => handleAdminLinkClick(link.href)}
                            className={`transition hover:text-[var(--brand-gold-300)] ${adminLinkClass(
                              link.active,
                              link.href
                            )}`}
                          >
                            {link.label}
                          </Link>
                        )}
                      </span>
                    ))}
                  </div>
                  <Link
                    href="/api/auth/signout?callbackUrl=/"
                    aria-label="Cerrar sesión"
                    className="inline-flex h-8 w-8 items-center justify-center text-rose-200 transition hover:text-rose-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-200/80"
                  >
                    <svg
                      viewBox="0 0 24 24"
                      fill="none"
                      aria-hidden
                      className="h-[18px] w-[18px]"
                      stroke="currentColor"
                      strokeWidth="1.9"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
                      <path d="M16 7 21 12l-5 5" />
                      <path d="M9 12h12" />
                    </svg>
                  </Link>
                </div>
              ) : isTienda ? (
                <>
                  {/* Mobile cart */}
                  <button
                    onClick={() => setCartOpen(!isCartOpen)}
                    className="relative inline-flex h-8 w-8 items-center justify-center rounded-full border border-[var(--brand-gold-300)] bg-[var(--brand-violet-900)] text-[var(--brand-cream)] transition hover:border-[var(--brand-gold-300)] hover:text-[var(--brand-gold-300)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand-gold-300)] md:hidden"
                    aria-label={isCartOpen ? "Cerrar carrito" : "Abrir carrito"}
                  >
                    {cartIcon}
                    <CartBadge className="absolute -right-1 -top-1 flex h-[1.1rem] min-w-[1.1rem] items-center justify-center rounded-full border border-[var(--brand-violet-900)] bg-[var(--brand-gold-300)] px-1 text-[9px] font-bold leading-none tabular-nums text-black shadow-[0_4px_10px_rgba(0,0,0,0.25)]" />
                  </button>

                  {/* Desktop cart */}
                  <div className="hidden md:flex items-center gap-2.5">
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
                </>
              ) : null}
            </div>

          </div>
        </nav>
        {isAdmin ? (
          <div className="h-[var(--admin-nav-height-mobile)] border-b border-[var(--brand-gold-400)]/70 md:hidden">
            <div className="mx-auto flex h-full w-full max-w-[1320px] items-center justify-center px-2">
              <div className="flex w-full items-center justify-center gap-1.5 whitespace-nowrap text-[9px] font-semibold uppercase tracking-[0.09em] text-[var(--brand-cream)]">
                {adminSections.map((link, index) => (
                  <span key={link.label} className="inline-flex items-center gap-2">
                    {index > 0 ? <span aria-hidden className="text-[var(--brand-gold-300)]/80">|</span> : null}
                    {link.disabled ? (
                      <span className="cursor-not-allowed text-[var(--brand-cream)]/45">{link.label}</span>
                    ) : link.active ? (
                      <span className={`cursor-default ${adminLinkClass(link.active, link.href)}`}>
                        {link.label}
                      </span>
                    ) : (
                      <Link
                        href={link.href}
                        onClick={() => handleAdminLinkClick(link.href)}
                        className={`transition hover:text-[var(--brand-gold-300)] ${adminLinkClass(
                          link.active,
                          link.href
                        )}`}
                      >
                        {link.label}
                      </Link>
                    )}
                  </span>
                ))}
              </div>
            </div>
          </div>
        ) : null}
      </header>

      <NavDrawer open={navMenuOpen} onClose={() => setNavMenuOpen(false)} />
    </>
  );
}

