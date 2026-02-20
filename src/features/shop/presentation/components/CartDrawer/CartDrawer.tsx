"use client";
import "@/src/core/presentation/styles/tokens.css";
import { useMemo, useState } from "react";
import { useCart } from "../../view-models/useCartStore";
import CheckoutModal from "../CheckoutModal/CheckoutModal";

export default function CartDrawer({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { items, updateQty, removeItem, clear } = useCart();
  const [checkoutOpen, setCheckoutOpen] = useState(false);
  const [isClosing, setIsClosing] = useState(false);
  const basePath = process.env.NEXT_PUBLIC_BASE_PATH ?? "";

  const handleClose = () => {
    setIsClosing(true);
    setTimeout(() => {
      onClose();
      setIsClosing(false);
    }, 300);
  };

  const subtotal = useMemo(() => items.reduce((s, it) => s + it.unitPrice * it.qty, 0), [items]);

  if (!open && !isClosing) return null;

  return (
    <div className="fixed inset-0 z-50 flex">
      <div className={`fixed inset-0 bg-black/40 ${isClosing ? 'animate-fadeOutBackdrop' : 'animate-fadeInBackdrop'}`} onClick={handleClose} />
      <aside className={`relative ml-auto w-full max-w-sm bg-[var(--brand-violet-950)] p-4 text-[var(--brand-cream)] shadow-[0_20px_45px_rgba(18,8,35,0.5)] ${isClosing ? 'animate-slideOutDrawer' : 'animate-slideInDrawer'}`}>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="text-2xl">🛒</span>
            <h2 className="text-lg font-semibold">Tu carrito</h2>
          </div>
          <button onClick={handleClose} className="text-xl transition-transform hover:scale-110">✕</button>
        </div>

        <div className="mt-4 flex max-h-[60vh] flex-col gap-3 overflow-y-auto">
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
                <div className="text-[var(--brand-gold-300)]">${it.unitPrice}</div>
                <div className="mt-2 flex items-center gap-2">
                  <button onClick={() => updateQty(it.productId, Math.max(1, it.qty - 1))} className="px-2 transition-transform hover:scale-110">−</button>
                  <div className="w-6 text-center">{it.qty}</div>
                  <button onClick={() => updateQty(it.productId, it.qty + 1)} className="px-2 transition-transform hover:scale-110">+</button>
                  <button onClick={() => removeItem(it.productId)} className="ml-3 text-xs underline transition-colors hover:text-[var(--brand-gold-300)]">Eliminar</button>
                </div>
              </div>
            </div>
          ))}
        </div>

        <div className="mt-4">
          <div className="flex items-center justify-between text-sm">
            <span>Subtotal</span>
            <span className="font-medium text-[var(--brand-gold-300)]">${subtotal}</span>
          </div>

          <div className="mt-4 flex gap-2">
            <button disabled={items.length===0} onClick={() => setCheckoutOpen(true)} className="flex-1 rounded bg-[var(--brand-gold-300)] py-2 text-black shadow-[0_10px_20px_rgba(18,8,35,0.25)] transition-transform hover:-translate-y-0.5 disabled:opacity-50 disabled:hover:translate-y-0">Finalizar</button>
            <button onClick={() => clear()} className="rounded border border-[var(--brand-violet-900)] px-3 py-2 transition-colors hover:border-[var(--brand-gold-300)] hover:text-[var(--brand-gold-300)]">Vaciar</button>
          </div>
        </div>

        <CheckoutModal open={checkoutOpen} onClose={() => setCheckoutOpen(false)} items={items} subtotal={subtotal} />
      </aside>
    </div>
  );
}
