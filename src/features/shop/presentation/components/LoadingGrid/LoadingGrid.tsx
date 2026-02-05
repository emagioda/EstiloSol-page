"use client";

export default function LoadingGrid() {
  const placeholders = Array.from({ length: 8 }, (_, index) => index);

  return (
    <div>
      <div className="mb-4 flex items-center gap-3 text-sm text-[var(--brand-gold-300)]/80">
        <span className="loading-dot" aria-hidden="true" />
        Cargando productos…
      </div>
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4">
        {placeholders.map((item) => (
          <div
            key={item}
            className="loading-card flex flex-col rounded-3xl p-3"
          >
            <div className="loading-block mb-3 h-40 w-full rounded-2xl" />
            <div className="loading-block mb-2 h-4 w-3/4 rounded-full" />
            <div className="loading-block h-4 w-1/2 rounded-full" />
            <div className="mt-4 flex items-center justify-end">
              <div className="loading-block h-8 w-20 rounded-full" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
