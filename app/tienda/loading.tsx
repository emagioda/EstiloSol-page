import LoadingGrid from "@/src/features/shop/presentation/components/LoadingGrid/LoadingGrid";

export default function TiendaLoading() {
  return (
    <main className="min-h-screen bg-[var(--brand-violet-950)] px-4 py-24 text-[var(--brand-cream)]">
      <section className="mx-auto w-full max-w-7xl">
        <div className="mb-8 space-y-3">
          <div className="loading-block h-8 w-44 rounded-full" />
          <div className="loading-block h-4 w-full max-w-lg rounded-full" />
        </div>
        <LoadingGrid />
      </section>
    </main>
  );
}
