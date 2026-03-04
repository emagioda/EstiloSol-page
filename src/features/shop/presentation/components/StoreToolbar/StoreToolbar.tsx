"use client";
import { useEffect, useState } from "react";

interface StoreToolbarProps {
  searchTerm: string;
  onSearchChange: (term: string) => void;
  onFiltersClick?: () => void;
  onSortClick?: () => void;
}

export default function StoreToolbar({
  searchTerm,
  onSearchChange,
  onFiltersClick,
  onSortClick,
}: StoreToolbarProps) {
  const [localSearch, setLocalSearch] = useState(searchTerm);

  useEffect(() => {
    setLocalSearch(searchTerm);
  }, [searchTerm]);

  const handleSearchChange = (value: string) => {
    setLocalSearch(value);
    onSearchChange(value);
  };

  return (
    <div className="mb-1.5 flex flex-col gap-2 rounded-xl border border-white/10 bg-white/5 p-3 md:mb-4 md:gap-4 md:rounded-2xl md:p-4">
      {/* Search Input */}
      <div className="relative w-full flex-1">
        <label htmlFor="store-search" className="sr-only">
          Buscar productos
        </label>
        <input
          id="store-search"
          type="text"
          placeholder="¿Qué estás buscando?"
          value={localSearch}
          onChange={(e) => handleSearchChange(e.target.value)}
          className="w-full rounded-xl border border-white/20 bg-white/10 px-3.5 py-2 text-sm text-[var(--brand-cream)] placeholder-[var(--brand-cream)]/55 backdrop-blur-sm transition duration-200 focus:border-[var(--brand-gold-300)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand-gold-300)]/55 md:px-4 md:py-2.5"
        />
        <span className="absolute right-3 top-1/2 -translate-y-1/2 text-[var(--brand-gold-300)]/90">
          🔍
        </span>
      </div>

      {(onFiltersClick || onSortClick) && (
        <div className="grid w-full grid-cols-2 overflow-hidden rounded-lg border border-[var(--brand-violet-800)]/60 bg-[var(--brand-violet-950)]/45 md:hidden">
          {onFiltersClick && (
            <button
              onClick={onFiltersClick}
              className="inline-flex items-center justify-center gap-1.5 border-r border-[var(--brand-violet-800)]/65 px-2 py-2 text-[11px] text-[var(--brand-cream)] transition duration-200 hover:bg-[var(--brand-violet-900)]/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand-gold-300)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--brand-violet-900)]"
              aria-label="Abrir filtros"
            >
              <span aria-hidden>⚙️</span>
              Filtrar
            </button>
          )}
          {onSortClick && (
            <button
              onClick={onSortClick}
              className="inline-flex items-center justify-center gap-1.5 px-2 py-2 text-[11px] text-[var(--brand-cream)] transition duration-200 hover:bg-[var(--brand-violet-900)]/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand-gold-300)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--brand-violet-900)]"
              aria-label="Abrir orden"
            >
              <span aria-hidden>⇅</span>
              Ordenar
            </button>
          )}
        </div>
      )}

      <div className="hidden shrink-0 items-center md:flex">
        {onFiltersClick && (
          <button
            onClick={onFiltersClick}
            className="inline-flex items-center justify-center gap-1 rounded-lg border border-[var(--brand-violet-800)] bg-[var(--brand-violet-950)]/60 px-2 py-1.5 text-[11px] text-[var(--brand-cream)] transition duration-200 hover:-translate-y-0.5 hover:bg-[var(--brand-violet-900)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand-gold-300)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--brand-violet-900)]"
            aria-label="Abrir filtros"
          >
            <span>⚙️</span>
            Filtros
          </button>
        )}
      </div>
    </div>
  );
}
