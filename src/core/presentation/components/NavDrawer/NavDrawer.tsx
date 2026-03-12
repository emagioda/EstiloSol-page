"use client";

import "@/src/core/presentation/styles/tokens.css";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { useBodyScrollLock } from "@/src/core/presentation/hooks/useBodyScrollLock";

interface NavDrawerProps {
  open: boolean;
  onClose: () => void;
}

export default function NavDrawer({ open, onClose }: NavDrawerProps) {
  const [shouldRender, setShouldRender] = useState(open);
  const [isClosing, setIsClosing] = useState(false);
  const [tiendaExpanded, setTiendaExpanded] = useState(false);
  const [infoExpanded, setInfoExpanded] = useState(false);
  const pathname = usePathname();
  const closeTimerRef = useRef<number | null>(null);

  useBodyScrollLock(shouldRender);

  const handleClose = useCallback(() => {
    if (isClosing) return;
    onClose();
  }, [isClosing, onClose]);

  useEffect(() => {
    if (open) {
      if (closeTimerRef.current !== null) {
        window.clearTimeout(closeTimerRef.current);
        closeTimerRef.current = null;
      }
      const openSyncTimer = window.setTimeout(() => {
        setShouldRender(true);
        setIsClosing(false);
      }, 0);
      return () => window.clearTimeout(openSyncTimer);
    }

    if (!shouldRender || isClosing) return;

    const startCloseTimer = window.setTimeout(() => {
      setIsClosing(true);
      closeTimerRef.current = window.setTimeout(() => {
        setIsClosing(false);
        setShouldRender(false);
        closeTimerRef.current = null;
      }, 300);
    }, 0);
    return () => window.clearTimeout(startCloseTimer);
  }, [open, shouldRender, isClosing]);

  useEffect(() => {
    if (!open) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") handleClose();
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [open, handleClose]);

  useEffect(() => {
    return () => {
      if (closeTimerRef.current !== null) {
        window.clearTimeout(closeTimerRef.current);
      }
    };
  }, []);

  if (!shouldRender) return null;

  const isTienda = pathname?.startsWith("/tienda") ?? false;
  const isTurnos = pathname?.startsWith("/turnos") ?? false;
  const isHome = pathname === "/";
  const isInfo =
    (pathname?.startsWith("/preguntas-frecuentes") ?? false) ||
    (pathname?.startsWith("/quien-soy") ?? false) ||
    (pathname?.startsWith("/contacto") ?? false);

  const linkBase =
    "flex w-full items-center rounded-lg px-3 py-2.5 text-sm font-semibold uppercase tracking-[0.14em] transition hover:bg-white/8 hover:text-[var(--brand-gold-300)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand-gold-300)]";
  const activeColor = "text-[var(--brand-gold-300)]";
  const inactiveColor = "text-[var(--brand-cream)]";

  return (
    <div className="fixed inset-0 z-[260]">
      {/* Backdrop */}
      <div
        className={`absolute inset-0 bg-black/50 ${isClosing ? "animate-fadeOutBackdrop" : "animate-fadeInBackdrop"}`}
        onClick={handleClose}
        aria-hidden
      />

      {/* Panel */}
      <aside
        role="dialog"
        aria-modal="true"
        aria-label="Menú de navegación"
        className={`absolute left-0 top-0 flex h-full w-72 flex-col bg-[var(--brand-violet-950)] shadow-[4px_0_32px_rgba(0,0,0,0.45)] ${isClosing ? "animate-slideOutDrawerLeft" : "animate-slideInDrawerLeft"}`}
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-[var(--brand-gold-300)]/20 px-4 py-3">
          <span className="text-[11px] font-semibold uppercase tracking-[0.2em] text-[var(--brand-gold-300)]">
            Menú
          </span>
          <button
            type="button"
            onClick={handleClose}
            className="inline-flex h-7 w-7 items-center justify-center text-[var(--brand-cream)] transition hover:text-[var(--brand-gold-300)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand-gold-300)]"
            aria-label="Cerrar menú"
          >
            <span className="text-base leading-none" aria-hidden>✕</span>
          </button>
        </div>

        {/* Nav links */}
        <nav className="flex flex-col gap-0.5 p-3">
          {/* Inicio */}
          <Link
            href="/"
            onClick={handleClose}
            className={`${linkBase} ${isHome ? activeColor : inactiveColor}`}
          >
            Inicio
          </Link>

          {/* Tienda + submenu */}
          <div>
            <button
              type="button"
              onClick={() => setTiendaExpanded((v) => !v)}
              className={`${linkBase} justify-between ${isTienda ? activeColor : inactiveColor}`}
            >
              Tienda
              <span
                aria-hidden
                className={`text-[9px] transition-transform duration-200 ${tiendaExpanded ? "rotate-180" : ""}`}
              >
                ▼
              </span>
            </button>

            {tiendaExpanded && (
              <div className="ml-3 mt-0.5 flex flex-col gap-0.5 border-l border-[var(--brand-gold-300)]/20 pl-3">
                <Link
                  href="/tienda?rubro=peluqueria"
                  onClick={handleClose}
                  className="rounded-md px-2 py-2 text-sm text-[var(--brand-cream)]/80 transition hover:text-[var(--brand-gold-300)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand-gold-300)]"
                >
                  Peluquería
                </Link>
                <Link
                  href="/tienda?rubro=bijouterie"
                  onClick={handleClose}
                  className="rounded-md px-2 py-2 text-sm text-[var(--brand-cream)]/80 transition hover:text-[var(--brand-gold-300)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand-gold-300)]"
                >
                  Bijouterie
                </Link>
              </div>
            )}
          </div>

          {/* Reservar turnos */}
          <Link
            href="/turnos"
            onClick={handleClose}
            className={`${linkBase} ${isTurnos ? activeColor : inactiveColor}`}
          >
            Reservar turnos
          </Link>

          {/* Divisor */}
          <div className="my-1 h-px bg-[var(--brand-gold-300)]/15" aria-hidden />

          {/* Información + submenu */}
          <div>
            <button
              type="button"
              onClick={() => setInfoExpanded((v) => !v)}
              className={`${linkBase} justify-between ${isInfo ? activeColor : inactiveColor}`}
            >
              Información
              <span
                aria-hidden
                className={`text-[9px] transition-transform duration-200 ${infoExpanded ? "rotate-180" : ""}`}
              >
                ▼
              </span>
            </button>

            {infoExpanded && (
              <div className="ml-3 mt-0.5 flex flex-col gap-0.5 border-l border-[var(--brand-gold-300)]/20 pl-3">
                <Link
                  href="/preguntas-frecuentes"
                  onClick={handleClose}
                  className="rounded-md px-2 py-2 text-sm text-[var(--brand-cream)]/80 transition hover:text-[var(--brand-gold-300)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand-gold-300)]"
                >
                  Preguntas frecuentes
                </Link>
                <Link
                  href="/quien-soy"
                  onClick={handleClose}
                  className="rounded-md px-2 py-2 text-sm text-[var(--brand-cream)]/80 transition hover:text-[var(--brand-gold-300)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand-gold-300)]"
                >
                  Quién soy
                </Link>
                <Link
                  href="/contacto"
                  onClick={handleClose}
                  className="rounded-md px-2 py-2 text-sm text-[var(--brand-cream)]/80 transition hover:text-[var(--brand-gold-300)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand-gold-300)]"
                >
                  Contacto
                </Link>
              </div>
            )}
          </div>
        </nav>
      </aside>
    </div>
  );
}
