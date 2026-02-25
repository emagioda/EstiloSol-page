"use client";
import { useState } from "react";
import type { CartItem } from "../../view-models/useCartStore";

interface Props {
  open: boolean;
  onClose: () => void;
  items: CartItem[];
  subtotal: number;
}

export default function CheckoutModal({ open, onClose, items, subtotal }: Props) {
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [notes, setNotes] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const isTestPublicKey = (process.env.NEXT_PUBLIC_MP_PUBLIC_KEY || "").toUpperCase().startsWith("TEST-");

  if (!open) return null;

  const startCheckout = async () => {
    if (items.length === 0 || isLoading) return;

    setError(null);
    setIsLoading(true);

    try {
      const response = await fetch("/api/mp/create-preference", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          items: items.map((item) => ({
            productId: item.productId,
            qty: item.qty,
          })),
          payer: { name, phone },
          notes,
        }),
      });

      const data = (await response.json().catch(() => null)) as
        | { initPoint?: string; sandboxInitPoint?: string; error?: string }
        | null;

      const checkoutUrl = isTestPublicKey
        ? data?.sandboxInitPoint || data?.initPoint
        : data?.initPoint || data?.sandboxInitPoint;

      if (!response.ok || !checkoutUrl) {
        setError(data?.error || "No pudimos iniciar el pago. Intentá nuevamente.");
        return;
      }

      window.location.assign(checkoutUrl);
    } catch {
      setError("Ocurrió un error de conexión. Intentá nuevamente.");
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-60 flex items-center justify-center">
      <div className="fixed inset-0 bg-black/60" onClick={onClose} />
      <div className="relative z-10 w-full max-w-md rounded bg-[var(--brand-violet-950)] p-6 text-[var(--brand-cream)]">
        <h3 className="text-lg font-semibold">Finalizar compra</h3>
        <p className="text-sm text-[var(--brand-cream)]/60">Completá tus datos para pagar con Mercado Pago Checkout Pro.</p>

        <div className="mt-4 flex flex-col gap-3">
          <input className="w-full rounded border border-[var(--brand-violet-800)] bg-transparent px-3 py-2 text-[var(--brand-cream)]" placeholder="Tu nombre" value={name} onChange={(e)=>setName(e.target.value)} />
          <input className="w-full rounded border border-[var(--brand-violet-800)] bg-transparent px-3 py-2 text-[var(--brand-cream)]" placeholder="WhatsApp (ej: 54911...)" value={phone} onChange={(e)=>setPhone(e.target.value)} />
          <textarea className="w-full rounded border border-[var(--brand-violet-800)] bg-transparent px-3 py-2 text-[var(--brand-cream)]" placeholder="Notas" value={notes} onChange={(e)=>setNotes(e.target.value)} />
        </div>

        {error ? <p className="mt-3 text-sm text-[var(--brand-gold-300)]">{error}</p> : null}

        <div className="mt-4 flex gap-2">
          <button
            onClick={startCheckout}
            disabled={isLoading || items.length === 0}
            className="flex-1 rounded bg-[var(--brand-gold-300)] py-2 text-black disabled:opacity-60"
          >
            {isLoading ? "Redirigiendo..." : `Pagar $${subtotal}`}
          </button>
          <button onClick={onClose} className="rounded border border-[var(--brand-violet-900)] px-3 py-2">Cancelar</button>
        </div>
      </div>
    </div>
  );
}
