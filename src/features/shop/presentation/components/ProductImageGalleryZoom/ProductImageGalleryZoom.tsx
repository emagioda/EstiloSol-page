"use client";

import {
  type MouseEvent,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import dynamic from "next/dynamic";
import OptimizedImageWithFallback from "../OptimizedImageWithFallback";

const ProductLightbox = dynamic(() => import("./ProductLightbox"), { ssr: false });
const PRODUCT_LIGHTBOX_HISTORY_KEY = "__estiloSolProductLightboxOpen";

const pushProductLightboxHistoryEntry = () => {
  if (typeof window === "undefined") return false;

  try {
    const currentState = window.history.state;
    const nextState =
      currentState && typeof currentState === "object"
        ? {
            ...(currentState as Record<string, unknown>),
            [PRODUCT_LIGHTBOX_HISTORY_KEY]: true,
          }
        : { [PRODUCT_LIGHTBOX_HISTORY_KEY]: true };

    window.history.pushState(nextState, "", window.location.href);
    return true;
  } catch {
    return false;
  }
};

const clearProductLightboxHistoryMarker = () => {
  if (typeof window === "undefined") return;

  try {
    const currentState = window.history.state;
    if (!currentState || typeof currentState !== "object") return;

    const currentRecord = currentState as Record<string, unknown>;
    if (!currentRecord[PRODUCT_LIGHTBOX_HISTORY_KEY]) return;

    const nextState = { ...currentRecord };
    delete nextState[PRODUCT_LIGHTBOX_HISTORY_KEY];
    window.history.replaceState(nextState, "", window.location.href);
  } catch {
    return;
  }
};

const isProductLightboxHistoryState = () => {
  if (typeof window === "undefined") return false;

  const currentState = window.history.state;
  return Boolean(
    currentState &&
      typeof currentState === "object" &&
      (currentState as Record<string, unknown>)[PRODUCT_LIGHTBOX_HISTORY_KEY]
  );
};

type Theme = "quickview" | "pdp";

type CarouselDirection = "next" | "previous";

type CarouselTransition = {
  id: number;
  fromIndex: number;
  toIndex: number;
  direction: CarouselDirection;
  phase: "preparing" | "running";
};

const CAROUSEL_TRANSITION_MS = 280;

const hasSameImages = (currentImages: string[], nextImages: string[]) =>
  currentImages.length === nextImages.length &&
  currentImages.every((image, index) => image === nextImages[index]);

type Props = {
  images: string[];
  productName: string;
  currentImageIndex: number;
  onImageIndexChange: (index: number) => void;
  theme?: Theme;
  // when true, force the gallery layout to always stack vertically
  // (thumbnails below the main image) regardless of viewport size.
  alwaysColumn?: boolean;
  priority?: boolean;
};

export default function ProductImageGalleryZoom({
  images,
  productName,
  currentImageIndex,
  onImageIndexChange,
  theme = "pdp",
  alwaysColumn = false,
  priority = false,
}: Props) {
  const SWIPE_THRESHOLD_PX = 40;
  const hasMultipleImages = images.length > 1;
  const safeIndex = images.length
    ? Math.min(Math.max(currentImageIndex, 0), images.length - 1)
    : 0;
  const [zoomPosition, setZoomPosition] = useState({ x: 50, y: 50 });
  const [isLightboxOpen, setIsLightboxOpen] = useState(false);
  const [displayedImageIndex, setDisplayedImageIndex] = useState(safeIndex);
  const [carouselTransition, setCarouselTransition] =
    useState<CarouselTransition | null>(null);
  const [imageSetSnapshot, setImageSetSnapshot] = useState(() => ({
    images: [...images],
    resetIndex: safeIndex,
  }));
  const [prefersReducedMotion, setPrefersReducedMotion] = useState(() =>
    typeof window !== "undefined" && typeof window.matchMedia === "function"
      ? window.matchMedia("(prefers-reduced-motion: reduce)").matches
      : false,
  );
  const lightboxHistoryEntryRef = useRef(false);
  const displayedImageIndexRef = useRef(safeIndex);
  const carouselTransitionRef = useRef<CarouselTransition | null>(null);
  const transitionIdRef = useRef(0);
  const animationFrameRef = useRef<number | null>(null);
  const transitionTimeoutRef = useRef<number | null>(null);
  const pointerStartRef = useRef<{
    pointerId: number;
    x: number;
    y: number;
  } | null>(null);
  const swipeHandledRef = useRef(false);

  if (!hasSameImages(imageSetSnapshot.images, images)) {
    setImageSetSnapshot({ images: [...images], resetIndex: safeIndex });
    setDisplayedImageIndex(safeIndex);
    setCarouselTransition(null);
  }

  // we intentionally **do not** suppress clicks after a swipe; the goal is
  // that a user can swipe to a new picture and then tap once (even very
  // quickly) to open the zoom view. the browser rarely delivers a click
  // event for a full horizontal drag, so accidental openings aren’t an issue.
  const slides = useMemo(() => images.map((src) => ({ src })), [images]);

  const clearTransitionScheduling = useCallback(() => {
    if (animationFrameRef.current !== null) {
      window.cancelAnimationFrame?.(animationFrameRef.current);
      animationFrameRef.current = null;
    }

    if (transitionTimeoutRef.current !== null) {
      window.clearTimeout(transitionTimeoutRef.current);
      transitionTimeoutRef.current = null;
    }
  }, []);

  useLayoutEffect(() => {
    clearTransitionScheduling();
    transitionIdRef.current += 1;
    displayedImageIndexRef.current = imageSetSnapshot.resetIndex;
    carouselTransitionRef.current = null;
  }, [clearTransitionScheduling, imageSetSnapshot]);

  const completeCarouselTransition = useCallback(
    (transitionId: number) => {
      const currentTransition = carouselTransitionRef.current;
      if (!currentTransition || currentTransition.id !== transitionId) return;

      clearTransitionScheduling();
      displayedImageIndexRef.current = currentTransition.toIndex;
      carouselTransitionRef.current = null;
      setDisplayedImageIndex(currentTransition.toIndex);
      setCarouselTransition(null);
    },
    [clearTransitionScheduling],
  );

  const settleOnImageIndex = useCallback(
    (nextIndex: number) => {
      clearTransitionScheduling();
      displayedImageIndexRef.current = nextIndex;
      carouselTransitionRef.current = null;
      setDisplayedImageIndex(nextIndex);
      setCarouselTransition(null);
    },
    [clearTransitionScheduling],
  );

  const startCarouselTransition = useCallback(
    (fromIndex: number, toIndex: number, direction: CarouselDirection) => {
      clearTransitionScheduling();

      const nextTransition: CarouselTransition = {
        id: transitionIdRef.current + 1,
        fromIndex,
        toIndex,
        direction,
        phase: "preparing",
      };
      transitionIdRef.current = nextTransition.id;
      carouselTransitionRef.current = nextTransition;
      setCarouselTransition(nextTransition);

      animationFrameRef.current = window.requestAnimationFrame(() => {
        animationFrameRef.current = null;
        const currentTransition = carouselTransitionRef.current;
        if (!currentTransition || currentTransition.id !== nextTransition.id) return;

        const runningTransition = {
          ...currentTransition,
          phase: "running" as const,
        };
        carouselTransitionRef.current = runningTransition;
        setCarouselTransition(runningTransition);
        transitionTimeoutRef.current = window.setTimeout(
          () => completeCarouselTransition(nextTransition.id),
          CAROUSEL_TRANSITION_MS + 100,
        );
      });
    },
    [clearTransitionScheduling, completeCarouselTransition],
  );

  useEffect(() => {
    if (typeof window.matchMedia !== "function") return;

    const reducedMotionQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
    const updateReducedMotionPreference = () => {
      setPrefersReducedMotion(reducedMotionQuery.matches);
    };

    updateReducedMotionPreference();
    reducedMotionQuery.addEventListener?.("change", updateReducedMotionPreference);
    return () => {
      reducedMotionQuery.removeEventListener?.("change", updateReducedMotionPreference);
    };
  }, []);

  useEffect(() => {
    const currentTransition = carouselTransitionRef.current;
    const currentTargetIndex =
      currentTransition?.toIndex ?? displayedImageIndexRef.current;

    if (!hasMultipleImages || prefersReducedMotion) {
      if (!currentTransition && safeIndex === displayedImageIndexRef.current) return;

      const frameId = window.requestAnimationFrame(() => settleOnImageIndex(safeIndex));
      return () => window.cancelAnimationFrame?.(frameId);
    }

    if (safeIndex === currentTargetIndex) return;

    const frameId = window.requestAnimationFrame(() =>
      startCarouselTransition(
        currentTargetIndex,
        safeIndex,
        safeIndex > currentTargetIndex ? "next" : "previous",
      ),
    );
    return () => window.cancelAnimationFrame?.(frameId);
  }, [
    hasMultipleImages,
    prefersReducedMotion,
    safeIndex,
    settleOnImageIndex,
    startCarouselTransition,
  ]);

  useEffect(() => clearTransitionScheduling, [clearTransitionScheduling]);

  const openLightbox = useCallback(() => {
    if (!images.length) return;

    setIsLightboxOpen(true);
    if (!lightboxHistoryEntryRef.current && pushProductLightboxHistoryEntry()) {
      lightboxHistoryEntryRef.current = true;
    }
  }, [images.length]);

  const closeLightbox = useCallback(() => {
    setIsLightboxOpen(false);

    if (!lightboxHistoryEntryRef.current) return;
    if (typeof window === "undefined") return;

    lightboxHistoryEntryRef.current = false;
    window.history.back();
  }, []);

  useEffect(() => {
    const onPopState = () => {
      if (isProductLightboxHistoryState()) {
        lightboxHistoryEntryRef.current = true;
        setIsLightboxOpen(true);
        return;
      }

      if (!lightboxHistoryEntryRef.current) return;

      lightboxHistoryEntryRef.current = false;
      setIsLightboxOpen(false);
    };

    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);

  useEffect(() => {
    return () => {
      lightboxHistoryEntryRef.current = false;
      clearProductLightboxHistoryMarker();
    };
  }, []);

  const changeImageIndex = (
    nextIndex: number,
    requestedDirection?: CarouselDirection,
  ) => {
    if (!images.length) {
      onImageIndexChange(nextIndex);
      return;
    }

    const normalizedNextIndex = Math.min(Math.max(nextIndex, 0), images.length - 1);
    const currentTargetIndex =
      carouselTransitionRef.current?.toIndex ?? displayedImageIndexRef.current;

    if (normalizedNextIndex === currentTargetIndex) {
      onImageIndexChange(normalizedNextIndex);
      return;
    }

    if (hasMultipleImages && !prefersReducedMotion) {
      startCarouselTransition(
        currentTargetIndex,
        normalizedNextIndex,
        requestedDirection ??
          (normalizedNextIndex > currentTargetIndex ? "next" : "previous"),
      );
    } else {
      settleOnImageIndex(normalizedNextIndex);
    }

    onImageIndexChange(normalizedNextIndex);
  };

  const nextImage = (event: MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation();
    if (!images.length) return;
    const currentTargetIndex =
      carouselTransitionRef.current?.toIndex ?? displayedImageIndexRef.current;
    changeImageIndex((currentTargetIndex + 1) % images.length, "next");
  };

  const prevImage = (event: MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation();
    if (!images.length) return;
    const currentTargetIndex =
      carouselTransitionRef.current?.toIndex ?? displayedImageIndexRef.current;
    changeImageIndex(
      (currentTargetIndex - 1 + images.length) % images.length,
      "previous",
    );
  };

  const surfaceClassName =
    theme === "quickview"
      ? "bg-[#f7f7f7] shadow-sm rounded-md"
      : "rounded-2xl bg-[rgba(255,255,255,0.03)]";
  const placeholderClassName =
    theme === "quickview" ? "text-[#777]" : "text-[var(--brand-gold-300)]";

  const thumbnailWrapperClassName = alwaysColumn
    ? "mt-4 flex flex-row gap-2 overflow-x-auto pb-1"
    : "mt-4 flex gap-2 overflow-x-auto pb-1 md:order-first md:mt-0 md:w-16 md:flex-col md:overflow-y-auto md:pb-0";

  // Use the same desktop gallery layout even for a single image, so the
  // thumbnail rail never jumps above the main product photo on PDP pages.
  const galleryLayoutClassName = alwaysColumn
    ? "flex flex-col"
    : images.length > 0
    ? "flex flex-col md:flex-row md:gap-4 md:items-start"
    : "flex flex-col";

  const mainImageWrapperClassName = alwaysColumn
    ? `group relative aspect-[3/4] w-full md:flex-1 overflow-hidden ${surfaceClassName}`
    : `group relative aspect-[3/4] w-full md:flex-1 overflow-hidden md:order-last ${surfaceClassName}`;

  const activeDisplayedIndex = images.length
    ? Math.min(Math.max(displayedImageIndex, 0), images.length - 1)
    : 0;
  const visibleMainSlides = carouselTransition
    ? [
        {
          index: carouselTransition.fromIndex,
          role: "outgoing" as const,
          transform:
            carouselTransition.phase === "running"
              ? `translate3d(${carouselTransition.direction === "next" ? "-100%" : "100%"}, 0, 0)`
              : "translate3d(0, 0, 0)",
        },
        {
          index: carouselTransition.toIndex,
          role: "incoming" as const,
          transform:
            carouselTransition.phase === "running"
              ? "translate3d(0, 0, 0)"
              : `translate3d(${carouselTransition.direction === "next" ? "100%" : "-100%"}, 0, 0)`,
        },
      ]
    : [
        {
          index: activeDisplayedIndex,
          role: "active" as const,
          transform: "translate3d(0, 0, 0)",
        },
      ];

  return (
    <>
      <div className={galleryLayoutClassName}>
        <div
          className={mainImageWrapperClassName}
          style={{ touchAction: "pan-y" }}
          data-carousel-direction={carouselTransition?.direction}
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
            const currentTargetIndex =
              carouselTransitionRef.current?.toIndex ?? displayedImageIndexRef.current;
            changeImageIndex(
              deltaX < 0
                ? (currentTargetIndex + 1) % images.length
                : (currentTargetIndex - 1 + images.length) % images.length,
              deltaX < 0 ? "next" : "previous",
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
              openLightbox();
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
          openLightbox();
        }}
        role="button"
        tabIndex={0}
        aria-label="Ampliar imagen del producto"
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            if (!images.length) return;
            openLightbox();
          }
        }}
      >
        {visibleMainSlides.map((mainSlide) => (
          <div
            key={`main-slide-${mainSlide.index}`}
            className={`pointer-events-none absolute inset-0 ${
              carouselTransition
                ? "will-change-transform transition-transform duration-[280ms] ease-out motion-reduce:transition-none"
                : ""
            }`}
            style={{ transform: mainSlide.transform }}
            data-gallery-slide={mainSlide.role}
            aria-hidden={mainSlide.role === "outgoing" ? "true" : undefined}
            onTransitionEnd={(event) => {
              if (
                mainSlide.role !== "incoming" ||
                event.target !== event.currentTarget ||
                event.propertyName !== "transform" ||
                !carouselTransition
              ) {
                return;
              }

              completeCarouselTransition(carouselTransition.id);
            }}
          >
            <OptimizedImageWithFallback
              src={images[mainSlide.index]}
              alt={`${productName}, imagen ${mainSlide.index + 1} de ${Math.max(images.length, 1)}`}
              fill
              className="object-cover transition-transform duration-500 ease-out md:group-hover:scale-105"
              style={{ transformOrigin: `${zoomPosition.x}% ${zoomPosition.y}%` }}
              sizes={
                alwaysColumn
                  ? "(max-width: 640px) calc(100vw - 3.5rem), 50vw"
                  : "(max-width: 1024px) calc(100vw - 2.5rem), 44vw"
              }
              priority={priority}
              loading={priority ? "eager" : "lazy"}
              fetchPriority={priority ? "high" : "auto"}
              fallbackClassName={placeholderClassName}
            />
          </div>
        ))}

        {hasMultipleImages && (
          <>
            <button
              type="button"
              onClick={prevImage}
              onPointerDown={(e) => e.stopPropagation()}
              onPointerUp={(e) => e.stopPropagation()}
              className="absolute left-2 top-1/2 z-10 -translate-y-1/2 rounded-full bg-black/55 p-2 text-white transition hover:bg-black/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand-gold-300)]"
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
              className="absolute right-2 top-1/2 z-10 -translate-y-1/2 rounded-full bg-black/55 p-2 text-white transition hover:bg-black/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand-gold-300)]"
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
              onClick={() => changeImageIndex(index)}
              className="relative aspect-square shrink-0 cursor-pointer overflow-hidden rounded-md transition-all hover:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand-gold-300)] md:border-2"
              style={{
                width: "3.5rem",
                height: "3.5rem",
                border:
                  index === safeIndex
                    ? theme === "quickview"
                      ? "2px solid var(--brand-violet-strong)"
                      : "2px solid var(--brand-gold-400)"
                    : "2px solid transparent",
                opacity: index === safeIndex ? 1 : 0.6,
              }}
              aria-label={`Ver imagen ${index + 1} de ${images.length}`}
              aria-current={index === safeIndex ? "true" : undefined}
            >
              <OptimizedImageWithFallback
                src={image}
                alt={`${productName} miniatura ${index + 1}`}
                fill
                className="object-cover"
                sizes="56px"
                fallbackClassName={placeholderClassName}
              />
            </button>
          ))}
        </div>
      )}
      </div>

      {isLightboxOpen && images.length > 0 ? (
        <ProductLightbox
          open={isLightboxOpen}
          onClose={closeLightbox}
          slides={slides}
          index={safeIndex}
          hasMultipleImages={hasMultipleImages}
          onViewIndex={changeImageIndex}
        />
      ) : null}
    </>
  );
}
