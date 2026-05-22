import { env } from "@/src/config/env";
import { fetchWithPolicy } from "@/src/server/http/fetchWithPolicy";
import { getSheetsToken, type SheetsTokenPurpose } from "@/src/server/sheets/tokens";
import type {
  Order,
  OrderDeliveryMethod,
  OrderPaymentMethod,
  OrderPaymentStatus,
  OrderShippingStatus,
} from "@/src/server/orders/types";
import type { StockStatus } from "@/src/features/shop/domain/entities/Product";

const SALES_SHEET_NAME = "ventas";
const PRODUCTS_SHEET_NAME = "products";

const DEFAULT_GET_POLICY = {
  timeoutMs: 10_000,
  retries: 1,
  retryDelayMs: 300,
} as const;

const DEFAULT_MUTATION_POLICY = {
  timeoutMs: 12_000,
  retries: 1,
  retryDelayMs: 400,
} as const;

type SheetRow = Record<string, unknown>;

type GetSheetRowsOptions = {
  includeInactive?: boolean;
};

type ParsedRowsPayload = {
  items: SheetRow[];
};

type SheetsMutationResponse = {
  ok?: boolean;
  error?: string;
  [key: string]: unknown;
};

export type AdminDepartament = "PELUQUERIA" | "BIJOUTERIE";
export type AdminProductType = "UNICO" | "KIT";

export type AdminOrderItem = {
  productId: string;
  title: string;
  qty: number;
  unitPrice?: number;
};

export type AdminOrderSheetRow = {
  orderId: string;
  createdAt: string;
  createdAtMs: number;
  customerName: string;
  whatsapp: string;
  email: string;
  total: number;
  currency: "ARS";
  paymentStatus: OrderPaymentStatus;
  shippingStatus: OrderShippingStatus;
  paymentMethod?: OrderPaymentMethod;
  deliveryMethod?: OrderDeliveryMethod;
  items: AdminOrderItem[];
  itemsSummary: string;
  notes: string;
  receiptEmailSentAt: string;
  raw: SheetRow;
};

export type AdminProductSheetRow = {
  id: string;
  name: string;
  price: number;
  currency: string;
  active: boolean;
  shortDescription: string;
  description: string;
  includes: string[];
  images: string[];
  isNew: boolean;
  isFeatured: boolean;
  productType: AdminProductType;
  stockStatus: StockStatus;
  stockQty: number | null;
  departament?: AdminDepartament;
  updatedAt: string;
  raw: SheetRow;
};

const normalizeKey = (value: string) =>
  value
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");

const normalizeToken = (value: unknown) =>
  String(value ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim();

const toBoolean = (value: unknown) => {
  if (value === true) return true;
  if (value === false) return false;
  if (typeof value === "number") return value !== 0;

  const normalized = normalizeToken(value);
  return ["1", "true", "verdadero", "si", "yes", "active", "activo"].includes(normalized);
};

const toStringValue = (value: unknown): string => {
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return "";
};

const toNumberValue = (value: unknown): number => {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const normalized = value.trim();
    if (!normalized) return Number.NaN;
    const parsed = Number(normalized.replace(/[^0-9.-]+/g, ""));
    if (Number.isFinite(parsed)) return parsed;
  }
  return Number.NaN;
};

const toIsoString = (timestamp: number | undefined): string => {
  if (!timestamp || !Number.isFinite(timestamp)) return "";
  return new Date(timestamp).toISOString();
};

const toStringArray = (value: unknown): string[] => {
  if (Array.isArray(value)) {
    return value
      .map((entry) => toStringValue(entry))
      .filter(Boolean);
  }

  if (typeof value === "string") {
    return value
      .split(/\r?\n|,/)
      .map((entry) => entry.trim())
      .filter(Boolean);
  }

  return [];
};

const toDateMs = (value: unknown): number => {
  if (typeof value === "number" && Number.isFinite(value)) return value;

  const asText = toStringValue(value);
  if (!asText) return 0;

  const parsed = Date.parse(asText);
  if (Number.isFinite(parsed)) return parsed;

  return 0;
};

const getSheetsEndpoint = () => {
  const endpoint = env.getOptionalServer("SHEETS_ENDPOINT");
  if (!endpoint) {
    throw new Error("SHEETS_ENDPOINT is missing");
  }
  return endpoint;
};

