import "server-only";

import { env } from "@/src/config/env";
import {
  buildFulfillmentId,
  fallbackFulfillmentConfig,
  isValidFulfillmentPrice,
  type DeliveryOptionConfig,
  type FulfillmentConfig,
  type FulfillmentSheetType,
  type PickupOptionConfig,
  type PickupPointConfig,
} from "@/src/config/fulfillment";
import { logEvent } from "@/src/server/observability/log";
import { getSheetsToken } from "@/src/server/sheets/tokens";

const FULFILLMENT_SHEET = "envios";

type SheetRow = Record<string, unknown>;

export class FulfillmentConfigurationError extends Error {
  readonly code = "FULFILLMENT_CONFIGURATION_INVALID";

  constructor(message: string) {
    super(message);
    this.name = "FulfillmentConfigurationError";
  }
}

const normalizeKey = (value: string) =>
  value
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");

const normalizeRow = (row: SheetRow): SheetRow =>
  Object.fromEntries(Object.entries(row).map(([key, value]) => [normalizeKey(key), value]));

const textValue = (value: unknown) => {
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return "";
};

const configuredPrice = (value: unknown): number | null => {
  if (typeof value === "number") {
    return isValidFulfillmentPrice(value) ? value : null;
  }
  const text = textValue(value);
  if (!text) return null;
  const compact = text.replace(/\s/g, "");
  if (!/^-?\d+(?:[.,]\d+)?$/.test(compact)) return null;
  const normalized = compact.replace(",", ".");
  const parsed = Number(normalized);
  return isValidFulfillmentPrice(parsed) ? parsed : null;
};

const booleanValue = (value: unknown) => {
  if (value === true) return true;
  if (value === false) return false;
  if (typeof value === "number") return value !== 0;
  const normalized = textValue(value)
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
  if (!normalized) return false;
  return ["true", "verdadero", "si", "yes", "1", "activo", "active"].includes(normalized);
};

const fulfillmentType = (value: unknown): FulfillmentSheetType | null => {
  const normalized = textValue(value).toLowerCase().trim();
  if (normalized === "delivery" || normalized === "pickup" || normalized === "pickup_point") return normalized;
  return null;
};

const buildSheetsUrl = () => {
  const endpoint = env.getOptionalServer("SHEETS_ENDPOINT");
  if (!endpoint) return null;

  const url = new URL(endpoint);
  url.searchParams.set("sheet", FULFILLMENT_SHEET);
  url.searchParams.set("token", getSheetsToken("read"));
  return url.toString();
};

const parseRowsPayload = (payload: unknown): SheetRow[] => {
  const rows = Array.isArray(payload)
    ? payload
    : payload && typeof payload === "object" && Array.isArray((payload as { items?: unknown }).items)
      ? (payload as { items: unknown[] }).items
      : [];

  return rows.filter((row): row is SheetRow => Boolean(row && typeof row === "object"));
};

export const adaptRowsToFulfillmentConfig = (rows: SheetRow[]): FulfillmentConfig => {
  const normalizedRows = rows.map(normalizeRow);
  let delivery: DeliveryOptionConfig | null = null;
  let pickup: PickupOptionConfig | null = null;
  const pickupPoints: PickupPointConfig[] = [];
  let sawDeliveryRow = false;
  let sawPickupRow = false;
  let sawPickupPointRow = false;

  for (const row of normalizedRows) {
    const type = fulfillmentType(row.tipo ?? row.type);
    if (!type) continue;

    const name = textValue(row.nombre ?? row.name);
    const active = booleanValue(row.activo ?? row.active);
    const subtitle = textValue(row.subtitulo ?? row.subtitle);
    const price = configuredPrice(row.precio ?? row.price);

    if (active && (!name || !subtitle || price === null)) {
      throw new FulfillmentConfigurationError(`Active ${type} fulfillment row is incomplete`);
    }

    if (type === "delivery") {
      sawDeliveryRow = true;
      delivery = {
        id: "delivery",
        type,
        name: name || fallbackFulfillmentConfig.delivery.name,
        subtitle: subtitle || fallbackFulfillmentConfig.delivery.subtitle,
        price: price ?? 0,
        image: textValue(row.imagen ?? row.image),
        active,
      };
      continue;
    }

    if (type === "pickup") {
      sawPickupRow = true;
      pickup = {
        id: "pickup",
        type,
        name: name || fallbackFulfillmentConfig.pickup.name,
        subtitle: subtitle || fallbackFulfillmentConfig.pickup.subtitle,
        price: price ?? 0,
        active,
      };
      continue;
    }

    sawPickupPointRow = true;
    if (!name) continue;

    pickupPoints.push({
      id: buildFulfillmentId(type, name),
      type,
      name,
      subtitle,
      price: price ?? 0,
      active,
    });
  }

  return {
    delivery: sawDeliveryRow ? delivery! : fallbackFulfillmentConfig.delivery,
    pickup: sawPickupRow ? pickup! : fallbackFulfillmentConfig.pickup,
    pickupPoints: sawPickupPointRow ? pickupPoints : fallbackFulfillmentConfig.pickupPoints,
  };
};

export async function fetchFulfillmentConfigFromSource(): Promise<FulfillmentConfig> {
  const requestUrl = buildSheetsUrl();
  if (!requestUrl) return fallbackFulfillmentConfig;

  const startedAt = Date.now();
  let status: number | undefined;

  try {
    const response = await fetch(requestUrl, {
      cache: "no-store",
    });
    status = response.status;

    if (!response.ok) {
      throw new Error(`Failed to fetch fulfillment config: ${response.status}`);
    }

    const payload: unknown = await response.json().catch(() => null);
    if (payload && typeof payload === "object" && (payload as { ok?: unknown }).ok === false) {
      const message = (payload as { error?: unknown }).error;
      throw new Error(typeof message === "string" ? message : "Sheets fulfillment endpoint error");
    }

    const rows = parseRowsPayload(payload);
    logEvent("info", "sheets.read.timing", {
      sheet: FULFILLMENT_SHEET,
      status,
      ok: true,
      durationMs: Date.now() - startedAt,
      rowCount: rows.length,
    });

    return adaptRowsToFulfillmentConfig(rows);
  } catch (error) {
    logEvent("warn", "sheets.read.timing", {
      sheet: FULFILLMENT_SHEET,
      status,
      ok: false,
      durationMs: Date.now() - startedAt,
      errorName: error instanceof Error ? error.name : "unknown",
    });
    throw error;
  }
}

export async function getFulfillmentConfig(): Promise<FulfillmentConfig> {
  try {
    return await fetchFulfillmentConfigFromSource();
  } catch (error) {
    if (error instanceof FulfillmentConfigurationError) throw error;
    return fallbackFulfillmentConfig;
  }
}
