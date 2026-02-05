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

  if (!open) return null;

  const waMessage = () => {
    const lines = [];
    lines.push(`Compra desde Estilo Sol`);
    lines.push(`Cliente: ${name}`);
    lines.push(`Tel: ${phone}`);
    lines.push(``);
    lines.push(`Items:`);
    items.forEach((it) => lines.push(`${it.qty}x ${it.name} - $${it.unitPrice}`));
    lines.push(``);
    lines.push(`Subtotal: $${subtotal}`);
    if (notes) lines.push(`Notas: ${notes}`);

    return encodeURIComponent(lines.join("\n"));
  };

  const openWhatsApp = () => {
    const phoneNumber = "5491123456789"; // TODO: replace with seller number
    const url = `https://wa.me/${phoneNumber}?text=${waMessage()}`;
    window.open(url, "_blank");
    onClose();
  };

  return (
    <div className="fixed inset-0 z-60 flex items-center justify-center">
      <div className="fixed inset-0 bg-black/60" onClick={onClose} />
      <div className="relative z-10 w-full max-w-md rounded bg-[var(--brand-violet-950)] p-6 text-[var(--brand-cream)]">
        <h3 className="text-lg font-semibold">Finalizar compra</h3>
        <p className="text-sm text-[var(--brand-cream)]/60">Completá tus datos y enviaremos el pedido por WhatsApp.</p>

        <div className="mt-4 flex flex-col gap-3">
          <input className="w-full rounded border border-[var(--brand-violet-800)] bg-transparent px-3 py-2 text-[var(--brand-cream)]" placeholder="Tu nombre" value={name} onChange={(e)=>setName(e.target.value)} />
          <input className="w-full rounded border border-[var(--brand-violet-800)] bg-transparent px-3 py-2 text-[var(--brand-cream)]" placeholder="WhatsApp (ej: 54911...)" value={phone} onChange={(e)=>setPhone(e.target.value)} />
          <textarea className="w-full rounded border border-[var(--brand-violet-800)] bg-transparent px-3 py-2 text-[var(--brand-cream)]" placeholder="Notas" value={notes} onChange={(e)=>setNotes(e.target.value)} />
        </div>

        <div className="mt-4 flex gap-2">
          <button onClick={openWhatsApp} className="flex-1 rounded bg-[var(--brand-gold-300)] py-2 text-black">Enviar por WhatsApp</button>
          <button onClick={onClose} className="rounded border border-[var(--brand-violet-900)] px-3 py-2">Cancelar</button>
        </div>
      </div>
    </div>
  );
}
