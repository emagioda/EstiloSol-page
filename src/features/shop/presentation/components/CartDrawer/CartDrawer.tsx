"use client";
/* eslint-disable @next/next/no-img-element */
import "@/src/core/presentation/styles/tokens.css";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useCart } from "../../view-models/useCartStore";
import CheckoutModal from "../CheckoutModal/CheckoutModal";

const formatMoney = (value: number) =>
  new Intl.NumberFormat("es-AR", {
    style: "currency",
    currency: "ARS",
    maximumFractionDigits: 0,
  }).format(value);

export default function CartDrawer({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { items, updateQty, removeItem, clear } = useCart();
  const [checkoutOpen, setCheckoutOpen] = useState(false);
  const [confirmClearOpen, setConfirmClearOpen] = useState(false);
  const [isClosing, setIsClosing] = useState(false);
  const basePath = process.env.NEXT_PUBLIC_BASE_PATH ?? "";
  const closeButtonRef = useRef<HTMLButtonElement | null>(null);
  const confirmCancelButtonRef = useRef<HTMLButtonElement | null>(null);

  const handleClose = useCallback(() => {
    setIsClosing(true);
    setTimeout(() => {
      onClose();
      setIsClosing(false);
    }, 300);
  }, [onClose]);

  const subtotal = useMemo(() => items.reduce((s, it) => s + it.unitPrice * it.qty, 0), [items]);

  const handleRequestClearCart = () => {
    if (items.length === 0) return;
    setConfirmClearOpen(true);
  };

  const handleConfirmClearCart = () => {
    clear();
    setConfirmClearOpen(false);
  };

  useEffect(() => {
    if (!open) return;

    closeButtonRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        if (confirmClearOpen) {
          setConfirmClearOpen(false);
          return;
        }
        handleClose();
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, handleClose, confirmClearOpen]);

  useEffect(() => {
    if (!confirmClearOpen) return;
    confirmCancelButtonRef.current?.focus();
  }, [confirmClearOpen]);

  if (!open && !isClosing) return null;

  return (
    <div className="fixed inset-0 z-50 flex">
      <div className={`fixed inset-0 bg-black/40 ${isClosing ? 'animate-fadeOutBackdrop' : 'animate-fadeInBackdrop'}`} onClick={handleClose} />
      <aside
        role="dialog"
        aria-modal="true"
        aria-label="Carrito de compras"
        className={`relative ml-auto flex h-full w-full max-w-sm flex-col bg-[var(--brand-violet-950)] p-4 text-[var(--brand-cream)] shadow-[0_20px_45px_rgba(18,8,35,0.5)] ${isClosing ? 'animate-slideOutDrawer' : 'animate-slideInDrawer'}`}
      >
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="text-2xl">🛒</span>
            <h2 className="text-lg font-semibold">Tu carrito</h2>
          </div>
          <button
            ref={closeButtonRef}
            onClick={handleClose}
            className="text-xl transition-transform hover:scale-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand-gold-300)]"
            aria-label="Cerrar carrito"
          >
            ✕
          </button>
        </div>

        <div className="elegant-scrollbar mt-4 flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto pr-1">
          {items.length === 0 && <div className="text-center text-sm">Tu carrito está vacío</div>}

          {items.map((it) => (
            <div key={it.productId} className="flex items-center gap-3 border-b border-[var(--brand-violet-900)] pb-3">
              <div className="h-16 w-16 flex-shrink-0 overflow-hidden rounded bg-black">
                {it.image ? (
                  <img
                    src={it.image.startsWith("/") ? `${basePath}${it.image}` : it.image}
                    alt={it.name}
                    className="h-full w-full object-cover"
                  />
                ) : null}
              </div>
              <div className="flex-1 text-sm">
                <div className="font-medium">{it.name}</div>
                <div className="text-[var(--brand-gold-300)]">{formatMoney(it.unitPrice)}</div>
                <div className="mt-2 flex items-center gap-2">
                  <button
                    onClick={() => updateQty(it.productId, Math.max(1, it.qty - 1))}
                    className="px-2 transition-transform hover:scale-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand-gold-300)]"
                    aria-label={`Reducir cantidad de ${it.name}`}
                  >
                    −
                  </button>
                  <div className="w-6 text-center" aria-live="polite">{it.qty}</div>
                  <button
                    onClick={() => updateQty(it.productId, it.qty + 1)}
                    className="px-2 transition-transform hover:scale-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand-gold-300)]"
                    aria-label={`Aumentar cantidad de ${it.name}`}
                  >
                    +
                  </button>
                  <button
                    onClick={() => removeItem(it.productId)}
                    className="ml-3 text-xs underline transition-colors hover:text-[var(--brand-gold-300)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand-gold-300)]"
                  >
                    Eliminar
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>

        <div className="sticky bottom-0 mt-4 rounded-2xl border border-[var(--brand-gold-300)]/35 bg-[var(--brand-violet-900)]/90 p-4 shadow-[0_14px_30px_rgba(18,8,35,0.35)] backdrop-blur">
          <div className="flex items-end justify-between gap-3">
            <div>
              <p className="text-[11px] uppercase tracking-[0.12em] text-[var(--brand-cream)]/70">Total a pagar</p>
              <p className="text-2xl font-bold leading-none text-[var(--brand-gold-300)]">{formatMoney(subtotal)}</p>
            </div>
            <span className="rounded-full border border-[var(--brand-gold-300)]/30 px-2 py-1 text-[11px] text-[var(--brand-cream)]/75">
              {items.length} producto{items.length !== 1 ? "s" : ""}
            </span>
          </div>

          <div className="mt-4 flex gap-2">
            <button
              disabled={items.length===0}
              onClick={() => setCheckoutOpen(true)}
              className="flex-1 rounded bg-[var(--brand-gold-300)] py-2 text-black shadow-[0_10px_20px_rgba(18,8,35,0.25)] transition-transform hover:-translate-y-0.5 disabled:opacity-50 disabled:hover:translate-y-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand-gold-300)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--brand-violet-950)]"
            >
              Continuar al pago
            </button>
            <button
              onClick={handleRequestClearCart}
              className="rounded border border-[var(--brand-violet-900)] px-3 py-2 transition-colors hover:border-[var(--brand-gold-300)] hover:text-[var(--brand-gold-300)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand-gold-300)]"
            >
              Vaciar
            </button>
          </div>
        </div>

        {confirmClearOpen && (
          <div
            className="animate-fadeInSoft absolute inset-0 z-20 flex items-center justify-center bg-black/55 p-4"
            onClick={() => setConfirmClearOpen(false)}
          >
            <div
              role="dialog"
              aria-modal="true"
              aria-label="Confirmar vaciar carrito"
              onClick={(event) => event.stopPropagation()}
              className="animate-popInSoft w-full max-w-xs rounded-2xl border border-[var(--brand-gold-300)]/35 bg-[var(--brand-violet-900)] p-4 shadow-[0_14px_30px_rgba(18,8,35,0.45)]"
            >
              <p className="text-sm text-[var(--brand-cream)]/90">¿Querés vaciar el carrito?</p>
              <p className="mt-1 text-xs text-[var(--brand-cream)]/70">Esta acción no se puede deshacer.</p>

              <div className="mt-4 flex gap-2">
                <button
                  ref={confirmCancelButtonRef}
                  type="button"
                  onClick={() => setConfirmClearOpen(false)}
                  className="flex-1 rounded border border-[var(--brand-violet-800)] px-3 py-2 text-sm transition-colors hover:border-[var(--brand-gold-300)] hover:text-[var(--brand-gold-300)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand-gold-300)]"
                >
                  Cancelar
                </button>
                <button
                  type="button"
                  onClick={handleConfirmClearCart}
                  className="flex-1 rounded bg-[var(--brand-gold-300)] px-3 py-2 text-sm font-medium text-black transition hover:brightness-105 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand-gold-300)]"
                >
                  Vaciar
                </button>
              </div>
            </div>
          </div>
        )}

        <CheckoutModal open={checkoutOpen} onClose={() => setCheckoutOpen(false)} items={items} subtotal={subtotal} />
      </aside>
    </div>
  );
}
