"use client";

import LoadingGrid from "@/src/features/shop/presentation/components/LoadingGrid/LoadingGrid";

export default function Loading() {
  return (
    <main className="mx-auto w-full max-w-7xl px-4 py-8 text-[var(--brand-cream)]">
      <header className="mb-8">
        <h1 className="text-3xl font-semibold text-[var(--brand-cream)]">
          Tienda de Bijouterie
        </h1>
        <p className="mt-3 max-w-2xl text-sm text-[var(--brand-gold-300)]">
          Estamos preparando la tienda para vos.
        </p>
      </header>
      <section className="flex flex-col gap-6 rounded-3xl border border-[var(--brand-gold-400)]/20 bg-[rgba(58,31,95,0.35)] p-4 shadow-[0_20px_50px_rgba(18,8,35,0.35)] md:gap-8 md:p-6">
        <LoadingGrid />
      </section>
    </main>
  );
}
