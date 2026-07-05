"use client";

import Image from "next/image";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import ProductImageGalleryZoom from "@/src/features/shop/presentation/components/ProductImageGalleryZoom/ProductImageGalleryZoom";
import ProductVariantSelector from "@/src/features/shop/presentation/components/ProductVariantSelector/ProductVariantSelector";
import Breadcrumbs from "@/src/features/shop/presentation/components/Breadcrumbs";
import { showCartAddedToast } from "@/src/features/shop/presentation/lib/cartToast";
import {
  getLastShopListingHref,
  requestShopScrollRestoreForNextVisit,
} from "@/src/features/shop/presentation/lib/shopScrollRestoration";
import { useCartDrawer } from "@/src/features/shop/presentation/view-models/useCartDrawer";
import { useCart } from "@/src/features/shop/presentation/view-models/useCartStore";
import type { Product } from "@/src/features/shop/domain/entities/Product";
import { formatProductCategories } from "@/src/features/shop/domain/productCategories";
import {
  getProductGroupId,
  getProductVariantLabel,
  getProductVariants,
  hasProductVariants,
} from "@/src/features/shop/domain/productVariants";
import { getCashTransferDiscountedTotal } from "@/src/features/shop/domain/cashTransferDiscount";
import {
  getStockLabel,
  isProductPurchasable,
} from "@/src/features/shop/infrastructure/data/productAdapter";

type Props = {
  product: Product;
  similarProducts?: Product[];
};

const formatMoney = (value: number) =>
  new Intl.NumberFormat("es-AR", {
    style: "currency",
    currency: "ARS",
  }).format(value);

const isValidPrice = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value);

const LONG_DESCRIPTION_PLACEHOLDER = "Sin descripción detallada por el momento.";

const getShortDescription = (shortDescription?: string, description?: string) => {
  if (typeof shortDescription === "string" && shortDescription.trim().length > 0) {
    return shortDescription.trim();
  }

  if (typeof description !== "string") {
    return "Sin descripción disponible por el momento.";
  }

  const normalizedDescription = description.trim();
  if (!normalizedDescription) {
    return "Sin descripción disponible por el momento.";
  }

  const firstSentence = normalizedDescription.match(/^.*?[.!?](?:\s|$)/)?.[0]?.trim();
  if (firstSentence && firstSentence.length <= 140) {
    return firstSentence;
  }

  const clipped = normalizedDescription.slice(0, 140).trim();
  return clipped.length < normalizedDescription.length ? `${clipped}…` : clipped;
};

type ProductDescriptionSection = {
  title: string;
  content: string[];
};

const cleanDescriptionTitle = (title?: string) => {
  const normalized = (title ?? "Descripcion")
    .replace(/:$/, "")
    .replace(/^¿?que/i, "Qué")
    .trim();
  const normalizedLower = normalized
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();

  if (normalizedLower.includes("beneficio")) return "Beneficios clave";
  if (normalizedLower.includes("modo")) return "Modo de uso";
  if (normalizedLower.includes("contiene")) return "Qué contiene";
  if (normalizedLower.includes("incluye")) return "Incluye";
  if (normalizedLower.includes("descripcion")) return "Descripción";

  return normalized.charAt(0).toUpperCase() + normalized.slice(1).toLowerCase();
};

const parseDescriptionSections = (text: string): ProductDescriptionSection[] => {
  const sections: ProductDescriptionSection[] = [];
  const lines = text.split("\n").map((line) => line.trim()).filter(Boolean);
  let currentSection: ProductDescriptionSection = { title: "Descripción", content: [] };

  for (const line of lines) {
    const isTitle =
      line.endsWith("?") ||
      line.endsWith(":") ||
      (line === line.toUpperCase() && line.length > 3 && !line.includes("."));

    if (isTitle) {
      if (currentSection.content.length > 0) {
        sections.push(currentSection);
      }
      currentSection = { title: cleanDescriptionTitle(line), content: [] };
      continue;
    }

    currentSection.content.push(line);
  }

  if (currentSection.content.length > 0) {
    sections.push(currentSection);
  }

  return sections.length > 0
    ? sections
    : [{ title: "Descripción", content: [LONG_DESCRIPTION_PLACEHOLDER] }];
};