const buildUrlWithParams = (
  params: Record<string, string | number | undefined>,
  tokenPurpose: SheetsTokenPurpose
) => {
  const url = new URL(getSheetsEndpoint());
  url.searchParams.set("token", getSheetsToken(tokenPurpose));
  for (const [key, rawValue] of Object.entries(params)) {
    if (rawValue === undefined) continue;
    const value = String(rawValue).trim();
    if (!value) continue;
    url.searchParams.set(key, value);
  }
  return url.toString();
};

const parseRowsPayload = (raw: unknown): ParsedRowsPayload => {
  if (Array.isArray(raw)) {
    return {
      items: raw.filter((item): item is SheetRow => Boolean(item && typeof item === "object")),
    };
  }

  if (!raw || typeof raw !== "object") {
    throw new Error("Invalid sheets payload");
  }

  const payload = raw as { items?: unknown; ok?: unknown; error?: unknown };
  if (payload.ok === false) {
    throw new Error(typeof payload.error === "string" ? payload.error : "Sheets endpoint error");
  }

  if (!Array.isArray(payload.items)) {
    throw new Error("Sheets payload did not return an items array");
  }

  return {
    items: payload.items.filter((item): item is SheetRow => Boolean(item && typeof item === "object")),
  };
};

const normalizeRow = (row: SheetRow): SheetRow =>
  Object.fromEntries(
    Object.entries(row).map(([key, value]) => [normalizeKey(key), value])
  );

const pickValue = (row: SheetRow, keys: string[]) => {
  for (const key of keys) {
    const normalized = normalizeKey(key);
    if (!Object.prototype.hasOwnProperty.call(row, normalized)) continue;
    const value = row[normalized];
    if (value === undefined || value === null) continue;
    if (typeof value === "string" && !value.trim()) continue;
    return value;
  }
  return undefined;
};

const parsePaymentMethod = (value: unknown): OrderPaymentMethod | undefined => {
  const token = normalizeToken(value);
  if (token.includes("mercado")) return "mercadopago";
  if (token.includes("transfer")) return "transfer";
  if (token.includes("cash") || token.includes("efectivo")) return "cash";
  return undefined;
};

const parseDeliveryMethod = (value: unknown): OrderDeliveryMethod | undefined => {
  const token = normalizeToken(value);
  if (token.includes("retiro") || token.includes("pickup") || token.includes("encuentro")) return "pickup";
  if (token.includes("delivery") || token.includes("domicilio")) return "delivery";
  return undefined;
};

const parseDepartament = (value: unknown): AdminDepartament | undefined => {
  const token = normalizeToken(value);
  if (!token) return undefined;
  if (token === "peluqueria") return "PELUQUERIA";
  if (token === "bijouterie") return "BIJOUTERIE";
  return undefined;
};

const parseProductType = (value: unknown): AdminProductType => {
  const token = normalizeToken(value);
  return token === "kit" ? "KIT" : "UNICO";
};

const parseStockStatus = (value: unknown, stockQty: number | null): StockStatus => {
  const token = normalizeKey(String(value ?? "")).replace(/_/g, "");
  if (["outofstock", "sinstock", "agotado"].includes(token)) return "out_of_stock";
  if (["preorder", "preventa", "preventas", "reserva"].includes(token)) return "preorder";
  if (typeof stockQty === "number" && stockQty <= 0) return "out_of_stock";
  return "in_stock";
};

export const parsePaymentStatus = (value: unknown): OrderPaymentStatus => {
  const token = normalizeToken(value);
  if (token.includes("contracargo") || token.includes("charge")) return "charged_back";
  if (token.includes("reintegr") || token.includes("devol") || token.includes("refund")) return "refunded";
  if (token.includes("confirm") || token.includes("aprobad")) return "confirmed";
  if (token.includes("cancel") || token.includes("rechaz")) return "cancelled";
  return "pending";
};

export const parseShippingStatus = (value: unknown): OrderShippingStatus => {
  const token = normalizeToken(value);
  if (token.includes("final") || token.includes("complet") || token.includes("entreg")) return "completed";
  return "in_process";
};

