import { describe, expect, it } from "vitest";

import { adaptSheetRowsToProducts, getStockLabel, isProductPurchasable } from "./productAdapter";

describe("productAdapter", () => {
  it("normalizes sheet rows into catalog products", () => {
    const products = adaptSheetRowsToProducts([
      {
        ID: "SKU-1",
        Nombre: "Ampolla Capilar",
        Precio: "3.500,00",
        old_price: "4500",
        active: "sí",
        departament: "peluquería",
        category: "Ampollitas",
        product_type: "ÚNICO",
        images_csv: "https://i.ibb.co/a.jpg, https://i.ibb.co/b.jpg",
        specs_csv: "Beneficio: Brillo, Cabello: Seco",
        stock_status: "in_stock",
        stock_qty: "4",
        is_new: "1",
      },
      {
        id: "",
        name: "Sin id",
        price: 1,
      },
      {
        id: "SKU-2",
        name: "Inactivo",
        price: 100,
        active: "no",
      },
    ]);

    expect(products).toHaveLength(1);
    expect(products[0]).toMatchObject({
      id: "SKU-1",
      name: "Ampolla Capilar",
      price: 3500,
      old_price: 4500,
      departament: "PELUQUERIA",
      category: "Ampollitas",
      product_type: "UNICO",
      is_new: true,
      is_sale: true,
      stock_status: "in_stock",
      stock_qty: 4,
    });
    expect(products[0].images).toEqual(["https://i.ibb.co/a.jpg", "https://i.ibb.co/b.jpg"]);
    expect(products[0].specifications).toEqual({ Beneficio: "Brillo", Cabello: "Seco" });
  });

  it("exposes stock helpers for controlled and uncontrolled stock", () => {
    expect(getStockLabel({ stock_status: "in_stock", stock_qty: 2 })).toBe("2 disponibles");
    expect(getStockLabel({ stock_status: "preorder", stock_qty: 5 })).toBe("5 disponibles");
    expect(getStockLabel({ stock_status: "preorder", stock_qty: null })).toBe("Preventa");
    expect(getStockLabel({ stock_status: "in_stock", stock_qty: null })).toBe("Disponible");
    expect(isProductPurchasable({ stock_status: "out_of_stock", stock_qty: 10 })).toBe(false);
    expect(isProductPurchasable({ stock_status: "in_stock", stock_qty: null })).toBe(true);
  });
});
