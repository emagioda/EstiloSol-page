"use client";
import { useState } from "react";

interface StoreToolbarProps {
  searchTerm: string;
  onSearchChange: (term: string) => void;
  onFiltersClick?: () => void;
  productCount: number;
}

export default function StoreToolbar({
  searchTerm,
  onSearchChange,
  onFiltersClick,
  productCount,
}: StoreToolbarProps) {
  const [localSearch, setLocalSearch] = useState(searchTerm);

  const handleSearchChange = (value: string) => {
    setLocalSearch(value);
    onSearchChange(value);
  };

  return (
    <div className="mb-6 flex flex-col gap-4 rounded-2xl border border-[var(--brand-gold-400)]/15 bg-[rgba(58,31,95,0.35)] p-4 shadow-[0_15px_35px_rgba(18,8,35,0.25)] md:flex-row md:items-center md:justify-between">
      {/* Search Input */}
      <div className="relative flex-1">
        <input
          type="text"
          placeholder="Buscar productos..."
          value={localSearch}
          onChange={(e) => handleSearchChange(e.target.value)}
          className="w-full rounded-lg border border-[var(--brand-violet-800)] bg-[var(--brand-violet-950)]/60 px-4 py-2 text-sm text-[var(--brand-cream)] placeholder-[var(--brand-cream)]/50 shadow-[inset_0_0_18px_rgba(18,8,35,0.35)] transition focus:border-[var(--brand-gold-300)] focus:outline-none focus:ring-2 focus:ring-[var(--brand-gold-300)]/40"
        />
        <span className="absolute right-3 top-1/2 -translate-y-1/2 text-[var(--brand-gold-300)]">
          🔍
        </span>
      </div>

      {/* Right Section */}
      <div className="flex flex-col items-start gap-3 sm:flex-row sm:items-center">
        {/* Product Count */}
        <span className="text-sm text-[var(--brand-cream)]/70">
          {productCount} producto{productCount !== 1 ? "s" : ""}
        </span>

        {/* Filters Button (Mobile) */}
        {onFiltersClick && (
          <button
            onClick={onFiltersClick}
            className="flex w-full items-center justify-center gap-2 rounded-lg border border-[var(--brand-violet-800)] bg-[var(--brand-violet-950)]/60 px-3 py-2 text-sm text-[var(--brand-cream)] shadow-[0_10px_25px_rgba(18,8,35,0.3)] transition-transform duration-200 hover:-translate-y-0.5 hover:bg-[var(--brand-violet-900)] sm:w-auto md:hidden"
          >
            <span>⚙️</span>
            Filtros
          </button>
        )}
      </div>
    </div>
  );
}