export const paymentStatusToLabel = (status: OrderPaymentStatus) => {
  if (status === "confirmed") return "Confirmado";
  if (status === "refunded") return "Reintegrado";
  if (status === "charged_back") return "Contracargo";
  if (status === "cancelled") return "Cancelado";
  return "Pendiente";
};

export const shippingStatusToLabel = (status: OrderShippingStatus) => {
  if (status === "completed") return "Finalizado";
  return "En proceso";
};

const paymentMethodToLabel = (method: OrderPaymentMethod | undefined) => {
  if (method === "cash") return "Efectivo";
  if (method === "transfer") return "Transferencia";
  if (method === "mercadopago") return "Mercado Pago";
  return "";
};

const deliveryMethodToLabel = (method: OrderDeliveryMethod | undefined) => {
  if (method === "pickup") return "Punto de encuentro coordinado";
  if (method === "delivery") return "Envío a domicilio";
  return "";
};

const splitCustomerName = (fullName: string) => {
  const parts = fullName
    .split(/\s+/)
    .map((part) => part.trim())
    .filter(Boolean);

  if (parts.length === 0) {
    return { firstName: "", lastName: "" };
  }
  if (parts.length === 1) {
    return { firstName: parts[0], lastName: "" };
  }

  return {
    firstName: parts.slice(0, -1).join(" "),
    lastName: parts[parts.length - 1],
  };
};

const buildOrderItemsSummary = (order: Order) =>
  order.items
    .map((item) => `${item.qty}x ${item.title}`)
    .join(" | ");

const buildDeliveryAddressSummary = (order: Order) => {
  const address = order.fulfillment?.deliveryAddress;
  if (!address) return "";

  return [
    `${address.street} ${address.number}`.trim(),
    address.floor || "",
    address.betweenStreets ? `entre ${address.betweenStreets}` : "",
    address.notes || "",
  ]
    .filter(Boolean)
    .join(", ");
};

async function postMutation(
  payload: Record<string, unknown>,
  tokenPurpose: SheetsTokenPurpose = "write"
): Promise<SheetsMutationResponse> {
  const response = await fetchWithPolicy(
    getSheetsEndpoint(),
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      cache: "no-store",
      body: JSON.stringify({
        ...payload,
        token: getSheetsToken(tokenPurpose),
      }),
    },
    DEFAULT_MUTATION_POLICY
  );

  const data = (await response.json().catch(() => null)) as SheetsMutationResponse | null;
  if (!response.ok) {
    throw new Error(data?.error || `Sheets mutation failed with status ${response.status}`);
  }

  if (!data || data.ok === false) {
    throw new Error(data?.error || "Sheets mutation failed");
  }

  return data;
}

async function fetchRows(
  sheetName: string,
  options: GetSheetRowsOptions = {},
  tokenPurpose: SheetsTokenPurpose = "admin"
): Promise<SheetRow[]> {
  const url = buildUrlWithParams({
    sheet: sheetName,
    includeInactive: options.includeInactive ? 1 : undefined,
  }, tokenPurpose);

  const response = await fetchWithPolicy(
    url,
    {
      method: "GET",
      cache: "no-store",
    },
    DEFAULT_GET_POLICY
  );

  if (!response.ok) {
    throw new Error(`Sheets GET failed for sheet ${sheetName}: ${response.status}`);
  }

  const raw = await response.json().catch(() => null);
  return parseRowsPayload(raw).items;
}

