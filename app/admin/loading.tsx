export default function AdminLoading() {
  return (
    <section
      aria-live="polite"
      aria-busy="true"
      className="rounded-3xl border border-[var(--brand-gold-300)]/25 bg-[rgba(255,255,255,0.08)] p-6 shadow-[0_20px_42px_rgba(11,4,24,0.28)]"
    >
      <div className="flex min-h-[220px] flex-col items-center justify-center gap-4 text-center">
        <span
          className="inline-flex h-10 w-10 animate-spin items-center justify-center rounded-full border-2 border-[var(--brand-gold-300)]/40 border-t-[var(--brand-gold-300)]"
          aria-hidden
        />
        <div className="space-y-1">
          <p className="[font-family:var(--font-brand-display)] text-2xl text-[var(--brand-cream)]">
            Cargando
          </p>
          <p className="text-sm text-[var(--brand-cream)]/80">
            Estamos preparando la sección de administración.
          </p>
        </div>
      </div>
    </section>
  );
}