const stripBullet = (line: string) => line.replace(/^[-•]\s*/, "").trim();
const isBulletLine = (line: string) => /^[-•]\s*/.test(line);
const isBenefitsSection = (section: ProductDescriptionSection) =>
  section.title.toLocaleLowerCase("es").includes("beneficio");
const isContainedSection = (section: ProductDescriptionSection) => {
  const title = section.title.toLocaleLowerCase("es");
  return title.includes("contiene") || title.includes("incluye");
};

function SectionText({ section, compact = false }: { section: ProductDescriptionSection; compact?: boolean }) {
  if (isBenefitsSection(section)) {
    return (
      <div className="flex flex-wrap gap-2">
        {section.content.map((line, index) => (
          <span
            key={`${line}-${index}`}
            className="rounded-full border border-[var(--brand-gold-300)]/28 bg-[var(--brand-gold-300)]/10 px-3 py-1 text-xs font-medium leading-relaxed text-[var(--brand-cream)]/92"
          >
            {stripBullet(line)}
          </span>
        ))}
      </div>
    );
  }

  return (
    <div className={compact ? "space-y-2" : "space-y-3"}>
      {section.content.map((line, index) => (
        <p
          key={`${line}-${index}`}
          className={`${compact ? "text-sm leading-6" : "text-[15px] leading-7"} text-[var(--brand-cream)]/88`}
        >
          {isBulletLine(line) ? (
            <>
              <span className="mr-2 text-[var(--brand-gold-300)]">•</span>
              {stripBullet(line)}
            </>
          ) : (
            line
          )}
        </p>
      ))}
    </div>
  );
}

function ProductDescriptionDetails({ description, includes }: { description: string; includes?: string[] }) {
  const descriptionSections = parseDescriptionSections(description);
  const includeSection =
    includes && includes.length > 0
      ? [{ title: "Incluye", content: includes }]
      : [];
  const sections = [...descriptionSections, ...includeSection];
  const sideSections = sections.filter((section) => isBenefitsSection(section) || isContainedSection(section));
  const mainSections = sections.filter((section) => !sideSections.includes(section));
  const visibleMainSections = mainSections.length > 0 ? mainSections : sections.slice(0, 1);
  const visibleSideSections = sideSections.length > 0 ? sideSections : sections.slice(1);

  return (
    <section className="mt-10 overflow-hidden rounded-3xl border border-[var(--brand-gold-400)]/18 bg-[rgba(58,31,95,0.28)] shadow-[0_18px_45px_rgba(18,8,35,0.24)]">
      <div className="border-b border-[var(--brand-gold-300)]/16 px-4 py-4 sm:px-6">
        <p className="text-[11px] font-bold uppercase tracking-[0.16em] text-[var(--brand-gold-300)]">
          Detalles del producto
        </p>
      </div>

      <div className="divide-y divide-[var(--brand-gold-300)]/14 md:hidden">
        {sections.map((section, index) => (
          <details key={`${section.title}-${index}`} className="group" open={index === 0}>
            <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-4 text-sm font-semibold text-[var(--brand-cream)] marker:hidden">
              <span>{section.title}</span>
              <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full border border-[var(--brand-gold-300)]/24 text-[var(--brand-gold-300)] transition group-open:rotate-45">
                +
              </span>
            </summary>
            <div className="px-4 pb-5">
              <SectionText section={section} compact />
            </div>
          </details>
        ))}
      </div>

      <div className="hidden gap-7 p-6 md:grid md:grid-cols-[minmax(0,1.45fr)_minmax(17rem,0.85fr)] lg:p-8">
        <div className="space-y-8">
          {visibleMainSections.map((section, index) => (
            <div key={`${section.title}-${index}`}>
              <h2 className="text-base font-semibold text-[var(--brand-cream)]">
                {section.title}
              </h2>
              <div className="mt-3 h-px bg-gradient-to-r from-[var(--brand-gold-400)]/42 via-[var(--brand-gold-300)]/18 to-transparent" />
              <div className="mt-4">
                <SectionText section={section} />
              </div>
            </div>
          ))}
        </div>

        {visibleSideSections.length > 0 && (
          <aside className="space-y-4">
            {visibleSideSections.map((section, index) => (
              <div
                key={`${section.title}-${index}`}
                className="rounded-2xl border border-[var(--brand-gold-300)]/18 bg-white/[0.07] p-4"
              >
                <h3 className="text-sm font-semibold text-[var(--brand-gold-300)]">
                  {section.title}
                </h3>
                <div className="mt-3">
                  <SectionText section={section} compact />
                </div>
              </div>
            ))}
          </aside>
        )}
      </div>
    </section>
  );
}