export const buildSalesSheetRow = (order: Order): Record<string, unknown> => {
  const createdAtIso = toIsoString(order.createdAt);
  const updatedAtIso = toIsoString(order.updatedAt || order.createdAt);
  const approvedAtIso = toIsoString(order.approvedAt);
  const customerName = toStringValue(order.customer?.name);
  const { firstName, lastName } = splitCustomerName(customerName);
  const customerPhone = toStringValue(order.customer?.phone);
  const customerEmail = toStringValue(order.customer?.email);
  const paymentStatusLabel = paymentStatusToLabel(order.paymentStatus);
  const shippingStatusLabel = shippingStatusToLabel(order.shippingStatus);
  const paymentMethodLabel = paymentMethodToLabel(order.paymentMethod);
  const deliveryMethodLabel = deliveryMethodToLabel(order.deliveryMethod);
  const orderItemsSummary = buildOrderItemsSummary(order);
  const fulfillment = order.fulfillment;
  const deliveryAddressSummary = buildDeliveryAddressSummary(order);
  const pickupPointName = fulfillment?.pickupPoint?.name ?? "";

  return {
    nro_de_compra: order.externalReference,
    order_id: order.externalReference,
    id_pedido: order.externalReference,
    created_at: createdAtIso,
    fecha: createdAtIso,
    fecha_pedido: createdAtIso,
    updated_at: updatedAtIso,
    nombre: firstName,
    apellido: lastName,
    cliente: customerName,
    customer_name: customerName,
    whatsapp: customerPhone,
    customer_whatsapp: customerPhone,
    email: customerEmail,
    customer_email: customerEmail,
    forma_de_pago: paymentMethodLabel,
    payment_method: paymentMethodLabel,
    payment_method_code: order.paymentMethod || "",
    metodo_pago: paymentMethodLabel,
    forma_de_entrega: deliveryMethodLabel,
    delivery_method: deliveryMethodLabel,
    delivery_method_code: order.deliveryMethod || "",
    metodo_entrega: deliveryMethodLabel,
    direccion_de_entrega: deliveryAddressSummary,
    punto_de_encuentro: pickupPointName,
    total: order.total,
    subtotal_productos: fulfillment?.subtotalProducts ?? order.total,
    descuento: fulfillment?.discountAmount ?? 0,
    costo_envio: fulfillment?.shippingFee ?? 0,
    total_final: fulfillment?.finalTotal ?? order.total,
    delivery_zone_id: fulfillment?.deliveryZone?.id ?? "",
    delivery_zone_name: fulfillment?.deliveryZone?.name ?? "",
    delivery_inside_zone_confirmed: fulfillment?.deliveryZone?.insideZoneConfirmed ? "TRUE" : "",
    delivery_address_street: fulfillment?.deliveryAddress?.street ?? "",
    delivery_address_number: fulfillment?.deliveryAddress?.number ?? "",
    delivery_address_floor: fulfillment?.deliveryAddress?.floor ?? "",
    delivery_address_between_streets: fulfillment?.deliveryAddress?.betweenStreets ?? "",
    delivery_address_notes: fulfillment?.deliveryAddress?.notes ?? "",
    pickup_point_id: fulfillment?.pickupPoint?.id ?? "",
    pickup_point_name: fulfillment?.pickupPoint?.name ?? "",
    pickup_point_address: fulfillment?.pickupPoint?.address ?? "",
    pickup_point_reference: fulfillment?.pickupPoint?.reference ?? "",
    fulfillment_summary: fulfillment?.summary ?? "",
    currency: order.currency,
    status: order.status,
    order_status: order.status,
    estado_de_pago: paymentStatusLabel,
    payment_status: paymentStatusLabel,
    estado_pago: paymentStatusLabel,
    estado_de_envio: shippingStatusLabel,
    shipping_status: shippingStatusLabel,
    estado_envio: shippingStatusLabel,
    detalle_del_pedido: orderItemsSummary,
    items_count: order.items.length,
    items_json: JSON.stringify(order.items),
    notas: order.notes || "",
    notes: order.notes || "",
    mp_preference_id: order.mpPreferenceId || "",
    mp_payment_id: order.mpPaymentId || "",
    mp_status: order.mpStatus || "",
    approved_at: approvedAtIso,
    fecha_pago: approvedAtIso,
    stock_deducted_at: toIsoString(order.stockDeductedAt),
    receipt_email_sent_at: toIsoString(order.receiptEmailSentAt),
  };
};

export async function appendOrderToSalesSheet(order: Order): Promise<void> {
  await postMutation({
    action: "appendRow",
    sheet: SALES_SHEET_NAME,
    row: buildSalesSheetRow(order),
  }, "write");
}

export async function appendOrderAndDecrementStockInSheet(
  order: Order,
  stockDeductedAt: number
): Promise<void> {
  await postMutation({
    action: "appendOrderAndDecrementStock",
    sheet: SALES_SHEET_NAME,
    productsSheet: PRODUCTS_SHEET_NAME,
    orderId: order.externalReference,
    row: buildSalesSheetRow({
      ...order,
      stockDeductedAt,
    }),
    items: order.items.map((item) => ({
      productId: item.productId,
      qty: item.qty,
      title: item.title,
    })),
  }, "write");
}

