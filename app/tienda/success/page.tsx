"use client";
import { useEffect, useState } from "react";
import { useCart } from "@/src/features/shop/presentation/view-models/useCartStore";

type PaymentData = {
  approved?: boolean;
  message?: string;
  paymentId?: string | number;
  externalReference?: string;
  date?: string;
};

export default function SuccessPage() {
  const { clear } = useCart();
  const [status, setStatus] = useState<"loading" | "approved" | "error">("loading");
  const [message, setMessage] = useState("");
  const [paymentData, setPaymentData] = useState<PaymentData | null>(null);

  useEffect(() => {
    (async () => {
      const params = new URLSearchParams(window.location.search);
      const ref = params.get("ref");

      if (!ref) {
        setStatus("error");
        setMessage("No se encontró referencia de pago.");
        return;
      }

      try {
        const res = await fetch(`/api/mp/verify-payment?ref=${encodeURIComponent(ref)}`);
        const data = (await res.json().catch(() => null)) as PaymentData | null;
        setPaymentData(data);

        if (data?.approved) {
          clear();
          setStatus("approved");
          setMessage("¡Pago completado! Gracias por tu compra.");
        } else {
          setStatus("error");
          setMessage(data?.message || "No pudimos confirmar el pago. Intentá nuevamente.");
        }
      } catch {
        setStatus("error");
        setMessage("Error al verificar el pago. Contactá a soporte.");
      }
    })();
  }, [clear]);

  const downloadReceipt = () => {
    if (!paymentData) return;

    const content = `COMPROBANTE DE PAGO - ESTILO SOL
====================================

PAGO COMPLETADO

Detalles:
─────────────────────────────────
ID de Pago: ${paymentData.paymentId || "N/A"}
Referencia: ${paymentData.externalReference || "N/A"}
Fecha: ${paymentData.date || new Date().toLocaleString("es-AR")}

─────────────────────────────────

Gracias por tu compra en Estilo Sol.
Te enviaremos los detalles de tu pedido por email.

Para consultas: contacto@estilosol.com
`;

    const blob = new Blob([content], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `comprobante-${paymentData.externalReference || "pago"}.txt`;
    link.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-[var(--brand-violet-950)] text-[var(--brand-cream)] p-4">
      <div className="w-full max-w-2xl">
        <div className="rounded-lg bg-[var(--brand-violet-900)] p-8 shadow-lg mb-6">
          <div className="text-center mb-8">
            <h1 className="text-4xl font-bold mb-2">
              {status === "approved" && "✓ ¡Éxito!"}
              {status === "error" && "⚠ Error"}
              {status === "loading" && "⏳ Procesando"}
            </h1>
            <p className="text-lg text-[var(--brand-cream)]/80">{message}</p>
          </div>

          {status === "approved" && paymentData && (
            <div className="bg-[var(--brand-violet-950)] rounded border border-[var(--brand-violet-800)] p-6 mb-6 font-mono text-sm">
              <div className="text-center mb-4">
                <p className="font-bold text-[var(--brand-gold-300)]" style={{ fontSize: "0.9rem" }}>
                  COMPROBANTE DE PAGO
                </p>
              </div>
              <div className="space-y-2 text-[var(--brand-cream)]/90">
                <div className="flex justify-between border-b border-[var(--brand-violet-800)] pb-2">
                  <span>ID de Pago:</span>
                  <span className="text-[var(--brand-gold-300)]">{paymentData.paymentId}</span>
                </div>
                <div className="flex justify-between border-b border-[var(--brand-violet-800)] pb-2">
                  <span>Referencia:</span>
                  <span className="text-[var(--brand-gold-300)] text-xs break-all">{paymentData.externalReference}</span>
                </div>
                <div className="flex justify-between">
                  <span>Fecha:</span>
                  <span className="text-[var(--brand-gold-300)]">{paymentData.date}</span>
                </div>
              </div>
              <p className="text-center text-xs text-[var(--brand-cream)]/50 mt-4">
                Te enviaremos los detalles por email.
              </p>
            </div>
          )}

          <div className="flex gap-3 flex-col sm:flex-row">
            {status === "approved" && (
              <button
                onClick={downloadReceipt}
                className="flex-1 rounded bg-[var(--brand-gold-300)] px-4 py-3 text-black font-medium hover:bg-[var(--brand-gold-300)]/90 transition"
              >
                Descargar Comprobante
              </button>
            )}
            <a
              href="/tienda"
              className="flex-1 rounded bg-[var(--brand-violet-800)] px-4 py-3 text-[var(--brand-gold-300)] font-medium hover:bg-[var(--brand-violet-700)] transition text-center"
            >
              Volver a la Tienda
            </a>
          </div>
        </div>

        {status === "error" && (
          <div className="rounded-lg bg-[var(--brand-violet-900)] p-6 text-center text-sm text-[var(--brand-cream)]/80">
            <p>
              Si crees que es un error, contactá a <strong>contacto@estilosol.com</strong>
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
