"use client";

import Image, { type ImageProps } from "next/image";
import { useState } from "react";

type OptimizedImageWithFallbackProps = Omit<ImageProps, "alt" | "src" | "onError"> & {
  src?: string | null;
  alt: string;
  fallbackLabel?: string;
  fallbackClassName?: string;
};

type FailedAttempt = {
  src: string;
  stage: "direct" | "failed";
};

export default function OptimizedImageWithFallback({
  src,
  alt,
  fallbackLabel = "Sin imagen",
  fallbackClassName = "text-[var(--brand-gold-300)]",
  ...imageProps
}: OptimizedImageWithFallbackProps) {
  const [failedAttempt, setFailedAttempt] = useState<FailedAttempt | null>(null);
  const normalizedSrc = typeof src === "string" ? src.trim() : "";
  const failureStage =
    failedAttempt?.src === normalizedSrc ? failedAttempt.stage : "optimized";
  const shouldRenderImage = normalizedSrc.length > 0 && failureStage !== "failed";
  const shouldLoadDirectly = imageProps.unoptimized === true || failureStage === "direct";

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
      key={`${normalizedSrc}-${failureStage}`}
      {...imageProps}
      src={normalizedSrc}
      alt={alt}
      unoptimized={shouldLoadDirectly}
      onError={() => {
        setFailedAttempt((currentAttempt) => {
          const currentStage =
            currentAttempt?.src === normalizedSrc ? currentAttempt.stage : "optimized";

          if (imageProps.unoptimized === true || currentStage === "direct") {
            return { src: normalizedSrc, stage: "failed" };
          }

          return { src: normalizedSrc, stage: "direct" };
        });
      }}
    />
  );
}
