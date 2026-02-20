"use client";
import Image from "next/image";
import Link from "next/link";
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
  const detailHref = `/tienda/producto/${product.slug || product.id}`;
  const staticHandlesSet = new Set(staticDetailHandles ?? []);
  const detailHandle = String(product.slug || product.id);
  const canOpenStaticDetail =
    staticHandlesSet.size === 0 || staticHandlesSet.has(detailHandle);

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
    <article className="animate-fade-up flex h-full flex-col rounded-2xl p-5 text-[var(--brand-cream)] bg-white/5 backdrop-blur-sm border border-[var(--brand-gold-400)]/30 shadow-md shadow-black/20 transition-all duration-300 hover:scale-[1.02] hover:shadow-xl hover:shadow-black/30 hover:border-[var(--brand-gold-300)]/60">
      {canOpenStaticDetail ? (
        <Link href={detailHref} className="group block" aria-label={`Ver detalle de ${product.name}`}>
          <div className="relative mb-4 aspect-[4/5] w-full overflow-hidden rounded-xl">
            {badgeText && (
              <span className="absolute top-3 left-3 z-10 bg-[var(--brand-gold-300)] text-violet-900 text-xs font-semibold px-2 py-1 rounded-lg">
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
                No image
              </div>
            )}
          </div>

          <div className="flex flex-1 flex-col gap-3">
            <div className="flex-1">
              <div className="text-2xl font-extrabold text-[var(--brand-gold-300)] mb-1">
                {formattedPrice}
              </div>
              <h3 className="text-sm font-medium text-white/90 leading-snug line-clamp-2">
                {product.name}
              </h3>
            </div>
          </div>
        </Link>
      ) : (
        <div className="group block" aria-label={`${product.name} requiere actualización del sitio`}> 
          <div className="relative mb-4 aspect-[4/5] w-full overflow-hidden rounded-xl">
            {badgeText && (
              <span className="absolute top-3 left-3 z-10 bg-[var(--brand-gold-300)] text-violet-900 text-xs font-semibold px-2 py-1 rounded-lg">
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
                No image
              </div>
            )}
          </div>

          <div className="flex flex-1 flex-col gap-3">
            <div className="flex-1">
              <div className="text-2xl font-extrabold text-[var(--brand-gold-300)] mb-1">
                {formattedPrice}
              </div>
              <h3 className="text-sm font-medium text-white/90 leading-snug line-clamp-2">
                {product.name}
              </h3>
            </div>
          </div>
        </div>
      )}

      <div className="mt-auto flex w-full justify-center pt-3">
        <button
          type="button"
          onClick={(event) => {
            event.preventDefault();
            event.stopPropagation();
            onQuickView?.(product);
          }}
          className="w-full h-11 rounded-xl bg-gradient-to-r from-yellow-200 to-amber-100 text-violet-950 font-semibold shadow-md shadow-black/20 ring-1 ring-white/30 transition hover:brightness-105 active:scale-[0.99] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand-gold-300)]"
          aria-label={`Comprar ${product.name}`}
        >
          Comprar
        </button>
      </div>
    </article>
  );
}
