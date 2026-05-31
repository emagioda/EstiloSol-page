export type FulfillmentSheetType = "delivery" | "pickup" | "pickup_point";

export type DeliveryOptionConfig = {
  id: "delivery";
  type: "delivery";
  name: string;
  subtitle: string;
  price: number;
  image: string;
  active: boolean;
};

export type PickupOptionConfig = {
  id: "pickup";
  type: "pickup";
  name: string;
  subtitle: string;
  price: number;
  active: boolean;
};

export type PickupPointConfig = {
  id: string;
  type: "pickup_point";
  name: string;
  subtitle: string;
  price: number;
  active: boolean;
};

export type FulfillmentConfig = {
  delivery: DeliveryOptionConfig;
  pickup: PickupOptionConfig;
  pickupPoints: PickupPointConfig[];
};

export const DELIVERY_ZONE = {
  id: "rosario-zona-habilitada",
  name: "Rosario - zona de envio",
} as const;

const knownPickupPointIds: Record<string, string> = {
  "santa fe y mitre": "santa-fe-mitre",
  "mercado del patio": "mercado-del-patio",
  "san martin y bv segui": "san-martin-segui",
  "shopping alto rosario": "alto-rosario-junin",
};

const normalizeIdSource = (value: string) =>
  value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

export const buildFulfillmentId = (type: FulfillmentSheetType, name: string) => {
  if (type === "delivery") return "delivery";
  if (type === "pickup") return "pickup";

  const normalized = normalizeIdSource(name);
  return (
    knownPickupPointIds[normalized] ||
    normalized
      .replace(/\s+/g, "-")
      .replace(/^-+|-+$/g, "")
  );
};

export const fallbackFulfillmentConfig: FulfillmentConfig = {
  delivery: {
    id: "delivery",
    type: "delivery",
    name: "Envio a domicilio",
    subtitle: "Dentro de la zona de envio",
    price: 3500,
    image: "",
    active: true,
  },
  pickup: {
    id: "pickup",
    type: "pickup",
    name: "Punto de encuentro",
    subtitle: "Coordinamos por WhatsApp.",
    price: 0,
    active: true,
  },
  pickupPoints: [
    {
      id: "santa-fe-mitre",
      type: "pickup_point",
      name: "Santa Fe y Mitre",
      subtitle: "Zona centro",
      price: 3000,
      active: true,
    },
    {
      id: "mercado-del-patio",
      type: "pickup_point",
      name: "Mercado del Patio",
      subtitle: "Cafferata / Cordoba",
      price: 3000,
      active: true,
    },
    {
      id: "san-martin-segui",
      type: "pickup_point",
      name: "San Martin y Bv. Segui",
      subtitle: "Zona sur",
      price: 3000,
      active: true,
    },
    {
      id: "alto-rosario-junin",
      type: "pickup_point",
      name: "Shopping Alto Rosario",
      subtitle: "Entrada principal por Junin",
      price: 4000,
      active: true,
    },
  ],
};

export const getActivePickupPointById = (config: FulfillmentConfig, id: string) =>
  config.pickupPoints.find((point) => point.id === id && point.active) ?? null;

export const getShippingFeeForDeliveryMethod = (
  deliveryMethod: "delivery" | "pickup",
  config: FulfillmentConfig = fallbackFulfillmentConfig,
  pickupPointId?: string
) => {
  if (deliveryMethod === "delivery") return config.delivery.price;
  return getActivePickupPointById(config, pickupPointId || "")?.price ?? config.pickup.price;
};