export async function updateOrderRowInSalesSheet(
  orderId: string,
  updates: Partial<{
    paymentStatus: OrderPaymentStatus;
    shippingStatus: OrderShippingStatus;
    orderStatus: string;
    mpStatus: string;
    mpPaymentId: string;
    mpPreferenceId: string;
    receiptEmailSentAt: number;
    stockDeductedAt: number;
    updatedAt: number;
  }>
): Promise<void> {
  const payload: Record<string, unknown> = {
    updated_at: toIsoString(updates.updatedAt ?? Date.now()),
  };

  if (updates.paymentStatus) {
    const label = paymentStatusToLabel(updates.paymentStatus);
    payload.estado_de_pago = label;
    payload.payment_status = label;
    payload.estado_pago = label;
  }

  if (updates.shippingStatus) {
    const label = shippingStatusToLabel(updates.shippingStatus);
    payload.estado_de_envio = label;
    payload.shipping_status = label;
    payload.estado_envio = label;
  }

  if (updates.orderStatus) {
    payload.order_status = updates.orderStatus;
    payload.status = updates.orderStatus;
  }

  if (updates.mpStatus) payload.mp_status = updates.mpStatus;
  if (updates.mpPaymentId) payload.mp_payment_id = updates.mpPaymentId;
  if (updates.mpPreferenceId) payload.mp_preference_id = updates.mpPreferenceId;
  if (updates.receiptEmailSentAt) {
    payload.receipt_email_sent_at = toIsoString(updates.receiptEmailSentAt);
  }
  if (updates.stockDeductedAt) {
    payload.stock_deducted_at = toIsoString(updates.stockDeductedAt);
  }

  try {
    await postMutation({
      action: "updateRow",
      sheet: SALES_SHEET_NAME,
      match: {
        key: "nro_de_compra",
        value: orderId,
      },
      updates: payload,
    }, "write");
  } catch {
    await postMutation({
      action: "updateRow",
      sheet: SALES_SHEET_NAME,
      orderId,
      updates: payload,
    }, "write");
  }
}

export async function updateProductRowInSheet(
  productId: string,
  updates: Partial<{
    price: number;
    active: boolean;
    name: string;
    shortDescription: string;
    description: string;
    includes: string[];
    images: string[];
    isNew: boolean;
    isFeatured: boolean;
    productType: AdminProductType;
    stockQty: number | null;
  }>
): Promise<void> {
  const payload: Record<string, unknown> = {
    updated_at: new Date().toISOString(),
  };

  if (typeof updates.price === "number" && Number.isFinite(updates.price)) {
    payload.price = Number(updates.price.toFixed(2));
  }
  if (typeof updates.active === "boolean") payload.active = updates.active;
  if (typeof updates.name === "string") payload.name = updates.name.trim();
  if (typeof updates.shortDescription === "string") {
    payload.short_description = updates.shortDescription.trim();
  }
  if (typeof updates.description === "string") {
    payload.description = updates.description.trim();
  }
  if (Array.isArray(updates.includes)) {
    payload.includes = updates.includes.join(", ");
  }
  if (Array.isArray(updates.images)) {
    payload.images = updates.images.join(", ");
  }
  if (typeof updates.isNew === "boolean") {
    payload.is_new = updates.isNew;
  }
  if (typeof updates.isFeatured === "boolean") {
    payload.is_featured = updates.isFeatured;
  }
  if (updates.productType === "UNICO" || updates.productType === "KIT") {
    payload.product_type = updates.productType;
  }
  if (typeof updates.stockQty === "number" && Number.isFinite(updates.stockQty)) {
    payload.stock_qty = Math.max(0, Math.trunc(updates.stockQty));
  } else if (updates.stockQty === null) {
    payload.stock_qty = "";
  }

  await postMutation({
    action: "updateRow",
    sheet: PRODUCTS_SHEET_NAME,
    productId,
    updates: payload,
  }, "admin");
}

