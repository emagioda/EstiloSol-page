"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import type { PaymentMethod } from "../../view-models/useCartStore";
import { useCart } from "../../view-models/useCartStore";
import { refreshProductsMemoryCacheFromSource } from "../../view-models/useProductsStore";
import {
  buildWhatsappMessage,
  deliveryMethodLabel,
  isDiscountPaymentMethod,
  isValidEmail,
  isValidWhatsapp,
  normalizePhoneDigits,
  paymentMethodLabel,
  sanitizeText,
  type CheckoutContactDraft,
  type DeliveryMethod,
} from "./checkoutUtils";

const DRAFT_STORAGE_KEY = "es_sol_checkout_draft";
const DEFAULT_WHATSAPP_NUMBER = "5493416888926";
const BANK_CBU = "0000000000000000000000";
const BANK_ALIAS = "ESTILOSOL.OK";

type CheckoutPhase = "idle" | "redirecting";

type CheckoutErrorState = {
  message: string;
  invalidProducts?: Array<{ productId: string; name: string }>;
};

type CheckoutStepsProps = {
  subtotal: number;
  discountedTotal: number;
};

type BankField = "cbu" | "alias";

const inputBaseClassName =
  "w-full rounded-2xl border border-transparent bg-[color-mix(in_srgb,var(--brand-violet-700)_24%,white_76%)] px-3.5 py-2.5 text-sm text-[var(--brand-violet-950)] placeholder:text-[var(--brand-violet-950)]/55 transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand-gold-500)]";

const getInputClassName = (hasError: boolean) =>
  `${inputBaseClassName} ${hasError ? "ring-1 ring-red-400/70" : ""}`;

const isPaymentMethod = (value: unknown): value is PaymentMethod =>
  value === "cash" || value === "transfer" || value === "mercadopago";

const isDeliveryMethod = (value: unknown): value is DeliveryMethod =>
  value === "delivery" || value === "pickup";

const buildApiNotes = ({
  deliveryMethod,
  email,
  notes,
}: {
  deliveryMethod: DeliveryMethod;
  email: string;
  notes: string;
}) =>
  sanitizeText(
    [`Entrega: ${deliveryMethodLabel(deliveryMethod)}`, email ? `Email: ${email}` : "", notes]
      .filter(Boolean)
      .join(" | "),
    250
  );