export default function ProductDetail({ product, similarProducts = [] }: Props) {
  const variants = useMemo(() => getProductVariants(product), [product]);
  const hasVariants = hasProductVariants(product);
  const [selectedVariantId, setSelectedVariantId] = useState(product.id);
  const [currentImageIndex, setCurrentImageIndex] = useState(0);
  const [qty, setQty] = useState(1);
  const currentProduct = variants.find((variant) => variant.id === selectedVariantId) ?? variants[0] ?? product;
  const selectedGroupId = getProductGroupId(currentProduct);
  const visibleSimilarProducts = useMemo(
    () =>
      similarProducts
        .filter((candidate) => {
          if (candidate.id === currentProduct.id) return false;
          return !selectedGroupId || getProductGroupId(candidate) !== selectedGroupId;
        })
        .slice(0, 6),
    [currentProduct.id, selectedGroupId, similarProducts],
  );
  const similarProductsScrollerRef = useRef<HTMLDivElement | null>(null);

  const images = useMemo(
    () =>
      Array.isArray(currentProduct.images)
        ? currentProduct.images.filter((image): image is string => typeof image === "string" && image.trim().length > 0)
        : [],
    [currentProduct.images]
  );
  const router = useRouter();
  const { addItem, items } = useCart();
  const { setOpen } = useCartDrawer();

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setSelectedVariantId(product.id);
      setQty(1);
      setCurrentImageIndex(0);
    }, 0);

    return () => window.clearTimeout(timer);
  }, [product]);

  const handleSelectVariant = useCallback(
    (variantId: string) => {
      if (variantId === selectedVariantId) return;

      setSelectedVariantId(variantId);
      setQty(1);
      setCurrentImageIndex(0);
    },
    [selectedVariantId],
  );

  const safeUnitPrice = isValidPrice(currentProduct.price) ? currentProduct.price : 0;
  const displayPrice = isValidPrice(currentProduct.price) ? formatMoney(currentProduct.price) : "Consultar";
  const stockLabel = getStockLabel(currentProduct);
  const canBuy = isProductPurchasable(currentProduct);
  const isLastUnit = canBuy && currentProduct.stock_qty === 1;
  const cartQty = items.find((item) => item.productId === currentProduct.id)?.qty ?? 0;
  const maxQty = typeof currentProduct.stock_qty === "number" ? currentProduct.stock_qty : null;
  const remainingQty = maxQty === null ? null : Math.max(0, maxQty - cartQty);
  const canAddToCart = canBuy && (remainingQty === null || remainingQty > 0);
  const effectiveQty =
    remainingQty === null ? qty : Math.max(1, Math.min(qty, Math.max(remainingQty, 1)));
  const discountedPrice = isValidPrice(currentProduct.price)
    ? formatMoney(getCashTransferDiscountedTotal(currentProduct.price))
    : null;
  const shortDescription = useMemo(
    () => getShortDescription(currentProduct.short_description, currentProduct.description),
    [currentProduct.short_description, currentProduct.description]
  );
  const longDescription =
    typeof currentProduct.description === "string" && currentProduct.description.trim().length > 0
      ? currentProduct.description
      : LONG_DESCRIPTION_PLACEHOLDER;

  const handleShopBreadcrumbClick = useCallback(
    (event: MouseEvent<HTMLAnchorElement>) => {
      const shopHref = getLastShopListingHref("/tienda");
      if (shopHref === "/tienda") return;

      event.preventDefault();
      requestShopScrollRestoreForNextVisit();
      router.push(shopHref, { scroll: false });
    },
    [router]
  );

  const scrollSimilarProducts = useCallback((direction: -1 | 1) => {
    const scroller = similarProductsScrollerRef.current;
    if (!scroller) return;

    scroller.scrollBy({
      left: direction * Math.max(scroller.clientWidth * 0.78, 280),
      behavior: "smooth",
    });
  }, []);

  const handleAddToCart = () => {
    if (!canAddToCart) return;

    const cartItemName = hasVariants
      ? `${product.name} - ${getProductVariantLabel(currentProduct)}`
      : currentProduct.name;

    try {
      const result = addItem({
        productId: currentProduct.id,
        name: cartItemName,
        unitPrice: safeUnitPrice,
        qty: effectiveQty,
        image: images[0] ?? "",
        stockStatus: currentProduct.stock_status,
        stockQty: currentProduct.stock_qty ?? null,
      });
      if (!result.ok) {
        toast.error(
          result.reason === "max_stock_reached"
            ? `Ya tenés el máximo disponible de ${currentProduct.name} en el carrito.`
            : `${currentProduct.name} no tiene stock disponible.`
        );
        return;
      }
      setQty(1);
      showCartAddedToast({
        productName: cartItemName,
        image: images[0],
        onViewCart: () => setOpen(true),
      });
    } catch {
      toast.error(`No pudimos agregar ${currentProduct.name}. Intentá nuevamente.`);
    }
  };

  return (
    <main className="mx-auto w-full max-w-6xl px-4 py-8 text-[var(--brand-cream)]">
      <Breadcrumbs
        items={[
          { label: "INICIO", href: "/" },
          { label: "Tienda", href: "/tienda", onClick: handleShopBreadcrumbClick },
          { label: currentProduct.name },
        ]}
      />
      <section className="grid gap-5 rounded-3xl border border-[var(--brand-gold-400)]/20 bg-[rgba(58,31,95,0.35)] p-5 shadow-[0_20px_50px_rgba(18,8,35,0.35)] lg:grid-cols-2 lg:gap-x-8 lg:gap-y-4 lg:p-8">
        <div className="min-w-0 lg:row-span-3">
          <ProductImageGalleryZoom
            images={images}
            productName={currentProduct.name}
            currentImageIndex={currentImageIndex}
            onImageIndexChange={setCurrentImageIndex}
            theme="pdp"
            thumbnailsDesktopOnly
          />
        </div>

        <ProductVariantSelector
          variants={variants}
          selectedProductId={currentProduct.id}
          onSelectVariant={handleSelectVariant}
          theme="pdp"
          className="lg:col-start-2 lg:row-start-2"
        />

        <div className="flex flex-col gap-4 lg:col-start-2 lg:row-start-1">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-xs uppercase tracking-[0.22em] text-[var(--brand-gold-300)]">
              {formatProductCategories(currentProduct)}
            </p>
            <div
              className={`inline-flex w-fit items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-bold leading-none shadow-sm ${
                !canBuy
                  ? "border-rose-300/80 bg-rose-400/18 text-rose-50"
                  : isLastUnit
                  ? "border-amber-200/80 bg-amber-200/22 text-amber-50 shadow-[0_8px_18px_rgba(180,83,9,0.14)]"
                  : currentProduct.stock_status === "preorder"
                  ? "border-amber-200/60 bg-amber-400/16 text-amber-100"
                  : "border-emerald-200/50 bg-emerald-400/14 text-emerald-100"
              }`}
            >
              {isLastUnit && (
                <span className="h-1.5 w-1.5 rounded-full bg-amber-200 shadow-[0_0_10px_rgba(254,243,199,0.85)]" />
              )}
              {stockLabel}
            </div>
          </div>
          <h1 className="text-3xl font-semibold leading-tight text-[var(--brand-cream)]">{product.name}</h1>
          <div className="space-y-2">
            <p className="text-3xl font-extrabold text-yellow-100">
              {displayPrice}
            </p>
            {discountedPrice && (
              <p className="text-sm font-medium leading-tight text-emerald-100">
                <span className="font-bold text-emerald-50">Efectivo/transf.</span>{" "}
                {discountedPrice} <span className="text-[var(--brand-gold-300)]">· 10% OFF</span>
              </p>
            )}
          </div>
        </div>

        <div className="flex flex-col gap-4 lg:col-start-2 lg:row-start-3">
          <div className="flex flex-row items-center gap-3">
            <div className="inline-flex items-center rounded-2xl bg-white/10 border border-white/15 p-1 backdrop-blur-sm">
              <button
                type="button"
                onClick={() => setQty((prev) => Math.max(1, prev - 1))}
                disabled={effectiveQty <= 1 || !canAddToCart}
                className="h-11 w-11 grid place-items-center rounded-xl bg-white/85 text-violet-900 shadow-sm border border-white/60 hover:bg-white active:scale-[0.98] transition disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand-gold-300)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--brand-violet-900)]"
                aria-label="Reducir cantidad"
              >
                −
              </button>
              <div
                className="text-white font-semibold text-center min-w-[3rem]"
                aria-live="polite"
                aria-label={`Cantidad seleccionada: ${effectiveQty}`}
              >
                {effectiveQty}
              </div>
              <button
                type="button"
                onClick={() =>
                  setQty((prev) =>
                    remainingQty === null ? prev + 1 : Math.min(remainingQty, prev + 1)
                  )
                }
                disabled={!canAddToCart || (remainingQty !== null && effectiveQty >= remainingQty)}
                className="h-11 w-11 grid place-items-center rounded-xl bg-white/85 text-violet-900 shadow-sm border border-white/60 hover:bg-white active:scale-[0.98] transition disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand-gold-300)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--brand-violet-900)]"
                aria-label="Aumentar cantidad"
              >
                +
              </button>
            </div>
            <button
              type="button"
              onClick={handleAddToCart}
              disabled={!canAddToCart}
              className="h-12 flex-1 rounded-2xl bg-gradient-to-r from-yellow-200 to-amber-100 text-violet-950 font-semibold shadow-lg shadow-black/20 ring-1 ring-white/30 hover:brightness-105 active:scale-[0.99] transition disabled:cursor-not-allowed disabled:from-slate-300 disabled:to-slate-400 disabled:text-slate-700 disabled:hover:brightness-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand-gold-300)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--brand-violet-900)]"
              aria-label={
                canAddToCart
                  ? `Comprar ahora ${currentProduct.name}`
                  : canBuy
                  ? `${currentProduct.name} ya está al máximo disponible en el carrito`
                  : `${currentProduct.name} sin stock`
              }
            >
              {canAddToCart ? "Comprar ahora" : canBuy ? "Máximo en carrito" : "Sin stock"}
            </button>
          </div>

          <p className="text-xs font-medium text-[var(--brand-cream)]/72">
            Entrega disponible en Rosario.
          </p>

          <p className="max-w-[62ch] text-sm leading-relaxed text-[var(--brand-cream)]/90">{shortDescription}</p>

        </div>
      </section>

      <ProductDescriptionDetails
        description={longDescription}
        includes={
          currentProduct.product_type === "KIT" && Array.isArray(currentProduct.includes)
            ? currentProduct.includes
            : undefined
        }
      />

      {visibleSimilarProducts.length > 0 && (
        <section className="mt-12">
          <h2 className="mb-4 text-lg font-semibold text-[var(--brand-gold-300)]">
            Tambien te puede gustar
          </h2>
          <div className="mb-6 h-px bg-gradient-to-r from-[var(--brand-gold-400)]/40 via-[var(--brand-gold-300)]/20 to-transparent" />

          <div className="relative">
            <button
              type="button"
              onClick={() => scrollSimilarProducts(-1)}
              className="absolute left-0 top-1/2 z-10 hidden h-10 w-10 -translate-y-1/2 place-items-center rounded-full border border-[var(--brand-gold-300)]/55 bg-[var(--brand-violet-950)]/88 text-[var(--brand-gold-300)] shadow-[0_12px_26px_rgba(18,8,35,0.32)] backdrop-blur-sm transition hover:border-[var(--brand-gold-300)] hover:bg-[var(--brand-violet-900)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand-gold-300)] md:grid"
              aria-label="Ver productos anteriores"
            >
              <svg aria-hidden="true" viewBox="0 0 20 20" className="h-5 w-5" fill="none">
                <path
                  d="M12.5 4.5 7 10l5.5 5.5"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </button>

            <div
              ref={similarProductsScrollerRef}
              className="-mx-1 flex snap-x snap-mandatory gap-3 overflow-x-auto px-1 pb-3 md:mx-0 md:px-12 md:pb-4 related-products-scroll"
            >
              {visibleSimilarProducts.map((similarProduct) => {
                const similarPrice = isValidPrice(similarProduct.price)
                  ? formatMoney(similarProduct.price)
                  : "Consultar";
                const oldPrice = isValidPrice(similarProduct.old_price)
                  ? similarProduct.old_price
                  : null;
                const hasOldPrice =
                  oldPrice !== null &&
                  isValidPrice(similarProduct.price) &&
                  oldPrice > similarProduct.price;
                const similarOldPrice = hasOldPrice
                  ? formatMoney(oldPrice)
                  : null;

                return (
                  <Link
                    key={similarProduct.id}
                    href={`/tienda/producto/${similarProduct.slug || similarProduct.id}`}
                    className="group snap-start shrink-0 basis-[38%] overflow-hidden rounded-xl border border-[var(--brand-gold-300)]/22 bg-white/[0.12] shadow-lg shadow-black/20 transition-all duration-200 hover:-translate-y-1 hover:border-[var(--brand-gold-300)]/50 sm:basis-[30%] lg:basis-[22%]"
                  >
                    <div className="relative aspect-[4/5] w-full">
                      {Array.isArray(similarProduct.images) && similarProduct.images[0] ? (
                        <Image
                          src={similarProduct.images[0]}
                          alt={similarProduct.name}
                          fill
                          className="object-cover transition-transform duration-300 group-hover:scale-105"
                          sizes="(max-width:640px) 38vw, (max-width:1024px) 30vw, 22vw"
                        />
                      ) : (
                        <div className="flex h-full w-full items-center justify-center text-xs uppercase text-[var(--brand-gold-300)]">
                          Sin imagen
                        </div>
                      )}
                    </div>
                    <div className="flex flex-col gap-1.5 p-3">
                      {similarOldPrice && (
                        <span className="text-xs text-[var(--brand-cream)]/60 line-through">
                          {similarOldPrice}
                        </span>
                      )}
                      <span className="text-xs font-semibold text-[var(--brand-gold-300)] sm:text-sm">
                        {similarPrice}
                      </span>
                      <p className="line-clamp-2 text-xs leading-relaxed text-[var(--brand-cream)]/92 sm:text-sm">
                        {similarProduct.name}
                      </p>
                    </div>
                  </Link>
                );
              })}
            </div>

            <button
              type="button"
              onClick={() => scrollSimilarProducts(1)}
              className="absolute right-0 top-1/2 z-10 hidden h-10 w-10 -translate-y-1/2 place-items-center rounded-full border border-[var(--brand-gold-300)]/55 bg-[var(--brand-violet-950)]/88 text-[var(--brand-gold-300)] shadow-[0_12px_26px_rgba(18,8,35,0.32)] backdrop-blur-sm transition hover:border-[var(--brand-gold-300)] hover:bg-[var(--brand-violet-900)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand-gold-300)] md:grid"
              aria-label="Ver mas productos recomendados"
            >
              <svg aria-hidden="true" viewBox="0 0 20 20" className="h-5 w-5" fill="none">
                <path
                  d="M7.5 4.5 13 10l-5.5 5.5"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </button>
          </div>
        </section>
      )}
    </main>
  );
}