export async function decrementProductsStockInSheet(
  orderId: string,
  items: Array<{ productId: string; qty: number; title?: string }>
): Promise<void> {
  if (!orderId.trim()) {
    throw new Error("decrementProductsStockInSheet requires orderId");
  }

  const normalizedItems = items
    .map((item) => ({
      productId: String(item.productId || "").trim(),
      qty: Math.max(0, Math.trunc(Number(item.qty))),
      title: String(item.title || "").trim(),
    }))
    .filter((item) => item.productId && item.qty > 0);

  if (normalizedItems.length === 0) return;

  await postMutation({
    action: "decrementStock",
    sheet: PRODUCTS_SHEET_NAME,
    orderId,
    items: normalizedItems,
  }, "write");
}

const parseOrderItemsSummary = (value: unknown): AdminOrderItem[] => {
  const summary = toStringValue(value);
  if (!summary) return [];

  return summary
    .split("|")
    .map((item) => item.trim())
    .filter(Boolean)
    .map((item) => {
      const match = item.match(/^(\d+)\s*x\s*(.+)$/i);
      if (!match) {
        return {
          productId: "",
          title: item,
          qty: 1,
        };
      }

      return {
        productId: "",
        title: match[2].trim(),
        qty: Math.max(1, Number(match[1])),
      };
    })
    .filter((item) => Boolean(item.title));
};

const parseOrderItemsJson = (value: unknown): AdminOrderItem[] => {
  const raw = toStringValue(value);
  if (!raw) return [];

  try {
    const parsed = JSON.parse(raw) as Array<Record<string, unknown>>;
    if (!Array.isArray(parsed)) return [];

    return parsed
      .map((item) => {
        const title = toStringValue(item.title ?? item.name);
        if (!title) return null;
        const qty = toNumberValue(item.qty);
        const unitPrice = toNumberValue(item.unitPrice ?? item.unit_price);

        return {
          productId: toStringValue(item.productId ?? item.product_id),
          title,
          qty: Number.isFinite(qty) && qty > 0 ? Math.trunc(qty) : 1,
          ...(Number.isFinite(unitPrice) ? { unitPrice } : {}),
        };
      })
      .filter((item): item is AdminOrderItem => item !== null);
  } catch {
    return [];
  }
};

const parseAdminOrderRow = (input: SheetRow): AdminOrderSheetRow | null => {
  const row = normalizeRow(input);
  const orderId = toStringValue(
    pickValue(row, ["nro_de_compra", "order_id", "id_pedido", "orderid", "external_reference", "id"])
  );
  if (!orderId) return null;

  const createdAtRaw = pickValue(row, ["created_at", "fecha", "fecha_pedido", "date"]);
  const createdAtText = toStringValue(createdAtRaw);
  const createdAtMs = toDateMs(createdAtRaw);

  const paymentStatusRaw = pickValue(row, ["estado_de_pago", "payment_status", "estado_pago", "payment_state"]);
  const shippingStatusRaw = pickValue(row, ["estado_de_envio", "shipping_status", "estado_envio", "shipping_state"]);

  const totalRaw = pickValue(row, ["total", "total_amount", "amount"]);
  const parsedTotal = toNumberValue(totalRaw);
  const customerFirstName = toStringValue(pickValue(row, ["nombre", "first_name"]));
  const customerLastName = toStringValue(pickValue(row, ["apellido", "last_name"]));
  const customerCombinedName = [customerFirstName, customerLastName].filter(Boolean).join(" ").trim();
  const itemsSummary = toStringValue(pickValue(row, ["detalle_del_pedido", "items_summary", "summary"]));
  const itemsFromJson = parseOrderItemsJson(pickValue(row, ["items_json"]));
  const items = itemsFromJson.length > 0 ? itemsFromJson : parseOrderItemsSummary(itemsSummary);
  const notes = toStringValue(pickValue(row, ["notas", "notes"]));
  const receiptEmailSentAt = toStringValue(
    pickValue(row, ["receipt_email_sent_at", "email_enviado_en", "email_sent_at"])
  );

  return {
    orderId,
    createdAt: createdAtText || (createdAtMs ? new Date(createdAtMs).toISOString() : ""),
    createdAtMs,
    customerName:
      customerCombinedName ||
      toStringValue(pickValue(row, ["customer_name", "cliente", "nombre_cliente"])),
    whatsapp: toStringValue(pickValue(row, ["customer_whatsapp", "whatsapp", "telefono"])),
    email: toStringValue(pickValue(row, ["customer_email", "email"])),
    total: Number.isFinite(parsedTotal) ? parsedTotal : 0,
    currency: "ARS",
    paymentStatus: parsePaymentStatus(paymentStatusRaw),
    shippingStatus: parseShippingStatus(shippingStatusRaw),
    paymentMethod: parsePaymentMethod(
      pickValue(row, ["forma_de_pago", "payment_method_code", "payment_method", "metodo_pago"])
    ),
    deliveryMethod: parseDeliveryMethod(
      pickValue(row, ["forma_de_entrega", "delivery_method_code", "delivery_method", "metodo_entrega"])
    ),
    items,
    itemsSummary,
    notes,
    receiptEmailSentAt,
    raw: input,
  };
};

