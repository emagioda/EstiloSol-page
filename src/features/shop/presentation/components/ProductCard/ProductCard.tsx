"use client";
import Image from "next/image";
import { useCart } from "@/src/features/shop/presentation/view-models/useCartStore";

export type Product = {
  id: string;
  name: string;
  price: number;
  currency?: string;
  images?: string[];
  is_new?: boolean;
  is_sale?: boolean;
  [k: string]: unknown;
};

const ACTION_WIDTH_CLASS = "w-[170px] min-w-[170px]";

export default function ProductCard({ product }: { product: Product }) {
  const { addItem, items, updateQty, removeItem } = useCart();
  const cartItem = items.find((it) => it.productId === product.id);

  const thumb =
    product.images && product.images.length > 0 ? product.images[0] : undefined;

  return (
    <article className="flex flex-col rounded-3xl glass-panel p-[var(--space-card-padding)] text-[var(--brand-cream)] shadow-[0_10px_30px_rgba(26,10,48,0.35)] animate-fade-up">
      <div className="relative mb-[var(--space-card-content-gap)] flex h-44 w-full items-center justify-center overflow-hidden rounded-2xl border border-[var(--brand-gold-400)]/30 bg-[rgba(255,255,255,0.03)]">
        {thumb ? (
          <Image
            src={thumb}
            alt={product.name}
            fill
            className="object-cover"
            sizes="(max-width:640px) 100vw, 33vw"
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center text-xs uppercase text-[var(--brand-gold-300)]">
            No image
          </div>
        )}
      </div>

      <div className="flex flex-col gap-[var(--space-card-content-gap)]">
        <div className="space-y-2">
          <h3 className="line-clamp-2 text-base font-semibold leading-snug">
            {product.name}
          </h3>
          <div className="text-base font-semibold text-[var(--brand-cream)]">
            {product.price} {product.currency ?? "ARS"}
          </div>
        </div>

        <div className="flex w-full justify-center">
          {cartItem ? (
            <div
              className={`${ACTION_WIDTH_CLASS} flex items-center justify-between rounded-full border border-[var(--brand-gold-400)] bg-[var(--brand-violet-strong)] px-3 py-3 shadow-[0_8px_20px_rgba(26,10,48,0.35)]`}
            >
              <button
                onClick={() => {
                  if (cartItem.qty > 1) {
                    updateQty(product.id, cartItem.qty - 1);
                  } else {
                    removeItem(product.id);
                  }
                }}
                className="min-h-9 min-w-9 rounded-full text-base transition hover:brightness-125 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand-gold-300)]"
                aria-label={`Quitar una unidad de ${product.name}`}
              >
                −
              </button>
              <span className="w-10 text-center text-base font-semibold">
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
                className="min-h-9 min-w-9 rounded-full text-base transition hover:brightness-125 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand-gold-300)]"
                aria-label={`Agregar una unidad más de ${product.name}`}
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
              className={`${ACTION_WIDTH_CLASS} flex items-center justify-center rounded-full border border-[var(--brand-gold-400)] bg-[var(--brand-violet-strong)] px-6 py-3 text-center text-sm font-semibold text-[var(--brand-cream)] shadow-[0_10px_25px_rgba(26,10,48,0.35)] transition hover:brightness-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand-gold-300)]`}
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
