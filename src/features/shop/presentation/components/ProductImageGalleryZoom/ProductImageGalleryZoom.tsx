"use client";

/* eslint-disable @next/next/no-img-element */

import { type MouseEvent, useEffect, useMemo, useRef, useState } from "react";
import Lightbox from "yet-another-react-lightbox";
import Zoom from "yet-another-react-lightbox/plugins/zoom";
import "yet-another-react-lightbox/styles.css";

type Theme = "quickview" | "pdp";

type Props = {
  images: string[];
  productName: string;
  currentImageIndex: number;
  onImageIndexChange: (index: number) => void;
  theme?: Theme;
  thumbnailsDesktopOnly?: boolean;
  // when true, force the gallery layout to always stack vertically
  // (thumbnails below the main image) regardless of viewport size.
  alwaysColumn?: boolean;
};

export default function ProductImageGalleryZoom({
  images,
  productName,
  currentImageIndex,
  onImageIndexChange,
  theme = "pdp",
  thumbnailsDesktopOnly = false,
  alwaysColumn = false,
}: Props) {
  const SWIPE_THRESHOLD_PX = 40;
  const [zoomPosition, setZoomPosition] = useState({ x: 50, y: 50 });
  const [isLightboxOpen, setIsLightboxOpen] = useState(false);
  const [animationKey, setAnimationKey] = useState(0);
  const [slideDirection, setSlideDirection] = useState<'left' | 'right'>('right');
  const prevIndexRef = useRef(currentImageIndex);
  const pointerStartRef = useRef<{
    pointerId: number;
    x: number;
    y: number;
  } | null>(null);
  const swipeHandledRef = useRef(false);

  // when images array changes (new product or modal remount) we treat the
  // gallery as fresh: reset the previous index and clear the animation key so
  // the first picture renders without any transition.
  const prevImagesRef = useRef<string[]>(images);

  useEffect(() => {
    if (prevImagesRef.current !== images) {
      prevImagesRef.current = images;
      prevIndexRef.current = currentImageIndex;
      setAnimationKey(0);
      return;
    }

    if (prevIndexRef.current === currentImageIndex) {
      // nothing to do if index didn't change
      return;
    }

    const prevIndex = prevIndexRef.current;
    const len = images.length;

    // determine shortest direction on circular list
    let isMovingForward = true;
    if (len > 0) {
      const forwardSteps = (currentImageIndex - prevIndex + len) % len;
      const backwardSteps = (prevIndex - currentImageIndex + len) % len;
      isMovingForward = forwardSteps <= backwardSteps;
    }

    setSlideDirection(isMovingForward ? 'left' : 'right');
    prevIndexRef.current = currentImageIndex;
    setAnimationKey((prev) => prev + 1);
  }, [currentImageIndex, images]);

  // we intentionally **do not** suppress clicks after a swipe; the goal is
  // that a user can swipe to a new picture and then tap once (even very
  // quickly) to open the zoom view. the browser rarely delivers a click
  // event for a full horizontal drag, so accidental openings aren’t an issue.

  const hasMultipleImages = images.length > 1;
  const safeIndex = images.length
    ? Math.min(Math.max(currentImageIndex, 0), images.length - 1)
    : 0;
  const currentImage = images[safeIndex] ?? "";
  const slides = useMemo(() => images.map((src) => ({ src })), [images]);

  const nextImage = (event: MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation();
    if (!images.length) return;
    onImageIndexChange((safeIndex + 1) % images.length);
  };

  const prevImage = (event: MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation();
    if (!images.length) return;
    onImageIndexChange((safeIndex - 1 + images.length) % images.length);
  };

  const surfaceClassName =
    theme === "quickview"
      ? "bg-[#f7f7f7] shadow-sm rounded-md"
      : "rounded-2xl bg-[rgba(255,255,255,0.03)]";
  const placeholderClassName =
    theme === "quickview" ? "text-[#777]" : "text-[var(--brand-gold-300)]";

  const thumbnailWrapperClassName = alwaysColumn
    ? "mt-4 flex flex-row gap-2 overflow-x-auto"
    : thumbnailsDesktopOnly
    ? "mt-4 gap-2 md:mt-0 md:flex md:flex-col md:w-16 md:order-first"
    : "mt-4 grid grid-cols-5 gap-2 md:mt-0 md:w-16 md:flex-col md:flex md:order-first";

  // layout: normally we switch to row on md when thumbnails exist,
  // but the optional `alwaysColumn` prop forces a vertical stack.
  const galleryLayoutClassName = alwaysColumn
    ? "flex flex-col"
    : thumbnailsDesktopOnly || images.length > 1
    ? "flex flex-col md:flex-row md:gap-4 md:items-start"
    : "flex flex-col";

  const mainImageWrapperClassName = alwaysColumn
    ? `group relative aspect-[3/4] w-full md:flex-1 overflow-hidden ${surfaceClassName}`
    : `group relative aspect-[3/4] w-full md:flex-1 overflow-hidden md:order-last ${surfaceClassName}`;

  return (
    <>
      <div className={galleryLayoutClassName}>
        <div
          className={mainImageWrapperClassName}
          style={{ touchAction: "pan-y" }}
        onMouseMove={(event) => {
          const rect = event.currentTarget.getBoundingClientRect();
          const x = ((event.clientX - rect.left) / rect.width) * 100;
          const y = ((event.clientY - rect.top) / rect.height) * 100;
          setZoomPosition({ x, y });
        }}
        onMouseLeave={() => setZoomPosition({ x: 50, y: 50 })}
        onPointerDown={(event) => {
          if (!hasMultipleImages || event.pointerType === "mouse") return;
          pointerStartRef.current = {
            pointerId: event.pointerId,
            x: event.clientX,
            y: event.clientY,
          };
          swipeHandledRef.current = false;
          event.currentTarget.setPointerCapture(event.pointerId);
        }}
        onPointerMove={(event) => {
          const pointerStart = pointerStartRef.current;
          if (!pointerStart || pointerStart.pointerId !== event.pointerId) return;
          if (swipeHandledRef.current || !images.length) return;

          const deltaX = event.clientX - pointerStart.x;
          const deltaY = event.clientY - pointerStart.y;

          if (
            Math.abs(deltaX) >= SWIPE_THRESHOLD_PX &&
            Math.abs(deltaX) > Math.abs(deltaY)
          ) {
            onImageIndexChange(
              deltaX < 0
                ? (safeIndex + 1) % images.length
                : (safeIndex - 1 + images.length) % images.length,
            );
            swipeHandledRef.current = true;
          }
        }}
        onPointerUp={(event) => {
          if (event.currentTarget.hasPointerCapture(event.pointerId)) {
            event.currentTarget.releasePointerCapture(event.pointerId);
          }

          // if this gesture wasn't treated as a swipe and the pointer
          // didn't move much, consider it a tap and open the lightbox.
          // this runs even when the native click event is blocked (some
          // browsers don't emit one after a touch drag), so it makes the
          // "one tap after swipe" behaviour much more reliable.
          if (
            !swipeHandledRef.current &&
            pointerStartRef.current &&
            event.target === event.currentTarget
          ) {
            const dx = event.clientX - pointerStartRef.current.x;
            const dy = event.clientY - pointerStartRef.current.y;
            const distSq = dx * dx + dy * dy;
            const TAP_DIST_SQ = 25; // ~5px tolerance
            if (distSq < TAP_DIST_SQ && images.length) {
              setIsLightboxOpen(true);
            }
          }

          pointerStartRef.current = null;
          swipeHandledRef.current = false;
        }}
        onPointerCancel={(event) => {
          if (event.currentTarget.hasPointerCapture(event.pointerId)) {
            event.currentTarget.releasePointerCapture(event.pointerId);
          }

          pointerStartRef.current = null;
          swipeHandledRef.current = false;
        }}
        onClick={() => {
          if (!images.length) return;
          setIsLightboxOpen(true);
        }}
        role="button"
        tabIndex={0}
        aria-label="Ampliar imagen del producto"
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            if (!images.length) return;
            setIsLightboxOpen(true);
          }
        }}
      >
        {currentImage ? (
          <img
            key={`${currentImage}-${animationKey}`}
            src={currentImage}
            alt={productName}
            className={`absolute inset-0 h-full w/full object-cover transition-all duration-500 ease-out md:group-hover:scale-110 ${
              animationKey > 0
                ? slideDirection === 'left'
                  ? 'animate-slideInRight'
                  : 'animate-slideInLeft'
                : ''
            }`}
            style={{
              transformOrigin: `${zoomPosition.x}% ${zoomPosition.y}%`,
            }}
            loading="eager"
          />
        ) : (
          <div
            className={`flex h-full w-full items-center justify-center text-xs uppercase ${placeholderClassName}`}
          >
            Sin imagen
          </div>
        )}

        {hasMultipleImages && (
          <>
            <button
              type="button"
              onClick={prevImage}
              onPointerDown={(e) => e.stopPropagation()}
              onPointerUp={(e) => e.stopPropagation()}
              className="absolute left-2 top-1/2 z-10 -translate-y-1/2 rounded-full bg-black/30 p-2 text-white transition hover:bg-black/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/70"
              aria-label="Imagen anterior"
            >
              <svg
                viewBox="0 0 24 24"
                className="h-5 w-5"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
              >
                <path
                  d="M15 18 9 12l6-6"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </button>
            <button
              type="button"
              onClick={nextImage}
              onPointerDown={(e) => e.stopPropagation()}
              onPointerUp={(e) => e.stopPropagation()}
              className="absolute right-2 top-1/2 z-10 -translate-y-1/2 rounded-full bg-black/30 p-2 text-white transition hover:bg-black/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/70"
              aria-label="Imagen siguiente"
            >
              <svg
                viewBox="0 0 24 24"
                className="h-5 w-5"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
              >
                <path
                  d="m9 18 6-6-6-6"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </button>
          </>
        )}
      </div>

      {images.length > 0 && (
        <div className={thumbnailWrapperClassName}>
          {images.map((image, index) => (
            <button
              key={`${image}-${index}`}
              type="button"
              onClick={() => onImageIndexChange(index)}
              className="relative aspect-square shrink-0 cursor-pointer overflow-hidden rounded-md transition-all hover:opacity-100 md:border-2"
              style={{
                width: thumbnailsDesktopOnly || alwaysColumn ? "3.5rem" : "auto",
                height: thumbnailsDesktopOnly || alwaysColumn ? "3.5rem" : "auto",
                border:
                  index === safeIndex
                    ? theme === "quickview"
                      ? "2px solid var(--brand-violet-strong)"
                      : "2px solid var(--brand-gold-400)"
                    : "2px solid transparent",
                opacity: index === safeIndex ? 1 : 0.6,
              }}
              aria-label={`Ver imagen ${index + 1} de ${images.length}`}
            >
              <img
                src={image}
                alt={`${productName} miniatura ${index + 1}`}
                className="absolute inset-0 h-full w-full object-cover"
                loading="lazy"
              />
            </button>
          ))}
        </div>
      )}
      </div>

      <Lightbox
        open={isLightboxOpen && images.length > 0}
        close={() => setIsLightboxOpen(false)}
        slides={slides}
        plugins={[Zoom]}
        index={safeIndex}
        on={{
          view: ({ index }) => {
            if (typeof index !== "number") return;
            onImageIndexChange(index);
          },
        }}
        controller={{ closeOnBackdropClick: false }}
        render={{
          buttonPrev: hasMultipleImages ? undefined : () => null,
          buttonNext: hasMultipleImages ? undefined : () => null,
        }}
      />
    </>
  );
}
