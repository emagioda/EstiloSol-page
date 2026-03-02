"use client";
import { useEffect, useState } from "react";

interface StoreToolbarProps {
  searchTerm: string;
  onSearchChange: (term: string) => void;
  onFiltersClick?: () => void;
}

export default function StoreToolbar({
  searchTerm,
  onSearchChange,
  onFiltersClick,
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
    <div className="mb-4 flex items-center gap-2 rounded-xl border border-white/10 bg-white/5 p-3 shadow-[0_12px_28px_rgba(18,8,35,0.22)] md:mb-6 md:gap-4 md:rounded-2xl md:p-4 md:shadow-[0_15px_35px_rgba(18,8,35,0.25)]">
      {/* Search Input */}
      <div className="relative w-full flex-1">
        <label htmlFor="store-search" className="sr-only">
          Buscar productos
        </label>
        <input
          id="store-search"
          type="text"
          placeholder="Buscar productos..."
          value={localSearch}
          onChange={(e) => handleSearchChange(e.target.value)}
          className="w-full rounded-xl border border-white/20 bg-white/10 px-3.5 py-2 text-sm text-[var(--brand-cream)] placeholder-[var(--brand-cream)]/55 shadow-[inset_0_0_18px_rgba(18,8,35,0.25)] backdrop-blur-sm transition duration-200 focus:border-[var(--brand-gold-300)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand-gold-300)]/55 md:px-4 md:py-2.5"
        />
        <span className="absolute right-3 top-1/2 -translate-y-1/2 text-[var(--brand-gold-300)]/90">
          🔍
        </span>
      </div>

      {/* Right Section */}
      <div className="flex shrink-0 items-center">
        {/* Filters Button (Mobile) */}
        {onFiltersClick && (
          <button
            onClick={onFiltersClick}
            className="inline-flex items-center justify-center gap-1 rounded-lg border border-[var(--brand-violet-800)] bg-[var(--brand-violet-950)]/60 px-2 py-1.5 text-[11px] text-[var(--brand-cream)] shadow-[0_8px_20px_rgba(18,8,35,0.28)] transition duration-200 hover:-translate-y-0.5 hover:bg-[var(--brand-violet-900)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand-gold-300)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--brand-violet-900)] md:hidden"
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
