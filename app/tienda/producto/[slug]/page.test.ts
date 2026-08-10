import { describe, expect, it, vi } from "vitest";
import type { Product } from "@/src/features/shop/domain/entities/Product";

const catalog = vi.hoisted(() => ({ products: [] as Product[] }));

vi.mock("@/src/server/catalog/source", () => ({
  fetchProductsFromCatalogSource: vi.fn(async () => catalog.products),
}));

vi.mock("@/src/features/shop/presentation/pages/ProductDetail", () => ({
  default: () => null,
}));

vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("NOT_FOUND");
  },
}));

import ProductDetailRoute, { generateMetadata, generateStaticParams } from "./page";

const variant = (overrides: Partial<Product>): Product => ({
  id: "A",
  name: "Variante A",
  slug: "shared",
  price: 1000,
  currency: "ARS",
  stock_status: "out_of_stock",
  stock_qty: 0,
  group_id: "shared-group",
  variant_name: "Azul",
  images: ["https://example.test/a.webp"],
  ...overrides,
});

const getJsonLd = async (slug: string) => {
  const element = (await ProductDetailRoute({ params: Promise.resolve({ slug }) })) as unknown as {
    props: { children: Array<{ props: { dangerouslySetInnerHTML: { __html: string } } }> };
  };
  return JSON.parse(element.props.children[0].props.dangerouslySetInnerHTML.__html) as {
    sku: string;
    name: string;
    offers: { price: number; availability: string };
  };
};

describe("deterministic product route and metadata", () => {
  it("PR3-VAR-09 metadata resolves the same canonical variant as the page", async () => {
    catalog.products = [
      variant({ id: "B", name: "Variante B", variant_name: "Blanco", stock_status: "in_stock", stock_qty: 2, price: 2000 }),
      variant({ id: "A" }),
    ];
    const metadata = await generateMetadata({ params: Promise.resolve({ slug: "shared" }) });
    const jsonLd = await getJsonLd("shared");
    expect(metadata.title).toBe("Variante B");
    expect(jsonLd.sku).toBe("B");
  });

  it("PR3-VAR-10 JSON-LD uses the canonical variant ID, price and stock", async () => {
    catalog.products = [
      variant({ id: "B", name: "Variante B", variant_name: "Blanco", stock_status: "in_stock", stock_qty: 2, price: 2450 }),
      variant({ id: "A" }),
    ];
    const jsonLd = await getJsonLd("shared");
    expect(jsonLd).toMatchObject({
      sku: "B",
      name: "Variante B",
      offers: { price: 2450, availability: "https://schema.org/InStock" },
    });
  });

  it("PR3-VAR-11 static params deduplicate shared slugs", async () => {
    catalog.products = [
      variant({ id: "A", slug: "shared" }),
      variant({ id: "B", slug: "shared" }),
      variant({ id: "C", slug: "unique", group_id: undefined }),
    ];
    expect(await generateStaticParams()).toEqual([{ slug: "shared" }, { slug: "unique" }]);
  });
});
