"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import { brandConfig } from "@/src/config/brand";
import {
  fallbackFulfillmentConfig,
  getActivePickupPointById,
  type FulfillmentConfig,
} from "@/src/config/fulfillment";
import type { PaymentMethod } from "../../view-models/useCartStore";
import { useCart } from "../../view-models/useCartStore";
import { refreshProductsMemoryCacheFromSource } from "../../view-models/useProductsStore";
import {
  deliveryMethodLabel,
  formatMoney,
  isDiscountPaymentMethod,
  isValidEmail,
  isValidWhatsapp,
  normalizePhoneDigits,
  sanitizeText,
  type CheckoutContactDraft,
  type DeliveryAddress,
  type DeliveryMethod,
} from "./checkoutUtils";

const DRAFT_STORAGE_KEY = "es_sol_checkout_draft";
const BANK_TRANSFER_INFO = brandConfig.paymentInfo.transfer;
const ProductLightbox = dynamic(() => import("../ProductImageGalleryZoom/ProductLightbox"), { ssr: false });

type CheckoutPhase = "idle" | "validating" | "creating" | "redirecting";

export type CheckoutInvalidProduct = {
  productId: string;
  name: string;
  reason?: string;
  requestedQty?: number;
  availableQty?: number | null;
  requestedPrice?: number;
  currentPrice?: number;
  stockStatus?: "in_stock" | "out_of_stock" | "preorder";
};

type CheckoutErrorState = {
  message: string;
  invalidProducts?: CheckoutInvalidProduct[];
};

type CheckoutApiError = {
  error?: string;
  invalidProducts?: Array<{
    productId?: string;
    name?: string;
    reason?: string;
    requestedQty?: number;
    availableQty?: number | null;
    requestedPrice?: number;
    currentPrice?: number;
    stockStatus?: "in_stock" | "out_of_stock" | "preorder";
  }>;
};

type CheckoutStepsProps = {
  subtotal: number;
  discountedTotal: number;
  fulfillmentConfig?: FulfillmentConfig;
  onDeliveryMethodChange?: (deliveryMethod: DeliveryMethod) => void;
  onPickupPointChange?: (pickupPointId: string) => void;
  onInvalidProductsChange?: (products: CheckoutInvalidProduct[]) => void;
};

type BankField = "cvu" | "alias";

const inputBaseClassName =
  "w-full rounded-2xl border border-white/10 bg-[rgba(255,255,255,0.9)] px-3.5 py-2.5 text-sm text-[var(--brand-violet-950)] placeholder:text-[var(--brand-violet-950)]/42 shadow-[inset_0_1px_0_rgba(255,255,255,0.5)] transition focus-visible:border-[rgba(248,227,176,0.68)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[rgba(248,227,176,0.5)]";
const fieldLabelClassName =
  "mb-1.5 block text-xs font-semibold uppercase tracking-[0.1em] text-[var(--brand-cream)]/76";
const fieldErrorClassName = "mt-1.5 text-xs font-medium text-rose-100";
const deliveryOptionBaseClassName =
  "group relative flex min-h-[5.25rem] cursor-pointer items-center rounded-2xl border px-4 py-3 text-left transition duration-200 focus-within:ring-2 focus-within:ring-[rgba(248,227,176,0.42)] sm:px-5";
const unselectedDeliveryOptionClassName =
  "border-white/14 bg-[rgba(255,255,255,0.1)] text-[var(--brand-cream)]/84 hover:border-[rgba(248,227,176,0.46)] hover:bg-[rgba(255,255,255,0.15)]";
const selectedDeliveryOptionClassName =
  "border-[rgba(248,227,176,0.86)] bg-[linear-gradient(135deg,rgba(248,227,176,0.22),rgba(255,255,255,0.14))] text-[var(--brand-cream)] shadow-[0_16px_28px_rgba(37,17,58,0.18),inset_0_0_0_1px_rgba(248,227,176,0.16)]";
const pickupOptionBaseClassName =
  "group relative block cursor-pointer rounded-xl border px-3.5 py-2.5 text-sm transition duration-200 focus-within:ring-2 focus-within:ring-[rgba(248,227,176,0.34)]";
const unselectedPickupOptionClassName =
  "border-white/10 bg-[rgba(255,255,255,0.07)] text-[var(--brand-cream)]/78 hover:border-[rgba(248,227,176,0.28)] hover:bg-[rgba(255,255,255,0.1)]";
const selectedPickupOptionClassName =
  "border-[rgba(248,227,176,0.68)] bg-[rgba(248,227,176,0.12)] text-[var(--brand-cream)] shadow-[0_8px_16px_rgba(37,17,58,0.1)]";

const getInputClassName = (hasError: boolean) =>
  `${inputBaseClassName} ${hasError ? "border-rose-200/70 bg-rose-50/95 ring-1 ring-rose-200/45" : ""}`;

const pickupPointPriceLabel = (price: number) => (price > 0 ? formatMoney(price) : "A coordinar");

const pickupMethodPriceLabel = (
  activePickupPoints: FulfillmentConfig["pickupPoints"],
  selectedPickupPoint: FulfillmentConfig["pickupPoints"][number] | null
) => {
  if (selectedPickupPoint) return pickupPointPriceLabel(selectedPickupPoint.price);

  const pricedPoints = activePickupPoints
    .map((point) => point.price)
    .filter((price) => price > 0);

  if (pricedPoints.length === 0) return "Según punto";

  const lowestPrice = Math.min(...pricedPoints);
  const highestPrice = Math.max(...pricedPoints);
  return lowestPrice === highestPrice ? formatMoney(lowestPrice) : `Desde ${formatMoney(lowestPrice)}`;
};

const isPaymentMethod = (value: unknown): value is PaymentMethod =>
  value === "cash" || value === "transfer" || value === "mercadopago";

const isDeliveryMethod = (value: unknown): value is DeliveryMethod =>
  value === "delivery" || value === "pickup";

const buildApiNotes = (notes: string) => sanitizeText(notes, 250);
const sanitizeDeliveryAddress = (address: Partial<DeliveryAddress> | undefined): DeliveryAddress => ({
  street: sanitizeText(address?.street, 80),
  number: sanitizeText(address?.number, 20),
  floor: sanitizeText(address?.floor, 30),
  betweenStreets: sanitizeText(address?.betweenStreets, 120),
  notes: sanitizeText(address?.notes, 180),
  insideZoneConfirmed: address?.insideZoneConfirmed === true,
});
const isDeliveryAddressValid = (address: DeliveryAddress) =>
  address.street.trim().length > 0 &&
  address.number.trim().length > 0 &&
  address.betweenStreets.trim().length > 0 &&
  address.insideZoneConfirmed;

