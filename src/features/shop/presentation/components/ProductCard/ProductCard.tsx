"use client";
import Image from "next/image";
import Link from "next/link";
import { memo } from "react";
import type { Product } from "@/src/features/shop/domain/entities/Product";
import {
  areVariantPricesDifferent,
  getProductVariants,
  hasProductVariants,
} from "@/src/features/shop/domain/productVariants";
import { rememberCurrentShopScroll } from "@/src/features/shop/presentation/lib/shopScrollRestoration";
import {
  getStockLabel,
  isProductPurchasable,
} from "@/src/features/shop/infrastructure/data/productAdapter";

const ARS_FORMATTER = new Intl.NumberFormat("es-AR", {
  style: "currency",
  currency: "ARS",
});

const isValidNumber = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value);

function ProductCard({
  product,
  onQuickView,
  priority = false,
}: {
  product: Product;
  onQuickView?: (product: Product) => void;
  priority?: boolean;
}) {
  const hasCurrentPrice = isValidNumber(product.price);
  const variants = getProductVariants(product);
  const hasVariants = hasProductVariants(product);
  const hasPriceRange = hasVariants && areVariantPricesDifferent(variants);
  const formattedPrice = hasCurrentPrice
    ? `${hasPriceRange ? "Desde " : ""}${ARS_FORMATTER.format(product.price)}`
    : "Consultar";
  const oldPrice = isValidNumber(product.old_price) ? product.old_price : null;
  const hasOldPrice = oldPrice !== null && hasCurrentPrice && oldPrice > product.price;
  const formattedOldPrice = hasOldPrice ? ARS_FORMATTER.format(oldPrice) : null;
  const discountPercent = hasOldPrice
    ? Math.round(((oldPrice - product.price) / oldPrice) * 100)
    : null;

  const detailHref = `/tienda/producto/${product.slug || product.id}`;
  const rememberScrollForProduct = () => {
    rememberCurrentShopScroll({
      id: product.id,
      handle: product.slug || product.id,
    });
  };

  const thumb = product.images && product.images.length > 0 ? product.images[0] : undefined;
  const stockLabel = getStockLabel(product);
  const canBuy = isProductPurchasable(product);
  const isLastUnit = canBuy && product.stock_qty === 1;
  const stockLabelClass = !canBuy
    ? "border-red-200/45 bg-red-500/20 text-red-50"
    : isLastUnit
    ? "border-amber-200/80 bg-amber-200/24 text-amber-50"
    : typeof product.stock_qty === "number"
    ? "border-emerald-200/45 bg-emerald-500/12 text-emerald-100"
    : product.stock_status === "preorder"
    ? "border-amber-200/45 bg-amber-500/14 text-amber-100"
    : "border-white/16 bg-white/8 text-[var(--brand-cream)]/78";

  const badges: Array<{ key: string; label: string; className: string }> = [];
  if (!canBuy) {
    badges.push({
      key: "stock",
      label: "SIN STOCK",
      className: "bg-slate-800 text-white",
    });
  }
  if (product.is_new) {
    badges.push({
      key: "new",
      label: "NUEVO",
      className: "bg-gradient-to-r from-emerald-500 to-cyan-500 text-white",
    });
  }
  if (product.is_sale) {
    badges.push({
      key: "sale",
      label: hasOldPrice && discountPercent ? `-${discountPercent}% OFF` : "PROMO",
      className: "bg-gradient-to-r from-red-500 to-orange-500 text-white",
    });
  }
  if (hasVariants) {
    badges.push({
      key: "variants",
      label: `${variants.length} DISEÑOS`,
      className: "bg-[var(--brand-violet-950)]/88 text-[var(--brand-gold-300)] ring-1 ring-white/20",
    });
  }

  const mediaAndBody = (
    <>
      <div className="relative aspect-[4/5] w-full overflow-hidden rounded-t-2xl">
        {badges.length > 0 && (
          <div className="pointer-events-none absolute left-3 top-3 z-30 flex flex-col gap-1.5">
            {badges.map((badge) => (
              <span
                key={badge.key}
                className={`rounded-md px-2 py-1 text-[11px] font-bold tracking-[0.03em] shadow-md ${badge.className}`}
              >
                {badge.label}
              </span>
            ))}
          </div>
        )}

        {thumb ? (
          <Image
            src={thumb}
            alt={product.name}
            fill
            className="object-cover transition-transform duration-300 group-hover:scale-105"
            sizes="(max-width:640px) 50vw, (max-width:1024px) 33vw, 25vw"
            priority={priority}
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center text-xs uppercase text-[var(--brand-gold-300)]">
            Sin imagen
          </div>
        )}
      </div>

      <div className="flex flex-1 flex-col gap-2 p-4">
        <div className="flex flex-col gap-0.5">
          {formattedOldPrice && (
            <span className="text-xs font-medium text-[var(--brand-cream)]/60 line-through">
              {formattedOldPrice}
            </span>
          )}
          <span
            className={`text-lg font-bold ${
              hasOldPrice ? "text-red-300" : "text-[var(--brand-gold-300)]"
            }`}
          >
            {formattedPrice}
          </span>
          <span className={`mt-1 inline-flex w-fit items-center gap-1.5 rounded-full border px-2 py-1 text-[11px] font-bold leading-none ${stockLabelClass}`}>
            {isLastUnit && (
              <span className="h-1.5 w-1.5 rounded-full bg-amber-100 shadow-[0_0_8px_rgba(254,243,199,0.9)]" />
            )}
            {stockLabel}
          </span>
        </div>
        <h3 className="line-clamp-2 text-sm font-normal leading-relaxed text-[var(--brand-cream)]/95">
          {product.name}
        </h3>
      </div>
    </>
  );

  return (
    <article className="animate-fade-up flex h-full flex-col overflow-hidden rounded-2xl border border-[var(--brand-gold-300)]/22 bg-white/[0.14] text-[var(--brand-cream)] shadow-lg shadow-black/22 backdrop-blur-sm transition-all duration-300 hover:-translate-y-1 hover:border-[var(--brand-gold-300)]/60 hover:bg-white/[0.18] hover:shadow-2xl hover:shadow-black/30">
      <Link
        href={detailHref}
        className="group flex h-full flex-col"
        aria-label={`Ver detalle de ${product.name}`}
        onClick={rememberScrollForProduct}
        onPointerDown={rememberScrollForProduct}
      >
        {mediaAndBody}
      </Link>

      <div className="mt-auto flex w-full justify-center px-4 pb-4 pt-3 md:px-4 md:pb-4 md:pt-3">
        <button
          type="button"
          onClick={(event) => {
            event.preventDefault();
            event.stopPropagation();
            if (!canBuy) return;
            onQuickView?.(product);
          }}
          disabled={!canBuy}
          className="h-11 w-full rounded-xl bg-gradient-to-r from-[var(--brand-gold-300)] to-[var(--brand-gold-400)] font-semibold text-[var(--brand-violet-950)] shadow-md shadow-black/20 ring-1 ring-white/30 transition duration-200 hover:brightness-105 active:scale-[0.99] disabled:cursor-not-allowed disabled:from-slate-300 disabled:to-slate-400 disabled:text-slate-700 disabled:hover:brightness-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand-gold-300)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--brand-violet-900)]"
          aria-label={canBuy ? `Lo quiero ${product.name}` : `${product.name} sin stock`}
        >
          {canBuy ? "Lo quiero" : "Sin stock"}
        </button>
      </div>
    </article>
  );
}

export default memo(ProductCard);
