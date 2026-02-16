"use client";
import Image from "next/image";
import Link from "next/link";

export type Product = {
  id: string;
  name: string;
  slug?: string;
  description?: string;
  category?: string;
  price: number;
  currency?: string;
  images?: string[];
  is_new?: boolean;
  is_sale?: boolean;
  [k: string]: unknown;
};

const ACTION_SIZE_CLASS = "h-11 w-full max-w-[170px]";

export default function ProductCard({
  product,
  onQuickView,
}: {
  product: Product;
  onQuickView?: (product: Product) => void;
}) {
  const formattedPrice = new Intl.NumberFormat("es-AR", {
    style: "currency",
    currency: "ARS",
  }).format(product.price);
  const detailHref = `/tienda/producto/${product.slug || product.id}`;

  const thumb =
    product.images && product.images.length > 0 ? product.images[0] : undefined;

  return (
    <article className="animate-fade-up flex h-full flex-col rounded-3xl p-3 text-[var(--brand-cream)] shadow-[0_10px_30px_rgba(26,10,48,0.35)] transition-all duration-300 hover:scale-[1.02] hover:shadow-2xl glass-panel sm:p-[var(--space-card-padding)]">
      <Link href={detailHref} className="group block" aria-label={`Ver detalle de ${product.name}`}>
        <div className="relative mb-[var(--space-card-content-gap)] aspect-square w-full overflow-hidden rounded-2xl border border-[var(--brand-gold-400)]/30 bg-[rgba(255,255,255,0.03)]">
          {thumb ? (
            <Image
              src={thumb}
              alt={product.name}
              fill
              className="object-cover"
              sizes="(max-width:640px) 50vw, (max-width:1024px) 33vw, 25vw"
            />
          ) : (
            <div className="flex h-full w-full items-center justify-center text-xs uppercase text-[var(--brand-gold-300)]">
              No image
            </div>
          )}
        </div>

        <div className="flex flex-1 flex-col gap-[var(--space-card-content-gap)]">
          <div className="min-h-[4.7rem] space-y-1.5 sm:space-y-2">
            <h3 className="line-clamp-2 text-sm font-semibold leading-snug sm:text-base">
              {product.name}
            </h3>
            <div className="text-sm font-semibold text-[var(--brand-cream)] sm:text-base">
              {formattedPrice}
            </div>
          </div>
        </div>
      </Link>

      <div className="mt-auto flex w-full justify-center">
        <button
          type="button"
          onClick={(event) => {
            event.preventDefault();
            event.stopPropagation();
            onQuickView?.(product);
          }}
          className={`${ACTION_SIZE_CLASS} flex items-center justify-center rounded-full border border-[var(--brand-gold-400)] bg-[var(--brand-violet-strong)] px-6 text-center text-sm font-semibold text-[var(--brand-cream)] shadow-[0_10px_25px_rgba(26,10,48,0.35)] transition hover:brightness-110 active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand-gold-300)]`}
          aria-label={`Comprar ${product.name}`}
        >
          Comprar
        </button>
      </div>
    </article>
  );
}
