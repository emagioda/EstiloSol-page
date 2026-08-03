import { describe, expect, it } from "vitest";
import { parseCheckoutBody, parseExternalReference } from "@/src/server/validation/payments";

describe("payments validation", () => {
  it("parses a valid checkout body", () => {
    const result = parseCheckoutBody({
      items: [{ productId: "abc-1", qty: 2 }],
      payer: { name: "Ana Perez", phone: "+54 11 1234-5678", email: "ana@example.com" },
      notes: "Sin apuro",
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value.items).toHaveLength(1);
    expect(result.value.items[0]).toEqual({ productId: "abc-1", qty: 2, requestedUnitPrices: [] });
    expect(result.value.payerName).toBe("Ana Perez");
    expect(result.value.payerPhone).toBe("+541112345678");
    expect(result.value.payerEmail).toBe("ana@example.com");
    expect(result.value.notes).toBe("Sin apuro");
  });

  it("rejects invalid checkout body", () => {
    const result = parseCheckoutBody({
      items: [{ productId: "", qty: 0 }],
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe("INVALID_ITEMS");
  });

  it("validates external reference format", () => {
    expect(parseExternalReference("es-123456-abcd").ok).toBe(true);
    expect(parseExternalReference("bad-ref").ok).toBe(false);
  });

  it("requires payer fields when configured", () => {
    const result = parseCheckoutBody(
      {
        items: [{ productId: "abc-1", qty: 1 }],
      },
      { requirePayer: true }
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.message).toContain("Completa nombre y WhatsApp");
  });

  it("rejects invalid payer email", () => {
    const result = parseCheckoutBody({
      items: [{ productId: "abc-1", qty: 1 }],
      payer: { name: "Ana Perez", phone: "+54 11 1234-5678", email: "bad-email" },
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.message).toContain("email");
  });

  it("rejects delivery checkout without required address fields", () => {
    const result = parseCheckoutBody(
      {
        items: [{ productId: "abc-1", qty: 1 }],
        deliveryMethod: "delivery",
        fulfillment: {
          deliveryAddress: {
            street: "San Lorenzo",
            number: "",
            betweenStreets: "Mitre y Entre Rios",
            insideZoneConfirmed: true,
          },
        },
      },
      { requireFulfillment: true }
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.message).toBe("Ingresá el número.");
  });

  it("rejects delivery checkout without zone confirmation", () => {
    const result = parseCheckoutBody(
      {
        items: [{ productId: "abc-1", qty: 1 }],
        deliveryMethod: "delivery",
        fulfillment: {
          deliveryAddress: {
            street: "San Lorenzo",
            number: "1234",
            betweenStreets: "Mitre y Entre Rios",
            insideZoneConfirmed: false,
          },
        },
      },
      { requireFulfillment: true }
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.message).toBe("Confirmá que la dirección está dentro de la zona de envío.");
  });

  it("parses pickup point id for fulfillment validation downstream", () => {
    const result = parseCheckoutBody(
      {
        items: [{ productId: "abc-1", qty: 1 }],
        deliveryMethod: "pickup",
        fulfillment: { pickupPointId: "inventado" },
      },
      { requireFulfillment: true }
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.fulfillment).toEqual({ pickupPointId: "inventado" });
  });

  it("parses a valid pickup fulfillment", () => {
    const result = parseCheckoutBody(
      {
        items: [{ productId: "abc-1", qty: 1 }],
        deliveryMethod: "pickup",
        fulfillment: { pickupPointId: "santa-fe-mitre" },
      },
      { requireFulfillment: true }
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.fulfillment).toEqual({ pickupPointId: "santa-fe-mitre" });
  });

  it("rejects the whole cart when a later item has a negative quantity", () => {
    const result = parseCheckoutBody({
      items: [
        { productId: "a", qty: 1 },
        { productId: "b", qty: -1 },
      ],
    });

    expect(result).toMatchObject({
      ok: false,
      code: "INVALID_QUANTITY",
      itemIndex: 1,
      productId: "b",
    });
  });

  it("rejects the whole cart when a later item has a decimal quantity", () => {
    const result = parseCheckoutBody({
      items: [
        { productId: "a", qty: 1 },
        { productId: "b", qty: 1.5 },
      ],
    });

    expect(result).toMatchObject({ ok: false, code: "INVALID_QUANTITY", itemIndex: 1 });
  });

  it("rejects the whole cart when a later item has an empty product id", () => {
    const result = parseCheckoutBody({
      items: [
        { productId: "a", qty: 1 },
        { productId: "", qty: 1 },
      ],
    });

    expect(result).toMatchObject({ ok: false, code: "INVALID_ITEMS", itemIndex: 1 });
  });

  it("rejects non-object items and unexpected item fields", () => {
    expect(parseCheckoutBody({ items: [{ productId: "a", qty: 1 }, "bad"] })).toMatchObject({
      ok: false,
      code: "INVALID_ITEMS",
      itemIndex: 1,
    });
    expect(parseCheckoutBody({ items: [{ productId: "a", qty: 1, stock: 10 }] })).toMatchObject({
      ok: false,
      code: "INVALID_ITEMS",
      itemIndex: 0,
    });
  });

  it("rejects invalid client prices", () => {
    expect(parseCheckoutBody({ items: [{ productId: "a", qty: 1, unitPrice: Number.NaN }] })).toMatchObject({
      ok: false,
      code: "INVALID_ITEMS",
      itemIndex: 0,
    });
    expect(parseCheckoutBody({ items: [{ productId: "a", qty: 1, unitPrice: "100" }] })).toMatchObject({
      ok: false,
      code: "INVALID_ITEMS",
      itemIndex: 0,
    });
  });

  it("enforces the maximum number of input lines", () => {
    const items = Array.from({ length: 31 }, (_, index) => ({ productId: `p-${index}`, qty: 1 }));
    expect(parseCheckoutBody({ items })).toMatchObject({ ok: false, code: "TOO_MANY_ITEMS" });
  });

  it("aggregates repeated product ids before enforcing the per-product limit", () => {
    expect(parseCheckoutBody({
      items: [
        { productId: "a", qty: 30 },
        { productId: "a", qty: 21 },
      ],
    })).toMatchObject({
      ok: false,
      code: "AGGREGATED_QUANTITY_LIMIT",
      productId: "a",
    });
  });

  it("returns one aggregated demand per product id", () => {
    const result = parseCheckoutBody({
      items: [
        { productId: "A", qty: 1, name: "Nombre falso", unitPrice: 1000 },
        { productId: "b", qty: 1, unitPrice: 500 },
        { productId: "A", qty: 2, name: "Otro nombre", unitPrice: 1000 },
      ],
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.items).toEqual([
      { productId: "A", qty: 3, requestedUnitPrices: [1000] },
      { productId: "b", qty: 1, requestedUnitPrices: [500] },
    ]);
  });
});
