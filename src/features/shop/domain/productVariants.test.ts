import { describe, expect, it } from "vitest";
import type { Product } from "@/src/features/shop/domain/entities/Product";
import {
  attachProductVariants,
  getProductVariantDisplayLabel,
  groupProductsForDisplay,
  resolveProductBySlugOrId,
  selectCanonicalProductVariant,
  sortProductVariants,
} from "./productVariants";

const baseVariant = (overrides: Partial<Product>): Product => ({
  id: "variant",
  name: "Choker Sirena",
  departament: "BIJOUTERIE",
  price: 10120,
  stock_status: "in_stock",
  stock_qty: 1,
  group_id: "choker-sirena",
  ...overrides,
});

describe("productVariants", () => {
  it("groups variants into one display product while keeping variant stock", () => {
    const products = [
      baseVariant({ id: "choker-sirena-bn", variant_name: "BN", stock_qty: 1 }),
      baseVariant({ id: "choker-sirena-t3", variant_name: "T3", stock_qty: 0, stock_status: "out_of_stock" }),
      baseVariant({ id: "choker-sirena-i3", variant_name: "I3", stock_qty: 2 }),
      {
        id: "collar-perlas",
        name: "Collar de Perlas",
        price: 7780,
        stock_status: "in_stock",
        stock_qty: 1,
      } satisfies Product,
    ];

    const grouped = groupProductsForDisplay(products);
    const choker = grouped.find((product) => product.group_id === "choker-sirena");

    expect(grouped).toHaveLength(2);
    expect(choker?.variants?.map((variant) => variant.id)).toEqual([
      "choker-sirena-bn",
      "choker-sirena-i3",
      "choker-sirena-t3",
    ]);
    expect(choker?.stock_qty).toBe(3);
    expect(choker?.stock_status).toBe("in_stock");
  });

  it("attaches sibling variants to a selected product", () => {
    const products = [
      baseVariant({ id: "choker-sirena-bn", variant_name: "BN" }),
      baseVariant({ id: "choker-sirena-t3", variant_name: "T3" }),
    ];

    expect(attachProductVariants(products[1], products).variants?.map((variant) => variant.variant_name)).toEqual([
      "BN",
      "T3",
    ]);
  });

  it("hides internal variant codes from the visual selector", () => {
    expect(getProductVariantDisplayLabel(baseVariant({ variant_name: "BN" }))).toBeNull();
    expect(getProductVariantDisplayLabel(baseVariant({ variant_name: "I3" }))).toBeNull();
    expect(getProductVariantDisplayLabel(baseVariant({ variant_name: "T3" }))).toBeNull();
    expect(getProductVariantDisplayLabel(baseVariant({ variant_name: "" }))).toBeNull();
  });

  it("keeps descriptive variant names readable", () => {
    expect(getProductVariantDisplayLabel(baseVariant({ variant_name: "perla dorada" }))).toBe("perla dorada");
    expect(getProductVariantDisplayLabel(baseVariant({ variant_name: "DORADO" }))).toBe("Dorado");
    expect(getProductVariantDisplayLabel(baseVariant({ variant_name: "ORO" }))).toBe("Oro");
  });

  it("PR3-VAR-01 produces the same sort for different source orders", () => {
    const a = baseVariant({ id: "A", variant_name: "Azul" });
    const b = baseVariant({ id: "B", variant_name: "Blanco" });
    const c = baseVariant({ id: "C", variant_name: "Coral" });
    expect(sortProductVariants([a, b, c]).map((variant) => variant.id)).toEqual(
      sortProductVariants([c, a, b]).map((variant) => variant.id),
    );
  });

  it("PR3-VAR-02 breaks equal labels by productId", () => {
    const variants = [
      baseVariant({ id: "20", variant_name: "Azul" }),
      baseVariant({ id: "3", variant_name: "Azul" }),
      baseVariant({ id: "1", variant_name: "Azul" }),
    ];
    expect(sortProductVariants(variants).map((variant) => variant.id)).toEqual(["1", "3", "20"]);
  });

  it("PR3-VAR-03 resolves a shared slug canonically independent of source order", () => {
    const a = baseVariant({ id: "A", slug: "shared", variant_name: "Azul" });
    const b = baseVariant({ id: "B", slug: "shared", variant_name: "Blanco" });
    expect(resolveProductBySlugOrId([a, b], "shared")?.id).toBe(
      resolveProductBySlugOrId([b, a], "shared")?.id,
    );
  });

  it("PR3-VAR-04 canonical selection prefers a purchasable variant", () => {
    const unavailable = baseVariant({
      id: "A",
      variant_name: "Azul",
      stock_status: "out_of_stock",
      stock_qty: 0,
    });
    const available = baseVariant({ id: "B", variant_name: "Blanco", stock_qty: 1 });
    expect(selectCanonicalProductVariant([unavailable, available])?.id).toBe("B");
  });

  it("PR3-VAR-05 canonical selection falls back to the first stable variant", () => {
    const b = baseVariant({ id: "B", variant_name: "Blanco", stock_status: "out_of_stock", stock_qty: 0 });
    const a = baseVariant({ id: "A", variant_name: "Azul", stock_status: "out_of_stock", stock_qty: 0 });
    expect(selectCanonicalProductVariant([b, a])?.id).toBe("A");
  });

  it("PR3-VAR-06 exact ID wins over a slug match", () => {
    const exactId = baseVariant({ id: "target", slug: "other", group_id: undefined });
    const slugMatch = baseVariant({ id: "another", slug: "target", group_id: undefined });
    expect(resolveProductBySlugOrId([slugMatch, exactId], "target")?.id).toBe("target");
  });

  it("PR3-VAR-07 unrelated duplicate slugs resolve deterministically", () => {
    const b = baseVariant({ id: "B", slug: "duplicate", group_id: "group-b" });
    const a = baseVariant({ id: "A", slug: "duplicate", group_id: "group-a" });
    expect(resolveProductBySlugOrId([b, a], "duplicate")?.id).toBe("A");
    expect(resolveProductBySlugOrId([a, b], "duplicate")?.id).toBe("A");
  });

  it("PR3-VAR-08 listing and route resolver choose the same canonical variant", () => {
    const unavailable = baseVariant({
      id: "A",
      slug: "shared",
      variant_name: "Azul",
      stock_status: "out_of_stock",
      stock_qty: 0,
    });
    const available = baseVariant({ id: "B", slug: "shared", variant_name: "Blanco", stock_qty: 1 });
    expect(groupProductsForDisplay([unavailable, available])[0].id).toBe(
      resolveProductBySlugOrId([available, unavailable], "shared")?.id,
    );
  });

  it("PR3-VAR-12 attachment preserves every ID in deterministic order", () => {
    const variants = [
      baseVariant({ id: "C", variant_name: "Coral" }),
      baseVariant({ id: "A", variant_name: "Azul" }),
      baseVariant({ id: "B", variant_name: "Blanco" }),
    ];
    expect(attachProductVariants(variants[0], variants).variants?.map((variant) => variant.id)).toEqual([
      "A",
      "B",
      "C",
    ]);
  });
});
