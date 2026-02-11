"use client";
import { useState } from "react";
import Image from "next/image";
import { ChevronLeft, ChevronRight } from "lucide-react";

interface ProductGalleryProps {
  images: string[];
  productName: string;
}

export const ProductGallery = ({ images, productName }: ProductGalleryProps) => {
  const [selectedIndex, setSelectedIndex] = useState(0);

  // Si no hay imágenes, mostramos un placeholder
  if (!images || images.length === 0) {
    return (
      <div className="aspect-square w-full rounded-2xl border border-[var(--brand-gold-400)]/30 bg-[rgba(255,255,255,0.03)] flex items-center justify-center text-[var(--brand-gold-300)]">
        Sin imagen
      </div>
    );
  }

  const handlePrev = () => {
    setSelectedIndex((prev) => (prev === 0 ? images.length - 1 : prev - 1));
  };

  const handleNext = () => {
    setSelectedIndex((prev) => (prev === images.length - 1 ? 0 : prev + 1));
  };

  return (
    <div className="flex flex-col gap-4">
      {/* IMAGEN PRINCIPAL */}
      <div className="relative aspect-square w-full overflow-hidden rounded-2xl border border-[var(--brand-gold-400)]/30 bg-[rgba(255,255,255,0.03)] shadow-lg group">
        <Image
          src={images[selectedIndex]}
          alt={`${productName} - imagen ${selectedIndex + 1}`}
          fill
          className="object-cover transition-transform duration-500"
          priority
          sizes="(max-width: 768px) 100vw, 50vw"
        />
        
        {/* FLECHAS DE NAVEGACIÓN (Solo si hay más de 1 imagen) */}
        {images.length > 1 && (
          <>
            <button
              onClick={(e) => { e.stopPropagation(); handlePrev(); }}
              className="absolute left-2 top-1/2 -translate-y-1/2 rounded-full bg-black/40 p-2 text-white hover:bg-[var(--brand-violet-strong)] transition-colors backdrop-blur-sm opacity-0 group-hover:opacity-100"
              aria-label="Imagen anterior"
            >
              <ChevronLeft size={24} />
            </button>
            <button
              onClick={(e) => { e.stopPropagation(); handleNext(); }}
              className="absolute right-2 top-1/2 -translate-y-1/2 rounded-full bg-black/40 p-2 text-white hover:bg-[var(--brand-violet-strong)] transition-colors backdrop-blur-sm opacity-0 group-hover:opacity-100"
              aria-label="Siguiente imagen"
            >
              <ChevronRight size={24} />
            </button>
          </>
        )}
      </div>

      {/* CARRUSEL DE MINIATURAS (THUMBNAILS) */}
      {images.length > 1 && (
        <div className="flex gap-3 overflow-x-auto pb-2 scrollbar-hide">
          {images.map((img, idx) => (
            <button
              key={idx}
              onClick={() => setSelectedIndex(idx)}
              className={`relative h-20 w-20 flex-shrink-0 overflow-hidden rounded-xl border-2 transition-all duration-200 ${
                idx === selectedIndex
                  ? "border-[var(--brand-gold-300)] opacity-100 scale-105 shadow-md"
                  : "border-transparent opacity-60 hover:opacity-100 hover:scale-105"
              }`}
            >
              <Image
                src={img}
                alt={`Miniatura ${idx + 1}`}
                fill
                className="object-cover"
                sizes="80px"
              />
            </button>
          ))}
        </div>
      )}
    </div>
  );
};