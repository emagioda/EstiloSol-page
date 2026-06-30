import { describe, expect, it } from "vitest";
import type { Product } from "@/src/features/shop/domain/entities/Product";
import { attachProductVariants, groupProductsForDisplay } from "./productVariants";

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
});
