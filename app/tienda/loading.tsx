import LoadingGrid from "@/src/features/shop/presentation/components/LoadingGrid/LoadingGrid";

export default function Loading() {
  return (
    <main className="mx-auto w-full max-w-7xl px-4 py-8 text-[var(--brand-cream)]">
      <header className="mb-8 animate-pulse">
        <div className="h-10 w-64 rounded bg-[var(--brand-gold-400)]/20 mb-3" />
        <div className="h-5 w-96 rounded bg-[var(--brand-gold-300)]/20" />
      </header>

      <div className="rounded-3xl border border-[var(--brand-gold-400)]/20 bg-[rgba(58,31,95,0.35)] p-4 md:p-6">
        {/* Reutilizamos tu componente de carga existente */}
        <LoadingGrid />
      </div>
    </main>
  );
}