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
        setTiendaExpanded(pathname?.startsWith("/tienda") ?? false);
        setInfoExpanded(
          (pathname?.startsWith("/preguntas-frecuentes") ?? false) ||
            (pathname?.startsWith("/quien-soy") ?? false) ||
            (pathname?.startsWith("/contacto") ?? false)
        );
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
  }, [open, pathname, shouldRender, isClosing]);

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
  const rubro =
    typeof window === "undefined"
      ? ""
      : (new URLSearchParams(window.location.search).get("rubro") ?? "").toLowerCase();
  const isPeluqueria = isTienda && (rubro === "" || rubro === "peluqueria" || rubro === "peluquería");
  const isBijouterie = isTienda && rubro === "bijouterie";
  const isInfo =
    (pathname?.startsWith("/preguntas-frecuentes") ?? false) ||
    (pathname?.startsWith("/quien-soy") ?? false) ||
    (pathname?.startsWith("/contacto") ?? false);

  const primaryLinkBase =
    "flex min-h-12 w-full items-center justify-between rounded-2xl border px-4 text-[15px] font-semibold tracking-normal transition duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#d9b86f]";
  const primaryActive =
    "border-[#e0bf72] bg-[#fff4dc] text-[#351953] shadow-[0_10px_24px_rgba(72,42,100,0.12)]";
  const primaryInactive =
    "border-[#eadcf4] bg-white/70 text-[#432064] hover:border-[#d9c3e8] hover:bg-white hover:text-[#351953]";
  const quietLinkBase =
    "flex min-h-10 w-full items-center rounded-xl px-3 text-[14px] font-medium text-[#5b3a76] transition duration-200 hover:bg-white/60 hover:text-[#351953] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#d9b86f]";
  const quietActive = "bg-white/70 text-[#351953] shadow-[0_8px_18px_rgba(72,42,100,0.08)]";
  const subLinkBase =
    "flex min-h-10 items-center gap-2 rounded-xl px-3 text-sm font-medium text-[#654781] transition duration-200 hover:bg-white/65 hover:text-[#351953] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#d9b86f]";
  const subActive = "bg-[#fff6e6] text-[#351953]";

  return (
    <div className="fixed inset-0 z-[260]">
      <div
        className={`absolute inset-0 bg-[#20102f]/40 backdrop-blur-[1px] ${isClosing ? "animate-fadeOutBackdrop" : "animate-fadeInBackdrop"}`}
        onClick={handleClose}
        aria-hidden
      />

      <aside
        role="dialog"
        aria-modal="true"
        aria-label="Menú de navegación"
        className={`absolute left-0 top-0 flex h-full w-[19rem] max-w-[88vw] flex-col border-r border-[#eadcf4] bg-[linear-gradient(180deg,#fffafd_0%,#f4e7fb_100%)] shadow-[8px_0_34px_rgba(54,25,80,0.18)] ${isClosing ? "animate-slideOutDrawerLeft" : "animate-slideInDrawerLeft"}`}
      >
        <div className="flex min-h-16 items-center justify-between border-b border-[#eadcf4] px-4 py-3">
          <div>
            <span className="block text-lg font-semibold leading-none text-[#351953]">
              Estilo Sol
            </span>
            <span className="mt-1 block text-[10px] font-semibold uppercase tracking-[0.2em] text-[#8b6aa0]">
              Estilo y cuidado
            </span>
          </div>
          <button
            type="button"
            onClick={handleClose}
            className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-[#d9c3e8] bg-white/75 text-[#5b3a76] transition hover:border-[#d9b86f] hover:bg-[#fff7e7] hover:text-[#351953] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#d9b86f]"
            aria-label="Cerrar menú"
          >
            <span className="text-lg leading-none" aria-hidden>×</span>
          </button>
        </div>

        <nav className="flex flex-col gap-2.5 p-4">
          <Link
            href="/"
            onClick={handleClose}
            className={`${quietLinkBase} ${isHome ? quietActive : ""}`}
          >
            Inicio
          </Link>

          <div className={`rounded-[22px] transition duration-200 ${tiendaExpanded ? "bg-white/45 p-1 shadow-[0_10px_24px_rgba(72,42,100,0.08)]" : ""}`}>
            <button
              type="button"
              onClick={() => setTiendaExpanded((v) => !v)}
              className={`${primaryLinkBase} justify-between ${isTienda ? primaryActive : primaryInactive}`}
              aria-expanded={tiendaExpanded}
            >
              Tienda
              <span
                aria-hidden
                className={`text-[10px] transition-transform duration-200 ${tiendaExpanded ? "rotate-180" : ""}`}
              >
                ▼
              </span>
            </button>

            {tiendaExpanded && (
              <div className="grid gap-1 px-1 pb-1 pt-2">
                <Link
                  href="/tienda?rubro=peluqueria"
                  onClick={handleClose}
                  className={`${subLinkBase} ${isPeluqueria ? subActive : ""}`}
                >
                  <span
                    aria-hidden
                    className={`h-1.5 w-1.5 rounded-full ${isPeluqueria ? "bg-[#d1a94e]" : "bg-[#d9c3e8]"}`}
                  />
                  Peluquería
                </Link>
                <Link
                  href="/tienda?rubro=bijouterie"
                  onClick={handleClose}
                  className={`${subLinkBase} ${isBijouterie ? subActive : ""}`}
                >
                  <span
                    aria-hidden
                    className={`h-1.5 w-1.5 rounded-full ${isBijouterie ? "bg-[#d1a94e]" : "bg-[#d9c3e8]"}`}
                  />
                  Bijouterie
                </Link>
              </div>
            )}
          </div>

          <Link
            href="/turnos"
            onClick={handleClose}
            className={`${primaryLinkBase} ${isTurnos ? primaryActive : primaryInactive}`}
          >
            Reservar turnos
          </Link>

          <div className="my-1 h-px bg-[#eadcf4]" aria-hidden />

          <div>
            <button
              type="button"
              onClick={() => setInfoExpanded((v) => !v)}
              className={`${quietLinkBase} justify-between ${isInfo ? quietActive : ""}`}
              aria-expanded={infoExpanded}
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
              <div className="mt-1.5 grid gap-1">
                <Link
                  href="/preguntas-frecuentes"
                  onClick={handleClose}
                  className={`${subLinkBase} ${pathname?.startsWith("/preguntas-frecuentes") ? subActive : ""}`}
                >
                  Preguntas frecuentes
                </Link>
                <Link
                  href="/quien-soy"
                  onClick={handleClose}
                  className={`${subLinkBase} ${pathname?.startsWith("/quien-soy") ? subActive : ""}`}
                >
                  Quién soy
                </Link>
                <Link
                  href="/contacto"
                  onClick={handleClose}
                  className={`${subLinkBase} ${pathname?.startsWith("/contacto") ? subActive : ""}`}
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
