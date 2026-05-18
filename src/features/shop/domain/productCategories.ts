import type { Product } from "./entities/Product";

export const getProductCategories = (product: Pick<Product, "category">): string[] => {
  if (typeof product.category !== "string") return [];

  const categories = product.category
    .split(",")
    .map((category) => category.trim())
    .filter(Boolean);

  return Array.from(new Set(categories));
};

export const productBelongsToCategory = (
  product: Pick<Product, "category">,
  category: string | null,
) => {
  if (!category) return true;
  return getProductCategories(product).includes(category);
};

export const formatProductCategories = (product: Pick<Product, "category">) => {
  const categories = getProductCategories(product);
  return categories.length > 0 ? categories.join(" / ") : "General";
};
