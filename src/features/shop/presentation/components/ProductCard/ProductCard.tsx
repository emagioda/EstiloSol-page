"use client";
import Image from "next/image";
import Link from "next/link";
import { useMemo } from "react";
import type { Product } from "@/src/features/shop/domain/entities/Product";

export default function ProductCard({
  product,
  onQuickView,
  staticDetailHandles,
}: {
  product: Product;
  onQuickView?: (product: Product) => void;
  staticDetailHandles?: string[];
}) {
  const formattedPrice =
    typeof product.price === "number" && Number.isFinite(product.price)
      ? new Intl.NumberFormat("es-AR", {
          style: "currency",
          currency: "ARS",
        }).format(product.price)
      : "Consultar";
  const hasSheetsEndpoint = Boolean(process.env.NEXT_PUBLIC_SHEETS_ENDPOINT?.trim());
  const detailHref = `/tienda/producto/${product.slug || product.id}`;
  const staticHandlesSet = useMemo(() => new Set(staticDetailHandles ?? []), [staticDetailHandles]);
  const detailHandle = String(product.slug || product.id);
  const canOpenStaticDetail =
    hasSheetsEndpoint || staticHandlesSet.size === 0 || staticHandlesSet.has(detailHandle);

  const thumb =
    product.images && product.images.length > 0 ? product.images[0] : undefined;

  // determine optional badge text based on existing product flags
  const badgeText = product.is_new
    ? "Nuevo"
    : product.is_sale
    ? "Promo"
    : product.product_type === "KIT"
    ? "Kit"
    : product.tags?.includes("destacado")
    ? "Destacado"
    : undefined;

  return (
    <article className="animate-fade-up flex h-full flex-col overflow-hidden rounded-2xl border border-[var(--brand-gold-300)]/22 bg-white/[0.14] text-[var(--brand-cream)] shadow-lg shadow-black/22 backdrop-blur-sm transition-all duration-300 hover:-translate-y-1 hover:border-[var(--brand-gold-300)]/60 hover:bg-white/[0.18] hover:shadow-2xl hover:shadow-black/30">
      {canOpenStaticDetail ? (
        <Link href={detailHref} className="group flex flex-col h-full" aria-label={`Ver detalle de ${product.name}`}>
          <div className="relative aspect-[4/5] w-full overflow-hidden rounded-t-2xl">
            {badgeText && (
              <span className="absolute left-3 top-3 z-10 rounded-lg bg-gradient-to-r from-[var(--brand-gold-400)] to-[var(--brand-gold-300)] px-2 py-1 text-xs font-semibold text-[var(--brand-violet-950)] shadow-sm">
                {badgeText}
              </span>
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
            <div className="text-lg font-bold text-[var(--brand-gold-300)]">{formattedPrice}</div>
            <h3 className="text-sm font-normal leading-relaxed text-[var(--brand-cream)]/95 line-clamp-2">
              {product.name}
            </h3>
          </div>
        </Link>
      ) : (
        <div className="group flex flex-col h-full" aria-label={`${product.name} requiere actualización del sitio`}>
          <div className="relative aspect-[4/5] w-full overflow-hidden rounded-t-2xl">
            {badgeText && (
              <span className="absolute left-3 top-3 z-10 rounded-lg bg-gradient-to-r from-[var(--brand-gold-400)] to-[var(--brand-gold-300)] px-2 py-1 text-xs font-semibold text-[var(--brand-violet-950)] shadow-sm">
                {badgeText}
              </span>
            )}
            {thumb ? (
              <Image
                src={thumb}
                alt={product.name}
                fill
                className="object-cover opacity-85 transition-transform duration-300 group-hover:scale-105"
                sizes="(max-width:640px) 50vw, (max-width:1024px) 33vw, 25vw"
              />
            ) : (
              <div className="flex h-full w-full items-center justify-center text-xs uppercase text-[var(--brand-gold-300)]">
                Sin imagen
              </div>
            )}
          </div>

          <div className="flex flex-1 flex-col gap-2 p-4">
            <div className="text-lg font-bold text-[var(--brand-gold-300)]">{formattedPrice}</div>
            <h3 className="text-sm font-normal leading-relaxed text-[var(--brand-cream)]/95 line-clamp-2">
              {product.name}
            </h3>
            <span className="text-xs text-[var(--brand-cream)]/60">Detalle disponible en la próxima actualización</span>
          </div>
        </div>
      )}

      <div className="mt-auto flex w-full justify-center pt-3 px-4 md:px-4 md:pt-3 pb-4 md:pb-4">
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
