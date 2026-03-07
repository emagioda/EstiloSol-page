"use client";
import Image from "next/image";
import Link from "next/link";
import { memo } from "react";
import type { Product } from "@/src/features/shop/domain/entities/Product";

const ARS_FORMATTER = new Intl.NumberFormat("es-AR", {
  style: "currency",
  currency: "ARS",
});

const isValidNumber = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value);

function ProductCard({
  product,
  onQuickView,
  staticDetailHandleSet,
}: {
  product: Product;
  onQuickView?: (product: Product) => void;
  staticDetailHandleSet?: Set<string>;
}) {
  const hasCurrentPrice = isValidNumber(product.price);
  const formattedPrice = hasCurrentPrice ? ARS_FORMATTER.format(product.price) : "Consultar";
  const oldPrice = isValidNumber(product.old_price) ? product.old_price : null;
  const hasOldPrice = oldPrice !== null && hasCurrentPrice && oldPrice > product.price;
  const formattedOldPrice = hasOldPrice ? ARS_FORMATTER.format(oldPrice) : null;
  const discountPercent = hasOldPrice
    ? Math.round(((oldPrice - product.price) / oldPrice) * 100)
    : null;

  const hasSheetsEndpoint = Boolean(process.env.NEXT_PUBLIC_SHEETS_ENDPOINT?.trim());
  const detailHref = `/tienda/producto/${product.slug || product.id}`;
  const detailHandle = String(product.slug || product.id);
  const canOpenStaticDetail =
    hasSheetsEndpoint ||
    !staticDetailHandleSet ||
    staticDetailHandleSet.size === 0 ||
    staticDetailHandleSet.has(detailHandle);

  const thumb = product.images && product.images.length > 0 ? product.images[0] : undefined;

  const badges: Array<{ key: string; label: string; className: string }> = [];
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
        </div>
        <h3 className="line-clamp-2 text-sm font-normal leading-relaxed text-[var(--brand-cream)]/95">
          {product.name}
        </h3>
      </div>
    </>
  );

  return (
    <article className="animate-fade-up flex h-full flex-col overflow-hidden rounded-2xl border border-[var(--brand-gold-300)]/22 bg-white/[0.14] text-[var(--brand-cream)] shadow-lg shadow-black/22 backdrop-blur-sm transition-all duration-300 hover:-translate-y-1 hover:border-[var(--brand-gold-300)]/60 hover:bg-white/[0.18] hover:shadow-2xl hover:shadow-black/30">
      {canOpenStaticDetail ? (
        <Link href={detailHref} className="group flex h-full flex-col" aria-label={`Ver detalle de ${product.name}`}>
          {mediaAndBody}
        </Link>
      ) : (
        <div className="group flex h-full flex-col" aria-label={`${product.name} requiere actualizacion del sitio`}>
          {mediaAndBody}
          <span className="px-4 pb-2 text-xs text-[var(--brand-cream)]/65">
            Detalle disponible en la proxima actualizacion
          </span>
        </div>
      )}

      <div className="mt-auto flex w-full justify-center px-4 pb-4 pt-3 md:px-4 md:pb-4 md:pt-3">
        <button
          type="button"
          onClick={(event) => {
            event.preventDefault();
            event.stopPropagation();
            onQuickView?.(product);
          }}
          className="h-11 w-full rounded-xl bg-gradient-to-r from-[var(--brand-gold-300)] to-[var(--brand-gold-400)] font-semibold text-[var(--brand-violet-950)] shadow-md shadow-black/20 ring-1 ring-white/30 transition duration-200 hover:brightness-105 active:scale-[0.99] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand-gold-300)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--brand-violet-900)]"
          aria-label={`Comprar ${product.name}`}
        >
          Comprar ahora
        </button>
      </div>
    </article>
  );
}

export default memo(ProductCard);
