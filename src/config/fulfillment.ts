export const DELIVERY_FEE = 4000;

export const DELIVERY_ZONE = {
  id: "rosario-zona-habilitada",
  name: "Rosario zona habilitada",
  description:
    "Zona delimitada por Av. San Martín, Bv. Avellaneda, Av. Uriburu y San Lorenzo.",
  boundaries: ["Av. San Martín", "Bv. Avellaneda", "Av. Uriburu", "San Lorenzo"],
} as const;

export const PICKUP_POINTS = [
  {
    id: "santa-fe-mitre",
    name: "Santa Fe y Mitre",
    address: "Santa Fe y Mitre",
    reference: "Coordinamos día y horario por WhatsApp",
    active: true,
  },
  {
    id: "mercado-del-patio",
    name: "Mercado del Patio",
    address: "Mercado del Patio",
    reference: "Coordinamos día y horario por WhatsApp",
    active: true,
  },
  {
    id: "san-martin-segui",
    name: "San Martín y Bv. Seguí",
    address: "San Martín y Bv. Seguí",
    reference: "Coordinamos día y horario por WhatsApp",
    active: true,
  },
  {
    id: "alto-rosario-junin",
    name: "Shopping Alto Rosario",
    address: "Entrada principal por Junín",
    reference: "Coordinamos día y horario por WhatsApp",
    active: true,
  },
] as const;

export type PickupPointId = (typeof PICKUP_POINTS)[number]["id"];

export function getPickupPointById(id: string) {
  return PICKUP_POINTS.find((point) => point.id === id && point.active) ?? null;
}

export function getShippingFeeForDeliveryMethod(deliveryMethod: "delivery" | "pickup") {
  return deliveryMethod === "delivery" ? DELIVERY_FEE : 0;
}
