import { getJson, setJson } from "@/src/server/kv";
import type { StockStatus } from "@/src/features/shop/domain/entities/Product";
import { fetchProductsFromCatalogSource } from "./source";

export type CatalogProduct = {
  id: string;
  name: string;
  price: number;
  currency: "ARS";
  active: boolean;
  stock_status: StockStatus;
  stock_qty: number | null;
};

const CATALOG_CACHE_KEY = "es:catalog:products";
const CATALOG_CACHE_TTL = 120;

type GetProductsCatalogOptions = {
  forceFresh?: boolean;
};

export async function getProductsCatalog(
  options: GetProductsCatalogOptions = {},
): Promise<Map<string, CatalogProduct>> {
  const forceFresh = options.forceFresh === true;

  if (!forceFresh) {
    const cached = await getJson<CatalogProduct[]>(CATALOG_CACHE_KEY);
    if (cached && Array.isArray(cached)) {
      return new Map(cached.map((item) => [item.id, item]));
    }
  }

  const products = await fetchProductsFromCatalogSource({
    forceFresh,
    allowMockFallback: false,
  });
  const catalogProducts = products
    .filter((product) => product.active !== false)
    .filter((product) => product.currency === undefined || product.currency === "ARS")
    .map<CatalogProduct>((product) => ({
      id: product.id,
      name: product.name,
      price: Number(product.price.toFixed(2)),
      currency: "ARS",
      active: product.active !== false,
      stock_status: product.stock_status || "in_stock",
      stock_qty: typeof product.stock_qty === "number" ? product.stock_qty : null,
    }));

  await setJson(CATALOG_CACHE_KEY, catalogProducts, CATALOG_CACHE_TTL);

  return new Map(catalogProducts.map((item) => [item.id, item]));
}