const createCheckoutAttemptId = () => {
  const cryptoRef = typeof window !== "undefined" ? window.crypto : undefined;
  const randomValue =
    cryptoRef && typeof cryptoRef.randomUUID === "function"
      ? cryptoRef.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2)}`;

  return `ca_${randomValue}`.replace(/[^a-zA-Z0-9_-]/g, "-").slice(0, 120);
};

const parseInvalidProducts = (items: CheckoutApiError["invalidProducts"]) =>
  Array.isArray(items) && items.length > 0
    ? items
        .map((item) => ({
          productId: typeof item?.productId === "string" ? item.productId : "",
          name: typeof item?.name === "string" ? item.name : "Producto no disponible",
          reason: typeof item?.reason === "string" ? item.reason : undefined,
          requestedQty: typeof item?.requestedQty === "number" ? item.requestedQty : undefined,
          availableQty:
            typeof item?.availableQty === "number" || item?.availableQty === null ? item.availableQty : undefined,
          requestedPrice: typeof item?.requestedPrice === "number" ? item.requestedPrice : undefined,
          currentPrice: typeof item?.currentPrice === "number" ? item.currentPrice : undefined,
          stockStatus:
            item?.stockStatus === "in_stock" || item?.stockStatus === "out_of_stock" || item?.stockStatus === "preorder"
              ? item.stockStatus
              : undefined,
        }))
        .filter((item) => item.productId)
    : undefined;

const isPriceChangedProduct = (item: CheckoutInvalidProduct) => item.reason === "price_changed";
const isUnavailableProduct = (item: CheckoutInvalidProduct) =>
  item.reason === "missing" ||
  item.reason === "out_of_stock" ||
  item.stockStatus === "out_of_stock" ||
  item.availableQty === 0;
const isInsufficientStockProduct = (item: CheckoutInvalidProduct) => item.reason === "insufficient_stock";

const checkoutErrorMessage = (fallback: string | undefined, invalidProducts: CheckoutInvalidProduct[] | undefined) => {
  if (!invalidProducts || invalidProducts.length === 0) {
    return fallback || "Algunos productos del carrito ya no estan disponibles.";
  }

  const hasPriceChanges = invalidProducts.some(isPriceChangedProduct);
  const hasStockProblems = invalidProducts.some((item) => isUnavailableProduct(item) || isInsufficientStockProduct(item));

  if (hasPriceChanges && hasStockProblems) {
    return "Hay cambios en el carrito. Revisa los productos marcados antes de continuar.";
  }
  if (hasPriceChanges) {
    return "El precio de algunos productos cambio. Revisa el carrito antes de continuar.";
  }
  return fallback || "Algunos productos no tienen stock suficiente. Ajusta el carrito para continuar.";
};

const LoadingIndicator = () => (
  <span
    aria-hidden="true"
    className="relative inline-flex h-4 w-4 shrink-0 items-center justify-center"
  >
    <span className="absolute h-full w-full rounded-full border-2 border-black/20" />
    <span className="absolute h-full w-full animate-spin rounded-full border-2 border-transparent border-t-black border-r-black/70" />
  </span>
);

const ButtonContent = ({ loading, children }: { loading: boolean; children: ReactNode }) => (
  <span className="inline-flex items-center justify-center gap-2">
    {loading ? <LoadingIndicator /> : null}
    <span>{children}</span>
  </span>
);

const DeliveryIcon = ({ type }: { type: DeliveryMethod }) => (
  <span className="grid h-9 w-9 shrink-0 place-items-center rounded-2xl border border-[rgba(248,227,176,0.32)] bg-[rgba(255,255,255,0.1)] text-[var(--brand-gold-300)] shadow-[inset_0_0_0_1px_rgba(255,255,255,0.08)]">
    {type === "delivery" ? (
      <svg viewBox="0 0 24 24" aria-hidden="true" className="h-[18px] w-[18px]" fill="none">
        <path d="M4 11.5 12 5l8 6.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M6.5 10.8V19h11v-8.2" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M10 19v-5h4v5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    ) : (
      <svg viewBox="0 0 24 24" aria-hidden="true" className="h-[18px] w-[18px]" fill="none">
        <path d="M12 21s6-5.2 6-11a6 6 0 1 0-12 0c0 5.8 6 11 6 11Z" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M12 12.2a2.2 2.2 0 1 0 0-4.4 2.2 2.2 0 0 0 0 4.4Z" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    )}
  </span>
);

const SelectedCheck = ({ selected }: { selected: boolean }) =>
  selected ? (
    <span className="absolute right-3 top-1/2 grid h-6 w-6 -translate-y-1/2 place-items-center rounded-full bg-[var(--brand-gold-300)] text-[var(--brand-violet-950)] shadow-[0_8px_16px_rgba(37,17,58,0.22)]">
      <svg viewBox="0 0 20 20" aria-hidden="true" className="h-3.5 w-3.5" fill="none">
        <path d="M5 10.4 8.2 13.5 15 6.5" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </span>
  ) : null;

const PickupSelectedMark = ({ selected }: { selected: boolean }) =>
  selected ? (
    <span className="absolute right-3 top-3 grid h-5 w-5 place-items-center rounded-full bg-[var(--brand-gold-300)] text-[var(--brand-violet-950)] shadow-[0_6px_12px_rgba(37,17,58,0.18)]">
      <svg viewBox="0 0 20 20" aria-hidden="true" className="h-3 w-3" fill="none">
        <path d="M5 10.4 8.2 13.5 15 6.5" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </span>
  ) : null;

const ProgressIcon = ({ status }: { status: "active" | "done" | "pending" }) => {
  if (status === "done") {
    return (
      <span className="grid h-7 w-7 place-items-center rounded-full bg-emerald-300 text-emerald-950 shadow-[0_0_18px_rgba(110,231,183,0.42)]">
        <svg viewBox="0 0 20 20" aria-hidden className="h-4 w-4" fill="none">
          <path
            d="M5 10.4 8.2 13.5 15 6.5"
            stroke="currentColor"
            strokeWidth="2.2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </span>
    );
  }

  if (status === "active") {
    return (
      <span className="grid h-7 w-7 place-items-center rounded-full border border-[var(--brand-gold-300)]/65 bg-[rgba(242,199,119,0.18)]">
        <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-[var(--brand-gold-300)]/30 border-t-[var(--brand-gold-300)]" />
      </span>
    );
  }

  return (
    <span className="grid h-7 w-7 place-items-center rounded-full border border-[var(--brand-cream)]/24 bg-white/5">
      <span className="h-2 w-2 rounded-full bg-[var(--brand-cream)]/35" />
    </span>
  );
};

const CheckoutProgress = ({
  phase,
  paymentMethod,
}: {
  phase: CheckoutPhase;
  paymentMethod: PaymentMethod;
}) => {
  if (phase === "idle") return null;

  if (paymentMethod === "mercadopago") {
    const status = phase === "redirecting" ? "done" : "active";

    return (
      <div
        className="mt-4 overflow-hidden rounded-2xl border border-[rgba(242,199,119,0.34)] bg-[rgba(52,28,84,0.34)] p-3 text-sm text-[var(--brand-cream)] shadow-[0_16px_32px_rgba(18,8,35,0.18)]"
        role="status"
        aria-live="polite"
      >
        <div className="flex items-center gap-3">
          <ProgressIcon status={status} />
          <div>
            <p className="font-semibold">Validando carrito y preparando pago seguro</p>
            <p className="text-xs text-[var(--brand-cream)]/68">
              Revisando productos, precios, stock y creando el enlace de Mercado Pago.
            </p>
          </div>
        </div>
        {phase === "redirecting" ? (
          <p className="mt-3 rounded-xl bg-emerald-300/14 px-3 py-2 text-xs font-medium text-emerald-100">
            Todo listo. Te llevamos al siguiente paso...
          </p>
        ) : null}
      </div>
    );
  }

  const secondStepLabel = "Generando pedido";
  const secondStepDetail = "Estamos registrando tu compra en Estilo Sol.";
  const firstStatus = phase === "validating" ? "active" : "done";
  const secondStatus =
    phase === "validating" ? "pending" : phase === "creating" ? "active" : "done";

  return (
    <div
      className="mt-4 overflow-hidden rounded-2xl border border-[rgba(242,199,119,0.34)] bg-[rgba(52,28,84,0.34)] p-3 text-sm text-[var(--brand-cream)] shadow-[0_16px_32px_rgba(18,8,35,0.18)]"
      role="status"
      aria-live="polite"
    >
      <div className="space-y-3">
        <div className="flex items-center gap-3">
          <ProgressIcon status={firstStatus} />
          <div>
            <p className="font-semibold">Validando carrito</p>
            <p className="text-xs text-[var(--brand-cream)]/68">Revisando productos, precios y stock.</p>
          </div>
        </div>
        <div className="ml-3 h-4 w-px bg-[var(--brand-gold-300)]/28" aria-hidden />
        <div className="flex items-center gap-3">
          <ProgressIcon status={secondStatus} />
          <div>
            <p className="font-semibold">{secondStepLabel}</p>
            <p className="text-xs text-[var(--brand-cream)]/68">{secondStepDetail}</p>
          </div>
        </div>
      </div>
      {phase === "redirecting" ? (
        <p className="mt-3 rounded-xl bg-emerald-300/14 px-3 py-2 text-xs font-medium text-emerald-100">
          Todo listo. Te llevamos al siguiente paso...
        </p>
      ) : null}
    </div>
  );
};

export default function CheckoutSteps({
  fulfillmentConfig = fallbackFulfillmentConfig,
  onDeliveryMethodChange,
  onPickupPointChange,
  onInvalidProductsChange,
}: CheckoutStepsProps) {
  const { items, paymentMethod, setPaymentMethod, removeItem, syncStockFromProducts } = useCart();
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [whatsapp, setWhatsapp] = useState("");
  const [email, setEmail] = useState("");
  const [deliveryMethod, setDeliveryMethod] = useState<DeliveryMethod>("delivery");
  const [deliveryAddressStreet, setDeliveryAddressStreet] = useState("");
  const [deliveryAddressNumber, setDeliveryAddressNumber] = useState("");
  const [deliveryAddressFloor, setDeliveryAddressFloor] = useState("");
  const [deliveryAddressBetweenStreets, setDeliveryAddressBetweenStreets] = useState("");
  const [deliveryAddressNotes, setDeliveryAddressNotes] = useState("");
  const [deliveryInsideZoneConfirmed, setDeliveryInsideZoneConfirmed] = useState(false);
  const [deliveryZoneOpen, setDeliveryZoneOpen] = useState(false);
  const [deliveryZoneZoomOpen, setDeliveryZoneZoomOpen] = useState(false);
  const [pickupPointId, setPickupPointId] = useState("");
  const [notes, setNotes] = useState("");
  const [isContactStepComplete, setIsContactStepComplete] = useState(false);
  const [showValidation, setShowValidation] = useState(false);
  const [transferInfoOpen, setTransferInfoOpen] = useState(false);
  const [checkoutPhase, setCheckoutPhase] = useState<CheckoutPhase>("idle");
  const [error, setError] = useState<CheckoutErrorState | null>(null);
  const [copiedField, setCopiedField] = useState<BankField | null>(null);
  const [isDraftHydrated, setIsDraftHydrated] = useState(false);
  const prevItemsCountRef = useRef(items.length);
  const checkoutPhaseTimerRef = useRef<number | null>(null);
  const checkoutAttemptIdRef = useRef<string | null>(null);
  const isTestPublicKey = (process.env.NEXT_PUBLIC_MP_PUBLIC_KEY || "").toUpperCase().startsWith("TEST-");

  const fullName = useMemo(() => `${firstName} ${lastName}`.replace(/\s+/g, " ").trim(), [firstName, lastName]);
  const deliveryAddress = useMemo<DeliveryAddress>(
    () => ({
      street: deliveryAddressStreet,
      number: deliveryAddressNumber,
      floor: deliveryAddressFloor,
      betweenStreets: deliveryAddressBetweenStreets,
      notes: deliveryAddressNotes,
      insideZoneConfirmed: deliveryInsideZoneConfirmed,
    }),
    [
      deliveryAddressBetweenStreets,
      deliveryAddressFloor,
      deliveryAddressNotes,
      deliveryAddressNumber,
      deliveryAddressStreet,
      deliveryInsideZoneConfirmed,
    ]
  );
  const activePickupPoints = useMemo(
    () => fulfillmentConfig.pickupPoints.filter((point) => point.active),
    [fulfillmentConfig.pickupPoints]
  );
  const selectedPickupPoint = useMemo(
    () => getActivePickupPointById(fulfillmentConfig, pickupPointId),
    [fulfillmentConfig, pickupPointId]
  );
  const pickupMethodPrice = useMemo(
    () => pickupMethodPriceLabel(activePickupPoints, selectedPickupPoint),
    [activePickupPoints, selectedPickupPoint]
  );
  const isDiscountMethod = isDiscountPaymentMethod(paymentMethod);
  const priceChangedProducts = useMemo(
    () => (error?.invalidProducts ?? []).filter(isPriceChangedProduct),
    [error?.invalidProducts]
  );
  const unavailableProducts = useMemo(
    () => (error?.invalidProducts ?? []).filter(isUnavailableProduct),
    [error?.invalidProducts]
  );
  const insufficientStockProducts = useMemo(
    () => (error?.invalidProducts ?? []).filter(isInsufficientStockProduct),
    [error?.invalidProducts]
  );

  const firstNameError = showValidation && !firstName.trim();
  const lastNameError = showValidation && !lastName.trim();
  const whatsappError = (showValidation || whatsapp.trim().length > 0) && !isValidWhatsapp(whatsapp);
  const emailError = (showValidation || email.trim().length > 0) && !isValidEmail(email);
  const isContactFormValid =
    firstName.trim().length > 0 &&
    lastName.trim().length > 0 &&
    isValidWhatsapp(whatsapp) &&
    isValidEmail(email);
  const isDeliveryDetailsValid =
    deliveryMethod === "delivery" ? isDeliveryAddressValid(deliveryAddress) : Boolean(selectedPickupPoint);
  const showFulfillmentValidation = showValidation || isContactFormValid;
  const deliveryAddressFieldsVisible = deliveryMethod === "delivery" && deliveryInsideZoneConfirmed;
  const deliveryStreetError =
    showFulfillmentValidation && deliveryAddressFieldsVisible && !deliveryAddressStreet.trim();
  const deliveryNumberError =
    showFulfillmentValidation && deliveryAddressFieldsVisible && !deliveryAddressNumber.trim();
  const deliveryBetweenStreetsError =
    showFulfillmentValidation && deliveryAddressFieldsVisible && !deliveryAddressBetweenStreets.trim();
  const deliveryInsideZoneError =
    showFulfillmentValidation && deliveryMethod === "delivery" && !deliveryInsideZoneConfirmed;
  const pickupPointError =
    showFulfillmentValidation && deliveryMethod === "pickup" && !selectedPickupPoint;

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
      const draftDeliveryMethod = isDeliveryMethod(parsed.deliveryMethod) ? parsed.deliveryMethod : "delivery";
      const draftAddress = sanitizeDeliveryAddress(
        parsed.deliveryAddress && typeof parsed.deliveryAddress === "object" ? parsed.deliveryAddress : undefined
      );
      const draftPickupPointId = sanitizeText(parsed.pickupPointId, 80);
      const activePickupPointId = draftPickupPointId;

      setFirstName(draftFirstName);
      setLastName(draftLastName);
      setWhatsapp(draftWhatsapp);
      setEmail(draftEmail);
      setNotes(draftNotes);
      setDeliveryMethod(draftDeliveryMethod);
      setDeliveryAddressStreet(draftAddress.street);
      setDeliveryAddressNumber(draftAddress.number);
      setDeliveryAddressFloor(draftAddress.floor || "");
      setDeliveryAddressBetweenStreets(draftAddress.betweenStreets);
      setDeliveryAddressNotes(draftAddress.notes || "");
      setDeliveryInsideZoneConfirmed(draftAddress.insideZoneConfirmed);
      setPickupPointId(activePickupPointId);
      if (isPaymentMethod(parsed.paymentMethod)) {
        setPaymentMethod(parsed.paymentMethod);
      }

      const hasValidDraftContact =
        draftFirstName.length > 0 &&
        draftLastName.length > 0 &&
        isValidWhatsapp(draftWhatsapp) &&
        isValidEmail(draftEmail);
      const hasValidDraftFulfillment =
        draftDeliveryMethod === "delivery" ? isDeliveryAddressValid(draftAddress) : Boolean(activePickupPointId);
      setIsContactStepComplete(Boolean(parsed.step1Completed) && hasValidDraftContact && hasValidDraftFulfillment);
    } catch {
      // ignore invalid draft payloads
    } finally {
      setIsDraftHydrated(true);
    }
  }, [setPaymentMethod]);

  useEffect(() => {
    onDeliveryMethodChange?.(deliveryMethod);
  }, [deliveryMethod, onDeliveryMethodChange]);

  useEffect(() => {
    onPickupPointChange?.(deliveryMethod === "pickup" ? selectedPickupPoint?.id || "" : "");
  }, [deliveryMethod, onPickupPointChange, selectedPickupPoint?.id]);

  // Detect new purchase session: reset Step 1 when cart transitions from empty to filled
  useEffect(() => {
    if (!isDraftHydrated) return;

    const wasPreviouslyEmpty = prevItemsCountRef.current === 0;
    const isNowFilled = items.length > 0;

    if (wasPreviouslyEmpty && isNowFilled && isContactStepComplete) {
      // Reset Step 1 to show customer data form on fresh purchase
      setIsContactStepComplete(false);
      setError(null);
      // Clear form fields for fresh start
      setFirstName("");
      setLastName("");
      setWhatsapp("");
      setEmail("");
      setNotes("");
      setDeliveryMethod("delivery");
      setDeliveryAddressStreet("");
      setDeliveryAddressNumber("");
      setDeliveryAddressFloor("");
      setDeliveryAddressBetweenStreets("");
      setDeliveryAddressNotes("");
      setDeliveryInsideZoneConfirmed(false);
      setPickupPointId("");
    }

    prevItemsCountRef.current = items.length;
  }, [items.length, isDraftHydrated, isContactStepComplete]);

  useEffect(() => {
    if (!isDraftHydrated) return;

    const draft: CheckoutContactDraft = {
      firstName: sanitizeText(firstName, 80),
      lastName: sanitizeText(lastName, 80),
      whatsapp: sanitizeText(whatsapp, 30),
      email: sanitizeText(email, 120),
      notes: sanitizeText(notes, 250),
      deliveryMethod,
      deliveryAddress: sanitizeDeliveryAddress(deliveryAddress),
      pickupPointId: selectedPickupPoint?.id || "",
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
    deliveryAddress,
    pickupPointId,
    email,
    firstName,
    isContactStepComplete,
    isDraftHydrated,
    lastName,
    notes,
    paymentMethod,
    selectedPickupPoint?.id,
    whatsapp,
  ]);

  useEffect(() => {
    return () => {
      if (checkoutPhaseTimerRef.current !== null) {
        window.clearTimeout(checkoutPhaseTimerRef.current);
      }
    };
  }, []);

  useEffect(() => {
    onInvalidProductsChange?.(error?.invalidProducts ?? []);
  }, [error?.invalidProducts, onInvalidProductsChange]);

  const clearCheckoutPhaseTimer = () => {
    if (checkoutPhaseTimerRef.current === null) return;
    window.clearTimeout(checkoutPhaseTimerRef.current);
    checkoutPhaseTimerRef.current = null;
  };

  const startCheckoutProgress = () => {
    clearCheckoutPhaseTimer();
    setCheckoutPhase("validating");
  };

  const resetCheckoutProgress = () => {
    clearCheckoutPhaseTimer();
    setCheckoutPhase("idle");
  };

  const finishCheckoutProgress = () => {
    clearCheckoutPhaseTimer();
    setCheckoutPhase("redirecting");
  };

  const getCheckoutAttemptId = () => {
    if (!checkoutAttemptIdRef.current) {
      checkoutAttemptIdRef.current = createCheckoutAttemptId();
    }
    return checkoutAttemptIdRef.current;
  };

  const checkoutItemsPayload = () =>
    items.map((item) => ({
      productId: item.productId,
      qty: item.qty,
      name: item.name,
      unitPrice: item.unitPrice,
    }));

  const checkoutFulfillmentPayload = () => ({
    deliveryAddress:
      deliveryMethod === "delivery"
        ? {
            street: sanitizeText(deliveryAddressStreet, 80),
            number: sanitizeText(deliveryAddressNumber, 20),
            floor: sanitizeText(deliveryAddressFloor, 30),
            betweenStreets: sanitizeText(deliveryAddressBetweenStreets, 120),
            notes: sanitizeText(deliveryAddressNotes, 180),
            insideZoneConfirmed: deliveryInsideZoneConfirmed,
          }
        : undefined,
    pickupPointId: deliveryMethod === "pickup" ? selectedPickupPoint?.id : undefined,
  });

  const syncInvalidProductsFromApi = (invalidProducts?: CheckoutInvalidProduct[]) => {
    if (!invalidProducts || invalidProducts.length === 0) return;

    syncStockFromProducts(
      invalidProducts
        .filter((product) => typeof product.currentPrice === "number")
        .map((product) => ({
          id: product.productId,
          name: product.name,
          price: product.currentPrice ?? 0,
          stock_status: product.stockStatus,
          stock_qty: product.availableQty,
        }))
    );
    void refreshProductsMemoryCacheFromSource();
  };

  const validateCartBeforeCheckout = async () => {
    const response = await fetch("/api/mp/validate-cart", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        items: checkoutItemsPayload(),
      }),
    });

    const data = (await response.json().catch(() => null)) as CheckoutApiError | null;

    if (response.ok) return true;

    const invalidProducts = parseInvalidProducts(data?.invalidProducts);
    syncInvalidProductsFromApi(invalidProducts);

    setError({
      message: checkoutErrorMessage(data?.error, invalidProducts),
      invalidProducts,
    });
    return false;
  };

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

  const handleContinueToPayment = () => {
    setShowValidation(true);
    if (!isContactFormValid || !isDeliveryDetailsValid) return;

    setError(null);
    setIsContactStepComplete(true);
  };

  const handleEditContact = () => {
    setIsContactStepComplete(false);
    resetCheckoutProgress();
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

    if (!isContactStepComplete || !isContactFormValid || !isDeliveryDetailsValid) {
      setIsContactStepComplete(false);
      setShowValidation(true);
      setError({ message: "Completa los datos de contacto y entrega para continuar." });
      return;
    }

    startCheckoutProgress();
    setError(null);

    try {
      setCheckoutPhase("creating");

      const response = await fetch("/api/mp/create-preference", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          items: checkoutItemsPayload(),
          paymentMethod,
          deliveryMethod,
          fulfillment: checkoutFulfillmentPayload(),
          checkoutAttemptId: getCheckoutAttemptId(),
          payer: {
            name: fullName,
            phone: normalizePhoneDigits(whatsapp),
            email: email.trim(),
          },
          notes: buildApiNotes(notes.trim()),
        }),
      });

      const data = (await response.json().catch(() => null)) as
        | {
            initPoint?: string;
            sandboxInitPoint?: string;
            error?: string;
            invalidProducts?: CheckoutApiError["invalidProducts"];
          }
        | null;

      const checkoutUrl = isTestPublicKey
        ? data?.sandboxInitPoint || data?.initPoint
        : data?.initPoint || data?.sandboxInitPoint;

      if (!response.ok || !checkoutUrl) {
        const invalidProducts = parseInvalidProducts(data?.invalidProducts);
        syncInvalidProductsFromApi(invalidProducts);
        resetCheckoutProgress();
        setError({
          message: invalidProducts
            ? checkoutErrorMessage(data?.error, invalidProducts)
            : data?.error || "No pudimos iniciar el pago. Intenta nuevamente.",
          invalidProducts,
        });
        return;
      }

      finishCheckoutProgress();
      window.location.assign(checkoutUrl);
    } catch {
      resetCheckoutProgress();
      setError({ message: "Ocurrio un error de conexion. Intenta nuevamente." });
    }
  };

  const startDiscountCheckout = async () => {
    if (!isDiscountMethod) return;
    if (items.length === 0 || checkoutPhase !== "idle") return;

    if (!isContactStepComplete || !isContactFormValid || !isDeliveryDetailsValid) {
      setIsContactStepComplete(false);
      setShowValidation(true);
      setError({ message: "Completa los datos de contacto y entrega para continuar." });
      return;
    }

    startCheckoutProgress();
    setError(null);

    try {
      const isCartValid = await validateCartBeforeCheckout();
      if (!isCartValid) {
        resetCheckoutProgress();
        return;
      }
      setCheckoutPhase("creating");

      const response = await fetch("/api/orders/create", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          items: checkoutItemsPayload(),
          paymentMethod,
          deliveryMethod,
          fulfillment: checkoutFulfillmentPayload(),
          payer: {
            name: fullName,
            phone: normalizePhoneDigits(whatsapp),
            email: email.trim(),
          },
          notes: buildApiNotes(notes.trim()),
        }),
      });

      const data = (await response.json().catch(() => null)) as
        | {
            externalReference?: string;
            summaryToken?: string;
            error?: string;
            invalidProducts?: Array<{ productId?: string; name?: string }>;
          }
        | null;

      if (!response.ok) {
        const invalidProducts = parseInvalidProducts(data?.invalidProducts);
        resetCheckoutProgress();
        setError({
          message: invalidProducts
            ? checkoutErrorMessage(data?.error, invalidProducts)
            : data?.error || "No pudimos registrar tu pedido. Intenta nuevamente.",
          invalidProducts,
        });
        return;
      }

      const externalReference = typeof data?.externalReference === "string" ? data.externalReference : "";
      if (!externalReference) {
        resetCheckoutProgress();
        setError({ message: "Pedido creado sin referencia. Intenta nuevamente." });
        return;
      }

      const successParams = new URLSearchParams({
        manual: "1",
        pm: paymentMethod,
        ref: externalReference,
      });
      const summaryToken = typeof data?.summaryToken === "string" ? data.summaryToken : "";
      if (summaryToken) {
        successParams.set("summaryToken", summaryToken);
      }

      finishCheckoutProgress();
      window.location.assign(`/tienda/success?${successParams.toString()}`);
    } catch {
      resetCheckoutProgress();
      setError({ message: "No pudimos registrar el pedido por un error de conexion. Intenta nuevamente." });
    }
  };

  const removeInvalidProducts = () => {
    const invalidProducts = (error?.invalidProducts ?? []).filter(isUnavailableProduct);
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
              {deliveryMethod === "delivery" ? (
                <>
                  <p className="sm:col-span-2">
                    <span className="text-[var(--brand-cream)]/65">Dirección:</span>{" "}
                    {deliveryAddressStreet} {deliveryAddressNumber}
                    {deliveryAddressFloor ? `, ${deliveryAddressFloor}` : ""}
                  </p>
                  <p className="sm:col-span-2">
                    <span className="text-[var(--brand-cream)]/65">Entre calles:</span>{" "}
                    {deliveryAddressBetweenStreets}
                  </p>
                </>
              ) : selectedPickupPoint ? (
                <p className="sm:col-span-2">
                  <span className="text-[var(--brand-cream)]/65">Punto:</span> {selectedPickupPoint.name} -{" "}
                  {selectedPickupPoint.subtitle}
                </p>
              ) : null}
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
                <label htmlFor="checkout-first-name" className={fieldLabelClassName}>
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
                {firstNameError ? <p className={fieldErrorClassName}>Ingresa tu nombre.</p> : null}
              </div>

              <div>
                <label htmlFor="checkout-last-name" className={fieldLabelClassName}>
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
                {lastNameError ? <p className={fieldErrorClassName}>Ingresa tu apellido.</p> : null}
              </div>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <label htmlFor="checkout-whatsapp" className={fieldLabelClassName}>
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
                  <p className={fieldErrorClassName}>Ingresa un WhatsApp valido (10 a 15 digitos).</p>
                ) : null}
              </div>

              <div>
                <label htmlFor="checkout-email" className={fieldLabelClassName}>
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
                {emailError ? <p className={fieldErrorClassName}>Ingresa un email valido.</p> : null}
              </div>
            </div>

            <div className="rounded-[1.5rem] border border-white/12 bg-[rgba(248,244,252,0.12)] p-4 sm:p-5">
              <div className="mb-3.5">
                <p className="[font-family:var(--font-brand-display)] text-xl leading-tight text-[var(--brand-cream)]">
                  Elegí cómo recibir tu pedido
                </p>
                <p className="mt-1 text-sm leading-relaxed text-[var(--brand-cream)]/72">
                  Elegí una de las dos opciones de entrega para continuar.
                </p>
              </div>

              <div className="grid gap-x-3 gap-y-7 sm:grid-cols-2">
                <label
                  className={`${deliveryOptionBaseClassName} ${
                    deliveryMethod === "delivery" ? selectedDeliveryOptionClassName : unselectedDeliveryOptionClassName
                  }`}
                >
                  <input
                    type="radio"
                    name="delivery-method"
                    className="sr-only"
                    checked={deliveryMethod === "delivery"}
                    onChange={() => setDeliveryMethod("delivery")}
                  />
                  <SelectedCheck selected={deliveryMethod === "delivery"} />
                  <span className="flex w-full items-center gap-3 pr-8">
                    <DeliveryIcon type="delivery" />
                    <span className="min-w-0 flex-1">
                      <span className="block text-base font-semibold leading-tight">{fulfillmentConfig.delivery.name}</span>
                      <span className="mt-1 block text-xs leading-relaxed text-[var(--brand-cream)]/66">
                        {fulfillmentConfig.delivery.subtitle}
                      </span>
                    </span>
                  </span>
                  <span className="pointer-events-none absolute bottom-0 left-1/2 inline-flex -translate-x-1/2 translate-y-[60%] rounded-full border border-[rgba(248,227,176,0.38)] bg-[rgba(216,188,229,0.94)] px-5 py-1.5 text-[13px] font-semibold leading-none text-[var(--brand-gold-300)] shadow-[0_8px_16px_rgba(37,17,58,0.18)]">
                    {formatMoney(fulfillmentConfig.delivery.price)}
                  </span>
                </label>

                <label
                  className={`${deliveryOptionBaseClassName} ${
                    deliveryMethod === "pickup" ? selectedDeliveryOptionClassName : unselectedDeliveryOptionClassName
                  }`}
                >
                  <input
                    type="radio"
                    name="delivery-method"
                    className="sr-only"
                    checked={deliveryMethod === "pickup"}
                    onChange={() => setDeliveryMethod("pickup")}
                  />
                  <SelectedCheck selected={deliveryMethod === "pickup"} />
                  <span className="flex w-full items-center gap-3 pr-8">
                    <DeliveryIcon type="pickup" />
                    <span className="min-w-0 flex-1">
                      <span className="block text-base font-semibold leading-tight">{fulfillmentConfig.pickup.name}</span>
                      <span className="mt-1 block text-xs leading-relaxed text-[var(--brand-cream)]/66">
                        {fulfillmentConfig.pickup.subtitle}
                      </span>
                    </span>
                  </span>
                  <span className="pointer-events-none absolute bottom-0 left-1/2 inline-flex -translate-x-1/2 translate-y-[60%] rounded-full border border-[rgba(248,227,176,0.38)] bg-[rgba(216,188,229,0.94)] px-5 py-1.5 text-[13px] font-semibold leading-none text-[var(--brand-gold-300)] shadow-[0_8px_16px_rgba(37,17,58,0.18)]">
                    {pickupMethodPrice}
                  </span>
                </label>
              </div>

              {deliveryMethod === "delivery" ? (
                <div className="mt-5 space-y-3 border-t border-white/10 pt-4">
                  <div className="text-sm text-[var(--brand-cream)]">
                    <button
                      type="button"
                      onClick={() => setDeliveryZoneOpen((open) => !open)}
                      aria-expanded={deliveryZoneOpen}
                      className="inline-flex items-center gap-1.5 text-sm font-semibold text-[var(--brand-gold-300)] underline underline-offset-4 transition hover:text-[var(--brand-gold-400)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand-gold-300)]"
                    >
                      {deliveryZoneOpen ? "Ocultar zona de envío" : "Ver zona de envío"}
                      <svg
                        aria-hidden
                        viewBox="0 0 20 20"
                        className={`h-3.5 w-3.5 fill-current transition-transform duration-200 ${
                          deliveryZoneOpen ? "rotate-180" : ""
                        }`}
                      >
                        <path d="M5.5 7.5h9L10 13.5 5.5 7.5Z" />
                      </svg>
                    </button>
                    {deliveryZoneOpen ? (
                      <div className="mt-2 w-full lg:max-w-none">
                        {fulfillmentConfig.delivery.image ? (
                          <>
                            <button
                              type="button"
                              onClick={() => setDeliveryZoneZoomOpen(true)}
                              className="group relative block w-full overflow-hidden rounded-2xl border border-white/12 shadow-[0_12px_22px_rgba(37,17,58,0.16)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand-gold-300)]"
                              aria-label="Ampliar mapa de la zona de envío"
                            >
                              <img
                                src={fulfillmentConfig.delivery.image}
                                alt="Mapa de la zona de envío"
                                className="aspect-[16/9] w-full object-cover transition duration-200 group-hover:scale-[1.02]"
                              />
                              <span className="absolute bottom-2 right-2 rounded-full bg-[rgba(43,22,67,0.78)] px-3 py-1 text-xs font-semibold text-[var(--brand-cream)] shadow-[0_8px_16px_rgba(18,8,35,0.24)]">
                                Click para ampliar
                              </span>
                            </button>
                            <ProductLightbox
                              open={deliveryZoneZoomOpen}
                              onClose={() => setDeliveryZoneZoomOpen(false)}
                              slides={[{ src: fulfillmentConfig.delivery.image }]}
                              index={0}
                              hasMultipleImages={false}
                              onViewIndex={() => {}}
                            />
                          </>
                        ) : (
                          <p className="border-l border-[var(--brand-gold-300)]/45 pl-3 text-sm leading-relaxed text-[var(--brand-cream)]/82">
                            {fulfillmentConfig.delivery.subtitle}
                          </p>
                        )}
                      </div>
                    ) : null}
                  </div>

                  <label
                    className={`flex cursor-pointer items-start gap-3 rounded-xl border px-3 py-2.5 text-sm text-[var(--brand-cream)] transition ${
                      deliveryInsideZoneError
                        ? "border-rose-200/60 bg-rose-200/10"
                        : "border-white/10 bg-transparent hover:border-[rgba(248,227,176,0.22)]"
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={deliveryInsideZoneConfirmed}
                      onChange={(event) => setDeliveryInsideZoneConfirmed(event.target.checked)}
                      className="mt-0.5 h-4 w-4 rounded border-white/30 accent-[var(--brand-gold-300)]"
                    />
                    <span className="leading-relaxed">
                      Confirmo que mi dirección está dentro de la zona de envío.
                    </span>
                  </label>

                  {deliveryAddressFieldsVisible ? (
                    <div className="space-y-3 rounded-2xl bg-[rgba(255,255,255,0.08)] p-3.5 sm:p-4">
                    <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_8rem]">
                      <div>
                        <label htmlFor="delivery-address-street" className={fieldLabelClassName}>
                          Calle
                        </label>
                        <input
                          id="delivery-address-street"
                          value={deliveryAddressStreet}
                          onChange={(event) => setDeliveryAddressStreet(event.target.value)}
                          placeholder="Calle"
                          className={getInputClassName(deliveryStreetError)}
                          autoComplete="address-line1"
                        />
                        {deliveryStreetError ? <p className={fieldErrorClassName}>Ingresá la calle.</p> : null}
                      </div>
                      <div>
                        <label htmlFor="delivery-address-number" className={fieldLabelClassName}>
                          Número
                        </label>
                        <input
                          id="delivery-address-number"
                          value={deliveryAddressNumber}
                          onChange={(event) => setDeliveryAddressNumber(event.target.value)}
                          placeholder="1234"
                          className={getInputClassName(deliveryNumberError)}
                          autoComplete="address-line2"
                        />
                        {deliveryNumberError ? <p className={fieldErrorClassName}>Ingresá el número.</p> : null}
                      </div>
                    </div>

                    <div className="grid gap-3 sm:grid-cols-2">
                      <div>
                        <label htmlFor="delivery-address-floor" className={fieldLabelClassName}>
                          Piso / Depto, opcional
                        </label>
                        <input
                          id="delivery-address-floor"
                          value={deliveryAddressFloor}
                          onChange={(event) => setDeliveryAddressFloor(event.target.value)}
                          placeholder="Piso, depto o timbre"
                          className={inputBaseClassName}
                        />
                      </div>
                      <div>
                        <label htmlFor="delivery-address-between" className={fieldLabelClassName}>
                          Entre calles
                        </label>
                        <input
                          id="delivery-address-between"
                          value={deliveryAddressBetweenStreets}
                          onChange={(event) => setDeliveryAddressBetweenStreets(event.target.value)}
                          placeholder="Ej: San Lorenzo y Rioja"
                          className={getInputClassName(deliveryBetweenStreetsError)}
                        />
                        {deliveryBetweenStreetsError ? (
                          <p className={fieldErrorClassName}>Ingresá las calles de referencia.</p>
                        ) : null}
                      </div>
                    </div>

                    <div>
                      <label htmlFor="delivery-address-notes" className={fieldLabelClassName}>
                        Aclaraciones de entrega, opcional
                      </label>
                      <textarea
                        id="delivery-address-notes"
                        value={deliveryAddressNotes}
                        onChange={(event) => setDeliveryAddressNotes(event.target.value)}
                        placeholder="Indicaciones para encontrar la dirección"
                        className={`${inputBaseClassName} min-h-20 resize-y`}
                      />
                    </div>
                    </div>
                  ) : null}
                </div>
              ) : (
                <div className="mt-5 space-y-3 border-t border-white/10 pt-4">
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-[0.12em] text-[var(--brand-gold-300)]">
                      Elegí un punto de encuentro
                    </p>
                    <p className="mt-1 text-sm leading-relaxed text-[var(--brand-cream)]/72">
                      Seleccioná el lugar que te quede más cómodo.
                    </p>
                  </div>
                  <div className="grid gap-2.5 sm:grid-cols-2">
                    {activePickupPoints.map((point) => {
                      const checked = pickupPointId === point.id;
                      return (
                        <label
                          key={point.id}
                          className={`${pickupOptionBaseClassName} ${
                            checked ? selectedPickupOptionClassName : unselectedPickupOptionClassName
                          }`}
                        >
                          <input
                            type="radio"
                            name="pickup-point"
                            className="sr-only"
                            checked={checked}
                            onChange={() => setPickupPointId(point.id)}
                          />
                          <PickupSelectedMark selected={checked} />
                          <span className="flex items-start justify-between gap-3 pr-6">
                            <span className="min-w-0 font-semibold leading-snug">{point.name}</span>
                            <span className="shrink-0 rounded-full border border-[rgba(248,227,176,0.32)] bg-[rgba(248,227,176,0.14)] px-2.5 py-1 text-[11px] font-semibold leading-none text-[var(--brand-gold-300)]">
                              {pickupPointPriceLabel(point.price)}
                            </span>
                          </span>
                          <span className="mt-1 block pr-6 text-xs leading-relaxed text-[var(--brand-cream)]/66">
                            {point.subtitle}
                          </span>
                        </label>
                      );
                    })}
                  </div>
                  <p className="text-sm leading-relaxed text-[var(--brand-cream)]/76">
                    El costo se suma al total según el punto elegido. Coordinamos día y horario por WhatsApp después de confirmar el pago.
                  </p>
                  {pickupPointError ? (
                    <p className={fieldErrorClassName}>Seleccioná un punto de encuentro para continuar.</p>
                  ) : null}
                </div>
              )}
            </div>

            <div>
              <label htmlFor="checkout-notes" className={fieldLabelClassName}>
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
              disabled={!isContactFormValid || !isDeliveryDetailsValid}
              className="w-full rounded-2xl border border-[rgba(248,227,176,0.38)] bg-[linear-gradient(135deg,var(--brand-gold-300),#e8c984)] px-4 py-3 text-sm font-semibold text-black shadow-[0_14px_26px_rgba(37,17,58,0.2)] transition hover:brightness-105 hover:shadow-[0_18px_32px_rgba(37,17,58,0.24)] disabled:cursor-not-allowed disabled:border-[rgba(248,227,176,0.2)] disabled:bg-[linear-gradient(135deg,rgba(248,227,176,0.62),rgba(232,201,132,0.48))] disabled:text-black/55 disabled:shadow-none disabled:hover:brightness-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[rgba(248,227,176,0.68)]"
            >
              Continuar al pago
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
            Completa primero los datos de contacto y entrega para habilitar este paso.
          </p>
        ) : (
          <div className="mt-4 space-y-2.5">
            <label
              className={`block w-full cursor-pointer rounded-2xl border p-3 transition hover:border-[rgba(248,227,176,0.74)] ${
                paymentMethod === "cash"
                  ? "border-[rgba(248,227,176,0.68)] bg-[rgba(116,79,154,0.42)] shadow-[inset_0_0_0_1px_rgba(248,227,176,0.12)]"
                  : "border-[rgba(242,199,119,0.42)] bg-[rgba(206,175,228,0.24)]"
              }`}
            >
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

            <div
              className={`rounded-2xl border px-3 pt-3 pb-2.5 transition ${
                paymentMethod === "transfer"
                  ? "border-[rgba(248,227,176,0.68)] bg-[rgba(116,79,154,0.42)] shadow-[inset_0_0_0_1px_rgba(248,227,176,0.12)]"
                  : "border-[rgba(242,199,119,0.42)] bg-[rgba(206,175,228,0.24)]"
              }`}
            >
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
                <dl className="mt-3 divide-y divide-[rgba(255,255,255,0.18)] text-sm text-white">
                  <div className="grid grid-cols-[2.75rem_minmax(0,1fr)] items-center gap-2 py-1.5">
                    <dt className="text-[11px] font-semibold uppercase tracking-[0.14em] text-white/75">
                      Banco
                    </dt>
                    <dd className="min-w-0 font-sans text-sm font-semibold leading-tight text-white">
                      {BANK_TRANSFER_INFO.bankName}
                    </dd>
                  </div>

                  <div className="grid grid-cols-[2.75rem_minmax(0,1fr)_2.75rem] items-center gap-2 py-1.5">
                    <dt className="text-[11px] font-semibold uppercase tracking-[0.14em] text-white/75">
                      CVU
                    </dt>
                    <dd className="min-w-0 overflow-hidden text-ellipsis whitespace-nowrap font-sans text-sm font-semibold leading-tight tracking-tight tabular-nums text-white">
                      {BANK_TRANSFER_INFO.cvu}
                    </dd>
                    <button
                      type="button"
                      onClick={() => void copyBankValue(BANK_TRANSFER_INFO.cvu, "cvu")}
                      aria-label={copiedField === "cvu" ? "CVU copiado" : "Copiar CVU"}
                      className="justify-self-end inline-flex h-8 w-8 items-center justify-center rounded-md border border-white/20 bg-transparent text-white transition hover:bg-[rgba(255,255,255,0.12)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[rgba(255,255,255,0.3)]"
                    >
                      <svg viewBox="0 0 20 20" fill="none" aria-hidden="true" className="h-4 w-4 stroke-current">
                        <rect x="6" y="4" width="10" height="12" rx="2" strokeWidth="1.5" />
                        <path d="M6 7H4a2 2 0 0 0-2 2v7" strokeWidth="1.5" />
                      </svg>
                    </button>
                  </div>

                  <div className="grid grid-cols-[2.75rem_minmax(0,1fr)_2.75rem] items-center gap-2 py-1.5">
                    <dt className="text-[11px] font-semibold uppercase tracking-[0.14em] text-white/75">
                      Alias
                    </dt>
                    <dd className="min-w-0 break-words font-sans text-sm font-semibold leading-tight text-white">
                      {BANK_TRANSFER_INFO.alias}
                    </dd>
                    <button
                      type="button"
                      onClick={() => void copyBankValue(BANK_TRANSFER_INFO.alias, "alias")}
                      aria-label={copiedField === "alias" ? "Alias copiado" : "Copiar Alias"}
                      className="justify-self-end inline-flex h-8 w-8 items-center justify-center rounded-md border border-white/20 bg-transparent text-white transition hover:bg-[rgba(255,255,255,0.12)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[rgba(255,255,255,0.3)]"
                    >
                      <svg viewBox="0 0 20 20" fill="none" aria-hidden="true" className="h-4 w-4 stroke-current">
                        <rect x="6" y="4" width="10" height="12" rx="2" strokeWidth="1.5" />
                        <path d="M6 7H4a2 2 0 0 0-2 2v7" strokeWidth="1.5" />
                      </svg>
                    </button>
                  </div>
                </dl>
              ) : null}
            </div>

            <label
              className={`block w-full cursor-pointer rounded-2xl border p-3 transition hover:border-[rgba(248,227,176,0.7)] ${
                paymentMethod === "mercadopago"
                  ? "border-[rgba(248,227,176,0.62)] bg-[rgba(116,79,154,0.38)] shadow-[inset_0_0_0_1px_rgba(248,227,176,0.1)]"
                  : "border-[rgba(218,189,236,0.45)] bg-[rgba(207,178,227,0.18)]"
              }`}
            >
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
                {priceChangedProducts.length > 0 ? (
                  <div className="mt-2">
                    <p className="text-xs font-semibold uppercase tracking-[0.08em] text-[var(--brand-cream)]/75">
                      Precios actualizados
                    </p>
                    <ul className="mt-1 list-disc space-y-1 pl-5 text-[var(--brand-cream)]/90">
                      {priceChangedProducts.map((item) => (
                        <li key={item.productId}>
                          {item.name}
                          {typeof item.currentPrice === "number" ? `: ahora ${formatMoney(item.currentPrice)}` : ""}
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}
                {unavailableProducts.length > 0 ? (
                  <div className="mt-2">
                    <p className="text-xs font-semibold uppercase tracking-[0.08em] text-[var(--brand-cream)]/75">
                      No disponibles
                    </p>
                    <ul className="mt-1 list-disc space-y-1 pl-5 text-[var(--brand-cream)]/90">
                      {unavailableProducts.map((item) => (
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
                  </div>
                ) : null}
                {insufficientStockProducts.length > 0 ? (
                  <div className="mt-2">
                    <p className="text-xs font-semibold uppercase tracking-[0.08em] text-[var(--brand-cream)]/75">
                      Stock insuficiente
                    </p>
                    <ul className="mt-1 list-disc space-y-1 pl-5 text-[var(--brand-cream)]/90">
                      {insufficientStockProducts.map((item) => (
                        <li key={item.productId}>
                          {item.name}
                          {typeof item.availableQty === "number" ? `: quedan ${item.availableQty}` : ""}
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}
              </>
            ) : null}
          </div>
        ) : null}

        <CheckoutProgress phase={checkoutPhase} paymentMethod={paymentMethod} />

        <button
          type="button"
          onClick={paymentMethod === "mercadopago" ? startCheckout : startDiscountCheckout}
          disabled={!isContactStepComplete || items.length === 0 || checkoutPhase !== "idle"}
          className="mt-5 w-full rounded-2xl bg-[var(--brand-gold-300)] px-4 py-3 text-sm font-semibold text-black shadow-[0_10px_20px_rgba(18,8,35,0.25)] transition hover:-translate-y-0.5 disabled:opacity-60 disabled:hover:translate-y-0 disabled:[&_[data-loading='true']]:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand-gold-300)]"
        >
          <span data-loading={checkoutPhase !== "idle"}>
            <ButtonContent loading={checkoutPhase !== "idle"}>
              {paymentMethod === "mercadopago"
                ? checkoutPhase === "validating" || checkoutPhase === "creating"
                  ? "Validando y preparando pago..."
                  : checkoutPhase === "redirecting"
                  ? "Redirigiendo..."
                  : "Finalizar pedido"
                : checkoutPhase === "validating"
                ? "Validando carrito..."
                : checkoutPhase === "creating"
                ? "Generando pedido..."
                : checkoutPhase === "redirecting"
                ? "Abriendo resumen..."
                : "Finalizar pedido"}
            </ButtonContent>
          </span>
        </button>

      </section>
    </div>
  );
}
