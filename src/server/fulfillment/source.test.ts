import { afterEach, describe, expect, it, vi } from "vitest";
import {
  fallbackFulfillmentConfig,
  getActivePickupPointById,
  getActivePickupPoints,
  isDeliveryOptionAvailable,
} from "@/src/config/fulfillment";
import {
  adaptRowsToFulfillmentConfig,
  FulfillmentConfigurationError,
  getFulfillmentConfig,
} from "./source";

const activeDeliveryRow = (price: unknown) => ({
  tipo: "delivery",
  nombre: "Envío a domicilio",
  subtitulo: "Dentro de la zona habilitada",
  precio: price,
  activo: true,
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

describe("AUD3 H07-F fulfillment source configuration", () => {
  it.each([
    ["blank", ""],
    ["non-numeric", "precio-3500"],
    ["NaN", Number.NaN],
    ["Infinity", Number.POSITIVE_INFINITY],
    ["negative number", -1],
    ["negative string", "-1"],
  ])("EF-F-02 fails closed for an active delivery row with %s price", (_label, price) => {
    expect(() => adaptRowsToFulfillmentConfig([activeDeliveryRow(price)])).toThrow(
      FulfillmentConfigurationError,
    );
  });

  it.each([0, "0", 3500, "3500", "3500,50"])(
    "EF-F-02 accepts an explicit finite non-negative price (%s)",
    (price) => {
      const config = adaptRowsToFulfillmentConfig([activeDeliveryRow(price)]);
      expect(isDeliveryOptionAvailable(config)).toBe(true);
      expect(config.delivery.price).toBe(Number(String(price).replace(",", ".")));
    },
  );

  it("EF-E-03 rejects an active pickup point with incomplete operator text", () => {
    expect(() => adaptRowsToFulfillmentConfig([{
      tipo: "pickup_point",
      nombre: "Santa Fe y Mitre",
      subtitulo: "",
      precio: 0,
      activo: true,
    }])).toThrow(FulfillmentConfigurationError);
  });

  it("EF-F-01A keeps pickup unavailable when its top-level option is inactive", () => {
    const config = adaptRowsToFulfillmentConfig([
      {
        tipo: "pickup",
        nombre: "Punto de encuentro",
        subtitulo: "Coordinamos por WhatsApp",
        precio: 0,
        activo: false,
      },
      {
        tipo: "pickup_point",
        nombre: "Santa Fe y Mitre",
        subtitulo: "Zona centro",
        precio: 0,
        activo: true,
      },
    ]);

    expect(getActivePickupPoints(config)).toEqual([]);
    expect(getActivePickupPointById(config, "santa-fe-mitre")).toBeNull();
  });

  it("EF-E-03 does not resurrect fallback points when pickup-point rows are explicitly inactive", () => {
    const config = adaptRowsToFulfillmentConfig([{
      tipo: "pickup_point",
      nombre: "Santa Fe y Mitre",
      subtitulo: "Zona centro",
      precio: 0,
      activo: false,
    }]);

    expect(getActivePickupPoints(config)).toEqual([]);
    expect(config.pickupPoints).toHaveLength(1);
    expect(config.pickupPoints[0]?.active).toBe(false);
  });

  it("EF-F-02 fails closed instead of using fallback for malformed explicit source data", async () => {
    vi.stubEnv("SHEETS_ENDPOINT", "https://sheets.example.test/api");
    vi.stubEnv("SHEETS_READ_TOKEN", "read-token");
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(
      JSON.stringify([activeDeliveryRow("")]),
      { status: 200 },
    ));

    await expect(getFulfillmentConfig()).rejects.toBeInstanceOf(FulfillmentConfigurationError);
  });

  it("EF-F-02 keeps the intentional safe fallback for a transport failure", async () => {
    vi.stubEnv("SHEETS_ENDPOINT", "https://sheets.example.test/api");
    vi.stubEnv("SHEETS_READ_TOKEN", "read-token");
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("network unavailable"));

    await expect(getFulfillmentConfig()).resolves.toEqual(fallbackFulfillmentConfig);
  });
});
