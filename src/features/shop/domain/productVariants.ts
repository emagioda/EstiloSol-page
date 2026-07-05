import type { Product, StockStatus } from "@/src/features/shop/domain/entities/Product";

const normalizeVariantText = (value: unknown): string => {
  if (typeof value !== "string") return "";
  return value.trim();
};

export const getProductGroupId = (product: Pick<Product, "group_id">): string | null => {
  const groupId = normalizeVariantText(product.group_id);
  return groupId ? groupId : null;
};

export const getProductVariantLabel = (
  product: Pick<Product, "variant_name" | "name">,
  fallbackIndex?: number,
): string => {
  const variantName = normalizeVariantText(product.variant_name);
  if (variantName) return variantName;
  if (typeof fallbackIndex === "number") return `Opcion ${fallbackIndex + 1}`;
  return normalizeVariantText(product.name) || "Opcion";
};

const INTERNAL_VARIANT_CODE_PATTERN = /^[A-Z]{1,3}\d{0,3}$/;
const SHORT_DESCRIPTIVE_VARIANT_WORDS = new Set(["ORO", "SOL"]);

const normalizeVariantCode = (value: string) =>
  value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]/gi, "")
    .toUpperCase();

const toReadableVariantLabel = (value: string) => {
  const compact = value.replace(/\s+/g, " ").trim();
  const hasLowerCase = compact !== compact.toLocaleUpperCase("es");
  const hasLetter = /[a-z]/i.test(compact);

  if (!hasLetter || hasLowerCase) return compact;

  return compact
    .toLocaleLowerCase("es")
    .replace(/(^|[\s/-])(\S)/g, (_match, separator: string, char: string) => {
      return `${separator}${char.toLocaleUpperCase("es")}`;
    });
};

export const getProductVariantDisplayLabel = (product: Pick<Product, "variant_name">): string | null => {
  const variantName = normalizeVariantText(product.variant_name);
  if (!variantName) return null;

  const normalizedCode = normalizeVariantCode(variantName);
  const looksLikeInternalCode =
    INTERNAL_VARIANT_CODE_PATTERN.test(normalizedCode) &&
    !SHORT_DESCRIPTIVE_VARIANT_WORDS.has(normalizedCode);

  return looksLikeInternalCode ? null : toReadableVariantLabel(variantName);
};

export const getProductVariants = (product: Product): Product[] => {
  if (!Array.isArray(product.variants) || product.variants.length === 0) {
    return [product];
  }

  return product.variants;
};

const isVariantPurchasable = (product: Pick<Product, "stock_status" | "stock_qty">): boolean => {
  if (product.stock_status === "out_of_stock") return false;
  if (typeof product.stock_qty === "number") return product.stock_qty > 0;
  return true;
};

const hasTrackedStock = (product: Product) => typeof product.stock_qty === "number";

const aggregateStockQty = (variants: Product[]): number | null => {
  if (!variants.every(hasTrackedStock)) return null;
  return variants.reduce((sum, variant) => sum + Math.max(0, Math.trunc(variant.stock_qty ?? 0)), 0);
};

const aggregateStockStatus = (variants: Product[], stockQty: number | null): StockStatus => {
  if (typeof stockQty === "number" && stockQty <= 0) return "out_of_stock";
  if (variants.some((variant) => isVariantPurchasable(variant))) return "in_stock";
  if (variants.some((variant) => variant.stock_status === "preorder")) return "preorder";
  return "out_of_stock";
};

const variantSortValue = (variant: Product) => {
  const label = getProductVariantLabel(variant);
  return label.localeCompare(variant.id, "es", { sensitivity: "base" }) === 0 ? variant.id : label;
};

export const sortProductVariants = (variants: Product[]): Product[] =>
  [...variants].sort((a, b) => variantSortValue(a).localeCompare(variantSortValue(b), "es", { sensitivity: "base" }));

export const attachProductVariants = (product: Product, allProducts: Product[]): Product => {
  const groupId = getProductGroupId(product);
  if (!groupId) return product;

  const variants = sortProductVariants(allProducts.filter((candidate) => getProductGroupId(candidate) === groupId));
  if (variants.length <= 1) return product;

  return {
    ...product,
    variants,
  };
};

export const groupProductsForDisplay = (products: Product[]): Product[] => {
  const grouped = new Map<string, Product[]>();
  const displayOrder: Array<{ type: "single"; product: Product } | { type: "group"; groupId: string }> = [];

  products.forEach((product) => {
    const groupId = getProductGroupId(product);
    if (!groupId) {
      displayOrder.push({ type: "single", product });
      return;
    }

    const variants = grouped.get(groupId) ?? [];
    if (variants.length === 0) {
      displayOrder.push({ type: "group", groupId });
    }
    variants.push(product);
    grouped.set(groupId, variants);
  });

  const displayGroups = new Map<string, Product>();
  grouped.forEach((variants, groupId) => {
    const sortedVariants = sortProductVariants(variants);
    const firstAvailableVariant = sortedVariants.find(isVariantPurchasable);
    const baseVariant = firstAvailableVariant ?? sortedVariants[0];
    const prices = sortedVariants
      .map((variant) => variant.price)
      .filter((price): price is number => typeof price === "number" && Number.isFinite(price));
    const lowestPrice = prices.length > 0 ? Math.min(...prices) : baseVariant.price;
    const oldPrices = sortedVariants
      .map((variant) => variant.old_price)
      .filter((price): price is number => typeof price === "number" && Number.isFinite(price));
    const highestOldPrice = oldPrices.length > 0 ? Math.max(...oldPrices) : baseVariant.old_price;
    const stockQty = aggregateStockQty(sortedVariants);

    displayGroups.set(groupId, {
      ...baseVariant,
      name: baseVariant.name,
      price: lowestPrice,
      old_price: highestOldPrice ?? null,
      images: baseVariant.images?.length ? baseVariant.images : sortedVariants.find((variant) => variant.images?.length)?.images,
      is_featured: sortedVariants.some((variant) => variant.is_featured),
      is_new: sortedVariants.some((variant) => variant.is_new),
      is_sale:
        sortedVariants.some((variant) => variant.is_sale) ||
        (typeof highestOldPrice === "number" && highestOldPrice > lowestPrice),
      stock_status: aggregateStockStatus(sortedVariants, stockQty),
      stock_qty: stockQty,
      variants: sortedVariants,
    });
  });

  return displayOrder.flatMap((item) => {
    if (item.type === "single") return [item.product];
    const group = displayGroups.get(item.groupId);
    return group ? [group] : [];
  });
};

export const hasProductVariants = (product: Product) => getProductVariants(product).length > 1;

export const areVariantPricesDifferent = (variants: Product[]) => {
  const prices = variants
    .map((variant) => variant.price)
    .filter((price): price is number => typeof price === "number" && Number.isFinite(price));
  return new Set(prices.map((price) => price.toFixed(2))).size > 1;
};
