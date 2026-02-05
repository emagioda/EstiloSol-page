"use client";
import Image from "next/image";
import { useCart } from "@/src/features/shop/presentation/view-models/useCartStore";

export type Product = {
  id: string;
  name: string;
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
  const { addItem, items, updateQty, removeItem } = useCart();
  const cartItem = items.find((it) => it.productId === product.id);

  const thumb =
    product.images && product.images.length > 0 ? product.images[0] : undefined;

  return (
    <article className="animate-fade-up flex flex-col rounded-3xl p-3 text-[var(--brand-cream)] shadow-[0_10px_30px_rgba(26,10,48,0.35)] glass-panel sm:p-[var(--space-card-padding)]">
      <div className="group relative mb-[var(--space-card-content-gap)] flex h-40 w-full items-center justify-center overflow-hidden rounded-2xl border border-[var(--brand-gold-400)]/30 bg-[rgba(255,255,255,0.03)] sm:h-44">
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

        <button
          type="button"
          onClick={() => onQuickView?.(product)}
          className="absolute inset-0 z-10 flex items-center justify-center bg-white/0 opacity-0 transition-all duration-300 group-hover:bg-white/65 group-hover:opacity-100 group-active:bg-white/65 group-active:opacity-100 focus-visible:bg-white/65 focus-visible:opacity-100"
          aria-label={`Abrir vista rápida de ${product.name}`}
        >
          <span className="inline-flex items-center gap-2 rounded-full bg-[var(--brand-violet-strong)]/90 px-3 py-2 text-[10px] font-semibold tracking-[0.14em] text-[var(--brand-cream)] sm:text-xs">
            <svg
              viewBox="0 0 24 24"
              className="h-4 w-4"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              aria-hidden="true"
            >
              <path d="M2 12s3.5-6 10-6 10 6 10 6-3.5 6-10 6-10-6-10-6Z" />
              <circle cx="12" cy="12" r="3" />
            </svg>
            VISTA RÁPIDA
          </span>
        </button>
      </div>

      <div className="flex flex-col gap-[var(--space-card-content-gap)]">
        <div className="space-y-1.5 sm:space-y-2">
          <h3 className="line-clamp-2 text-sm font-semibold leading-snug sm:text-base">
            {product.name}
          </h3>
          <div className="text-sm font-semibold text-[var(--brand-cream)] sm:text-base">
            {product.price} {product.currency ?? "ARS"}
          </div>
        </div>

        <div className="flex w-full justify-center">
          {cartItem ? (
            <div
              className={`${ACTION_SIZE_CLASS} flex items-center justify-between rounded-full border border-[var(--brand-gold-400)] bg-[var(--brand-violet-strong)] px-3 text-[var(--brand-cream)] shadow-[0_10px_25px_rgba(26,10,48,0.35)]`}
              aria-label={`Cantidad agregada de ${product.name}`}
            >
              <button
                onClick={() => {
                  if (cartItem.qty > 1) {
                    updateQty(product.id, cartItem.qty - 1);
                  } else {
                    removeItem(product.id);
                  }
                }}
                className="flex h-8 w-8 items-center justify-center rounded-full text-base font-semibold transition hover:brightness-125 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand-gold-300)]"
                aria-label={`Quitar una unidad de ${product.name}`}
              >
                -
              </button>
              <span className="w-10 text-center text-sm font-semibold">
                {cartItem.qty}
              </span>
              <button
                onClick={() =>
                  addItem({
                    productId: product.id,
                    name: product.name,
                    unitPrice: product.price,
                    qty: 1,
                    image: thumb ?? "",
                  })
                }
                className="flex h-8 w-8 items-center justify-center rounded-full text-base font-semibold transition hover:brightness-125 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand-gold-300)]"
                aria-label={`Agregar una unidad de ${product.name}`}
              >
                +
              </button>
            </div>
          ) : (
            <button
              onClick={() =>
                addItem({
                  productId: product.id,
                  name: product.name,
                  unitPrice: product.price,
                  qty: 1,
                  image: thumb ?? "",
                })
              }
              className={`${ACTION_SIZE_CLASS} flex items-center justify-center rounded-full border border-[var(--brand-gold-400)] bg-[var(--brand-violet-strong)] px-6 text-center text-sm font-semibold text-[var(--brand-cream)] shadow-[0_10px_25px_rgba(26,10,48,0.35)] transition hover:brightness-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand-gold-300)]`}
              aria-label={`Agregar ${product.name} al carrito`}
            >
              Agregar
            </button>
          )}
        </div>
      </div>
    </article>
  );
}
