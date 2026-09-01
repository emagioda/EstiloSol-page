"use client";

import Image, { type ImageProps } from "next/image";
import { useState } from "react";

type OptimizedImageWithFallbackProps = Omit<ImageProps, "alt" | "src" | "onError"> & {
  src?: string | null;
  alt: string;
  fallbackLabel?: string;
  fallbackClassName?: string;
};

export default function OptimizedImageWithFallback({
  src,
  alt,
  fallbackLabel = "Sin imagen",
  fallbackClassName = "text-[var(--brand-gold-300)]",
  ...imageProps
}: OptimizedImageWithFallbackProps) {
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  const normalizedSrc = typeof src === "string" ? src.trim() : "";
  const shouldRenderImage = normalizedSrc.length > 0 && failedSrc !== normalizedSrc;

  if (!shouldRenderImage) {
    return (
      <div
        role="img"
        aria-label={`${alt}: imagen no disponible`}
        className={`flex h-full w-full items-center justify-center px-2 text-center text-[10px] font-semibold uppercase tracking-wide ${fallbackClassName}`}
      >
        {fallbackLabel}
      </div>
    );
  }

  return (
    <Image
      {...imageProps}
      src={normalizedSrc}
      alt={alt}
      onError={() => setFailedSrc(normalizedSrc)}
    />
  );
}
