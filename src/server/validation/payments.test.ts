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
    expect(result.value.items[0]).toEqual({ productId: "abc-1", qty: 2 });
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
    expect(result.message).toBe("Invalid cart items");
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
    expect(result.message).toBe("Confirmá que la dirección está dentro de la zona habilitada.");
  });

  it("rejects checkout with invalid pickup point", () => {
    const result = parseCheckoutBody(
      {
        items: [{ productId: "abc-1", qty: 1 }],
        deliveryMethod: "pickup",
        fulfillment: { pickupPointId: "inventado" },
      },
      { requireFulfillment: true }
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.message).toBe("Punto de encuentro inválido.");
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
});
