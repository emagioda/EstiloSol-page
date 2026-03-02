import { describe, expect, it } from "vitest";
import { parseCheckoutBody, parseExternalReference } from "@/src/server/validation/payments";

describe("payments validation", () => {
  it("parses a valid checkout body", () => {
    const result = parseCheckoutBody({
      items: [{ productId: "abc-1", qty: 2 }],
      payer: { name: "Ana Perez", phone: "+54 11 1234-5678" },
      notes: "Sin apuro",
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value.items).toHaveLength(1);
    expect(result.value.items[0]).toEqual({ productId: "abc-1", qty: 2 });
    expect(result.value.payerName).toBe("Ana Perez");
    expect(result.value.payerPhone).toBe("+541112345678");
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
    expect(result.message).toContain("Completá nombre y WhatsApp");
  });
});
