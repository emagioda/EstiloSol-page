export default function TurnosRoute() {
  return (
    <main className="flex min-h-[calc(100dvh-var(--header-height-mobile))] items-center justify-center bg-[var(--brand-violet-950)] px-6 text-center text-[var(--brand-cream)] md:min-h-[calc(100dvh-var(--header-height-desktop))]">
      <div className="max-w-xl rounded-2xl border border-[var(--brand-gold-400)]/30 bg-white/5 px-8 py-10 shadow-[0_16px_32px_rgba(10,4,20,0.28)] backdrop-blur-sm">
        <p className="text-xs font-medium uppercase tracking-[0.18em] text-[var(--brand-gold-300)]">
          Peluquería
        </p>
        <h1 className="mt-3 text-3xl font-semibold tracking-wide md:text-4xl">
          Próximamente
        </h1>
        <p className="mt-3 text-sm text-[var(--brand-cream)]/80 md:text-base">
          Estamos preparando esta sección para vos.
        </p>
      </div>
    </main>
  );
}
