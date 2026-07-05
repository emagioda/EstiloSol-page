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
    root: "border-white/12 bg-white/[0.045] text-[var(--brand-cream)] shadow-[inset_0_1px_0_rgba(255,255,255,0.06)]",
    eyebrow: "text-[var(--brand-gold-300)]",
    count: "text-[var(--brand-cream)]/58",
    option:
      "border-white/12 bg-white/[0.055] text-[var(--brand-cream)] shadow-[0_10px_24px_rgba(18,8,35,0.14)] hover:border-[var(--brand-gold-300)]/38 hover:bg-white/[0.085]",
    selected:
      "border-[var(--brand-gold-300)]/88 bg-[var(--brand-gold-300)]/12 text-[var(--brand-gold-300)] shadow-[0_14px_30px_rgba(18,8,35,0.24)]",
    thumb: "bg-white/10 ring-offset-[var(--brand-violet-950)]",
    selectedThumb: "ring-2 ring-[var(--brand-gold-300)]",
    dot: "border-[var(--brand-violet-950)] bg-[var(--brand-gold-300)]",
    label: "text-[var(--brand-cream)]/86",
    placeholder: "text-[var(--brand-gold-300)]/72",
    focus: "focus-visible:ring-[var(--brand-gold-300)] focus-visible:ring-offset-[var(--brand-violet-950)]",
  },
  quickview: {
    root: "border-[var(--brand-violet-950)]/12 bg-[var(--brand-violet-950)]/[0.035] text-[var(--brand-violet-950)] shadow-[inset_0_1px_0_rgba(255,255,255,0.62)]",
    eyebrow: "text-[var(--brand-violet-700)]",
    count: "text-[var(--brand-violet-950)]/48",
    option:
      "border-[var(--brand-violet-950)]/12 bg-white/72 text-[var(--brand-violet-950)] shadow-[0_10px_22px_rgba(58,31,95,0.08)] hover:border-[var(--brand-violet-950)]/30 hover:bg-white",
    selected:
      "border-[var(--brand-violet-950)]/82 bg-[var(--brand-violet-950)]/[0.075] text-[var(--brand-violet-950)] shadow-[0_13px_26px_rgba(58,31,95,0.15)]",
    thumb: "bg-[var(--brand-violet-950)]/8 ring-offset-[var(--brand-cream)]",
    selectedThumb: "ring-2 ring-[var(--brand-violet-950)]",
    dot: "border-white bg-[var(--brand-violet-950)]",
    label: "text-[var(--brand-violet-950)]/76",
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
  const hasAnyDisplayLabel = options.some((option) => Boolean(option.displayLabel));

  return (
    <fieldset className={cn("rounded-2xl border px-3 pb-2.5 pt-3", styles.root, className)}>
      <legend className="sr-only">Elegir diseño</legend>
      <div className="flex items-center justify-between gap-3 px-0.5">
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
        className="-mx-1 mt-2 flex snap-x snap-mandatory gap-2 overflow-x-auto overscroll-x-contain scroll-smooth px-1 pb-1.5 pt-0.5 scrollbar-hide"
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
                "group relative flex shrink-0 snap-start flex-col items-center gap-1.5 rounded-2xl border p-1.5 transition duration-200 ease-out focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-45",
                hasAnyDisplayLabel ? "min-h-[7rem] w-[6.25rem] sm:w-[6.5rem]" : "min-h-[4.9rem] w-[4.9rem]",
                selected ? styles.selected : styles.option,
                styles.focus,
              )}
            >
              <span
                className={cn(
                  "relative grid h-16 w-16 shrink-0 place-items-center overflow-hidden rounded-xl transition duration-200",
                  styles.thumb,
                  selected && styles.selectedThumb,
                  disabled && "grayscale",
                )}
              >
                {previewImage ? (
                  <Image
                    src={previewImage}
                    alt=""
                    fill
                    className="object-cover transition duration-300 group-hover:scale-105"
                    sizes="72px"
                  />
                ) : (
                  <span className={cn("px-1 text-center text-[10px] font-semibold uppercase", styles.placeholder)}>
                    Sin imagen
                  </span>
                )}
                {selected ? (
                  <span
                    aria-hidden="true"
                    className={cn(
                      "absolute right-1.5 top-1.5 h-3.5 w-3.5 rounded-full border-2 shadow-[0_3px_10px_rgba(18,8,35,0.24)]",
                      styles.dot,
                    )}
                  />
                ) : null}
                {disabled ? (
                  <span className="absolute inset-x-1 bottom-1 rounded-full bg-black/62 px-1 py-0.5 text-center text-[9px] font-bold uppercase tracking-[0.06em] text-white">
                    Sin stock
                  </span>
                ) : null}
              </span>

              {hasAnyDisplayLabel ? (
                <span
                  className={cn(
                    "line-clamp-2 min-h-8 w-full break-words text-center text-[11px] font-semibold leading-tight",
                    styles.label,
                  )}
                >
                  {displayLabel ?? ""}
                </span>
              ) : null}
            </button>
          );
        })}
      </div>
    </fieldset>
  );
}