const parseAdminProductRow = (input: SheetRow): AdminProductSheetRow | null => {
  const row = normalizeRow(input);
  const id = toStringValue(pickValue(row, ["id", "product_id", "id_producto"]));
  if (!id) return null;

  const name = toStringValue(pickValue(row, ["name", "nombre"]));
  const priceRaw = pickValue(row, ["price", "precio"]);
  const priceParsed = toNumberValue(priceRaw);
  const activeRaw = pickValue(row, ["active", "activo"]);
  const productType = parseProductType(pickValue(row, ["product_type", "tipo"]));
  const includes =
    productType === "KIT"
      ? toStringArray(pickValue(row, ["includes", "include", "incluye"]))
      : [];
  const images = toStringArray(pickValue(row, ["images", "images_csv", "image_links", "imagenes"]));
  const stockQtyRaw = pickValue(row, ["stock_qty", "stock", "cantidad_stock"]);
  const stockQtyParsed = toNumberValue(stockQtyRaw);
  const stockQty = Number.isFinite(stockQtyParsed) ? Math.max(0, Math.trunc(stockQtyParsed)) : null;

  return {
    id,
    name: name || id,
    price: Number.isFinite(priceParsed) ? priceParsed : 0,
    currency: toStringValue(pickValue(row, ["currency", "moneda"])) || "ARS",
    active: activeRaw === undefined ? true : toBoolean(activeRaw),
    shortDescription: toStringValue(
      pickValue(row, ["short_description", "shortdescription", "short_description_", "descripcion_corta"])
    ),
    description: toStringValue(pickValue(row, ["description", "descripcion", "descripcion_larga"])),
    includes,
    images,
    isNew: toBoolean(pickValue(row, ["is_new", "nuevo"])),
    isFeatured: toBoolean(pickValue(row, ["is_featured", "destacado"])),
    productType,
    stockStatus: parseStockStatus(pickValue(row, ["stock_status", "estado_stock"]), stockQty),
    stockQty,
    departament: parseDepartament(pickValue(row, ["departament", "departamento", "rubro"])),
    updatedAt: toStringValue(pickValue(row, ["updated_at", "actualizado_en", "fecha_actualizacion"])),
    raw: input,
  };
};

export async function getOrdersForAdmin(): Promise<AdminOrderSheetRow[]> {
  const rows = await fetchRows(SALES_SHEET_NAME);
  return rows
    .map(parseAdminOrderRow)
    .filter((row): row is AdminOrderSheetRow => row !== null)
    .sort((a, b) => b.createdAtMs - a.createdAtMs);
}

export async function getProductsForAdmin(): Promise<AdminProductSheetRow[]> {
  const rows = await fetchRows(PRODUCTS_SHEET_NAME, { includeInactive: true });
  return rows
    .map(parseAdminProductRow)
    .filter((row): row is AdminProductSheetRow => row !== null)
    .sort((a, b) => a.name.localeCompare(b.name, "es"));
}

export async function getOrderRowById(orderId: string): Promise<AdminOrderSheetRow | null> {
  if (!orderId.trim()) return null;
  const orders = await getOrdersForAdmin();
  return orders.find((order) => order.orderId === orderId) || null;
}
