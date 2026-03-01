"use client";
import { useEffect, useRef, useState } from "react";
import type { CartItem } from "../../view-models/useCartStore";
import { useCart } from "../../view-models/useCartStore";
import { refreshProductsMemoryCacheFromSource } from "../../view-models/useProductsStore";

const formatMoney = (value: number) =>
  new Intl.NumberFormat("es-AR", {
    style: "currency",
    currency: "ARS",
    maximumFractionDigits: 0,
  }).format(value);

interface Props {
  open: boolean;
  onClose: () => void;
  items: CartItem[];
  subtotal: number;
}

type CheckoutErrorState = {
  message: string;
  invalidProducts?: Array<{ productId: string; name: string }>;
};

export default function CheckoutModal({ open, onClose, items, subtotal }: Props) {
  const { removeItem } = useCart();
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [notes, setNotes] = useState("");
  const [checkoutPhase, setCheckoutPhase] = useState<"idle" | "validating" | "redirecting">("idle");
  const [slowValidationVisible, setSlowValidationVisible] = useState(false);
  const [error, setError] = useState<CheckoutErrorState | null>(null);
  const isTestPublicKey = (process.env.NEXT_PUBLIC_MP_PUBLIC_KEY || "").toUpperCase().startsWith("TEST-");
  const closeButtonRef = useRef<HTMLButtonElement | null>(null);
  const slowValidationTimerRef = useRef<number | null>(null);
  const prevalidationDebounceRef = useRef<number | null>(null);

  useEffect(() => {
    if (!open) return;

    const resetStateTimer = window.setTimeout(() => {
      setError(null);
      setCheckoutPhase("idle");
      setSlowValidationVisible(false);
    }, 0);

    closeButtonRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.clearTimeout(resetStateTimer);
      window.removeEventListener("keydown", onKeyDown);
      if (slowValidationTimerRef.current !== null) {
        window.clearTimeout(slowValidationTimerRef.current);
        slowValidationTimerRef.current = null;
      }
      setSlowValidationVisible(false);
    };
  }, [open, onClose]);

  useEffect(() => {
    if (!open) return;
    if (items.length === 0) return;

    if (prevalidationDebounceRef.current !== null) {
      window.clearTimeout(prevalidationDebounceRef.current);
      prevalidationDebounceRef.current = null;
    }

    prevalidationDebounceRef.current = window.setTimeout(() => {
      void (async () => {
        const response = await fetch("/api/mp/validate-cart", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            items: items.map((item) => ({
              productId: item.productId,
              qty: item.qty,
              name: item.name,
            })),
          }),
        }).catch(() => null);

        if (!response || response.ok) return;

        const data = (await response.json().catch(() => null)) as
          | {
              error?: string;
              invalidProducts?: Array<{ productId?: string; name?: string }>;
            }
          | null;

        if (!Array.isArray(data?.invalidProducts) || data.invalidProducts.length === 0) {
          return;
        }

        await refreshProductsMemoryCacheFromSource();

        setError({
          message: data?.error || "Algunos productos del carrito ya no están disponibles.",
          invalidProducts: data.invalidProducts
            .map((item) => ({
              productId: typeof item?.productId === "string" ? item.productId : "",
              name: typeof item?.name === "string" ? item.name : "Producto no disponible",
            }))
            .filter((item) => item.productId),
        });
      })();
    }, 450);

    return () => {
      if (prevalidationDebounceRef.current !== null) {
        window.clearTimeout(prevalidationDebounceRef.current);
        prevalidationDebounceRef.current = null;
      }
    };
  }, [open, items]);

  useEffect(() => {
    if (!open) return;
    if (!error?.invalidProducts || error.invalidProducts.length === 0) return;

    const itemIds = new Set(items.map((item) => item.productId));
    const remainingInvalidProducts = error.invalidProducts.filter((item) => itemIds.has(item.productId));

    if (remainingInvalidProducts.length === 0) {
      const clearErrorTimer = window.setTimeout(() => {
        setError(null);
      }, 0);
      return () => window.clearTimeout(clearErrorTimer);
    }

    if (remainingInvalidProducts.length !== error.invalidProducts.length) {
      const syncErrorTimer = window.setTimeout(() => {
        setError({
          ...error,
          invalidProducts: remainingInvalidProducts,
        });
      }, 0);
      return () => window.clearTimeout(syncErrorTimer);
    }
  }, [open, items, error]);

  if (!open) return null;

  const startSlowValidationTimer = () => {
    if (slowValidationTimerRef.current !== null) {
      window.clearTimeout(slowValidationTimerRef.current);
    }

    slowValidationTimerRef.current = window.setTimeout(() => {
      setSlowValidationVisible(true);
    }, 2500);
  };

  const clearSlowValidationTimer = () => {
    if (slowValidationTimerRef.current !== null) {
      window.clearTimeout(slowValidationTimerRef.current);
      slowValidationTimerRef.current = null;
    }
    setSlowValidationVisible(false);
  };

  const startCheckout = async () => {
    if (items.length === 0 || checkoutPhase !== "idle") return;

    if (!name.trim() || !phone.trim()) {
      setError({ message: "Completá nombre y WhatsApp para continuar." });
      return;
    }

    setError(null);
    setCheckoutPhase("validating");
    startSlowValidationTimer();
    const catalogRefreshPromise = refreshProductsMemoryCacheFromSource();

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
            name: item.name,
          })),
          payer: { name, phone },
          notes,
        }),
      });

      const data = (await response.json().catch(() => null)) as
        | {
            initPoint?: string;
            sandboxInitPoint?: string;
            error?: string;
            invalidProducts?: Array<{ productId?: string; name?: string }>;
          }
        | null;

      const checkoutUrl = isTestPublicKey
        ? data?.sandboxInitPoint || data?.initPoint
        : data?.initPoint || data?.sandboxInitPoint;

      if (!response.ok || !checkoutUrl) {
        clearSlowValidationTimer();
        setCheckoutPhase("idle");
        setError({
          message: data?.error || "No pudimos iniciar el pago. Intentá nuevamente.",
          invalidProducts:
            Array.isArray(data?.invalidProducts) && data?.invalidProducts.length > 0
              ? data.invalidProducts
                  .map((item) => ({
                    productId: typeof item?.productId === "string" ? item.productId : "",
                    name: typeof item?.name === "string" ? item.name : "Producto no disponible",
                  }))
                  .filter((item) => item.productId)
              : undefined,
        });
        return;
      }

      clearSlowValidationTimer();
      setCheckoutPhase("redirecting");
      await Promise.race([
        catalogRefreshPromise,
        new Promise<boolean>((resolve) => window.setTimeout(() => resolve(false), 1200)),
      ]);
      await new Promise((resolve) => window.setTimeout(resolve, 650));
      window.location.assign(checkoutUrl);
    } catch {
      clearSlowValidationTimer();
      setCheckoutPhase("idle");
      setError({ message: "Ocurrió un error de conexión. Intentá nuevamente." });
    }
  };

  const removeInvalidProducts = () => {
    const invalidProducts = error?.invalidProducts ?? [];
    if (invalidProducts.length === 0) return;

    invalidProducts.forEach((item) => {
      removeItem(item.productId);
    });

    setError({ message: "Quitamos los productos no disponibles. Ya podés continuar con el pago." });
  };

  return (
    <div className="fixed inset-0 z-60 flex items-center justify-center">
      <div className="fixed inset-0 bg-black/60" onClick={onClose} />
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Finalizar compra"
        className="relative z-10 w-full max-w-md rounded bg-[var(--brand-violet-950)] p-6 text-[var(--brand-cream)]"
      >
        <h3 className="text-lg font-semibold">Finalizar compra</h3>
        <p className="text-sm text-[var(--brand-cream)]/60">Completá tus datos para continuar con Mercado Pago Checkout Pro.</p>

        <div className="mt-4 flex flex-col gap-3">
          <label className="text-xs uppercase tracking-[0.08em] text-[var(--brand-cream)]/70" htmlFor="checkout-name">Nombre</label>
          <input id="checkout-name" className="w-full rounded border border-[var(--brand-violet-800)] bg-transparent px-3 py-2 text-[var(--brand-cream)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand-gold-300)]" placeholder="Tu nombre" value={name} onChange={(e)=>setName(e.target.value)} />
          <label className="text-xs uppercase tracking-[0.08em] text-[var(--brand-cream)]/70" htmlFor="checkout-phone">WhatsApp</label>
          <input id="checkout-phone" className="w-full rounded border border-[var(--brand-violet-800)] bg-transparent px-3 py-2 text-[var(--brand-cream)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand-gold-300)]" placeholder="Ej: 54911..." value={phone} onChange={(e)=>setPhone(e.target.value)} />
          <label className="text-xs uppercase tracking-[0.08em] text-[var(--brand-cream)]/70" htmlFor="checkout-notes">Notas (opcional)</label>
          <textarea id="checkout-notes" className="w-full rounded border border-[var(--brand-violet-800)] bg-transparent px-3 py-2 text-[var(--brand-cream)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand-gold-300)]" placeholder="Indicaciones para tu pedido" value={notes} onChange={(e)=>setNotes(e.target.value)} />
        </div>

        {error ? (
          <div className="mt-3 text-sm text-[var(--brand-gold-300)]" role="alert">
            <p>{error.message}</p>
            {error.invalidProducts && error.invalidProducts.length > 0 ? (
              <>
                <ul className="mt-2 list-disc space-y-1 pl-5 text-[var(--brand-cream)]/90">
                  {error.invalidProducts.map((item) => (
                    <li key={item.productId}>{item.name}</li>
                  ))}
                </ul>
                <div className="mt-3 flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={removeInvalidProducts}
                    className="rounded bg-[var(--brand-gold-300)] px-3 py-1.5 text-xs font-semibold text-black focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand-gold-300)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--brand-violet-950)]"
                  >
                    Quitar no disponibles
                  </button>
                  <button
                    type="button"
                    onClick={onClose}
                    className="rounded border border-[var(--brand-violet-700)] px-3 py-1.5 text-xs text-[var(--brand-cream)]/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand-gold-300)]"
                  >
                    Editar carrito
                  </button>
                </div>
              </>
            ) : null}
          </div>
        ) : null}

        {checkoutPhase === "validating" ? (
          <p className="mt-3 text-xs text-[var(--brand-cream)]/75" role="status" aria-live="polite">
            Verificando precios y disponibilidad…
          </p>
        ) : null}

        {checkoutPhase === "redirecting" ? (
          <p className="mt-3 text-xs text-[var(--brand-cream)]/75" role="status" aria-live="polite">
            Redirigiendo a Mercado Pago…
          </p>
        ) : null}

        {slowValidationVisible && checkoutPhase === "validating" ? (
          <p className="mt-2 text-xs text-[var(--brand-gold-300)]" role="status" aria-live="polite">
            Esto puede demorar unos segundos.
          </p>
        ) : null}

        <div className="mt-4 flex gap-2">
          <button
            onClick={startCheckout}
            disabled={checkoutPhase !== "idle" || items.length === 0}
            className="flex-1 rounded bg-[var(--brand-gold-300)] py-2 text-black disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand-gold-300)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--brand-violet-950)]"
          >
            {checkoutPhase === "validating"
              ? "Verificando..."
              : checkoutPhase === "redirecting"
              ? "Redirigiendo..."
              : `Pagar ${formatMoney(subtotal)}`}
          </button>
          <button
            ref={closeButtonRef}
            onClick={onClose}
            disabled={checkoutPhase !== "idle"}
            className="rounded border border-[var(--brand-violet-900)] px-3 py-2 disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand-gold-300)]"
          >
            Cancelar
          </button>
        </div>
      </div>
    </div>
  );
}