export default function CheckoutSteps({ subtotal, discountedTotal }: CheckoutStepsProps) {
  const { items, paymentMethod, setPaymentMethod, removeItem } = useCart();
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [whatsapp, setWhatsapp] = useState("");
  const [email, setEmail] = useState("");
  const [deliveryMethod, setDeliveryMethod] = useState<DeliveryMethod>("delivery");
  const [notes, setNotes] = useState("");
  const [isContactStepComplete, setIsContactStepComplete] = useState(false);
  const [showValidation, setShowValidation] = useState(false);
  const [transferInfoOpen, setTransferInfoOpen] = useState(false);
  const [checkoutPhase, setCheckoutPhase] = useState<CheckoutPhase>("idle");
  const [isStep1CheckingCart, setIsStep1CheckingCart] = useState(false);
  const [error, setError] = useState<CheckoutErrorState | null>(null);
  const [copiedField, setCopiedField] = useState<BankField | null>(null);
  const [lastValidatedCartHash, setLastValidatedCartHash] = useState<string | null>(null);
  const [isDraftHydrated, setIsDraftHydrated] = useState(false);
  const catalogWarmupPromiseRef = useRef<Promise<boolean> | null>(null);
  const lastCatalogWarmupAtRef = useRef(0);
  const isTestPublicKey = (process.env.NEXT_PUBLIC_MP_PUBLIC_KEY || "").toUpperCase().startsWith("TEST-");

  const fullName = useMemo(() => `${firstName} ${lastName}`.replace(/\s+/g, " ").trim(), [firstName, lastName]);
  const cartHash = useMemo(
    () => items.map((item) => `${item.productId}:${item.qty}`).sort().join("|"),
    [items]
  );
  const isDiscountMethod = isDiscountPaymentMethod(paymentMethod);
  const finalTotal = isDiscountMethod ? discountedTotal : subtotal;

  const firstNameError = showValidation && !firstName.trim();
  const lastNameError = showValidation && !lastName.trim();
  const whatsappError = (showValidation || whatsapp.trim().length > 0) && !isValidWhatsapp(whatsapp);
  const emailError = (showValidation || email.trim().length > 0) && !isValidEmail(email);
  const isContactFormValid =
    firstName.trim().length > 0 &&
    lastName.trim().length > 0 &&
    isValidWhatsapp(whatsapp) &&
    isValidEmail(email);

  const whatsappNumber = (process.env.NEXT_PUBLIC_WHATSAPP_NUMBER || DEFAULT_WHATSAPP_NUMBER).replace(/\D/g, "");

  const checkoutMessage = useMemo(
    () =>
      buildWhatsappMessage({
        items,
        paymentMethod,
        finalTotal,
        fullName,
        whatsapp: normalizePhoneDigits(whatsapp),
        email: email.trim(),
        deliveryMethod,
        notes: notes.trim(),
      }),
    [deliveryMethod, email, finalTotal, fullName, items, notes, paymentMethod, whatsapp]
  );

  const checkoutWhatsappUrl = useMemo(
    () => `https://wa.me/${whatsappNumber}?text=${encodeURIComponent(checkoutMessage)}`,
    [checkoutMessage, whatsappNumber]
  );

  useEffect(() => {
    try {
      const raw = localStorage.getItem(DRAFT_STORAGE_KEY);
      if (!raw) {
        setIsDraftHydrated(true);
        return;
      }

      const parsed = JSON.parse(raw) as Partial<CheckoutContactDraft> | null;
      if (!parsed || typeof parsed !== "object") {
        setIsDraftHydrated(true);
        return;
      }

      const draftFirstName = sanitizeText(parsed.firstName, 80);
      const draftLastName = sanitizeText(parsed.lastName, 80);
      const draftWhatsapp = sanitizeText(parsed.whatsapp, 30);
      const draftEmail = sanitizeText(parsed.email, 120);
      const draftNotes = sanitizeText(parsed.notes, 250);

      setFirstName(draftFirstName);
      setLastName(draftLastName);
      setWhatsapp(draftWhatsapp);
      setEmail(draftEmail);
      setNotes(draftNotes);

      if (isDeliveryMethod(parsed.deliveryMethod)) {
        setDeliveryMethod(parsed.deliveryMethod);
      }
      if (isPaymentMethod(parsed.paymentMethod)) {
        setPaymentMethod(parsed.paymentMethod);
      }

      const hasValidDraftContact =
        draftFirstName.length > 0 &&
        draftLastName.length > 0 &&
        isValidWhatsapp(draftWhatsapp) &&
        isValidEmail(draftEmail);
      setIsContactStepComplete(Boolean(parsed.step1Completed) && hasValidDraftContact);
    } catch {
      // ignore invalid draft payloads
    } finally {
      setIsDraftHydrated(true);
    }
  }, [setPaymentMethod]);

  useEffect(() => {
    if (!isDraftHydrated) return;

    const draft: CheckoutContactDraft = {
      firstName: sanitizeText(firstName, 80),
      lastName: sanitizeText(lastName, 80),
      whatsapp: sanitizeText(whatsapp, 30),
      email: sanitizeText(email, 120),
      notes: sanitizeText(notes, 250),
      deliveryMethod,
      step1Completed: isContactStepComplete,
      paymentMethod,
    };

    try {
      localStorage.setItem(DRAFT_STORAGE_KEY, JSON.stringify(draft));
    } catch {
      // ignore localStorage issues
    }
  }, [
    deliveryMethod,
    email,
    firstName,
    isContactStepComplete,
    isDraftHydrated,
    lastName,
    notes,
    paymentMethod,
    whatsapp,
  ]);

  useEffect(() => {
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
  }, [items, error]);

  useEffect(() => {
    return () => {
      // noop
    };
  }, []);

  useEffect(() => {
    setLastValidatedCartHash(null);
  }, [cartHash]);

  const normalizeInvalidProducts = (
    invalidProducts: Array<{ productId?: string; name?: string }> | undefined
  ) =>
    (invalidProducts ?? [])
      .map((item) => ({
        productId: typeof item?.productId === "string" ? item.productId : "",
        name: typeof item?.name === "string" ? item.name : "Producto no disponible",
      }))
      .filter((item) => item.productId);

  const warmCatalogCache = () => {
    if (catalogWarmupPromiseRef.current) return catalogWarmupPromiseRef.current;

    const now = Date.now();
    if (now - lastCatalogWarmupAtRef.current < 30_000) {
      return Promise.resolve(true);
    }

    const warmupPromise = refreshProductsMemoryCacheFromSource()
      .then(() => true)
      .catch(() => false)
      .finally(() => {
        lastCatalogWarmupAtRef.current = Date.now();
        if (catalogWarmupPromiseRef.current === warmupPromise) {
          catalogWarmupPromiseRef.current = null;
        }
      });

    catalogWarmupPromiseRef.current = warmupPromise;
    return warmupPromise;
  };

  const validateCartBeforePayment = async (): Promise<boolean> => {
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

    if (!response) {
      setError({ message: "No pudimos validar el carrito. Revisa tu conexion e intenta nuevamente." });
      return false;
    }

    if (response.ok) {
      setLastValidatedCartHash(cartHash);
      return true;
    }

    const data = (await response.json().catch(() => null)) as
      | {
          error?: string;
          invalidProducts?: Array<{ productId?: string; name?: string }>;
        }
      | null;

    const invalidProducts = normalizeInvalidProducts(data?.invalidProducts);
    if (invalidProducts.length > 0) {
      await refreshProductsMemoryCacheFromSource();
    }

    setError({
      message:
        data?.error ||
        (response.status === 429
          ? "Demasiadas solicitudes. Espera unos segundos e intenta nuevamente."
          : "No pudimos validar los productos del carrito."),
      invalidProducts: invalidProducts.length > 0 ? invalidProducts : undefined,
    });

    return false;
  };

  const handleContinueToPayment = async () => {
    if (isStep1CheckingCart) return;
    setShowValidation(true);
    if (!isContactFormValid) return;

    setIsStep1CheckingCart(true);
    setError(null);

    try {
      const isCartValid = await validateCartBeforePayment();
      if (!isCartValid) return;

      setIsContactStepComplete(true);
      void warmCatalogCache();
    } finally {
      setIsStep1CheckingCart(false);
    }
  };

  const handleEditContact = () => {
    setIsContactStepComplete(false);
    setCheckoutPhase("idle");
    setError(null);
  };

  const handlePaymentMethodChange = (method: PaymentMethod) => {
    if (checkoutPhase !== "idle") return;
    setPaymentMethod(method);
    if (method !== "transfer") {
      setTransferInfoOpen(false);
    }
    setError(null);
  };

  const startCheckout = async () => {
    if (paymentMethod !== "mercadopago") return;
    if (items.length === 0 || checkoutPhase !== "idle") return;

    if (!isContactStepComplete || !isContactFormValid) {
      setIsContactStepComplete(false);
      setShowValidation(true);
      setError({ message: "Completa todos los datos de contacto para continuar." });
      return;
    }

    setError(null);
    if (lastValidatedCartHash !== cartHash) {
      setIsContactStepComplete(false);
      setCheckoutPhase("idle");
      setError({ message: "Tu carrito cambio. Revisa el Paso 1 y presiona Continuar al pago para validar nuevamente." });
      return;
    }

    setCheckoutPhase("redirecting");

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
          payer: {
            name: fullName,
            phone: normalizePhoneDigits(whatsapp),
            email: email.trim(),
          },
          notes: buildApiNotes({
            deliveryMethod,
            email: email.trim(),
            notes: notes.trim(),
          }),
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
        setCheckoutPhase("idle");
        setError({
          message: data?.error || "No pudimos iniciar el pago. Intenta nuevamente.",
          invalidProducts:
            Array.isArray(data?.invalidProducts) && data.invalidProducts.length > 0
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

      window.location.assign(checkoutUrl);
    } catch {
      setCheckoutPhase("idle");
      setError({ message: "Ocurrio un error de conexion. Intenta nuevamente." });
    }
  };

  const startDiscountCheckout = async () => {
    if (!isDiscountMethod) return;
    if (items.length === 0 || checkoutPhase !== "idle") return;

    if (!isContactStepComplete || !isContactFormValid) {
      setIsContactStepComplete(false);
      setShowValidation(true);
      setError({ message: "Completa todos los datos de contacto para continuar." });
      return;
    }

    setError(null);
    if (lastValidatedCartHash !== cartHash) {
      setIsContactStepComplete(false);
      setError({ message: "Tu carrito cambio. Revisa el Paso 1 y presiona Continuar al pago para validar nuevamente." });
      return;
    }
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

  const copyBankValue = async (value: string, field: BankField) => {
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(value);
      } else {
        const helperInput = document.createElement("textarea");
        helperInput.value = value;
        helperInput.setAttribute("readonly", "true");
        helperInput.style.position = "absolute";
        helperInput.style.left = "-9999px";
        document.body.appendChild(helperInput);
        helperInput.select();
        document.execCommand("copy");
        document.body.removeChild(helperInput);
      }

      setCopiedField(field);
      window.setTimeout(() => {
        setCopiedField((current) => (current === field ? null : current));
      }, 1400);
    } catch {
      setCopiedField(null);
    }
  };

  if (items.length === 0) {
    return (
      <section className="rounded-3xl border border-[rgba(242,199,119,0.34)] bg-[rgba(132,109,165,0.86)] p-6 shadow-[0_22px_40px_rgba(18,8,35,0.28)]">
        <h1 className="[font-family:var(--font-brand-display)] text-2xl text-[var(--brand-cream)]">Checkout</h1>
        <p className="mt-2 text-sm text-[var(--brand-cream)]/80">Tu carrito esta vacio. Agrega productos para continuar.</p>
        <Link
          href="/tienda"
          className="mt-5 inline-flex rounded-2xl bg-[var(--brand-gold-300)] px-4 py-2 text-sm font-medium text-black transition hover:brightness-105 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand-gold-300)]"
        >
          Volver a la tienda
        </Link>
      </section>
    );
  }

  return (
    <div className="space-y-4 lg:space-y-5">
      <section className="rounded-3xl border border-[rgba(242,199,119,0.34)] bg-[rgba(132,109,165,0.86)] p-4 shadow-[0_22px_40px_rgba(18,8,35,0.28)] sm:p-6">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--brand-gold-300)]/20 pb-4">
          <div>
            <p className="text-xs uppercase tracking-[0.12em] text-[var(--brand-cream)]/70">Paso 1</p>
            <h1 className="[font-family:var(--font-brand-display)] text-2xl text-[var(--brand-cream)]">
              Contacto y entrega
            </h1>
          </div>
          {isContactStepComplete ? (
            <span className="rounded-full border border-[var(--brand-gold-300)]/30 px-3 py-1 text-xs text-[var(--brand-gold-300)]">
              Completado
            </span>
          ) : null}
        </div>

        {isContactStepComplete ? (
          <div className="mt-4 rounded-2xl border border-[rgba(242,199,119,0.28)] bg-[rgba(205,178,227,0.18)] p-4">
            <div className="grid gap-1 text-sm text-[var(--brand-cream)]/88 sm:grid-cols-2">
              <p>
                <span className="text-[var(--brand-cream)]/65">Cliente:</span> {fullName}
              </p>
              <p>
                <span className="text-[var(--brand-cream)]/65">WhatsApp:</span> {normalizePhoneDigits(whatsapp)}
              </p>
              <p className="sm:col-span-2">
                <span className="text-[var(--brand-cream)]/65">Email:</span> {email.trim()}
              </p>
              <p className="sm:col-span-2">
                <span className="text-[var(--brand-cream)]/65">Entrega:</span> {deliveryMethodLabel(deliveryMethod)}
              </p>
            </div>
            <button
              type="button"
              onClick={handleEditContact}
              className="mt-4 rounded-xl border border-[var(--brand-gold-300)]/45 px-3 py-2 text-xs font-medium text-[var(--brand-gold-300)] transition hover:bg-[var(--brand-gold-300)] hover:text-black focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand-gold-300)]"
            >
              Cambiar
            </button>
          </div>
        ) : (
          <div className="mt-4 space-y-4">
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <label htmlFor="checkout-first-name" className="mb-1.5 block text-xs uppercase tracking-[0.1em] text-[var(--brand-cream)]/75">
                  Nombre
                </label>
                <input
                  id="checkout-first-name"
                  value={firstName}
                  onChange={(event) => setFirstName(event.target.value)}
                  placeholder="Tu nombre"
                  className={getInputClassName(firstNameError)}
                  autoComplete="given-name"
                />
                {firstNameError ? <p className="mt-1 text-xs text-red-200">Ingresa tu nombre.</p> : null}
              </div>

              <div>
                <label htmlFor="checkout-last-name" className="mb-1.5 block text-xs uppercase tracking-[0.1em] text-[var(--brand-cream)]/75">
                  Apellido
                </label>
                <input
                  id="checkout-last-name"
                  value={lastName}
                  onChange={(event) => setLastName(event.target.value)}
                  placeholder="Tu apellido"
                  className={getInputClassName(lastNameError)}
                  autoComplete="family-name"
                />
                {lastNameError ? <p className="mt-1 text-xs text-red-200">Ingresa tu apellido.</p> : null}
              </div>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <label htmlFor="checkout-whatsapp" className="mb-1.5 block text-xs uppercase tracking-[0.1em] text-[var(--brand-cream)]/75">
                  WhatsApp
                </label>
                <input
                  id="checkout-whatsapp"
                  value={whatsapp}
                  onChange={(event) => setWhatsapp(event.target.value)}
                  placeholder="Ej: 54911..."
                  className={getInputClassName(whatsappError)}
                  autoComplete="tel"
                />
                {whatsappError ? (
                  <p className="mt-1 text-xs text-red-200">Ingresa un WhatsApp valido (10 a 15 digitos).</p>
                ) : null}
              </div>

              <div>
                <label htmlFor="checkout-email" className="mb-1.5 block text-xs uppercase tracking-[0.1em] text-[var(--brand-cream)]/75">
                  Email
                </label>
                <input
                  id="checkout-email"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  placeholder="nombre@email.com"
                  className={getInputClassName(emailError)}
                  autoComplete="email"
                />
                {emailError ? <p className="mt-1 text-xs text-red-200">Ingresa un email valido.</p> : null}
              </div>
            </div>

            <div>
              <p className="mb-2 text-xs uppercase tracking-[0.1em] text-[var(--brand-cream)]/75">Entrega</p>
              <div className="grid gap-2 sm:grid-cols-2">
                <label
                  className={`block w-full cursor-pointer rounded-2xl border px-3.5 py-3 text-sm transition-all ${
                    deliveryMethod === "delivery"
                      ? "border-[rgba(248,227,176,0.8)] bg-[rgba(242,199,119,0.18)] text-[var(--brand-cream)]"
                      : "border-[rgba(218,189,236,0.45)] bg-[rgba(207,178,227,0.18)] text-[var(--brand-cream)]/85 hover:border-[rgba(248,227,176,0.6)]"
                  }`}
                >
                  <input
                    type="radio"
                    name="delivery-method"
                    className="sr-only"
                    checked={deliveryMethod === "delivery"}
                    onChange={() => setDeliveryMethod("delivery")}
                  />
                  <span className="block font-medium">Envio a domicilio</span>
                </label>
                <label
                  className={`block w-full cursor-pointer rounded-2xl border px-3.5 py-3 text-sm transition-all ${
                    deliveryMethod === "pickup"
                      ? "border-[rgba(248,227,176,0.8)] bg-[rgba(242,199,119,0.18)] text-[var(--brand-cream)]"
                      : "border-[rgba(218,189,236,0.45)] bg-[rgba(207,178,227,0.18)] text-[var(--brand-cream)]/85 hover:border-[rgba(248,227,176,0.6)]"
                  }`}
                >
                  <input
                    type="radio"
                    name="delivery-method"
                    className="sr-only"
                    checked={deliveryMethod === "pickup"}
                    onChange={() => setDeliveryMethod("pickup")}
                  />
                  <span className="block font-medium">Punto de retiro</span>
                </label>
              </div>

              <div className="mt-2 rounded-xl bg-[rgba(224,200,239,0.2)] px-3 py-2 text-xs text-[var(--brand-cream)]/82 transition-all duration-300 ease-out">
                {deliveryMethod === "delivery"
                  ? "Coordinamos la entrega por WhatsApp despues de confirmar el pago."
                  : "Te avisamos por WhatsApp cuando tu pedido este listo para retirar en el punto de retiro."}
              </div>
            </div>

            <div>
              <label htmlFor="checkout-notes" className="mb-1.5 block text-xs uppercase tracking-[0.1em] text-[var(--brand-cream)]/75">
                Notas (opcional)
              </label>
              <textarea
                id="checkout-notes"
                value={notes}
                onChange={(event) => setNotes(event.target.value)}
                placeholder="Aclaraciones sobre entrega o pedido"
                className={`${inputBaseClassName} min-h-24 resize-y`}
              />
            </div>

            <button
              type="button"
              onClick={handleContinueToPayment}
              disabled={isStep1CheckingCart}
              className="w-full rounded-2xl bg-[var(--brand-gold-300)] px-4 py-3 text-sm font-semibold text-black transition hover:brightness-105 disabled:cursor-not-allowed disabled:opacity-70 disabled:hover:brightness-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand-gold-300)]"
            >
              {isStep1CheckingCart ? "Validando carrito..." : "Continuar al pago"}
            </button>
          </div>
        )}
      </section>

      <section
        className={`rounded-3xl border border-[rgba(242,199,119,0.34)] bg-[rgba(132,109,165,0.86)] p-4 shadow-[0_22px_40px_rgba(18,8,35,0.28)] transition sm:p-6 ${
          isContactStepComplete ? "opacity-100" : "opacity-70"
        }`}
      >
        <div className="border-b border-[var(--brand-gold-300)]/20 pb-4">
          <p className="text-xs uppercase tracking-[0.12em] text-[var(--brand-cream)]/70">Paso 2</p>
          <h2 className="[font-family:var(--font-brand-display)] text-2xl text-[var(--brand-cream)]">Pago</h2>
        </div>

        {!isContactStepComplete ? (
          <p className="mt-4 text-sm text-[var(--brand-cream)]/78">
            Completa primero los datos de contacto para habilitar este paso.
          </p>
        ) : (
          <div className="mt-4 space-y-2.5">
            <label className="block w-full cursor-pointer rounded-2xl border border-[rgba(242,199,119,0.42)] bg-[rgba(206,175,228,0.24)] p-3 transition hover:border-[rgba(248,227,176,0.74)]">
              <div className="flex items-start gap-3">
                <input
                  type="radio"
                  name="payment-method"
                  checked={paymentMethod === "cash"}
                  onChange={() => handlePaymentMethodChange("cash")}
                  className="mt-1"
                  disabled={checkoutPhase !== "idle"}
                />
                <div className="flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="text-sm font-semibold text-[var(--brand-cream)]">Efectivo</p>
                    <span className="rounded-full bg-[var(--brand-gold-300)] px-2 py-0.5 text-[10px] font-bold text-[var(--brand-violet-950)]">10% OFF</span>
                  </div>
                </div>
              </div>
            </label>

            <div className="rounded-2xl border border-[rgba(242,199,119,0.42)] bg-[rgba(206,175,228,0.24)] px-3 pt-3 pb-2.5">
              <label className="block w-full cursor-pointer">
                <div className="flex items-start gap-3">
                  <input
                    type="radio"
                    name="payment-method"
                    checked={paymentMethod === "transfer"}
                    onChange={() => handlePaymentMethodChange("transfer")}
                    className="mt-1"
                    disabled={checkoutPhase !== "idle"}
                  />
                  <div className="flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="text-sm font-semibold text-[var(--brand-cream)]">Transferencia bancaria</p>
                      <span className="rounded-full bg-[var(--brand-gold-300)] px-2 py-0.5 text-[10px] font-bold text-[var(--brand-violet-950)]">10% OFF</span>
                    </div>
                  </div>
                </div>
              </label>

              <button
                type="button"
                onClick={() => setTransferInfoOpen((prev) => !prev)}
                className="ml-6 mt-0.5 inline-flex items-center gap-1 text-xs font-medium text-[var(--brand-cream)] transition hover:text-[var(--brand-gold-300)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand-gold-300)]"
              >
                <span className="underline underline-offset-4">
                  {transferInfoOpen ? "Ocultar datos bancarios" : "Ver datos bancarios"}
                </span>
                <svg
                  aria-hidden
                  viewBox="0 0 20 20"
                  className={`h-3 w-3 fill-current transition-transform duration-200 ${
                    transferInfoOpen ? "rotate-180" : ""
                  }`}
                >
                  <path d="M5.5 7.5h9L10 13.5 5.5 7.5Z" />
                </svg>
              </button>

              {transferInfoOpen ? (
                <div className="mt-2 rounded-lg border border-[rgba(242,199,119,0.42)] bg-[rgba(250,242,255,0.94)] p-3 text-[var(--brand-violet-950)]">
                  <div className="space-y-1 text-xs sm:text-sm">
                    <p><span className="font-semibold">Banco:</span> Banco Galicia</p>
                    <p><span className="font-semibold">Titular:</span> Estilo Sol</p>
                    <div className="flex items-start justify-between gap-2">
                      <p className="break-all">
                        <span className="font-semibold">CBU:</span> {BANK_CBU}
                      </p>
                      <button
                        type="button"
                        onClick={() => void copyBankValue(BANK_CBU, "cbu")}
                        className="shrink-0 rounded border border-[rgba(94,58,146,0.32)] px-2 py-0.5 text-[11px] font-medium text-[var(--brand-violet-950)] transition hover:bg-[rgba(214,166,75,0.2)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand-gold-500)]"
                      >
                        {copiedField === "cbu" ? "Copiado" : "Copiar"}
                      </button>
                    </div>
                    <div className="flex items-start justify-between gap-2">
                      <p>
                        <span className="font-semibold">Alias:</span> {BANK_ALIAS}
                      </p>
                      <button
                        type="button"
                        onClick={() => void copyBankValue(BANK_ALIAS, "alias")}
                        className="shrink-0 rounded border border-[rgba(94,58,146,0.32)] px-2 py-0.5 text-[11px] font-medium text-[var(--brand-violet-950)] transition hover:bg-[rgba(214,166,75,0.2)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand-gold-500)]"
                      >
                        {copiedField === "alias" ? "Copiado" : "Copiar"}
                      </button>
                    </div>
                  </div>
                </div>
              ) : null}
            </div>

            <label className="block w-full cursor-pointer rounded-2xl border border-[rgba(218,189,236,0.45)] bg-[rgba(207,178,227,0.18)] p-3 transition hover:border-[rgba(248,227,176,0.7)]">
              <div className="flex items-start gap-3">
                <input
                  type="radio"
                  name="payment-method"
                  checked={paymentMethod === "mercadopago"}
                  onChange={() => handlePaymentMethodChange("mercadopago")}
                  className="mt-1"
                  disabled={checkoutPhase !== "idle"}
                />
                <div className="flex-1">
                  <p className="text-sm font-semibold text-[var(--brand-cream)]">Mercado Pago / Tarjetas</p>
                  <p className="text-xs text-[var(--brand-cream)]/70">Pago online seguro</p>
                </div>
              </div>
            </label>
          </div>
        )}

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
                    className="rounded bg-[var(--brand-gold-300)] px-3 py-1.5 text-xs font-semibold text-black focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand-gold-300)]"
                  >
                    Quitar no disponibles
                  </button>
                </div>
              </>
            ) : null}
          </div>
        ) : null}

        {paymentMethod === "mercadopago" && checkoutPhase === "redirecting" ? (
          <p className="mt-3 text-xs text-[var(--brand-cream)]/75" role="status" aria-live="polite">
            Redirigiendo a Mercado Pago...
          </p>
        ) : null}

        <button
          type="button"
          onClick={paymentMethod === "mercadopago" ? startCheckout : startDiscountCheckout}
          disabled={!isContactStepComplete || items.length === 0 || checkoutPhase !== "idle"}
          className="mt-5 w-full rounded-2xl bg-[var(--brand-gold-300)] px-4 py-3 text-sm font-semibold text-black shadow-[0_10px_20px_rgba(18,8,35,0.25)] transition hover:-translate-y-0.5 disabled:opacity-60 disabled:hover:translate-y-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand-gold-300)]"
        >
          {paymentMethod === "mercadopago"
            ? checkoutPhase === "redirecting"
              ? "Redirigiendo..."
              : "Finalizar pedido"
            : "Finalizar pedido"}
        </button>

        <p className="mt-2 text-xs text-[var(--brand-cream)]/70">
          Metodo seleccionado: {paymentMethodLabel(paymentMethod)}
        </p>
      </section>
    </div>
  );
}
