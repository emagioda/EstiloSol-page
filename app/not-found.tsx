import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Página no encontrada",
};

export default function NotFound() {
  return (
    <main className="flex min-h-[calc(100dvh-var(--header-height-mobile))] items-center justify-center bg-[var(--brand-violet-950)] px-5 py-12 text-[var(--brand-cream)] md:min-h-[calc(100dvh-var(--header-height-desktop))] md:px-8">
      <section className="w-full max-w-2xl rounded-2xl border border-[var(--brand-gold-300)]/30 bg-white/5 px-6 py-9 text-center shadow-[0_18px_42px_rgba(24,9,44,0.28)] backdrop-blur-sm md:px-10 md:py-12">
        <p className="text-xs font-semibold uppercase tracking-[0.24em] text-[var(--brand-gold-300)]">
          Error 404
        </p>
        <h1 className="mt-4 text-3xl font-semibold leading-tight md:text-5xl">
          Página no encontrada
        </h1>
        <p className="mx-auto mt-4 max-w-lg text-sm leading-relaxed text-[var(--brand-cream)]/82 md:text-base">
          Esta sección no está disponible. Podés volver al inicio o seguir viendo los productos de Estilo Sol.
        </p>
        <div className="mt-8 flex flex-col justify-center gap-3 sm:flex-row">
          <Link
            href="/"
            className="inline-flex min-h-11 items-center justify-center rounded-lg bg-[var(--brand-gold-300)] px-5 text-sm font-semibold text-[#261238] shadow-[0_10px_24px_rgba(26,10,48,0.24)] transition hover:brightness-105 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand-gold-300)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--brand-violet-950)]"
          >
            Volver al inicio
          </Link>
          <Link
            href="/tienda"
            className="inline-flex min-h-11 items-center justify-center rounded-lg border border-[var(--brand-gold-300)]/45 px-5 text-sm font-semibold text-[var(--brand-cream)] transition hover:border-[var(--brand-gold-300)] hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand-gold-300)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--brand-violet-950)]"
          >
            Ir a la tienda
          </Link>
        </div>
      </section>
    </main>
  );
}
