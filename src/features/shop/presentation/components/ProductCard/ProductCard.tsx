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

export default function ProductCard({ product }: { product: Product }) {
  const { addItem, items, updateQty, removeItem } = useCart();
  const cartItem = items.find((it) => it.productId === product.id);

  const thumb = product.images && product.images.length > 0 ? product.images[0] : undefined;

  return (
    <article className="group flex flex-col rounded-3xl glass-panel p-3 text-[var(--brand-cream)] shadow-[0_10px_30px_rgba(26,10,48,0.35)] transition-all duration-300 hover:-translate-y-1 hover:shadow-[0_20px_45px_rgba(26,10,48,0.45)] animate-fade-up">
      <div className="relative mb-3 flex h-40 w-full items-center justify-center overflow-hidden rounded-2xl border border-[var(--brand-gold-400)]/30 bg-[rgba(255,255,255,0.03)]">
        {thumb ? (
          <Image
            src={thumb}
            alt={product.name}
            fill
            className="object-cover transition-transform duration-500 group-hover:scale-105"
            sizes="(max-width:640px) 100vw, 33vw"
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center text-xs uppercase text-[var(--brand-gold-300)]">No image</div>
        )}
      </div>
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1">
          <h3 className="text-sm font-medium line-clamp-2">{product.name}</h3>
          <div className="mt-2 text-sm font-semibold text-[var(--brand-cream)]">{product.price} {product.currency ?? 'ARS'}</div>
        </div>

        <div className="flex items-center gap-2">
          {cartItem ? (
            <div className="flex items-center gap-1 rounded-full border border-[var(--brand-gold-400)] bg-[var(--brand-violet-strong)] px-2 py-2 shadow-[0_8px_20px_rgba(26,10,48,0.35)] transition-transform duration-200 hover:-translate-y-0.5">
              <button
                onClick={() => {
                  if (cartItem.qty > 1) {
                    updateQty(product.id, cartItem.qty - 1);
                  } else {
                    removeItem(product.id);
                  }
                }}
                className="px-2 py-1 text-xs transition-transform duration-200 hover:scale-110 hover:brightness-125"
              >
                −
              </button>
              <span className="w-6 text-center text-xs font-semibold">{cartItem.qty}</span>
              <button
                onClick={() => addItem({ productId: product.id, name: product.name, unitPrice: product.price, qty: 1, image: thumb ?? '' })}
                className="px-2 py-1 text-xs transition-transform duration-200 hover:scale-110 hover:brightness-125"
              >
                +
              </button>
            </div>
          ) : (
            <button
              onClick={() => addItem({ productId: product.id, name: product.name, unitPrice: product.price, qty: 1, image: thumb ?? '' })}
              className="rounded-full border border-[var(--brand-gold-400)] bg-[var(--brand-violet-strong)] px-4 py-2 text-xs font-semibold text-[var(--brand-cream)] shadow-[0_10px_25px_rgba(26,10,48,0.35)] transition-transform duration-200 hover:-translate-y-0.5 hover:brightness-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand-gold-300)]"
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
