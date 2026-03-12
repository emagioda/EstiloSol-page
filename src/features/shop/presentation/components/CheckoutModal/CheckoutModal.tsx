"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { useBodyScrollLock } from "@/src/core/presentation/hooks/useBodyScrollLock";
import type { CartItem, PaymentMethod } from "../../view-models/useCartStore";
import { useCart } from "../../view-models/useCartStore";
import { refreshProductsMemoryCacheFromSource } from "../../view-models/useProductsStore";

const formatMoney = (value: number) =>
  new Intl.NumberFormat("es-AR", {
    style: "currency",
    currency: "ARS",
    maximumFractionDigits: 0,
  }).format(value);

const DEFAULT_WHATSAPP_NUMBER = "5493416888926";

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
  const {
    removeItem,
    setPaymentMethod,
    getTotal,
    getDiscountedTotal,
  } = useCart();
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [notes, setNotes] = useState("");
  const [selectedPaymentMethod, setSelectedPaymentMethod] = useState<PaymentMethod | null>(null);
  const [transferInfoOpen, setTransferInfoOpen] = useState(false);
  const [checkoutPhase, setCheckoutPhase] = useState<"idle" | "validating" | "redirecting">("idle");
  const [slowValidationVisible, setSlowValidationVisible] = useState(false);
  const [error, setError] = useState<CheckoutErrorState | null>(null);
  const isTestPublicKey = (process.env.NEXT_PUBLIC_MP_PUBLIC_KEY || "").toUpperCase().startsWith("TEST-");
  const checkoutMode = (process.env.NEXT_PUBLIC_MP_CHECKOUT_MODE || "").trim().toLowerCase();
  const closeButtonRef = useRef<HTMLButtonElement | null>(null);
  const onCloseRef = useRef(onClose);
  const slowValidationTimerRef = useRef<number | null>(null);
  const prevalidationDebounceRef = useRef<number | null>(null);

  useBodyScrollLock(open);

  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  const total = useMemo(() => {
    const fromStore = getTotal();
    if (Number.isFinite(fromStore) && fromStore > 0) {
      return Math.round(fromStore);
    }
    return Math.round(subtotal);
  }, [getTotal, subtotal]);

  const discountedTotal = useMemo(() => {
    const fromStore = getDiscountedTotal();
    if (Number.isFinite(fromStore) && fromStore > 0) {
      return Math.round(fromStore);
    }
    return Math.round(total * 0.9);
  }, [getDiscountedTotal, total]);

  const whatsappNumber = (process.env.NEXT_PUBLIC_WHATSAPP_NUMBER || DEFAULT_WHATSAPP_NUMBER).replace(/\D/g, "");

  const isDiscountMethod =
    selectedPaymentMethod === "cash" || selectedPaymentMethod === "transfer";

  const checkoutMessage = useMemo(() => {
    const orderLines = items.map((item) => `- ${item.qty}x ${item.name}`).join("\n");
    const paymentText =
      selectedPaymentMethod === "transfer"
        ? "transferencia bancaria"
        : selectedPaymentMethod === "cash"
        ? "efectivo"
        : "Mercado Pago / tarjetas";
    const finalTotal = isDiscountMethod ? discountedTotal : total;
    const closingLine =
      selectedPaymentMethod === "transfer"
        ? "Adjunto el comprobante."
        : selectedPaymentMethod === "cash"
        ? "Quiero coordinar el pago en efectivo."
        : "Quiero continuar con el pago.";

    return [
      `Hola, quiero continuar mi pedido con pago por ${paymentText}.`,
      "",
      `Total: ${formatMoney(finalTotal)}`,
      "",
      "Detalle del pedido:",
      orderLines || "- Sin productos",
      name.trim() ? `Nombre: ${name.trim()}` : "",
      phone.trim() ? `WhatsApp: ${phone.trim()}` : "",
      notes.trim() ? `Notas: ${notes.trim()}` : "",
      "",
      closingLine,
    ]
      .filter((line, index, all) => !(line === "" && all[index - 1] === ""))
      .join("\n");
  }, [discountedTotal, isDiscountMethod, items, name, notes, phone, selectedPaymentMethod, total]);

  const checkoutWhatsappUrl = useMemo(
    () => `https://wa.me/${whatsappNumber}?text=${encodeURIComponent(checkoutMessage)}`,
    [checkoutMessage, whatsappNumber]
  );

  const handlePaymentMethodChange = (method: PaymentMethod) => {
    if (checkoutPhase !== "idle") return;
    setSelectedPaymentMethod(method);
    setPaymentMethod(method);
    if (method !== "transfer") {
      setTransferInfoOpen(false);
    }
    setError(null);
    setSlowValidationVisible(false);
  };

  useEffect(() => {
    if (!open) return;

    const resetOpenStateTimer = window.setTimeout(() => {
      setError(null);
      setSelectedPaymentMethod(null);
      setTransferInfoOpen(false);
      setCheckoutPhase("idle");
      setSlowValidationVisible(false);
      closeButtonRef.current?.focus();
    }, 0);
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onCloseRef.current();
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.clearTimeout(resetOpenStateTimer);
      window.removeEventListener("keydown", onKeyDown);
      if (slowValidationTimerRef.current !== null) {
        window.clearTimeout(slowValidationTimerRef.current);
        slowValidationTimerRef.current = null;
      }
      setSlowValidationVisible(false);
    };
  }, [open]);

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
          message: data?.error || "Algunos productos del carrito ya no estan disponibles.",
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
    if (selectedPaymentMethod !== "mercadopago") return;
    if (items.length === 0 || checkoutPhase !== "idle") return;

    if (!name.trim() || !phone.trim()) {
      setError({ message: "Completa nombre y WhatsApp para continuar." });
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

      const checkoutUrl =
        checkoutMode === "sandbox"
          ? data?.sandboxInitPoint || data?.initPoint
          : checkoutMode === "production"
          ? data?.initPoint || data?.sandboxInitPoint
          : isTestPublicKey
          ? data?.sandboxInitPoint || data?.initPoint
          : data?.initPoint || data?.sandboxInitPoint;

      if (!response.ok || !checkoutUrl) {
        clearSlowValidationTimer();
        setCheckoutPhase("idle");
        setError({
          message: data?.error || "No pudimos iniciar el pago. Intenta nuevamente.",
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
      setError({ message: "Ocurrio un error de conexion. Intenta nuevamente." });
    }
  };

  const startDiscountCheckout = () => {
    if (!isDiscountMethod) return;
    if (items.length === 0 || checkoutPhase !== "idle") return;

    if (!name.trim() || !phone.trim()) {
      setError({ message: "Completa nombre y WhatsApp para continuar." });
      return;
    }

    setError(null);
    window.open(checkoutWhatsappUrl, "_blank", "noopener,noreferrer");
  };

  const removeInvalidProducts = () => {
    const invalidProducts = error?.invalidProducts ?? [];
    if (invalidProducts.length === 0) return;

    invalidProducts.forEach((item) => {
      removeItem(item.productId);
    });

    setError({ message: "Quitamos los productos no disponibles. Ya podes continuar con el pago." });
  };

  return (
    <div className="fixed inset-0 z-60 flex items-center justify-center px-4 pb-[calc(1rem+var(--safe-area-bottom))] pt-[calc(1rem+var(--safe-area-top))]">
      <div className="fixed inset-0 bg-black/60" onClick={onClose} />
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Finalizar compra"
        className="relative z-10 max-h-[calc(100vh-2rem)] w-full max-w-md overflow-y-auto rounded bg-[var(--brand-violet-950)] p-6 text-[var(--brand-cream)]"
      >
        <h3 className="text-lg font-semibold">Finalizar compra</h3>
        <p className="text-sm text-[var(--brand-cream)]/60">
          Completa tus datos y elegi como queres pagar.
        </p>

        <div className="mt-4 flex flex-col gap-3">
          <label className="text-xs uppercase tracking-[0.08em] text-[var(--brand-cream)]/70" htmlFor="checkout-name">Nombre</label>
          <input
            id="checkout-name"
            className="w-full rounded border border-[var(--brand-violet-800)] bg-transparent px-3 py-2 text-[var(--brand-cream)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand-gold-300)]"
            placeholder="Tu nombre"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
          <label className="text-xs uppercase tracking-[0.08em] text-[var(--brand-cream)]/70" htmlFor="checkout-phone">WhatsApp</label>
          <input
            id="checkout-phone"
            className="w-full rounded border border-[var(--brand-violet-800)] bg-transparent px-3 py-2 text-[var(--brand-cream)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand-gold-300)]"
            placeholder="Ej: 54911..."
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
          />
          <label className="text-xs uppercase tracking-[0.08em] text-[var(--brand-cream)]/70" htmlFor="checkout-notes">Notas (opcional)</label>
          <textarea
            id="checkout-notes"
            className="w-full rounded border border-[var(--brand-violet-800)] bg-transparent px-3 py-2 text-[var(--brand-cream)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand-gold-300)]"
            placeholder="Indicaciones para tu pedido"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
          />
        </div>

        <div className="mt-5">
          <p className="text-xs uppercase tracking-[0.08em] text-[var(--brand-cream)]/70">Metodo de pago</p>
          <div className="mt-2 grid gap-2">
            <label className="cursor-pointer rounded-lg border border-green-400/45 bg-green-500/10 p-3 transition hover:border-green-300">
              <div className="flex items-start gap-3">
                <input
                  type="radio"
                  name="payment-method"
                  checked={selectedPaymentMethod === "cash"}
                  onChange={() => handlePaymentMethodChange("cash")}
                  className="mt-1"
                  disabled={checkoutPhase !== "idle"}
                />
                <div className="flex-1">
                  <div className="flex items-center gap-2">
                    <p className="text-sm font-semibold text-green-200">Efectivo</p>
                    <span className="rounded-full bg-green-200 px-2 py-0.5 text-[10px] font-bold text-green-900">10% OFF</span>
                  </div>
                  <p className="text-xs font-semibold text-green-300">Total con descuento: {formatMoney(discountedTotal)}</p>
                </div>
              </div>
            </label>

            <div className="rounded-lg border border-green-400/45 bg-green-500/10 p-3">
              <label className="cursor-pointer">
                <div className="flex items-start gap-3">
                  <input
                    type="radio"
                    name="payment-method"
                    checked={selectedPaymentMethod === "transfer"}
                    onChange={() => handlePaymentMethodChange("transfer")}
                    className="mt-1"
                    disabled={checkoutPhase !== "idle"}
                  />
                  <div className="flex-1">
                    <div className="flex items-center gap-2">
                      <p className="text-sm font-semibold text-green-200">Transferencia bancaria</p>
                      <span className="rounded-full bg-green-200 px-2 py-0.5 text-[10px] font-bold text-green-900">10% OFF</span>
                    </div>
                    <p className="text-xs font-semibold text-green-300">Total con descuento: {formatMoney(discountedTotal)}</p>
                  </div>
                </div>
              </label>

              <button
                type="button"
                onClick={() => setTransferInfoOpen((prev) => !prev)}
                className="ml-6 mt-1 inline-flex items-center gap-1 text-xs font-medium text-green-100 transition hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-green-300"
              >
                <span className="underline underline-offset-4">
                  {transferInfoOpen ? "Ocultar datos bancarios" : "Ver datos bancarios"}
                </span>
                <span aria-hidden className="no-underline">{transferInfoOpen ? "▴" : "▾"}</span>
              </button>

              {transferInfoOpen && (
                <div className="ml-6 mt-2 rounded-lg border border-green-300/40 bg-green-50 p-3 text-green-900">
                  <div className="space-y-1 text-xs sm:text-sm">
                    <p><span className="font-semibold">Banco:</span> Banco Galicia</p>
                    <p><span className="font-semibold">Titular:</span> Estilo Sol</p>
                    <p className="break-all"><span className="font-semibold">CBU:</span> 0000000000000000000000</p>
                    <p><span className="font-semibold">Alias:</span> ESTILOSOL.OK</p>
                  </div>
                  <div className="mx-auto my-3 flex h-28 w-28 items-center justify-center rounded-lg bg-gray-200 text-center text-xs text-gray-500">
                    [Imagen QR aqui]
                  </div>
                </div>
              )}
            </div>

            <label className="cursor-pointer rounded-lg border border-[var(--brand-violet-700)] bg-white/5 p-3 transition hover:border-[var(--brand-gold-300)]/70">
              <div className="flex items-start gap-3">
                <input
                  type="radio"
                  name="payment-method"
                  checked={selectedPaymentMethod === "mercadopago"}
                  onChange={() => handlePaymentMethodChange("mercadopago")}
                  className="mt-1"
                  disabled={checkoutPhase !== "idle"}
                />
                <div className="flex-1">
                  <p className="text-sm font-semibold text-[var(--brand-cream)]">Mercado Pago / Tarjetas</p>
                  <p className="text-xs text-[var(--brand-cream)]/70">Total: {formatMoney(total)}</p>
                </div>
              </div>
            </label>
          </div>
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

        {selectedPaymentMethod === "mercadopago" && checkoutPhase === "validating" ? (
          <p className="mt-3 text-xs text-[var(--brand-cream)]/75" role="status" aria-live="polite">
            Verificando precios y disponibilidad...
          </p>
        ) : null}

        {selectedPaymentMethod === "mercadopago" && checkoutPhase === "redirecting" ? (
          <p className="mt-3 text-xs text-[var(--brand-cream)]/75" role="status" aria-live="polite">
            Redirigiendo a Mercado Pago...
          </p>
        ) : null}

        {selectedPaymentMethod === "mercadopago" && slowValidationVisible && checkoutPhase === "validating" ? (
          <p className="mt-2 text-xs text-[var(--brand-gold-300)]" role="status" aria-live="polite">
            Esto puede demorar unos segundos.
          </p>
        ) : null}

        <div className="mt-4 flex gap-2">
          {selectedPaymentMethod === "mercadopago" ? (
            <button
              onClick={startCheckout}
              disabled={checkoutPhase !== "idle" || items.length === 0}
              className="flex-1 rounded bg-[var(--brand-gold-300)] py-2 text-black disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand-gold-300)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--brand-violet-950)]"
            >
              {checkoutPhase === "validating"
                ? "Verificando..."
                : checkoutPhase === "redirecting"
                ? "Redirigiendo..."
                : `Pagar ${formatMoney(total)}`}
            </button>
          ) : isDiscountMethod ? (
            <button
              type="button"
              onClick={startDiscountCheckout}
              disabled={items.length === 0 || checkoutPhase !== "idle"}
              className="flex-1 rounded bg-[var(--brand-gold-300)] py-2 text-black shadow-[0_10px_20px_rgba(18,8,35,0.25)] transition-transform hover:-translate-y-0.5 disabled:opacity-50 disabled:hover:translate-y-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand-gold-300)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--brand-violet-950)]"
            >
              {selectedPaymentMethod === "transfer"
                ? "Enviar Comprobante de Transferencia"
                : "Coordinar Pago en Efectivo"}
            </button>
          ) : <div className="flex-1" />}

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
