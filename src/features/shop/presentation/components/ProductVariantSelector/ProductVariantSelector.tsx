"use client";

import Image from "next/image";
import type { Product } from "@/src/features/shop/domain/entities/Product";
import { getProductVariantDisplayLabel } from "@/src/features/shop/domain/productVariants";
import { isProductPurchasable } from "@/src/features/shop/infrastructure/data/productAdapter";

type VariantSelectorTheme = "pdp" | "quickview";

type ProductVariantSelectorProps = {
  variants: Product[];
  selectedProductId: string;
  onSelectVariant: (productId: string) => void;
  theme?: VariantSelectorTheme;
  className?: string;
};

const cn = (...classes: Array<string | false | null | undefined>) => classes.filter(Boolean).join(" ");

const getPreviewImage = (product: Product) =>
  Array.isArray(product.images)
    ? product.images.find((image): image is string => typeof image === "string" && image.trim().length > 0)
    : undefined;

const themeClasses = {
  pdp: {
    root: "text-[var(--brand-cream)]",
    eyebrow: "text-[var(--brand-gold-300)]",
    count: "text-[var(--brand-cream)]/58",
    option:
      "bg-transparent text-[var(--brand-cream)] shadow-none ring-1 ring-white/18 hover:ring-[var(--brand-gold-300)]/55",
    selected:
      "bg-transparent text-[var(--brand-gold-300)] shadow-none ring-2 ring-[var(--brand-gold-300)] ring-offset-0",
    thumb: "bg-[var(--brand-cream)]",
    placeholder: "text-[var(--brand-gold-300)]/72",
    focus: "focus-visible:ring-[var(--brand-gold-300)] focus-visible:ring-offset-[var(--brand-violet-950)]",
  },
  quickview: {
    root: "text-[var(--brand-violet-950)]",
    eyebrow: "text-[var(--brand-violet-700)]",
    count: "text-[var(--brand-violet-950)]/48",
    option:
      "bg-transparent text-[var(--brand-violet-950)] shadow-none ring-1 ring-[var(--brand-violet-950)]/14 hover:ring-[var(--brand-violet-950)]/36",
    selected:
      "bg-transparent text-[var(--brand-violet-950)] shadow-none ring-2 ring-[var(--brand-violet-950)] ring-offset-0",
    thumb: "bg-[var(--brand-cream)]",
    placeholder: "text-[var(--brand-violet-950)]/46",
    focus: "focus-visible:ring-[var(--brand-violet-900)]/70 focus-visible:ring-offset-[var(--brand-cream)]",
  },
} satisfies Record<VariantSelectorTheme, Record<string, string>>;

export default function ProductVariantSelector({
  variants,
  selectedProductId,
  onSelectVariant,
  theme = "pdp",
  className,
}: ProductVariantSelectorProps) {
  if (variants.length <= 1) return null;

  const styles = themeClasses[theme];
  const options = variants.map((variant) => ({
    variant,
    displayLabel: getProductVariantDisplayLabel(variant),
    previewImage: getPreviewImage(variant),
    disabled: !isProductPurchasable(variant),
  }));
  const shouldFillAvailableWidth = variants.length > 5;

  return (
    <fieldset
      className={cn(
        "max-w-full",
        shouldFillAvailableWidth ? "w-full" : "w-fit max-w-full",
        styles.root,
        className,
      )}
    >
      <legend className="sr-only">Elegir diseño</legend>
      <div className="flex items-center justify-between gap-3">
        <p className={cn("text-[11px] font-bold uppercase tracking-[0.16em]", styles.eyebrow)}>
          Diseño
        </p>
        {variants.length > 3 ? (
          <span className={cn("text-[11px] font-semibold leading-none", styles.count)}>
            {variants.length} opciones
          </span>
        ) : null}
      </div>

      <div
        className="-mx-1.5 mt-2 flex snap-x snap-mandatory gap-2 overflow-x-auto overscroll-x-contain scroll-smooth px-1.5 py-1.5 scrollbar-hide"
        role="radiogroup"
        aria-label="Elegir diseño"
      >
        {options.map(({ variant, displayLabel, previewImage, disabled }, index) => {
          const selected = variant.id === selectedProductId;
          const accessibleLabel = displayLabel ?? `Diseño ${index + 1}`;

          return (
            <button
              key={variant.id}
              type="button"
              role="radio"
              aria-checked={selected}
              aria-label={`${selected ? "Diseno seleccionado" : "Elegir diseno"} ${accessibleLabel}${
                disabled ? ", sin stock" : ""
              }`}
              disabled={disabled}
              onClick={() => onSelectVariant(variant.id)}
              title={disabled ? `${accessibleLabel} sin stock` : `Elegir ${accessibleLabel}`}
              className={cn(
                "group relative flex h-24 w-[4.5rem] shrink-0 snap-start items-center justify-center overflow-hidden rounded-2xl transition duration-200 ease-out focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-45 sm:h-28 sm:w-[5.25rem]",
                selected ? styles.selected : styles.option,
                styles.focus,
              )}
            >
              <span
                className={cn(
                  "relative grid h-full w-full shrink-0 place-items-center overflow-hidden rounded-[calc(1rem-1px)] transition duration-200",
                  styles.thumb,
                  disabled && "grayscale",
                )}
              >
                {previewImage ? (
                  <Image
                    src={previewImage}
                    alt=""
                    fill
                    className="object-cover transition duration-300 group-hover:scale-105"
                    sizes="(min-width: 640px) 84px, 72px"
                  />
                ) : (
                  <span className={cn("px-1 text-center text-[10px] font-semibold uppercase", styles.placeholder)}>
                    Sin imagen
                  </span>
                )}
                {disabled ? (
                  <span className="absolute inset-x-1 bottom-1 rounded-full bg-black/62 px-1 py-0.5 text-center text-[9px] font-bold uppercase tracking-[0.06em] text-white">
                    Sin stock
                  </span>
                ) : null}
              </span>
            </button>
          );
        })}
      </div>
    </fieldset>
  );
}
