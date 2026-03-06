"use client";

import Image from "next/image";

type CartAddedToastProps = {
  productName: string;
  image?: string;
  onViewCart: () => void;
};

export default function CartAddedToast({ productName, image, onViewCart }: CartAddedToastProps) {
  return (
    <div className="pointer-events-auto flex w-[min(92vw,420px)] items-center gap-3 rounded-2xl border border-white/20 bg-white px-3 py-2.5 shadow-xl shadow-black/20">
      <div className="relative h-12 w-12 shrink-0 overflow-hidden rounded-lg bg-slate-100">
        {image ? (
          <Image
            src={image}
            alt={productName}
            fill
            sizes="48px"
            className="object-cover"
          />
        ) : (
          <div className="grid h-full w-full place-items-center text-[10px] font-semibold uppercase tracking-wide text-slate-500">
            Sin foto
          </div>
        )}
      </div>

      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-semibold text-slate-900">Agregado al carrito</p>
        <p className="truncate text-xs text-slate-500">{productName}</p>
      </div>

      <button
        type="button"
        onClick={onViewCart}
        className="shrink-0 rounded-lg px-2.5 py-1.5 text-xs font-medium text-slate-700 underline decoration-slate-300 underline-offset-4 transition hover:text-slate-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-400"
      >
        Ver carrito
      </button>
    </div>
  );
}
