"use client";

import Image from "next/image";
import Link from "next/link";
import { useCallback, useMemo, useState, type MouseEvent } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import ProductImageGalleryZoom from "@/src/features/shop/presentation/components/ProductImageGalleryZoom/ProductImageGalleryZoom";
import Breadcrumbs from "@/src/features/shop/presentation/components/Breadcrumbs";
import FormattedDescription from "@/src/features/shop/presentation/components/FormattedDescription";
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

export default function ProductDetail({ product, similarProducts = [] }: Props) {
  const currentProduct = product;
  const visibleSimilarProducts = useMemo(
    () =>
      similarProducts
        .filter((candidate) => candidate.id !== currentProduct.id)
        .slice(0, 6),
    [currentProduct.id, similarProducts],
  );

  const images = useMemo(
    () =>
      Array.isArray(currentProduct.images)
        ? currentProduct.images.filter((image): image is string => typeof image === "string" && image.trim().length > 0)
        : [],
    [currentProduct.images]
  );
  const [currentImageIndex, setCurrentImageIndex] = useState(0);
  const [qty, setQty] = useState(1);
  const router = useRouter();
  const { addItem, items } = useCart();
  const { setOpen } = useCartDrawer();

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
    ? formatMoney(Math.round(currentProduct.price * 0.9))
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

  const handleAddToCart = () => {
    if (!canAddToCart) return;

    try {
      const result = addItem({
        productId: currentProduct.id,
        name: currentProduct.name,
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
        productName: currentProduct.name,
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
      <section className="grid gap-8 rounded-3xl border border-[var(--brand-gold-400)]/20 bg-[rgba(58,31,95,0.35)] p-5 shadow-[0_20px_50px_rgba(18,8,35,0.35)] lg:grid-cols-2 lg:p-8">
        <div>
          <ProductImageGalleryZoom
            images={images}
            productName={currentProduct.name}
            currentImageIndex={currentImageIndex}
            onImageIndexChange={setCurrentImageIndex}
            theme="pdp"
          />
        </div>

        <div className="flex flex-col gap-5">
          <p className="text-xs uppercase tracking-[0.22em] text-[var(--brand-gold-300)]">
            {formatProductCategories(currentProduct)}
          </p>
          <h1 className="text-3xl font-semibold leading-tight text-[var(--brand-cream)]">{currentProduct.name}</h1>
          <p className="text-3xl font-extrabold text-yellow-100">
            {displayPrice}
          </p>
          <div
            className={`inline-flex w-fit items-center gap-2 rounded-full border px-3.5 py-2 text-sm font-bold leading-none shadow-sm ${
              !canBuy
                ? "border-rose-300/80 bg-rose-400/18 text-rose-50"
                : isLastUnit
                ? "border-amber-200/80 bg-gradient-to-r from-amber-200/30 to-rose-200/24 text-amber-50 shadow-[0_8px_18px_rgba(180,83,9,0.18)]"
                : currentProduct.stock_status === "preorder"
                ? "border-amber-200/60 bg-amber-400/16 text-amber-100"
                : "border-emerald-200/50 bg-emerald-400/14 text-emerald-100"
            }`}
          >
            {isLastUnit && (
              <span className="h-2 w-2 rounded-full bg-amber-200 shadow-[0_0_10px_rgba(254,243,199,0.85)]" />
            )}
            {stockLabel}
          </div>
          {discountedPrice && (
            <div className="mt-2 w-fit rounded-md border border-green-200 bg-green-50 px-3 py-2 text-green-700">
              <span className="font-bold">10% OFF</span> en Efectivo/Transferencia: {discountedPrice}
            </div>
          )}

          <p className="max-w-[62ch] text-sm leading-relaxed text-[var(--brand-cream)]/90">{shortDescription}</p>

          <div className="mt-3 flex flex-row items-center gap-3">
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

          {/* info panel below buy button */}
          <div className="mt-5 rounded-2xl bg-white/10 border border-white/15 p-4 text-white/90">
            <ul className="space-y-2 text-sm">
              <li className="flex items-center gap-2">
                <span className="text-lg">🚚</span>
                <span>Entrega en Rosario</span>
              </li>
              <li className="flex items-center gap-2">
                <span className="text-lg">💳</span>
                <span>Pago por transferencia o efectivo</span>
              </li>
            </ul>
          </div>
        </div>
      </section>

      {currentProduct.product_type === "KIT" && Array.isArray(currentProduct.includes) && currentProduct.includes.length > 0 && (
        <section className="mt-10">
          <h2 className="mb-4 text-lg font-semibold text-[var(--brand-gold-300)]">INCLUYE</h2>
          <div className="mb-6 h-px bg-gradient-to-r from-[var(--brand-gold-400)]/40 via-[var(--brand-gold-300)]/20 to-transparent" />
          <FormattedDescription description={currentProduct.includes.join("\n")} />
        </section>
      )}

      <section className="mt-10">
        <h2 className="mb-4 text-lg font-semibold text-[var(--brand-gold-300)]">DESCRIPCIÓN</h2>
        <div className="mb-6 h-px bg-gradient-to-r from-[var(--brand-gold-400)]/40 via-[var(--brand-gold-300)]/20 to-transparent" />
        <FormattedDescription description={longDescription} />
      </section>

      {visibleSimilarProducts.length > 0 && (
        <section className="mt-12">
          <h2 className="mb-4 text-lg font-semibold text-[var(--brand-gold-300)]">
            Tambien te puede gustar
          </h2>
          <div className="mb-6 h-px bg-gradient-to-r from-[var(--brand-gold-400)]/40 via-[var(--brand-gold-300)]/20 to-transparent" />

          <div className="-mx-1 flex snap-x snap-mandatory gap-4 overflow-x-auto px-1 pb-2">
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
                  className="group snap-start shrink-0 basis-[74%] overflow-hidden rounded-2xl border border-[var(--brand-gold-300)]/22 bg-white/[0.12] shadow-lg shadow-black/20 transition-all duration-200 hover:-translate-y-1 hover:border-[var(--brand-gold-300)]/50 sm:basis-[46%] lg:basis-[30%]"
                >
                  <div className="relative aspect-[4/5] w-full">
                    {Array.isArray(similarProduct.images) && similarProduct.images[0] ? (
                      <Image
                        src={similarProduct.images[0]}
                        alt={similarProduct.name}
                        fill
                        className="object-cover transition-transform duration-300 group-hover:scale-105"
                        sizes="(max-width:640px) 70vw, (max-width:1024px) 40vw, 24vw"
                      />
                    ) : (
                      <div className="flex h-full w-full items-center justify-center text-xs uppercase text-[var(--brand-gold-300)]">
                        Sin imagen
                      </div>
                    )}
                  </div>
                  <div className="flex flex-col gap-1.5 p-3.5">
                    {similarOldPrice && (
                      <span className="text-xs text-[var(--brand-cream)]/60 line-through">
                        {similarOldPrice}
                      </span>
                    )}
                    <span className="text-sm font-semibold text-[var(--brand-gold-300)]">
                      {similarPrice}
                    </span>
                    <p className="line-clamp-2 text-sm leading-relaxed text-[var(--brand-cream)]/92">
                      {similarProduct.name}
                    </p>
                  </div>
                </Link>
              );
            })}
          </div>
        </section>
      )}
    </main>
  );
}
