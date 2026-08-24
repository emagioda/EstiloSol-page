/**
 * ESTILO SOL - API APP SCRIPT (V4.0)
 *
 * Script Properties requeridas:
 * - SPREADSHEET_ID: id de la planilla.
 * - SHEETS_READ_TOKEN: lectura server-side del catalogo publico.
 * - SHEETS_WRITE_TOKEN: creacion/actualizacion operativa de ordenes y stock.
 * - SHEETS_ADMIN_TOKEN: lectura/admin de ventas y edicion de productos.
 *
 * Cambios clave:
 * - doGet/doPost exigen token.
 * - Solo se permiten las hojas "products" y "ventas".
 * - El cliente web ya no debe llamar Apps Script directo: usa /api/catalog.
 * - Productos activos usan CacheService por 180 segundos.
 */

const SHEET_PRODUCTS = "products";
const SHEET_SALES = "ventas";
const SHEET_FULFILLMENT = "envios";
const SHEET_INVENTORY_TRANSACTIONS = "_inventory_transactions";
const INVENTORY_TRANSACTION_HEADERS = ["order_id", "demand_fingerprint", "applied_at", "state"];
const INVENTORY_TRANSACTION_STATE_APPLIED = "APPLIED";
const SHEET_ORDER_RECOVERY_SNAPSHOTS = "_order_recovery_snapshots";
const SHEET_PAYMENT_RECOVERY_EVENTS = "_payment_recovery_events";
const SHEET_EMAIL_OUTBOX_EVENTS = "_email_outbox_events";
const RECOVERY_SCHEMA_VERSION = 1;
const EMAIL_OUTBOX_SCHEMA_VERSION = 1;
const EMAIL_OUTBOX_ROLLOUT_AT_PROPERTY = "EMAIL_OUTBOX_ROLLOUT_AT";
const EMAIL_OUTBOX_VENTAS_ELIGIBILITY_HEADER = "receipt_outbox_version";
const EMAIL_OUTBOX_PROVIDER_IDEMPOTENCY_WINDOW_MS = 24 * 60 * 60 * 1000;
const ORDER_RECOVERY_SNAPSHOT_HEADERS = [
  "external_reference",
  "checkout_attempt_id",
  "schema_version",
  "snapshot_hash",
  "snapshot_json",
  "created_at",
  "preference_valid_from",
  "preference_expires_at",
  "recovery_state",
  "last_checked_at",
  "last_error_code",
  "updated_at",
  "completed_at"
];
const PAYMENT_RECOVERY_EVENT_HEADERS = [
  "event_key",
  "payment_id",
  "external_reference",
  "financial_status",
  "status_detail",
  "amount",
  "currency",
  "mp_updated_at",
  "observed_at",
  "source",
  "schema_version",
  "snapshot_hash",
  "validation_state",
  "processing_state",
  "attempt_count",
  "lease_owner",
  "lease_expires_at",
  "last_attempt_at",
  "last_error_code",
  "updated_at",
  "completed_at"
];
const EMAIL_OUTBOX_EVENT_HEADERS = [
  "event_key",
  "external_reference",
  "notification_type",
  "schema_version",
  "template_version",
  "payload_hash",
  "payload_json",
  "idempotency_key",
  "state",
  "attempt_count",
  "lease_owner",
  "lease_expires_at",
  "next_attempt_at",
  "provider_first_attempt_at",
  "provider_outcome_unknown_since",
  "last_attempt_at",
  "last_error_code",
  "provider_message_id",
  "accepted_at",
  "created_at",
  "updated_at",
  "completed_at"
];
const RECOVERY_SNAPSHOT_STATES = ["pending_payment", "payment_observed", "attention", "completed", "expired_unpaid"];
const RECOVERY_EVENT_STATES = ["pending", "processing", "retryable", "attention", "completed"];
const RECOVERY_FINANCIAL_STATUSES = ["approved", "refunded", "charged_back"];
const EMAIL_OUTBOX_STATES = ["pending", "processing", "retryable", "accepted", "attention", "skipped"];
const EMAIL_OUTBOX_MAX_ATTEMPTS = 5;
const CACHE_PRODUCTS_KEY = "catalog:products:active:v4";
const CACHE_PRODUCTS_TTL_SECONDS = 180;
const ALLOWED_SHEETS = [SHEET_PRODUCTS, SHEET_SALES, SHEET_FULFILLMENT];
const ORDER_ID_KEYS = ["nro_de_compra", "order_id", "id_pedido", "orderid", "external_reference", "id"];
const MAX_STOCK_ITEM_LINES = 30;
const MAX_STOCK_QTY_PER_PRODUCT = 50;
const MAX_PRODUCT_ID_LENGTH = 120;
const MAX_INVENTORY_ORDER_ID_LENGTH = 160;

const HEADER_ALIASES = {
  id_pedido: ["order_id", "orderid", "id", "nro_de_compra"],
  order_id: ["id_pedido", "orderid", "id", "nro_de_compra"],
  nro_de_compra: ["order_id", "id_pedido", "orderid", "id"],
  estado_pago: ["payment_status", "status_pago", "paymentstate", "estado_de_pago"],
  payment_status: ["estado_pago", "status_pago", "estado_de_pago"],
  estado_envio: ["shipping_status", "status_envio", "delivery_status", "estado_de_envio"],
  shipping_status: ["estado_envio", "status_envio", "delivery_status", "estado_de_envio"],
  cliente: ["customer_name", "nombre_cliente", "name"],
  nombre_cliente: ["customer_name", "cliente", "name"],
  whatsapp: ["customer_whatsapp", "telefono", "phone"],
  telefono: ["customer_whatsapp", "whatsapp", "phone"],
  total: ["total_amount", "amount_total", "amount"],
  fecha: ["created_at", "order_date", "date"],
  fecha_pedido: ["created_at", "order_date", "date"],
  id_producto: ["product_id", "productid", "id"],
  product_id: ["id_producto", "productid", "id"],
  activo: ["active", "is_active"],
  active: ["activo", "is_active"],
  precio: ["price"],
  price: ["precio"],
  stock_qty: ["stock", "cantidad_stock"],
  stock_status: ["estado_stock"],
  stock_deducted_at: ["stock_descontado_en", "fecha_descuento_stock"],
  stock_descontado_en: ["stock_deducted_at", "fecha_descuento_stock"],
  fecha_descuento_stock: ["stock_deducted_at", "stock_descontado_en"],
  mp_payment_id: ["id_pago_mp", "mercadopago_payment_id"],
  id_pago_mp: ["mp_payment_id", "mercadopago_payment_id"],
  mp_status: ["estado_mp", "mercadopago_status"],
  estado_mp: ["mp_status", "mercadopago_status"],
  is_featured: ["destacado"]
};

function getScriptProperty_(key) {
  return String(PropertiesService.getScriptProperties().getProperty(key) || "").trim();
}

function getSpreadsheet_() {
  const spreadsheetId = getScriptProperty_("SPREADSHEET_ID");
  if (spreadsheetId) return SpreadsheetApp.openById(spreadsheetId);
  return SpreadsheetApp.getActiveSpreadsheet();
}

function normalizeKey(key) {
  return String(key || "")
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function compactKey(key) {
  return normalizeKey(key).replace(/_/g, "");
}

function toBool(v) {
  if (v === true) return true;
  if (v === false) return false;
  if (Number(v) === 1) return true;
  if (Number(v) === 0) return false;
  const str = String(v || "").toLowerCase().trim();
  return str === "true" || str === "verdadero" || str === "si" || str === "sí" || str === "yes";
}

function toNumberOrNull_(v) {
  if (v === undefined || v === null || v === "") return null;
  if (typeof v === "number") return isFinite(v) ? v : null;
  const compact = String(v).trim().replace(/\s/g, "").replace(/[^0-9,.-]/g, "");
  const normalized = compact.indexOf(",") !== -1 ? compact.replace(/\./g, "").replace(",", ".") : compact;
  const parsed = Number(normalized);
  return isFinite(parsed) ? parsed : null;
}

function toCellValue(value) {
  if (value === undefined || value === null) return "";
  if (typeof value === "number" && !isFinite(value)) return "";
  if (Array.isArray(value)) return JSON.stringify(value);
  if (value instanceof Date) return value;
  if (typeof value === "object") return JSON.stringify(value);
  return value;
}

function jsonOutput(payload) {
  return ContentService.createTextOutput(JSON.stringify(payload)).setMimeType(ContentService.MimeType.JSON);
}

function legacyFallbackToken_() {
  const hasScopedToken =
    getScriptProperty_("SHEETS_READ_TOKEN") ||
    getScriptProperty_("SHEETS_WRITE_TOKEN") ||
    getScriptProperty_("SHEETS_ADMIN_TOKEN");
  return hasScopedToken ? "" : (getScriptProperty_("SHEETS_API_TOKEN") || getScriptProperty_("API_TOKEN"));
}

function firstDefinedValue_() {
  for (let i = 0; i < arguments.length; i++) {
    if (arguments[i] !== undefined) return arguments[i];
  }
  return undefined;
}

function toStrictNumberOrNull_(value) {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value === "number") return isFinite(value) ? value : null;
  if (typeof value !== "string") return null;

  const trimmed = value.trim();
  if (!trimmed || !/^[+-]?(?:\d+(?:[.,]\d+)?|[.,]\d+)$/.test(trimmed)) return null;
  const parsed = Number(trimmed.replace(",", "."));
  return isFinite(parsed) ? parsed : null;
}

function toStrictActiveOrNull_(value) {
  if (value === true || value === 1) return true;
  if (value === false || value === 0) return false;
  const token = compactKey(value);
  if (["true", "verdadero", "si", "yes", "1", "active", "activo"].indexOf(token) !== -1) return true;
  if (["false", "falso", "no", "0", "inactive", "inactivo"].indexOf(token) !== -1) return false;
  return null;
}

function toStrictStockStatusOrNull_(value) {
  const token = compactKey(value);
  if (["instock", "disponible"].indexOf(token) !== -1) return "in_stock";
  if (["outofstock", "sinstock", "agotado", "nodisponible"].indexOf(token) !== -1) return "out_of_stock";
  if (["preorder", "preventa", "preventas", "reserva", "areserva"].indexOf(token) !== -1) return "preorder";
  return null;
}

function toStrictCurrencyOrNull_(value) {
  if (typeof value !== "string") return null;
  const currency = value.trim().toUpperCase();
  return /^[A-Z]{3}$/.test(currency) ? currency : null;
}

function isValidInventoryProductId_(value) {
  return typeof value === "string" &&
    value.length > 0 &&
    value.length <= MAX_PRODUCT_ID_LENGTH &&
    /^[a-zA-Z0-9][a-zA-Z0-9._:-]*$/.test(value);
}

function inventoryError_(code, message, context) {
  const error = new Error(message);
  error.name = "InventoryError";
  error.code = code;
  if (context && typeof context.itemIndex === "number") error.itemIndex = context.itemIndex;
  if (context && isValidInventoryProductId_(context.productId)) error.productId = context.productId;
  return error;
}

function expectedTokensForScope_(scope) {
  const readToken = getScriptProperty_("SHEETS_READ_TOKEN");
  const writeToken = getScriptProperty_("SHEETS_WRITE_TOKEN");
  const adminToken = getScriptProperty_("SHEETS_ADMIN_TOKEN");
  const legacyToken = legacyFallbackToken_();
  const tokens = [];

  if (scope === "read") {
    if (readToken) tokens.push(readToken);
    if (adminToken) tokens.push(adminToken);
  } else if (scope === "write") {
    if (writeToken) tokens.push(writeToken);
    if (adminToken) tokens.push(adminToken);
  } else if (scope === "admin") {
    if (adminToken) tokens.push(adminToken);
  }

  if (legacyToken) tokens.push(legacyToken);
  return tokens;
}

function requireTokenFor_(token, scope) {
  const expected = expectedTokensForScope_(scope);
  if (expected.length === 0) throw new Error("Token script property is missing for scope: " + scope);
  if (!token || expected.indexOf(String(token)) === -1) throw new Error("Unauthorized");
}

function getScopeForGet_(sheetName, params) {
  const normalized = normalizeKey(sheetName);
  if (normalized === normalizeKey(SHEET_PRODUCTS)) {
    return toBool(params.includeInactive) ||
      toBool(params.include_inactive) ||
      toBool(params.authoritative)
      ? "admin"
      : "read";
  }
  if (normalized === normalizeKey(SHEET_FULFILLMENT)) return "read";
  if (normalized === normalizeKey(SHEET_SALES)) return "admin";
  throw new Error("Sheet not allowed");
}

function getPostScope_(payload, action) {
  const sheetName = payload.sheet || payload.sheetName || (payload.orderId ? SHEET_SALES : payload.productId ? SHEET_PRODUCTS : "");
  const normalizedSheet = normalizeKey(sheetName);
  const isProductsMutation =
    normalizedSheet === normalizeKey(SHEET_PRODUCTS) ||
    Boolean(payload.productId || payload.product_id);

  if ([
    "apply_admin_order_status_intent",
    "ensure_recovery_schema",
    "upsert_recovery_snapshot",
    "get_recovery_snapshot",
    "list_recovery_snapshots_for_scan",
    "append_recovery_payment_event",
    "get_recovery_payment_event",
    "list_recovery_payment_events",
    "claim_recovery_work",
    "mark_recovery_work_retryable",
    "mark_recovery_work_attention",
    "mark_recovery_work_completed",
    "mark_recovery_snapshot_checked",
    "mark_recovery_snapshot_completed",
    "mark_recovery_snapshot_expired_unpaid",
    "list_recovery_attention",
    "upsert_email_outbox_event",
    "get_email_outbox_event",
    "claim_email_outbox_work",
    "mark_email_outbox_provider_outcome_unknown",
    "clear_email_outbox_provider_outcome_unknown",
    "mark_email_outbox_accepted",
    "mark_email_outbox_retryable",
    "mark_email_outbox_attention",
    "mark_email_outbox_skipped",
    "list_email_outbox_attention",
    "list_missing_receipt_candidates"
  ].indexOf(action) !== -1) return "admin";

  if (action === "decrement_stock" || action === "decrementstock") return "write";
  if (action === "append_order_and_decrement_stock" || action === "appendorderanddecrementstock") return "write";
  if ((action === "append_row" || action === "append") && isProductsMutation) return "admin";
  if ((action === "update_row" || action === "update") && isProductsMutation) return "admin";
  if (action === "append_row" || action === "append" || action === "update_row" || action === "update") return "write";
  throw new Error("Unsupported action");
}

function assertAllowedSheet_(sheetName) {
  const normalized = normalizeKey(sheetName);
  const allowed = ALLOWED_SHEETS.some((name) => normalizeKey(name) === normalized);
  if (!allowed) throw new Error("Sheet not allowed");
}

function getSheetOrThrow(sheetName) {
  assertAllowedSheet_(sheetName);
  const sheet = getSpreadsheet_().getSheetByName(String(sheetName || "").trim());
  if (!sheet) throw new Error("Sheet '" + sheetName + "' not found");
  return sheet;
}

function getHeaders(sheet) {
  const lastColumn = sheet.getLastColumn();
  if (lastColumn <= 0) return [];
  return sheet.getRange(1, 1, 1, lastColumn).getValues()[0].map((h) => String(h || "").trim());
}

function rowToObject(headers, row) {
  const obj = {};
  for (let i = 0; i < headers.length; i++) {
    const key = normalizeKey(headers[i]);
    obj[key] = row[i] === "" ? null : row[i];
  }
  return obj;
}

function parseCsv_(value) {
  return value ? String(value).split(",").map((s) => s.trim()).filter(Boolean) : [];
}

function normalizeProduct(p) {
  const images = parseCsv_(p.images || p.images_csv || p.image_links || p.image || p.imagenes || p.imagenes_csv || p.imagen);
  const specifications = {};

  if (p.specifications && typeof p.specifications === "object") {
    Object.keys(p.specifications).forEach((key) => {
      if (p.specifications[key]) specifications[key] = String(p.specifications[key]);
    });
  } else if (p.specs_csv) {
    String(p.specs_csv).split(",").forEach((item) => {
      const idx = item.indexOf(":");
      if (idx > 0) specifications[item.slice(0, idx).trim()] = item.slice(idx + 1).trim();
    });
  }

  const priceRaw = firstDefinedValue_(p.price, p.precio);
  const stockQtyRaw = firstDefinedValue_(p.stock_qty, p.stock, p.cantidad_stock);
  const stockStatusRaw = firstDefinedValue_(p.stock_status, p.estado_stock);
  const activeRaw = firstDefinedValue_(p.active, p.activo, p.is_active);
  const idRaw = firstDefinedValue_(p.id, p.product_id, p.id_producto);
  const currencyRaw = firstDefinedValue_(p.currency, p.moneda);
  const price = toNumberOrNull_(priceRaw);
  const oldPrice = toNumberOrNull_(p.old_price || p.precio_anterior);
  const stockQty = toNumberOrNull_(stockQtyRaw);
  const rawStockStatus = compactKey(stockStatusRaw);
  const stockStatus =
    rawStockStatus === "outofstock" || rawStockStatus === "sinstock" || rawStockStatus === "agotado"
      ? "out_of_stock"
      : rawStockStatus === "preorder" || rawStockStatus === "preventa" || rawStockStatus === "reserva"
        ? "preorder"
        : (typeof stockQty === "number" && stockQty <= 0 ? "out_of_stock" : "in_stock");
  const rawSlug = p.slug ? String(p.slug).trim() : "";
  const finalSlug = rawSlug || String(idRaw || "");

  return {
    id: isNonEmptyCell_(idRaw) ? String(idRaw) : null,
    name: p.name ? String(p.name) : null,
    slug: finalSlug,
    departament: p.departament ? String(p.departament).toUpperCase() : null,
    category: p.category ? String(p.category) : null,
    price: typeof price === "number" ? price : null,
    old_price: typeof oldPrice === "number" ? oldPrice : null,
    currency: currencyRaw ? String(currencyRaw) : "ARS",
    short_description: p.short_description ? String(p.short_description) : null,
    description: p.description ? String(p.description) : null,
    product_type: compactKey(p.product_type) === "kit" ? "KIT" : "UNICO",
    images: images,
    specifications: specifications,
    group_id: p.group_id ? String(p.group_id).trim() : null,
    variant_name: p.variant_name ? String(p.variant_name).trim() : null,
    is_featured: toBool(p.is_featured || p.destacado),
    is_new: toBool(p.is_new || p.nuevo),
    is_sale: toBool(p.is_sale || p.oferta) || (typeof oldPrice === "number" && typeof price === "number" && oldPrice > price),
    stock_status: stockStatus,
    stock_qty: typeof stockQty === "number" ? stockQty : null,
    active: activeRaw === undefined ? true : toBool(activeRaw),
    authoritative_price: toStrictNumberOrNull_(priceRaw),
    authoritative_currency: toStrictCurrencyOrNull_(currencyRaw),
    authoritative_active: toStrictActiveOrNull_(activeRaw),
    authoritative_stock_status: toStrictStockStatusOrNull_(stockStatusRaw),
    authoritative_stock_qty: toStrictNumberOrNull_(stockQtyRaw),
    created_at: p.created_at ? String(p.created_at) : null,
    updated_at: p.updated_at ? String(p.updated_at) : null
  };
}

function flattenToMap(value, prefix, out) {
  if (value === undefined) return out;
  if (value === null || value instanceof Date || Array.isArray(value) || typeof value !== "object") {
    if (prefix) out[prefix] = value;
    return out;
  }

  if (prefix) out[prefix] = value;
  Object.keys(value).forEach((key) => {
    const childKey = normalizeKey(key);
    flattenToMap(value[key], prefix ? prefix + "_" + childKey : childKey, out);
  });
  return out;
}

function buildValueMap(input) {
  const flat = {};
  flattenToMap(input, "", flat);
  const normalized = {};
  Object.keys(flat).forEach((key) => {
    normalized[normalizeKey(key)] = flat[key];
  });
  return normalized;
}

function resolveValueByHeader(headerKey, valueMap) {
  if (Object.prototype.hasOwnProperty.call(valueMap, headerKey)) return valueMap[headerKey];

  const headerCompact = compactKey(headerKey);
  const mapKeys = Object.keys(valueMap);
  for (let i = 0; i < mapKeys.length; i++) {
    if (compactKey(mapKeys[i]) === headerCompact) return valueMap[mapKeys[i]];
  }

  const aliases = HEADER_ALIASES[headerKey] || [];
  for (let i = 0; i < aliases.length; i++) {
    const alias = normalizeKey(aliases[i]);
    if (Object.prototype.hasOwnProperty.call(valueMap, alias)) return valueMap[alias];
    const aliasCompact = compactKey(alias);
    for (let j = 0; j < mapKeys.length; j++) {
      if (compactKey(mapKeys[j]) === aliasCompact) return valueMap[mapKeys[j]];
    }
  }

  return undefined;
}

function findColumnIndex(headers, candidates) {
  const list = Array.isArray(candidates) ? candidates : [candidates];
  const normalizedHeaders = headers.map((h) => normalizeKey(h));
  const compactHeaders = normalizedHeaders.map((h) => compactKey(h));

  for (let i = 0; i < list.length; i++) {
    const exact = normalizedHeaders.indexOf(normalizeKey(list[i]));
    if (exact !== -1) return exact;
  }
  for (let i = 0; i < list.length; i++) {
    const compact = compactHeaders.indexOf(compactKey(list[i]));
    if (compact !== -1) return compact;
  }
  return -1;
}

function normalizeCompareValue(value) {
  return String(value === null || value === undefined ? "" : value).trim().toLowerCase();
}

function clearCatalogCache_() {
  CacheService.getScriptCache().remove(CACHE_PRODUCTS_KEY);
}

function cacheCatalogItemsSafely_(cache, items) {
  try {
    cache.put(CACHE_PRODUCTS_KEY, JSON.stringify(items), CACHE_PRODUCTS_TTL_SECONDS);
  } catch (err) {
    // CacheService rejects values larger than 100 KB. The cache is an
    // optimization, so a failed write must never make the catalog unavailable.
    logInternalError_("catalogCachePut", err);
  }
}

function isNonEmptyCell_(value) {
  return value !== "" && value !== null && value !== undefined;
}

function resolveFirstValue_(valueMap, candidates) {
  for (let i = 0; i < candidates.length; i++) {
    const value = resolveValueByHeader(normalizeKey(candidates[i]), valueMap);
    if (isNonEmptyCell_(value)) return value;
  }
  return "";
}

function extractOrderIdFromInput_(rowInput) {
  if (!rowInput || typeof rowInput !== "object" || Array.isArray(rowInput)) return "";
  const value = resolveFirstValue_(buildValueMap(rowInput), ORDER_ID_KEYS);
  return String(value || "").trim();
}

function findRowNumberByValue_(sheet, headers, candidates, value) {
  const needle = normalizeCompareValue(value);
  if (!needle) return -1;

  const colIndex = findColumnIndex(headers, candidates);
  if (colIndex === -1) return -1;

  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return -1;

  const values = sheet.getRange(2, colIndex + 1, lastRow - 1, 1).getValues();
  for (let i = 0; i < values.length; i++) {
    if (normalizeCompareValue(values[i][0]) === needle) return i + 2;
  }

  return -1;
}

function findOrderRowNumber_(sheet, headers, orderId) {
  return findRowNumberByValue_(sheet, headers, ORDER_ID_KEYS, orderId);
}

function buildProductsPayloadObject(options) {
  const includeInactive = Boolean(options && options.includeInactive);
  const authoritative = Boolean(options && options.authoritative);
  const force = Boolean(options && options.force);
  const cache = CacheService.getScriptCache();

  if (!includeInactive && !authoritative && !force) {
    const cached = cache.get(CACHE_PRODUCTS_KEY);
    if (cached) {
      const items = JSON.parse(cached);
      return { ok: true, items: items, meta: { count: items.length, cached: true, source_sheet: SHEET_PRODUCTS } };
    }
  }

  SpreadsheetApp.flush();
  const sheet = getSheetOrThrow(SHEET_PRODUCTS);
  const values = sheet.getDataRange().getValues();
  if (!values || values.length === 0) return { ok: true, items: [], meta: { count: 0 } };

  const headers = values.shift().map((h) => String(h).trim());
  const idCol = findColumnIndex(headers, ["id", "product_id", "id_producto"]);
  const nameCol = findColumnIndex(headers, ["name", "nombre", "product_name", "nombre_producto"]);
  const priceCol = findColumnIndex(headers, ["price", "precio"]);
  const hasRequiredProductCols = idCol !== -1 && nameCol !== -1 && priceCol !== -1;
  const rows = values.filter((r) => {
    if (authoritative) {
      return idCol !== -1 && isNonEmptyCell_(r[idCol]);
    }
    if (hasRequiredProductCols) {
      return isNonEmptyCell_(r[idCol]) && isNonEmptyCell_(r[nameCol]) && isNonEmptyCell_(r[priceCol]);
    }
    return r.some(isNonEmptyCell_);
  });
  const items = rows
    .map((r) => rowToObject(headers, r))
    .map(normalizeProduct)
    .filter((p) => authoritative ? Boolean(p.id) : Boolean(p.id && p.name && (includeInactive ? true : p.active)));

  if (!includeInactive && !authoritative) cacheCatalogItemsSafely_(cache, items);

  return {
    ok: true,
    items: items,
    meta: { count: items.length, generated_at: new Date().toISOString(), source_sheet: SHEET_PRODUCTS }
  };
}

function readSheetAsObjects(sheetName) {
  const sheet = getSheetOrThrow(sheetName);
  const values = sheet.getDataRange().getValues();
  if (!values || values.length === 0) return [];
  const headers = values.shift().map((h) => String(h).trim());
  return values
    .filter((r) => r.some((cell) => cell !== "" && cell != null))
    .map((r) => rowToObject(headers, r));
}

function parsePostBody(e) {
  if (!e || !e.postData || !e.postData.contents) throw new Error("POST body is empty");
  const payload = JSON.parse(e.postData.contents);
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) throw new Error("POST body must be a JSON object");
  return payload;
}

function handleAppendRow(payload) {
  const sheetName = payload.sheet || payload.sheetName || SHEET_SALES;
  assertAllowedSheet_(sheetName);
  const rowInput = payload.row || payload.data || payload.values || payload.order;
  if (rowInput === undefined || rowInput === null) throw new Error("appendRow requires row");

  const sheet = getSheetOrThrow(sheetName);
  const headers = getHeaders(sheet);
  const rowValues = buildAppendRowValues_(sheet, rowInput);

  if (normalizeKey(sheetName) === normalizeKey(SHEET_SALES)) {
    const orderId = extractOrderIdFromInput_(rowInput);
    const existingRowNumber = findOrderRowNumber_(sheet, headers, orderId);
    if (existingRowNumber !== -1) {
      return {
        ok: true,
        action: "appendRow",
        sheet: sheetName,
        rowNumber: existingRowNumber,
        deduped: true
      };
    }
  }

  sheet.appendRow(rowValues);

  if (normalizeKey(sheetName) === normalizeKey(SHEET_PRODUCTS)) clearCatalogCache_();
  return { ok: true, action: "appendRow", sheet: sheetName, rowNumber: sheet.getLastRow() };
}

function buildAppendRowValues_(sheet, rowInput) {
  const headers = getHeaders(sheet);
  if (headers.length === 0) throw new Error("Sheet has no header row");

  const rowValues = Array.isArray(rowInput)
    ? headers.map((_, idx) => toCellValue(rowInput[idx]))
    : headers.map((header) => toCellValue(resolveValueByHeader(normalizeKey(header), buildValueMap(rowInput))));

  if (rowValues.every((v) => v === "")) throw new Error("No values matched headers");
  return rowValues;
}

function buildMatchSpec(payload) {
  if (payload.match && typeof payload.match === "object") {
    const key = payload.match.key || payload.match.field || payload.match.column;
    const value = payload.match.value;
    if (!key || value === undefined || value === null || value === "") throw new Error("updateRow.match is required");
    return { keys: [key], value: value };
  }
  if (payload.orderId) return { keys: ["order_id", "id_pedido", "nro_de_compra", "id"], value: payload.orderId };
  if (payload.productId) return { keys: ["product_id", "id_producto", "id"], value: payload.productId };
  if (payload.id) return { keys: ["id"], value: payload.id };
  throw new Error("updateRow requires match/orderId/productId");
}

function handleUpdateRow(payload) {
  const sheetName = payload.sheet || payload.sheetName || (payload.orderId ? SHEET_SALES : payload.productId ? SHEET_PRODUCTS : null);
  if (!sheetName) throw new Error("updateRow requires sheet or orderId/productId");
  assertAllowedSheet_(sheetName);
  const isProductsSheet = normalizeKey(sheetName) === normalizeKey(SHEET_PRODUCTS);

  const updates = payload.updates || payload.data || payload.row;
  if (!updates || typeof updates !== "object" || Array.isArray(updates)) throw new Error("updateRow requires updates object");

  const sheet = getSheetOrThrow(sheetName);
  const headers = getHeaders(sheet);
  const lastRow = sheet.getLastRow();
  if (headers.length === 0 || lastRow < 2) throw new Error("Sheet has no data rows");

  const match = buildMatchSpec(payload);
  const matchColIndex = findColumnIndex(headers, match.keys);
  if (matchColIndex === -1) throw new Error("Could not find match column");

  const data = sheet.getRange(2, 1, lastRow - 1, headers.length).getValues();
  const needle = normalizeCompareValue(match.value);
  const matchedRows = [];
  for (let i = 0; i < data.length; i++) {
    if (normalizeCompareValue(data[i][matchColIndex]) === needle) {
      matchedRows.push(i + 2);
      if (!payload.updateAll) break;
    }
  }
  if (matchedRows.length === 0) throw new Error("No row matched " + headers[matchColIndex]);

  const updateMap = buildValueMap(updates);
  const columnUpdates = {};
  headers.forEach((header, idx) => {
    const normalizedHeader = normalizeKey(header);
    if (isProductsSheet && (normalizedHeader === "stock_status" || normalizedHeader === "estado_stock")) return;
    const value = resolveValueByHeader(normalizedHeader, updateMap);
    if (value !== undefined) columnUpdates[idx] = toCellValue(value);
  });

  const updatedAtCol = findColumnIndex(headers, ["updated_at", "actualizado_en", "fecha_actualizacion"]);
  if (payload.touchUpdatedAt !== false && updatedAtCol !== -1 && columnUpdates[updatedAtCol] === undefined) {
    columnUpdates[updatedAtCol] = new Date().toISOString();
  }

  const updateCols = Object.keys(columnUpdates);
  if (updateCols.length === 0) throw new Error("No update keys matched headers");

  matchedRows.forEach((rowNumber) => {
    updateCols.forEach((colIndex) => {
      sheet.getRange(rowNumber, Number(colIndex) + 1).setValue(columnUpdates[colIndex]);
    });
  });

  if (isProductsSheet) clearCatalogCache_();
  return { ok: true, action: "updateRow", sheet: sheetName, updatedRows: matchedRows.length, rowNumbers: matchedRows };
}

function adminSalesValue_(headers, row, candidates) {
  const column = findColumnIndex(headers, candidates);
  return column === -1 ? "" : row[column];
}

function setAdminSalesValue_(sheet, rowNumber, headers, candidates, value) {
  const normalizedCandidates = candidates.map(function(candidate) { return compactKey(candidate); });
  let matched = false;
  headers.forEach(function(header, index) {
    if (normalizedCandidates.indexOf(compactKey(header)) === -1) return;
    sheet.getRange(rowNumber, index + 1).setValue(toCellValue(value));
    matched = true;
  });
  return matched;
}

function requireAdminSalesColumn_(headers, candidates) {
  if (findColumnIndex(headers, candidates) === -1) {
    throw new Error("Required ventas status column is missing");
  }
}

function appendAtomicAdminSalesValueRequests_(requests, sheetId, rowIndex, headers, candidates, value) {
  const normalizedCandidates = candidates.map(function(candidate) { return compactKey(candidate); });
  headers.forEach(function(header, columnIndex) {
    if (normalizedCandidates.indexOf(compactKey(header)) === -1) return;
    requests.push(sheetsUpdateCellRequest_(sheetId, rowIndex, columnIndex, value));
  });
}

function buildAtomicAdminPaymentClaimRequests_(sheet, rowNumber, headers, claim) {
  const requests = [];
  const sheetId = sheet.getSheetId();
  const rowIndex = rowNumber - 1;
  appendAtomicAdminSalesValueRequests_(requests, sheetId, rowIndex, headers, ["estado_de_pago", "payment_status", "estado_pago", "payment_state"], adminPaymentLabel_("confirmed"));
  appendAtomicAdminSalesValueRequests_(requests, sheetId, rowIndex, headers, ["status", "order_status"], "approved");
  appendAtomicAdminSalesValueRequests_(requests, sheetId, rowIndex, headers, ["mp_status", "estado_mp"], "manual_confirmed");
  appendAtomicAdminSalesValueRequests_(requests, sheetId, rowIndex, headers, ["mp_payment_id", "id_pago_mp"], claim.paymentId);
  appendAtomicAdminSalesValueRequests_(requests, sheetId, rowIndex, headers, ["approved_at", "fecha_pago"], claim.approvedAtIso);
  appendAtomicAdminSalesValueRequests_(requests, sheetId, rowIndex, headers, ["receipt_outbox_version"], 1);
  appendAtomicAdminSalesValueRequests_(requests, sheetId, rowIndex, headers, ["updated_at", "actualizado_en", "fecha_actualizacion"], claim.updatedAtIso);
  return requests;
}

function commitAtomicAdminPaymentClaim_(requests) {
  if (typeof Sheets === "undefined" || !Sheets.Spreadsheets || typeof Sheets.Spreadsheets.batchUpdate !== "function") {
    throw new Error("Advanced Sheets service is required for atomic Admin payment claims");
  }
  const spreadsheetId = getScriptProperty_("SPREADSHEET_ID");
  if (!spreadsheetId) throw new Error("Missing required Script Property: SPREADSHEET_ID");
  Sheets.Spreadsheets.batchUpdate({ requests: requests }, spreadsheetId);
}

function adminPaymentStatusCode_(value) {
  const token = normalizeKey(value);
  if (token.indexOf("contracargo") !== -1 || token.indexOf("charge") !== -1) return "charged_back";
  if (token.indexOf("reintegr") !== -1 || token.indexOf("devol") !== -1 || token.indexOf("refund") !== -1) return "refunded";
  if (token.indexOf("confirm") !== -1 || token.indexOf("aprobad") !== -1) return "confirmed";
  if (token.indexOf("cancel") !== -1 || token.indexOf("rechaz") !== -1) return "cancelled";
  return "pending";
}

function adminShippingStatusCode_(value) {
  const token = normalizeKey(value);
  return token.indexOf("final") !== -1 || token.indexOf("complet") !== -1 || token.indexOf("entreg") !== -1
    ? "completed"
    : "in_process";
}

function adminPaymentLabel_(status) {
  if (status === "confirmed") return "Confirmado";
  if (status === "cancelled") return "Cancelado";
  if (status === "refunded") return "Reintegrado";
  if (status === "charged_back") return "Contracargo";
  return "Pendiente";
}

function adminShippingLabel_(status) {
  return status === "completed" ? "Finalizado" : "En proceso";
}

function adminPaymentMethodCode_(value) {
  const token = normalizeKey(value);
  if (token.indexOf("mercado") !== -1) return "mercadopago";
  if (token.indexOf("transfer") !== -1) return "transfer";
  if (token.indexOf("cash") !== -1 || token.indexOf("efectivo") !== -1) return "cash";
  return "";
}

function adminStatusIntentError_(message) {
  const error = new Error(message || "Invalid Admin order status intent");
  error.code = "INVALID_ADMIN_ORDER_STATUS_INTENT";
  return error;
}

function parseAdminStatusIntent_(payload) {
  const intent = payload.intent;
  if (!intent || typeof intent !== "object" || Array.isArray(intent)) throw adminStatusIntentError_();
  const fields = intent.changedFields;
  if (!Array.isArray(fields) || fields.length === 0) throw adminStatusIntentError_();
  const seen = {};
  fields.forEach(function(field) {
    if (field !== "paymentStatus" && field !== "shippingStatus") throw adminStatusIntentError_();
    if (seen[field]) throw adminStatusIntentError_();
    seen[field] = true;
  });
  if (Boolean(seen.paymentStatus) !== (
    Object.prototype.hasOwnProperty.call(intent, "expectedPaymentStatus") &&
    Object.prototype.hasOwnProperty.call(intent, "requestedPaymentStatus")
  )) throw adminStatusIntentError_();
  if (Boolean(seen.shippingStatus) !== (
    Object.prototype.hasOwnProperty.call(intent, "expectedShippingStatus") &&
    Object.prototype.hasOwnProperty.call(intent, "requestedShippingStatus")
  )) throw adminStatusIntentError_();
  if (seen.paymentStatus) {
    const allowedPayment = ["pending", "confirmed", "cancelled", "refunded", "charged_back"];
    if (allowedPayment.indexOf(intent.expectedPaymentStatus) === -1 || allowedPayment.indexOf(intent.requestedPaymentStatus) === -1) {
      throw adminStatusIntentError_();
    }
  }
  if (seen.shippingStatus) {
    const allowedShipping = ["in_process", "completed"];
    if (allowedShipping.indexOf(intent.expectedShippingStatus) === -1 || allowedShipping.indexOf(intent.requestedShippingStatus) === -1) {
      throw adminStatusIntentError_();
    }
  }
  return { intent: intent, changed: seen };
}

function adminNumber_(value) {
  if (typeof value === "number" && isFinite(value)) return value;
  const parsed = Number(String(value === undefined || value === null ? "" : value).replace(/[^0-9.-]+/g, ""));
  return isFinite(parsed) ? parsed : NaN;
}

function adminTruthy_(value) {
  const token = normalizeKey(value);
  return value === true || value === 1 || token === "true" || token === "si" || token === "yes" || token === "1";
}

function adminHasText_(value) {
  return String(value === undefined || value === null ? "" : value).trim().length > 0;
}

function adminCompletionBlockReason_(headers, row, paymentStatus) {
  if (paymentStatus !== "confirmed") return "PAYMENT_NOT_CONFIRMED";
  const inventory = normalizeKey(adminSalesValue_(headers, row, ["inventory_status"]));
  if (inventory === "conflict" || inventory === "error") return "INVENTORY_REQUIRES_ATTENTION";
  if (inventory !== "deducted") return "INVENTORY_NOT_DEDUCTED";

  const total = adminNumber_(adminSalesValue_(headers, row, ["total", "total_final"]));
  const subtotal = adminNumber_(adminSalesValue_(headers, row, ["subtotal_productos"]));
  const discount = adminNumber_(adminSalesValue_(headers, row, ["descuento"]));
  const shippingFee = adminNumber_(adminSalesValue_(headers, row, ["costo_envio"]));
  const finalTotal = adminNumber_(adminSalesValue_(headers, row, ["total_final", "total"]));
  const summary = adminSalesValue_(headers, row, ["fulfillment_summary"]);
  if (
    !isFinite(total) || !isFinite(subtotal) || !isFinite(discount) || !isFinite(shippingFee) || !isFinite(finalTotal) ||
    total < 0 || subtotal < 0 || discount < 0 || shippingFee < 0 || finalTotal < 0 ||
    Math.abs((subtotal - discount + shippingFee) - finalTotal) > 0.01 ||
    Math.abs(finalTotal - total) > 0.01 || !adminHasText_(summary)
  ) return "FULFILLMENT_TOTALS_INVALID";

  const deliveryMethod = normalizeKey(adminSalesValue_(headers, row, [
    "delivery_method_code", "delivery_method", "forma_de_entrega", "metodo_entrega"
  ]));
  if (deliveryMethod.indexOf("delivery") !== -1 || deliveryMethod.indexOf("domicilio") !== -1) {
    if (
      !adminHasText_(adminSalesValue_(headers, row, ["delivery_zone_id"])) ||
      !adminHasText_(adminSalesValue_(headers, row, ["delivery_zone_name"])) ||
      !adminTruthy_(adminSalesValue_(headers, row, ["delivery_inside_zone_confirmed"])) ||
      !adminHasText_(adminSalesValue_(headers, row, ["delivery_address_street"])) ||
      !adminHasText_(adminSalesValue_(headers, row, ["delivery_address_number"])) ||
      !adminHasText_(adminSalesValue_(headers, row, ["delivery_address_between_streets"]))
    ) return "DELIVERY_INCOMPLETE";
    return "";
  }
  if (deliveryMethod.indexOf("pickup") !== -1 || deliveryMethod.indexOf("retiro") !== -1 || deliveryMethod.indexOf("encuentro") !== -1) {
    if (
      !adminHasText_(adminSalesValue_(headers, row, ["pickup_point_id"])) ||
      !adminHasText_(adminSalesValue_(headers, row, ["pickup_point_name"])) ||
      !adminHasText_(adminSalesValue_(headers, row, ["pickup_point_address"])) ||
      !adminHasText_(adminSalesValue_(headers, row, ["pickup_point_reference"]))
    ) return "PICKUP_INCOMPLETE";
    return "";
  }
  return "DELIVERY_METHOD_INVALID";
}

function handleApplyAdminOrderStatusIntent_(payload) {
  const parsed = parseAdminStatusIntent_(payload);
  const intent = parsed.intent;
  const changed = parsed.changed;
  const orderId = String(payload.orderId || "").trim();
  if (!orderId) throw adminStatusIntentError_();
  const sheet = getSheetOrThrow(SHEET_SALES);
  const headers = getHeaders(sheet);
  requireAdminSalesColumn_(headers, ["estado_de_pago", "payment_status", "estado_pago", "payment_state"]);
  requireAdminSalesColumn_(headers, ["estado_de_envio", "shipping_status", "estado_envio", "shipping_state"]);
  const rowNumber = findOrderRowNumber_(sheet, headers, orderId);
  if (rowNumber === -1) throw new Error("No row matched order id");
  const row = sheet.getRange(rowNumber, 1, 1, headers.length).getValues()[0];
  let paymentStatus = adminPaymentStatusCode_(adminSalesValue_(headers, row, ["estado_de_pago", "payment_status", "estado_pago", "payment_state"]));
  let shippingStatus = adminShippingStatusCode_(adminSalesValue_(headers, row, ["estado_de_envio", "shipping_status", "estado_envio", "shipping_state"]));
  const current = { paymentStatus: paymentStatus, shippingStatus: shippingStatus };
  let everyTargetAlreadySatisfied = true;
  const fields = intent.changedFields;
  for (let i = 0; i < fields.length; i++) {
    const field = fields[i];
    const actual = current[field];
    const expected = field === "paymentStatus" ? intent.expectedPaymentStatus : intent.expectedShippingStatus;
    const requested = field === "paymentStatus" ? intent.requestedPaymentStatus : intent.requestedShippingStatus;
    if (actual === expected) {
      if (actual !== requested) everyTargetAlreadySatisfied = false;
      continue;
    }
    if (actual === requested) continue;
    return {
      ok: false,
      code: "ORDER_STATE_CHANGED",
      error: "Order state changed",
      orderId: orderId,
      current: current
    };
  }
  if (everyTargetAlreadySatisfied) {
    return {
      ok: true,
      action: "applyAdminOrderStatusIntent",
      outcome: "idempotent_replay",
      current: current,
      paymentApplied: false,
      shippingApplied: false,
      shippingDeferred: false,
      mpPaymentId: String(adminSalesValue_(headers, row, ["mp_payment_id", "id_pago_mp"]) || "").trim(),
      approvedAt: Date.parse(String(adminSalesValue_(headers, row, ["approved_at", "fecha_pago"]) || "")) || undefined
    };
  }

  let paymentApplied = false;
  let shippingApplied = false;
  let shippingDeferred = false;
  let paymentBlockReason = "";
  let completionBlockReason = "";
  let appliedPaymentId = "";
  let appliedApprovedAt;
  if (changed.paymentStatus && paymentStatus !== intent.requestedPaymentStatus) {
    const method = adminPaymentMethodCode_(adminSalesValue_(headers, row, [
      "payment_method_code", "payment_method", "forma_de_pago", "metodo_pago"
    ]));
    if (paymentStatus === "confirmed") paymentBlockReason = "PAYMENT_CONFIRMED_CANNOT_BE_DOWNGRADED";
    else if (["cancelled", "refunded", "charged_back"].indexOf(paymentStatus) !== -1) paymentBlockReason = "PAYMENT_TERMINAL_REQUIRES_CORRECTION";
    else if (method === "mercadopago") {
      return {
        ok: true,
        action: "applyAdminOrderStatusIntent",
        outcome: "provider_confirmation_required",
        current: current,
        paymentApplied: false,
        shippingApplied: false,
        shippingDeferred: false
      };
    }
    else if (!(paymentStatus === "pending" && intent.requestedPaymentStatus === "confirmed" && (method === "cash" || method === "transfer"))) {
      paymentBlockReason = "PAYMENT_TRANSITION_NOT_ALLOWED";
    }
    if (!paymentBlockReason) {
      requireAdminSalesColumn_(headers, ["status", "order_status"]);
      requireAdminSalesColumn_(headers, ["mp_status", "estado_mp"]);
      requireAdminSalesColumn_(headers, ["mp_payment_id", "id_pago_mp"]);
      requireAdminSalesColumn_(headers, ["approved_at", "fecha_pago"]);
      requireAdminSalesColumn_(headers, ["receipt_outbox_version"]);
      const approvedAtValue = adminSalesValue_(headers, row, ["approved_at", "fecha_pago"]);
      const approvedAt = Date.parse(String(approvedAtValue || "")) || Number(payload.manualApprovedAt) || Date.now();
      const existingPaymentId = String(adminSalesValue_(headers, row, ["mp_payment_id", "id_pago_mp"]) || "").trim();
      const paymentId = existingPaymentId || String(payload.manualPaymentId || ("manual-" + orderId));
      const claimRequests = buildAtomicAdminPaymentClaimRequests_(sheet, rowNumber, headers, {
        paymentId: paymentId,
        approvedAtIso: new Date(approvedAt).toISOString(),
        updatedAtIso: new Date().toISOString()
      });
      commitAtomicAdminPaymentClaim_(claimRequests);
      paymentStatus = "confirmed";
      paymentApplied = true;
      appliedPaymentId = paymentId;
      appliedApprovedAt = approvedAt;
    }
  }

  if (!paymentBlockReason && changed.shippingStatus && shippingStatus !== intent.requestedShippingStatus) {
    if (shippingStatus === "completed" && intent.requestedShippingStatus === "in_process") {
      completionBlockReason = "SHIPPING_COMPLETED_REOPEN_NOT_ALLOWED";
    } else if (intent.requestedShippingStatus === "completed") {
      const refreshedRow = sheet.getRange(rowNumber, 1, 1, headers.length).getValues()[0];
      const completionReason = adminCompletionBlockReason_(headers, refreshedRow, paymentStatus);
      if (paymentApplied && completionReason === "INVENTORY_NOT_DEDUCTED") {
        shippingDeferred = true;
      } else if (completionReason) {
        completionBlockReason = completionReason;
      } else {
        setAdminSalesValue_(sheet, rowNumber, headers, ["estado_de_envio", "shipping_status", "estado_envio", "shipping_state"], adminShippingLabel_("completed"));
        shippingStatus = "completed";
        shippingApplied = true;
      }
    } else {
      setAdminSalesValue_(sheet, rowNumber, headers, ["estado_de_envio", "shipping_status", "estado_envio", "shipping_state"], adminShippingLabel_("in_process"));
      shippingStatus = "in_process";
      shippingApplied = true;
    }
  }
  if (shippingApplied) {
    setAdminSalesValue_(sheet, rowNumber, headers, ["updated_at", "actualizado_en", "fecha_actualizacion"], new Date().toISOString());
  }

  const latestRow = sheet.getRange(rowNumber, 1, 1, headers.length).getValues()[0];
  const latest = {
    paymentStatus: paymentStatus,
    shippingStatus: shippingStatus
  };
  return {
    ok: true,
    action: "applyAdminOrderStatusIntent",
    outcome: paymentBlockReason || completionBlockReason ? "business_block" : "applied",
    current: latest,
    paymentApplied: paymentApplied,
    shippingApplied: shippingApplied,
    shippingDeferred: shippingDeferred,
    paymentBlockReason: paymentBlockReason || undefined,
    completionBlockReason: completionBlockReason || undefined,
    mpPaymentId: paymentApplied
      ? appliedPaymentId
      : String(adminSalesValue_(headers, latestRow, ["mp_payment_id", "id_pago_mp"]) || "").trim(),
    approvedAt: paymentApplied
      ? appliedApprovedAt
      : Date.parse(String(adminSalesValue_(headers, latestRow, ["approved_at", "fecha_pago"]) || "")) || undefined
  };
}

function normalizeStockItems_(items) {
  if (!Array.isArray(items) || items.length === 0) {
    throw inventoryError_("INVALID_ITEMS", "Inventory items are required");
  }
  if (items.length > MAX_STOCK_ITEM_LINES) {
    throw inventoryError_("TOO_MANY_ITEMS", "Too many inventory item lines");
  }

  const parsedItems = [];
  for (let itemIndex = 0; itemIndex < items.length; itemIndex++) {
    const item = items[itemIndex];
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      throw inventoryError_("INVALID_ITEMS", "Invalid inventory item structure", { itemIndex: itemIndex });
    }

    const allowedKeys = ["productId", "product_id", "id", "qty", "title", "name"];
    const hasUnexpectedKey = Object.keys(item).some(function(key) {
      return allowedKeys.indexOf(key) === -1;
    });
    if (hasUnexpectedKey) {
      throw inventoryError_("INVALID_ITEMS", "Invalid inventory item structure", { itemIndex: itemIndex });
    }

    const productIdValue = firstDefinedValue_(item.productId, item.product_id, item.id);
    const productId = (typeof productIdValue === "string" || typeof productIdValue === "number")
      ? String(productIdValue).trim()
      : "";
    if (!isValidInventoryProductId_(productId)) {
      throw inventoryError_("INVALID_ITEMS", "Invalid inventory product id", { itemIndex: itemIndex });
    }

    const qty = item.qty;
    if (typeof qty !== "number" || !isFinite(qty) || !Number.isInteger(qty) || qty < 1 || qty > MAX_STOCK_QTY_PER_PRODUCT) {
      throw inventoryError_("INVALID_QUANTITY", "Invalid inventory quantity", {
        itemIndex: itemIndex,
        productId: productId
      });
    }

    parsedItems.push({ productId: productId, qty: qty });
  }

  return aggregateStockItems_(parsedItems);
}

function aggregateStockItems_(items) {
  const demandsByProductId = {};
  const orderedKeys = [];

  items.forEach(function(item) {
    const key = normalizeCompareValue(item.productId);
    if (!Object.prototype.hasOwnProperty.call(demandsByProductId, key)) {
      demandsByProductId[key] = { productId: item.productId, qty: 0 };
      orderedKeys.push(key);
    }

    const nextQty = demandsByProductId[key].qty + item.qty;
    if (!Number.isSafeInteger(nextQty) || nextQty > MAX_STOCK_QTY_PER_PRODUCT) {
      throw inventoryError_("AGGREGATED_QUANTITY_LIMIT", "Aggregated inventory quantity exceeds limit", {
        productId: item.productId
      });
    }
    demandsByProductId[key].qty = nextQty;
  });

  return orderedKeys.map(function(key) { return demandsByProductId[key]; });
}

function stockDeductionPropertyKey_(orderId) {
  return "stock_deducted:" + String(orderId || "").trim();
}

function normalizeInventoryOrderId_(payload) {
  const orderId = String(payload.orderId || payload.order_id || payload.externalReference || "").trim();
  if (!orderId || orderId.length > MAX_INVENTORY_ORDER_ID_LENGTH || !/^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(orderId)) {
    throw inventoryError_("INVALID_ORDER_ID", "Inventory order id is invalid");
  }
  return orderId;
}

function inventoryDemandFingerprint_(items) {
  const canonical = items.map(function(item) {
    return normalizeCompareValue(item.productId) + "\t" + String(item.qty);
  }).sort().join("\n");
  const digest = Utilities.computeDigest(
    Utilities.DigestAlgorithm.SHA_256,
    "inventory-demand-v1\n" + canonical,
    Utilities.Charset.UTF_8
  );
  return digest.map(function(value) {
    const unsigned = value < 0 ? value + 256 : value;
    return ("0" + unsigned.toString(16)).slice(-2);
  }).join("");
}

function logInventoryApply_(event, context) {
  const entry = { event: event };
  if (context && context.orderId) entry.orderId = context.orderId;
  if (context && typeof context.productCount === "number") entry.productCount = context.productCount;
  if (context && context.code) entry.code = context.code;
  console.info(JSON.stringify(entry));
}

function legacyInventoryDeductionExists_(orderId) {
  return Boolean(PropertiesService.getScriptProperties().getProperty(stockDeductionPropertyKey_(orderId)));
}

function allocateInventoryJournalSheetId_(spreadsheet) {
  const used = {};
  spreadsheet.getSheets().forEach(function(sheet) {
    used[sheet.getSheetId()] = true;
  });
  let candidate = 1900000000;
  while (used[candidate] && candidate < 2147483000) candidate += 1;
  if (used[candidate]) throw new Error("Unable to allocate inventory journal sheet id");
  return candidate;
}

function assertInventoryJournalHeaders_(sheet) {
  const headers = getHeaders(sheet);
  const valid = headers.length === INVENTORY_TRANSACTION_HEADERS.length && headers.every(function(header, index) {
    return header === INVENTORY_TRANSACTION_HEADERS[index];
  });
  if (!valid) {
    throw inventoryError_("INVENTORY_JOURNAL_INVALID", "Inventory transaction journal headers are invalid");
  }
}

function resolveInventoryJournal_(spreadsheet, orderId, fingerprint) {
  const sheet = spreadsheet.getSheetByName(SHEET_INVENTORY_TRANSACTIONS);
  if (!sheet) {
    return {
      outcome: "PENDING",
      createSheet: true,
      sheetId: allocateInventoryJournalSheetId_(spreadsheet)
    };
  }

  assertInventoryJournalHeaders_(sheet);
  const lastRow = sheet.getLastRow();
  const rows = lastRow < 2 ? [] : sheet.getRange(2, 1, lastRow - 1, INVENTORY_TRANSACTION_HEADERS.length).getValues();
  const seenOrderIds = {};
  let matchingRow = null;
  rows.forEach(function(row) {
    const recordedOrderId = String(row[0] === null || row[0] === undefined ? "" : row[0]).trim();
    const recordedFingerprint = String(row[1] === null || row[1] === undefined ? "" : row[1]).trim();
    const appliedAt = String(row[2] === null || row[2] === undefined ? "" : row[2]).trim();
    const state = String(row[3] === null || row[3] === undefined ? "" : row[3]).trim();
    if (!recordedOrderId && !recordedFingerprint && !appliedAt && !state) return;
    if (
      !recordedOrderId ||
      recordedOrderId.length > MAX_INVENTORY_ORDER_ID_LENGTH ||
      !/^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(recordedOrderId) ||
      !/^[a-f0-9]{64}$/.test(recordedFingerprint) ||
      !appliedAt ||
      isNaN(Date.parse(appliedAt)) ||
      state !== INVENTORY_TRANSACTION_STATE_APPLIED
    ) {
      throw inventoryError_("INVENTORY_JOURNAL_INVALID", "Inventory transaction journal row is invalid");
    }
    if (seenOrderIds[recordedOrderId]) {
      throw inventoryError_("INVENTORY_JOURNAL_INVALID", "Inventory transaction journal contains duplicate order ids");
    }
    seenOrderIds[recordedOrderId] = true;
    if (recordedOrderId === orderId) matchingRow = {
      fingerprint: recordedFingerprint
    };
  });
  if (matchingRow) {
    if (matchingRow.fingerprint !== fingerprint) {
      throw inventoryError_("INVENTORY_IDEMPOTENCY_CONFLICT", "Order id was already applied with different inventory demand");
    }
    return {
      outcome: "ALREADY_APPLIED",
      createSheet: false,
      sheetId: sheet.getSheetId()
    };
  }

  return {
    outcome: "PENDING",
    createSheet: false,
    sheetId: sheet.getSheetId()
  };
}

function sheetsExtendedValue_(value) {
  if (typeof value === "number") return { numberValue: value };
  if (typeof value === "boolean") return { boolValue: value };
  return { stringValue: String(value === null || value === undefined ? "" : value) };
}

function sheetsCell_(value) {
  return { userEnteredValue: sheetsExtendedValue_(value) };
}

function sheetsUpdateCellRequest_(sheetId, rowIndex, columnIndex, value) {
  return {
    updateCells: {
      start: { sheetId: sheetId, rowIndex: rowIndex, columnIndex: columnIndex },
      rows: [{ values: [sheetsCell_(value)] }],
      fields: "userEnteredValue"
    }
  };
}

function sheetsAppendRowRequest_(sheetId, values) {
  return {
    appendCells: {
      sheetId: sheetId,
      rows: [{ values: values.map(sheetsCell_) }],
      fields: "userEnteredValue"
    }
  };
}

function buildAtomicInventoryRequests_(stockPlan, journal, orderId, fingerprint, now, salesAppend) {
  const requests = [];
  if (journal.createSheet) {
    requests.push({
      addSheet: {
        properties: {
          sheetId: journal.sheetId,
          title: SHEET_INVENTORY_TRANSACTIONS,
          hidden: true,
          gridProperties: { rowCount: 1000, columnCount: INVENTORY_TRANSACTION_HEADERS.length, frozenRowCount: 1 }
        }
      }
    });
    requests.push(sheetsAppendRowRequest_(journal.sheetId, INVENTORY_TRANSACTION_HEADERS));
  }
  if (salesAppend) requests.push(sheetsAppendRowRequest_(salesAppend.sheetId, salesAppend.values));
  stockPlan.updates.forEach(function(update) {
    requests.push(sheetsUpdateCellRequest_(stockPlan.sheetId, update.rowNumber - 1, stockPlan.stockQtyCol, update.nextQty));
    if (stockPlan.updatedAtCol !== -1) {
      requests.push(sheetsUpdateCellRequest_(stockPlan.sheetId, update.rowNumber - 1, stockPlan.updatedAtCol, now));
    }
  });
  requests.push(sheetsAppendRowRequest_(journal.sheetId, [
    orderId,
    fingerprint,
    now,
    INVENTORY_TRANSACTION_STATE_APPLIED
  ]));
  return requests;
}

function commitAtomicInventoryRequests_(requests) {
  if (typeof Sheets === "undefined" || !Sheets.Spreadsheets || typeof Sheets.Spreadsheets.batchUpdate !== "function") {
    throw new Error("Advanced Sheets service is required for atomic inventory updates");
  }
  const spreadsheetId = getScriptProperty_("SPREADSHEET_ID");
  if (!spreadsheetId) throw new Error("Missing required Script Property: SPREADSHEET_ID");
  Sheets.Spreadsheets.batchUpdate({ requests: requests }, spreadsheetId);
}

function clearCatalogCacheAfterInventory_() {
  try {
    clearCatalogCache_();
  } catch (err) {
    logInternalError_("inventory catalog cache invalidation", err);
  }
}

function alreadyAppliedInventoryResult_(action, orderId, legacyMarker) {
  clearCatalogCacheAfterInventory_();
  logInventoryApply_("inventory.apply.already_applied", { orderId: orderId });
  return {
    ok: true,
    action: action,
    outcome: "ALREADY_APPLIED",
    deduped: true,
    legacyMarker: Boolean(legacyMarker),
    orderId: orderId
  };
}

function handleDecrementStock(payload) {
  const sheetName = payload.sheet || payload.sheetName || SHEET_PRODUCTS;
  assertAllowedSheet_(sheetName);
  if (normalizeKey(sheetName) !== normalizeKey(SHEET_PRODUCTS)) {
    throw new Error("decrementStock only supports products sheet");
  }

  const orderId = normalizeInventoryOrderId_(payload);
  const productCount = Array.isArray(payload.items) ? payload.items.length : 0;
  logInventoryApply_("inventory.apply.started", { orderId: orderId, productCount: productCount });

  try {
    const items = normalizeStockItems_(payload.items);
    const fingerprint = inventoryDemandFingerprint_(items);
    if (legacyInventoryDeductionExists_(orderId)) {
      return alreadyAppliedInventoryResult_("decrementStock", orderId, true);
    }

    const spreadsheet = getSpreadsheet_();
    const journal = resolveInventoryJournal_(spreadsheet, orderId, fingerprint);
    if (journal.outcome === "ALREADY_APPLIED") {
      return alreadyAppliedInventoryResult_("decrementStock", orderId, false);
    }

    const stockPlan = planStockDecrement_(items);
    const now = new Date().toISOString();
    const requests = buildAtomicInventoryRequests_(stockPlan, journal, orderId, fingerprint, now, null);
    commitAtomicInventoryRequests_(requests);
    clearCatalogCacheAfterInventory_();
    logInventoryApply_("inventory.apply.applied", { orderId: orderId, productCount: productCount });

    return {
      ok: true,
      action: "decrementStock",
      outcome: "APPLIED",
      orderId: orderId,
      deduped: false,
      updated: stockPlan.updates.map(function(update) {
        return {
          productId: update.productId,
          previousQty: update.previousQty,
          nextQty: update.nextQty
        };
      })
    };
  } catch (err) {
    logInventoryApply_(err && err.code ? "inventory.apply.conflict" : "inventory.apply.error", {
      orderId: orderId,
      productCount: productCount,
      code: err && err.code ? err.code : "INVENTORY_COMMIT_FAILED"
    });
    throw err;
  }
}

function planStockDecrement_(items) {
  const sheet = getSheetOrThrow(SHEET_PRODUCTS);
  const headers = getHeaders(sheet);
  const lastRow = sheet.getLastRow();
  if (headers.length === 0 || lastRow < 2) {
    throw inventoryError_("INVENTORY_VALIDATION_FAILED", "Products sheet has no inventory rows");
  }

  const idCol = findColumnIndex(headers, ["id", "product_id", "id_producto"]);
  const activeCol = findColumnIndex(headers, ["active", "activo", "is_active"]);
  const stockStatusCol = findColumnIndex(headers, ["stock_status", "estado_stock"]);
  const stockQtyCol = findColumnIndex(headers, ["stock_qty", "stock", "cantidad_stock"]);
  const updatedAtCol = findColumnIndex(headers, ["updated_at", "actualizado_en", "fecha_actualizacion"]);

  if (idCol === -1 || activeCol === -1 || stockStatusCol === -1 || stockQtyCol === -1) {
    throw inventoryError_("INVENTORY_VALIDATION_FAILED", "Products sheet is missing required inventory columns");
  }

  const data = sheet.getRange(2, 1, lastRow - 1, headers.length).getValues();
  const rowsByProductId = {};
  for (let i = 0; i < data.length; i++) {
    const productId = String(data[i][idCol] === null || data[i][idCol] === undefined ? "" : data[i][idCol]).trim();
    if (!productId) continue;
    const key = normalizeCompareValue(productId);
    if (!Object.prototype.hasOwnProperty.call(rowsByProductId, key)) rowsByProductId[key] = [];
    rowsByProductId[key].push({
      rowNumber: i + 2,
      row: data[i]
    });
  }

  const updates = [];
  items.forEach(function(item) {
    const matches = rowsByProductId[normalizeCompareValue(item.productId)] || [];
    if (matches.length === 0) {
      throw inventoryError_("PRODUCT_NOT_FOUND", "Product not found for stock decrement", {
        productId: item.productId
      });
    }
    if (matches.length > 1) {
      throw inventoryError_("DUPLICATE_PRODUCT_ID", "Duplicate product id in inventory", {
        productId: item.productId
      });
    }

    const found = matches[0];
    if (toStrictActiveOrNull_(found.row[activeCol]) !== true) {
      throw inventoryError_("PRODUCT_INACTIVE", "Product is inactive", { productId: item.productId });
    }

    if (toStrictStockStatusOrNull_(found.row[stockStatusCol]) !== "in_stock") {
      throw inventoryError_("PRODUCT_NOT_AVAILABLE", "Product is not available", { productId: item.productId });
    }

    const currentQty = toStrictNumberOrNull_(found.row[stockQtyCol]);
    if (currentQty === null || !Number.isInteger(currentQty) || currentQty < 0) {
      throw inventoryError_("INVALID_STOCK_QTY", "Product stock quantity is invalid", {
        productId: item.productId
      });
    }

    if (currentQty < item.qty) {
      throw inventoryError_("INSUFFICIENT_STOCK", "Insufficient product stock", {
        productId: item.productId
      });
    }

    const nextQty = currentQty - item.qty;
    updates.push({
      productId: item.productId,
      rowNumber: found.rowNumber,
      previousQty: currentQty,
      nextQty: nextQty
    });
  });

  return {
    sheet: sheet,
    sheetId: sheet.getSheetId(),
    headers: headers,
    stockQtyCol: stockQtyCol,
    updatedAtCol: updatedAtCol,
    updates: updates
  };
}

function handleAppendOrderAndDecrementStock(payload) {
  const orderId = normalizeInventoryOrderId_(payload);
  const productCount = Array.isArray(payload.items) ? payload.items.length : 0;
  logInventoryApply_("inventory.apply.started", { orderId: orderId, productCount: productCount });

  try {
    const items = normalizeStockItems_(payload.items);
    const fingerprint = inventoryDemandFingerprint_(items);
    if (legacyInventoryDeductionExists_(orderId)) {
      return alreadyAppliedInventoryResult_("appendOrderAndDecrementStock", orderId, true);
    }

    const salesSheetName = payload.sheet || payload.sheetName || SHEET_SALES;
    assertAllowedSheet_(salesSheetName);
    if (normalizeKey(salesSheetName) !== normalizeKey(SHEET_SALES)) {
      throw new Error("appendOrderAndDecrementStock only supports ventas sheet");
    }

    const rowInput = payload.row || payload.data || payload.values || payload.order;
    if (rowInput === undefined || rowInput === null) throw new Error("appendOrderAndDecrementStock requires row");

    const spreadsheet = getSpreadsheet_();
    const journal = resolveInventoryJournal_(spreadsheet, orderId, fingerprint);
    if (journal.outcome === "ALREADY_APPLIED") {
      return alreadyAppliedInventoryResult_("appendOrderAndDecrementStock", orderId, false);
    }

    const salesSheet = getSheetOrThrow(SHEET_SALES);
    const salesHeaders = getHeaders(salesSheet);
    const rowValues = buildAppendRowValues_(salesSheet, rowInput);
    const existingSalesRow = findOrderRowNumber_(salesSheet, salesHeaders, orderId);
    const salesRowNumber = existingSalesRow === -1 ? salesSheet.getLastRow() + 1 : existingSalesRow;
    const stockPlan = planStockDecrement_(items);
    const now = new Date().toISOString();
    const salesAppend = existingSalesRow === -1
      ? { sheetId: salesSheet.getSheetId(), values: rowValues }
      : null;
    const requests = buildAtomicInventoryRequests_(stockPlan, journal, orderId, fingerprint, now, salesAppend);
    commitAtomicInventoryRequests_(requests);
    clearCatalogCacheAfterInventory_();
    logInventoryApply_("inventory.apply.applied", { orderId: orderId, productCount: productCount });

    return {
      ok: true,
      action: "appendOrderAndDecrementStock",
      outcome: "APPLIED",
      orderId: orderId,
      deduped: false,
      salesRowNumber: salesRowNumber,
      dedupedSalesRow: existingSalesRow !== -1,
      updated: stockPlan.updates.map(function(update) {
        return {
          productId: update.productId,
          previousQty: update.previousQty,
          nextQty: update.nextQty
        };
      })
    };
  } catch (err) {
    logInventoryApply_(err && err.code ? "inventory.apply.conflict" : "inventory.apply.error", {
      orderId: orderId,
      productCount: productCount,
      code: err && err.code ? err.code : "INVENTORY_COMMIT_FAILED"
    });
    throw err;
  }
}

function recoveryError_(code, message) {
  const error = new Error(message);
  error.name = "RecoveryError";
  error.code = code;
  return error;
}

function sha256Hex_(value) {
  const digest = Utilities.computeDigest(
    Utilities.DigestAlgorithm.SHA_256,
    String(value),
    Utilities.Charset.UTF_8
  );
  return digest.map(function(byte) {
    return ((byte < 0 ? byte + 256 : byte).toString(16).padStart(2, "0"));
  }).join("");
}

function assertRecoveryHeaders_(sheet, expectedHeaders) {
  const headers = getHeaders(sheet);
  const valid = headers.length === expectedHeaders.length && headers.every(function(header, index) {
    return header === expectedHeaders[index];
  });
  if (!valid) {
    throw recoveryError_("RECOVERY_SCHEMA_INVALID", "Recovery sheet headers are invalid");
  }
}

function ensureRecoverySheet_(spreadsheet, sheetName, expectedHeaders) {
  let sheet = spreadsheet.getSheetByName(sheetName);
  if (!sheet) {
    sheet = spreadsheet.insertSheet(sheetName);
    sheet.getRange(1, 1, 1, expectedHeaders.length).setValues([expectedHeaders.slice()]);
    sheet.setFrozenRows(1);
    sheet.hideSheet();
  }
  assertRecoveryHeaders_(sheet, expectedHeaders);
  if (typeof sheet.isSheetHidden === "function" && !sheet.isSheetHidden()) {
    sheet.hideSheet();
  }
  return sheet;
}

function emailOutboxEligibilityColumns_(headers) {
  const supported = [
    EMAIL_OUTBOX_VENTAS_ELIGIBILITY_HEADER,
    "receipt_email_outbox_version",
    "email_outbox_version"
  ].map(function(header) { return compactKey(header); });
  return headers.map(function(header, index) {
    return { header: String(header || "").trim(), index: index };
  }).filter(function(entry) {
    return supported.indexOf(compactKey(entry.header)) !== -1;
  });
}

function assertEmailOutboxEligibilityColumn_(sheet) {
  const matches = emailOutboxEligibilityColumns_(getHeaders(sheet));
  if (
    matches.length !== 1 ||
    matches[0].header !== EMAIL_OUTBOX_VENTAS_ELIGIBILITY_HEADER
  ) {
    throw recoveryError_(
      "EMAIL_OUTBOX_SCHEMA_INVALID",
      "Ventas email outbox eligibility column is missing or ambiguous"
    );
  }
  return matches[0].index;
}

function ensureEmailOutboxEligibilityColumn_(spreadsheet) {
  const sheet = spreadsheet.getSheetByName(SHEET_SALES);
  if (!sheet) {
    throw recoveryError_("EMAIL_OUTBOX_SCHEMA_INVALID", "Ventas sheet is missing");
  }
  const headers = getHeaders(sheet);
  const matches = emailOutboxEligibilityColumns_(headers);
  if (matches.length > 1 || (matches.length === 1 && matches[0].header !== EMAIL_OUTBOX_VENTAS_ELIGIBILITY_HEADER)) {
    throw recoveryError_("EMAIL_OUTBOX_SCHEMA_INVALID", "Ventas email outbox eligibility column is ambiguous");
  }
  if (matches.length === 0) {
    sheet.getRange(1, headers.length + 1).setValue(EMAIL_OUTBOX_VENTAS_ELIGIBILITY_HEADER);
  }
  assertEmailOutboxEligibilityColumn_(sheet);
  return sheet;
}

function ensureRecoverySchema_(includeEmailOutbox) {
  const spreadsheet = getSpreadsheet_();
  const snapshotSheet = ensureRecoverySheet_(
    spreadsheet,
    SHEET_ORDER_RECOVERY_SNAPSHOTS,
    ORDER_RECOVERY_SNAPSHOT_HEADERS
  );
  const eventSheet = ensureRecoverySheet_(
    spreadsheet,
    SHEET_PAYMENT_RECOVERY_EVENTS,
    PAYMENT_RECOVERY_EVENT_HEADERS
  );
  const schema = { snapshotSheet: snapshotSheet, eventSheet: eventSheet };
  if (includeEmailOutbox === true) {
    schema.emailOutboxSheet = ensureRecoverySheet_(
      spreadsheet,
      SHEET_EMAIL_OUTBOX_EVENTS,
      EMAIL_OUTBOX_EVENT_HEADERS
    );
    schema.salesSheet = ensureEmailOutboxEligibilityColumn_(spreadsheet);
    const properties = PropertiesService.getScriptProperties();
    let rolloutAt = String(properties.getProperty(EMAIL_OUTBOX_ROLLOUT_AT_PROPERTY) || "").trim();
    if (!rolloutAt) {
      rolloutAt = new Date().toISOString();
      properties.setProperty(EMAIL_OUTBOX_ROLLOUT_AT_PROPERTY, rolloutAt);
    }
    if (isNaN(Date.parse(rolloutAt))) {
      throw recoveryError_("EMAIL_OUTBOX_SCHEMA_INVALID", "Email outbox rollout boundary is invalid");
    }
    schema.emailOutboxRolloutAt = new Date(Date.parse(rolloutAt)).toISOString();
  }
  return schema;
}

function getEmailOutboxSchema_() {
  const spreadsheet = getSpreadsheet_();
  const sheet = spreadsheet.getSheetByName(SHEET_EMAIL_OUTBOX_EVENTS);
  if (!sheet) {
    throw recoveryError_("EMAIL_OUTBOX_SCHEMA_NOT_READY", "Email outbox schema has not been bootstrapped");
  }
  assertRecoveryHeaders_(sheet, EMAIL_OUTBOX_EVENT_HEADERS);
  if (typeof sheet.isSheetHidden === "function" && !sheet.isSheetHidden()) sheet.hideSheet();
  const salesSheet = spreadsheet.getSheetByName(SHEET_SALES);
  if (!salesSheet) throw recoveryError_("EMAIL_OUTBOX_SCHEMA_INVALID", "Ventas sheet is missing");
  assertEmailOutboxEligibilityColumn_(salesSheet);
  const rolloutAt = String(
    PropertiesService.getScriptProperties().getProperty(EMAIL_OUTBOX_ROLLOUT_AT_PROPERTY) || ""
  ).trim();
  if (!rolloutAt || isNaN(Date.parse(rolloutAt))) {
    throw recoveryError_("EMAIL_OUTBOX_SCHEMA_INVALID", "Email outbox rollout boundary is missing or invalid");
  }
  return { sheet: sheet, rolloutAt: new Date(Date.parse(rolloutAt)).toISOString() };
}

function assertExactObjectKeys_(input, headers, code) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw recoveryError_(code, "Recovery row must be an object");
  }
  const keys = Object.keys(input).sort();
  const expected = headers.slice().sort();
  if (keys.length !== expected.length || keys.some(function(key, index) { return key !== expected[index]; })) {
    throw recoveryError_(code, "Recovery row keys are invalid");
  }
}

function assertRecoveryIsoDate_(value, field, allowEmpty) {
  const text = String(value === null || value === undefined ? "" : value).trim();
  if (!text && allowEmpty) return "";
  if (!text || isNaN(Date.parse(text))) {
    throw recoveryError_("RECOVERY_SCHEMA_INVALID", "Invalid recovery timestamp: " + field);
  }
  return new Date(Date.parse(text)).toISOString();
}

function safeRecoveryErrorCode_(value) {
  const code = String(value || "").trim();
  if (!code) return "";
  return /^[A-Z0-9_]{3,120}$/.test(code) ? code : "RECOVERY_TECHNICAL_FAILURE";
}

function recoveryRowToObject_(headers, row) {
  const result = {};
  headers.forEach(function(header, index) {
    result[header] = row[index] === undefined || row[index] === null ? "" : row[index];
  });
  return result;
}

function readRecoveryRows_(sheet, headers, identityHeader, duplicateCode) {
  assertRecoveryHeaders_(sheet, headers);
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return [];
  const rows = sheet.getRange(2, 1, lastRow - 1, headers.length).getValues();
  const identityIndex = headers.indexOf(identityHeader);
  const seen = {};
  const result = [];
  rows.forEach(function(row, index) {
    if (!row.some(function(cell) { return cell !== "" && cell !== null && cell !== undefined; })) return;
    const identity = String(row[identityIndex] === undefined || row[identityIndex] === null ? "" : row[identityIndex]).trim();
    if (!identity || seen[identity]) {
      throw recoveryError_(duplicateCode, "Recovery sheet contains missing or duplicate identities");
    }
    seen[identity] = true;
    result.push({ rowNumber: index + 2, values: row.slice(), object: recoveryRowToObject_(headers, row) });
  });
  return result;
}

function setRecoveryCell_(sheet, rowNumber, headers, header, value) {
  const index = headers.indexOf(header);
  if (index === -1) throw recoveryError_("RECOVERY_SCHEMA_INVALID", "Recovery column missing: " + header);
  sheet.getRange(rowNumber, index + 1).setValue(value);
}

function validateRecoverySnapshotInput_(input) {
  assertExactObjectKeys_(input, ORDER_RECOVERY_SNAPSHOT_HEADERS, "RECOVERY_SCHEMA_INVALID");
  const externalReference = String(input.external_reference || "").trim();
  const checkoutAttemptId = String(input.checkout_attempt_id || "").trim();
  const snapshotHash = String(input.snapshot_hash || "").trim();
  const snapshotJson = String(input.snapshot_json || "");
  if (!/^es-[a-z0-9-]{6,80}$/i.test(externalReference) || !checkoutAttemptId || checkoutAttemptId.length > 160) {
    throw recoveryError_("RECOVERY_SCHEMA_INVALID", "Invalid recovery snapshot identity");
  }
  if (Number(input.schema_version) !== RECOVERY_SCHEMA_VERSION || !/^[a-f0-9]{64}$/.test(snapshotHash)) {
    throw recoveryError_("RECOVERY_SCHEMA_INVALID", "Invalid recovery snapshot schema/hash");
  }
  let parsed;
  try {
    parsed = JSON.parse(snapshotJson);
  } catch (error) {
    throw recoveryError_("RECOVERY_SCHEMA_INVALID", "Recovery snapshot JSON is malformed");
  }
  if (
    !parsed ||
    typeof parsed !== "object" ||
    parsed.externalReference !== externalReference ||
    parsed.checkoutAttemptId !== checkoutAttemptId ||
    Number(parsed.schemaVersion) !== RECOVERY_SCHEMA_VERSION ||
    sha256Hex_(snapshotJson) !== snapshotHash
  ) {
    throw recoveryError_("RECOVERY_SNAPSHOT_CONFLICT", "Recovery snapshot integrity mismatch");
  }
  if (String(input.recovery_state) !== "pending_payment") {
    throw recoveryError_("RECOVERY_SCHEMA_INVALID", "New recovery snapshot state is invalid");
  }
  assertRecoveryIsoDate_(input.created_at, "created_at", false);
  assertRecoveryIsoDate_(input.preference_valid_from, "preference_valid_from", false);
  assertRecoveryIsoDate_(input.preference_expires_at, "preference_expires_at", false);
  assertRecoveryIsoDate_(input.last_checked_at, "last_checked_at", true);
  assertRecoveryIsoDate_(input.updated_at, "updated_at", false);
  assertRecoveryIsoDate_(input.completed_at, "completed_at", true);
  return ORDER_RECOVERY_SNAPSHOT_HEADERS.map(function(header) { return input[header]; });
}

function recoverySnapshotImmutableMatches_(existing, candidate) {
  const immutableHeaders = [
    "external_reference",
    "checkout_attempt_id",
    "schema_version",
    "snapshot_hash",
    "snapshot_json",
    "created_at",
    "preference_valid_from",
    "preference_expires_at"
  ];
  return immutableHeaders.every(function(header) {
    return String(existing[header]) === String(candidate[header]);
  });
}

function handleUpsertRecoverySnapshot_(payload) {
  const schema = ensureRecoverySchema_();
  const rowValues = validateRecoverySnapshotInput_(payload.snapshot);
  const rows = readRecoveryRows_(
    schema.snapshotSheet,
    ORDER_RECOVERY_SNAPSHOT_HEADERS,
    "external_reference",
    "RECOVERY_SCHEMA_INVALID"
  );
  const externalReference = String(payload.snapshot.external_reference);
  const existing = rows.filter(function(row) {
    return String(row.object.external_reference) === externalReference;
  });
  if (existing.length > 1) throw recoveryError_("RECOVERY_SCHEMA_INVALID", "Duplicate recovery snapshots");
  if (existing.length === 1) {
    if (!recoverySnapshotImmutableMatches_(existing[0].object, payload.snapshot)) {
      const now = new Date().toISOString();
      setRecoveryCell_(schema.snapshotSheet, existing[0].rowNumber, ORDER_RECOVERY_SNAPSHOT_HEADERS, "recovery_state", "attention");
      setRecoveryCell_(schema.snapshotSheet, existing[0].rowNumber, ORDER_RECOVERY_SNAPSHOT_HEADERS, "last_error_code", "RECOVERY_SNAPSHOT_CONFLICT");
      setRecoveryCell_(schema.snapshotSheet, existing[0].rowNumber, ORDER_RECOVERY_SNAPSHOT_HEADERS, "updated_at", now);
      console.info(JSON.stringify({ event: "recovery.snapshot.conflict", orderId: externalReference }));
      throw recoveryError_("RECOVERY_SNAPSHOT_CONFLICT", "Recovery snapshot already exists with different content");
    }
    console.info(JSON.stringify({ event: "recovery.snapshot.replayed", orderId: externalReference }));
    return { ok: true, result: "SNAPSHOT_ALREADY_EXISTS", snapshot: existing[0].object };
  }
  schema.snapshotSheet.appendRow(rowValues);
  const stored = recoveryRowToObject_(ORDER_RECOVERY_SNAPSHOT_HEADERS, rowValues);
  console.info(JSON.stringify({ event: "recovery.snapshot.persisted", orderId: externalReference }));
  return { ok: true, result: "SNAPSHOT_STORED", snapshot: stored };
}

function findRecoverySnapshot_(externalReference) {
  const schema = ensureRecoverySchema_();
  const rows = readRecoveryRows_(
    schema.snapshotSheet,
    ORDER_RECOVERY_SNAPSHOT_HEADERS,
    "external_reference",
    "RECOVERY_SCHEMA_INVALID"
  ).filter(function(row) { return String(row.object.external_reference) === String(externalReference || "").trim(); });
  if (rows.length > 1) throw recoveryError_("RECOVERY_SCHEMA_INVALID", "Duplicate recovery snapshots");
  return { sheet: schema.snapshotSheet, row: rows.length === 1 ? rows[0] : null };
}

function handleGetRecoverySnapshot_(payload) {
  const found = findRecoverySnapshot_(payload.externalReference);
  if (!found.row) return { ok: true, result: "RECOVERY_SNAPSHOT_NOT_FOUND" };
  return { ok: true, result: "RECOVERY_SNAPSHOT_FOUND", snapshot: found.row.object };
}

function validateRecoveryEventInput_(input) {
  assertExactObjectKeys_(input, PAYMENT_RECOVERY_EVENT_HEADERS, "RECOVERY_SCHEMA_INVALID");
  const eventKey = String(input.event_key || "").trim();
  const paymentId = String(input.payment_id || "").trim();
  const externalReference = String(input.external_reference || "").trim();
  const status = String(input.financial_status || "").trim();
  const currency = String(input.currency || "").trim();
  if (!/^[a-f0-9]{64}$/.test(eventKey) || !/^[A-Za-z0-9_-]{1,64}$/.test(paymentId)) {
    throw recoveryError_("RECOVERY_SCHEMA_INVALID", "Invalid recovery event identity");
  }
  if (externalReference.length > 160 || RECOVERY_FINANCIAL_STATUSES.indexOf(status) === -1) {
    throw recoveryError_("RECOVERY_SCHEMA_INVALID", "Invalid recovery financial reference/status");
  }
  if (!isFinite(Number(input.amount)) || Number(input.amount) < 0 || !/^[A-Z]{3}$/.test(currency)) {
    throw recoveryError_("RECOVERY_SCHEMA_INVALID", "Invalid recovery financial amount/currency");
  }
  if (Number(input.schema_version) !== RECOVERY_SCHEMA_VERSION) {
    throw recoveryError_("RECOVERY_SCHEMA_INVALID", "Invalid recovery event schema");
  }
  if (["validated", "missing_snapshot", "conflict"].indexOf(String(input.validation_state)) === -1) {
    throw recoveryError_("RECOVERY_SCHEMA_INVALID", "Invalid recovery validation state");
  }
  if (["pending", "attention"].indexOf(String(input.processing_state)) === -1) {
    throw recoveryError_("RECOVERY_SCHEMA_INVALID", "Invalid initial recovery processing state");
  }
  if (Number(input.attempt_count) !== 0 || String(input.lease_owner || "") || String(input.lease_expires_at || "")) {
    throw recoveryError_("RECOVERY_SCHEMA_INVALID", "Invalid initial recovery coordination state");
  }
  assertRecoveryIsoDate_(input.mp_updated_at, "mp_updated_at", true);
  assertRecoveryIsoDate_(input.observed_at, "observed_at", false);
  assertRecoveryIsoDate_(input.last_attempt_at, "last_attempt_at", true);
  assertRecoveryIsoDate_(input.updated_at, "updated_at", false);
  assertRecoveryIsoDate_(input.completed_at, "completed_at", true);
  return PAYMENT_RECOVERY_EVENT_HEADERS.map(function(header) { return input[header]; });
}

function recoveryEventFinancialPayloadMatches_(existing, candidate) {
  const immutableHeaders = [
    "event_key",
    "payment_id",
    "external_reference",
    "financial_status",
    "status_detail",
    "amount",
    "currency",
    "mp_updated_at",
    "schema_version",
    "snapshot_hash",
    "validation_state"
  ];
  return immutableHeaders.every(function(header) {
    return String(existing[header]) === String(candidate[header]);
  });
}

function handleAppendRecoveryPaymentEvent_(payload) {
  const schema = ensureRecoverySchema_();
  const rowValues = validateRecoveryEventInput_(payload.event);
  const rows = readRecoveryRows_(
    schema.eventSheet,
    PAYMENT_RECOVERY_EVENT_HEADERS,
    "event_key",
    "RECOVERY_SCHEMA_INVALID"
  );
  const eventKey = String(payload.event.event_key);
  const existing = rows.filter(function(row) { return String(row.object.event_key) === eventKey; });
  if (existing.length > 1) throw recoveryError_("RECOVERY_SCHEMA_INVALID", "Duplicate recovery events");
  if (existing.length === 1) {
    if (!recoveryEventFinancialPayloadMatches_(existing[0].object, payload.event)) {
      const now = new Date().toISOString();
      setRecoveryCell_(schema.eventSheet, existing[0].rowNumber, PAYMENT_RECOVERY_EVENT_HEADERS, "processing_state", "attention");
      setRecoveryCell_(schema.eventSheet, existing[0].rowNumber, PAYMENT_RECOVERY_EVENT_HEADERS, "last_error_code", "RECOVERY_EVENT_CONFLICT");
      setRecoveryCell_(schema.eventSheet, existing[0].rowNumber, PAYMENT_RECOVERY_EVENT_HEADERS, "updated_at", now);
      console.info(JSON.stringify({ event: "recovery.payment_event.conflict", paymentId: payload.event.payment_id }));
      throw recoveryError_("RECOVERY_EVENT_CONFLICT", "Recovery event key has conflicting financial data");
    }
    console.info(JSON.stringify({ event: "recovery.payment_event.replayed", paymentId: existing[0].object.payment_id }));
    return { ok: true, result: "EVENT_ALREADY_STORED", event: existing[0].object };
  }
  schema.eventSheet.appendRow(rowValues);
  const stored = recoveryRowToObject_(PAYMENT_RECOVERY_EVENT_HEADERS, rowValues);
  console.info(JSON.stringify({ event: "recovery.payment_event.persisted", paymentId: stored.payment_id, state: stored.processing_state }));
  return { ok: true, result: "EVENT_STORED", event: stored };
}

function findRecoveryEvent_(eventKey) {
  const schema = ensureRecoverySchema_();
  const rows = readRecoveryRows_(
    schema.eventSheet,
    PAYMENT_RECOVERY_EVENT_HEADERS,
    "event_key",
    "RECOVERY_SCHEMA_INVALID"
  ).filter(function(row) { return String(row.object.event_key) === String(eventKey || "").trim(); });
  if (rows.length > 1) throw recoveryError_("RECOVERY_SCHEMA_INVALID", "Duplicate recovery events");
  return { sheet: schema.eventSheet, row: rows.length === 1 ? rows[0] : null };
}

function handleGetRecoveryPaymentEvent_(payload) {
  const found = findRecoveryEvent_(payload.eventKey);
  if (!found.row) return { ok: true, result: "RECOVERY_EVENT_NOT_FOUND" };
  return { ok: true, result: "RECOVERY_EVENT_FOUND", event: found.row.object };
}

function boundedRecoveryLimit_(value, fallback) {
  const parsed = Math.trunc(Number(value));
  if (!isFinite(parsed) || parsed <= 0) return fallback;
  return Math.min(parsed, 50);
}

function handleListRecoveryPaymentEvents_(payload) {
  const schema = ensureRecoverySchema_();
  const limit = boundedRecoveryLimit_(payload.limit, 20);
  const rows = readRecoveryRows_(schema.eventSheet, PAYMENT_RECOVERY_EVENT_HEADERS, "event_key", "RECOVERY_SCHEMA_INVALID");
  return { ok: true, result: "RECOVERY_EVENTS_LISTED", events: rows.slice(0, limit).map(function(row) { return row.object; }) };
}

function handleListRecoverySnapshotsForScan_(payload) {
  const schema = ensureRecoverySchema_();
  const limit = boundedRecoveryLimit_(payload.limit, 20);
  const rows = readRecoveryRows_(schema.snapshotSheet, ORDER_RECOVERY_SNAPSHOT_HEADERS, "external_reference", "RECOVERY_SCHEMA_INVALID")
    .filter(function(row) { return ["pending_payment", "payment_observed"].indexOf(String(row.object.recovery_state)) !== -1; });
  return { ok: true, result: "RECOVERY_SNAPSHOTS_LISTED", snapshots: rows.slice(0, limit).map(function(row) { return row.object; }) };
}

function handleClaimRecoveryWork_(payload) {
  const schema = ensureRecoverySchema_();
  const leaseOwner = String(payload.leaseOwner || "").trim();
  const claimedAt = assertRecoveryIsoDate_(payload.claimedAt, "claimedAt", false);
  const leaseExpiresAt = assertRecoveryIsoDate_(payload.leaseExpiresAt, "leaseExpiresAt", false);
  if (!/^[A-Za-z0-9._:-]{8,160}$/.test(leaseOwner) || Date.parse(leaseExpiresAt) <= Date.parse(claimedAt)) {
    throw recoveryError_("RECOVERY_WORK_LEASE_CONFLICT", "Invalid recovery work lease");
  }
  const maxEvents = boundedRecoveryLimit_(payload.maxEvents, 20);
  const maxSnapshots = boundedRecoveryLimit_(payload.maxSnapshots, 20);
  const eventRows = readRecoveryRows_(schema.eventSheet, PAYMENT_RECOVERY_EVENT_HEADERS, "event_key", "RECOVERY_SCHEMA_INVALID");
  const claimedEvents = [];
  const eventResponseReplays = [];
  const eligibleEventRows = [];
  eventRows.forEach(function(row) {
    const state = String(row.object.processing_state);
    const currentOwner = String(row.object.lease_owner || "");
    const currentExpiry = Date.parse(String(row.object.lease_expires_at || ""));
    const responseReplay = state === "processing" && currentOwner === leaseOwner && currentExpiry > Date.parse(claimedAt);
    const eligible = state === "pending" || state === "retryable" || (state === "processing" && (!isFinite(currentExpiry) || currentExpiry <= Date.parse(claimedAt)));
    if (responseReplay) eventResponseReplays.push(row);
    else if (eligible) eligibleEventRows.push(row);
  });
  eligibleEventRows.sort(function(left, right) {
    const leftAttempt = Date.parse(String(left.object.last_attempt_at || ""));
    const rightAttempt = Date.parse(String(right.object.last_attempt_at || ""));
    const leftTime = isFinite(leftAttempt) ? leftAttempt : 0;
    const rightTime = isFinite(rightAttempt) ? rightAttempt : 0;
    return leftTime - rightTime || left.rowNumber - right.rowNumber;
  });

  eventResponseReplays.concat(eligibleEventRows).slice(0, maxEvents).forEach(function(row) {
    const state = String(row.object.processing_state);
    const currentOwner = String(row.object.lease_owner || "");
    const currentExpiry = Date.parse(String(row.object.lease_expires_at || ""));
    const responseReplay = state === "processing" && currentOwner === leaseOwner && currentExpiry > Date.parse(claimedAt);
    if (!responseReplay) {
      setRecoveryCell_(schema.eventSheet, row.rowNumber, PAYMENT_RECOVERY_EVENT_HEADERS, "processing_state", "processing");
      setRecoveryCell_(schema.eventSheet, row.rowNumber, PAYMENT_RECOVERY_EVENT_HEADERS, "attempt_count", Number(row.object.attempt_count || 0) + 1);
      setRecoveryCell_(schema.eventSheet, row.rowNumber, PAYMENT_RECOVERY_EVENT_HEADERS, "lease_owner", leaseOwner);
      setRecoveryCell_(schema.eventSheet, row.rowNumber, PAYMENT_RECOVERY_EVENT_HEADERS, "lease_expires_at", leaseExpiresAt);
      setRecoveryCell_(schema.eventSheet, row.rowNumber, PAYMENT_RECOVERY_EVENT_HEADERS, "last_attempt_at", claimedAt);
      setRecoveryCell_(schema.eventSheet, row.rowNumber, PAYMENT_RECOVERY_EVENT_HEADERS, "updated_at", claimedAt);
      row.object.processing_state = "processing";
      row.object.attempt_count = Number(row.object.attempt_count || 0) + 1;
      row.object.lease_owner = leaseOwner;
      row.object.lease_expires_at = leaseExpiresAt;
      row.object.last_attempt_at = claimedAt;
      row.object.updated_at = claimedAt;
    }
    claimedEvents.push(row.object);
  });

  const snapshotRows = readRecoveryRows_(schema.snapshotSheet, ORDER_RECOVERY_SNAPSHOT_HEADERS, "external_reference", "RECOVERY_SCHEMA_INVALID");
  const claimedSnapshots = [];
  const snapshotResponseReplays = [];
  const eligibleSnapshotRows = [];
  const claimedAtMs = Date.parse(claimedAt);
  const snapshotLeaseDurationMs = Date.parse(leaseExpiresAt) - claimedAtMs;
  snapshotRows.forEach(function(row) {
    if (["pending_payment", "payment_observed"].indexOf(String(row.object.recovery_state)) === -1) return;
    const responseReplay = String(row.object.last_checked_at || "") === claimedAt;
    const lastCheckedAt = Date.parse(String(row.object.last_checked_at || ""));
    const eligible = !isFinite(lastCheckedAt) || lastCheckedAt <= claimedAtMs - snapshotLeaseDurationMs;
    if (responseReplay) snapshotResponseReplays.push(row);
    else if (eligible) eligibleSnapshotRows.push(row);
  });
  eligibleSnapshotRows.sort(function(left, right) {
    const leftChecked = Date.parse(String(left.object.last_checked_at || ""));
    const rightChecked = Date.parse(String(right.object.last_checked_at || ""));
    const leftTime = isFinite(leftChecked) ? leftChecked : 0;
    const rightTime = isFinite(rightChecked) ? rightChecked : 0;
    return leftTime - rightTime || left.rowNumber - right.rowNumber;
  });

  snapshotResponseReplays.concat(eligibleSnapshotRows).slice(0, maxSnapshots).forEach(function(row) {
    const responseReplay = String(row.object.last_checked_at || "") === claimedAt;
    if (!responseReplay) {
      setRecoveryCell_(schema.snapshotSheet, row.rowNumber, ORDER_RECOVERY_SNAPSHOT_HEADERS, "last_checked_at", claimedAt);
      setRecoveryCell_(schema.snapshotSheet, row.rowNumber, ORDER_RECOVERY_SNAPSHOT_HEADERS, "updated_at", claimedAt);
      row.object.last_checked_at = claimedAt;
      row.object.updated_at = claimedAt;
    }
    claimedSnapshots.push(row.object);
  });
  return { ok: true, result: "WORK_CLAIMED", events: claimedEvents, snapshots: claimedSnapshots };
}

function handleMarkRecoveryWork_(payload, targetState) {
  if (["retryable", "attention", "completed"].indexOf(targetState) === -1) {
    throw recoveryError_("RECOVERY_SCHEMA_INVALID", "Invalid recovery work target state");
  }
  const found = findRecoveryEvent_(payload.eventKey);
  if (!found.row) throw recoveryError_("RECOVERY_EVENT_NOT_FOUND", "Recovery event not found");
  const currentState = String(found.row.object.processing_state);
  if (currentState === "completed") {
    if (targetState !== "completed") {
      throw recoveryError_("RECOVERY_WORK_LEASE_CONFLICT", "Completed recovery work is monotonic");
    }
    return { ok: true, result: "WORK_COMPLETED", event: found.row.object };
  }
  const leaseOwner = String(payload.leaseOwner || "").trim();
  if (leaseOwner && String(found.row.object.lease_owner || "") !== leaseOwner) {
    throw recoveryError_("RECOVERY_WORK_LEASE_CONFLICT", "Recovery work lease owner mismatch");
  }
  const now = new Date().toISOString();
  setRecoveryCell_(found.sheet, found.row.rowNumber, PAYMENT_RECOVERY_EVENT_HEADERS, "processing_state", targetState);
  setRecoveryCell_(found.sheet, found.row.rowNumber, PAYMENT_RECOVERY_EVENT_HEADERS, "lease_owner", "");
  setRecoveryCell_(found.sheet, found.row.rowNumber, PAYMENT_RECOVERY_EVENT_HEADERS, "lease_expires_at", "");
  const errorCode = targetState === "completed" ? "" : safeRecoveryErrorCode_(payload.errorCode);
  setRecoveryCell_(found.sheet, found.row.rowNumber, PAYMENT_RECOVERY_EVENT_HEADERS, "last_error_code", errorCode);
  setRecoveryCell_(found.sheet, found.row.rowNumber, PAYMENT_RECOVERY_EVENT_HEADERS, "updated_at", now);
  if (targetState === "completed") {
    setRecoveryCell_(found.sheet, found.row.rowNumber, PAYMENT_RECOVERY_EVENT_HEADERS, "completed_at", now);
  }
  found.row.object.processing_state = targetState;
  found.row.object.lease_owner = "";
  found.row.object.lease_expires_at = "";
  found.row.object.last_error_code = errorCode;
  found.row.object.updated_at = now;
  if (targetState === "completed") found.row.object.completed_at = now;
  const result = targetState === "completed" ? "WORK_COMPLETED" : targetState === "attention" ? "WORK_ATTENTION" : "WORK_RETRYABLE";
  return { ok: true, result: result, event: found.row.object };
}

function handleMarkRecoverySnapshot_(payload, forcedState) {
  const found = findRecoverySnapshot_(payload.externalReference);
  if (!found.row) throw recoveryError_("RECOVERY_SNAPSHOT_NOT_FOUND", "Recovery snapshot not found");
  const currentState = String(found.row.object.recovery_state);
  const targetState = forcedState || String(payload.recoveryState || "");
  if (RECOVERY_SNAPSHOT_STATES.indexOf(targetState) === -1) {
    throw recoveryError_("RECOVERY_SCHEMA_INVALID", "Invalid recovery snapshot target state");
  }
  if ((currentState === "completed" || currentState === "expired_unpaid") && targetState !== currentState) {
    throw recoveryError_("RECOVERY_WORK_LEASE_CONFLICT", "Terminal recovery snapshot state is monotonic");
  }
  const now = new Date().toISOString();
  setRecoveryCell_(found.sheet, found.row.rowNumber, ORDER_RECOVERY_SNAPSHOT_HEADERS, "recovery_state", targetState);
  setRecoveryCell_(found.sheet, found.row.rowNumber, ORDER_RECOVERY_SNAPSHOT_HEADERS, "last_checked_at", now);
  const errorCode = safeRecoveryErrorCode_(payload.errorCode);
  setRecoveryCell_(found.sheet, found.row.rowNumber, ORDER_RECOVERY_SNAPSHOT_HEADERS, "last_error_code", errorCode);
  setRecoveryCell_(found.sheet, found.row.rowNumber, ORDER_RECOVERY_SNAPSHOT_HEADERS, "updated_at", now);
  if (targetState === "completed" || targetState === "expired_unpaid") {
    setRecoveryCell_(found.sheet, found.row.rowNumber, ORDER_RECOVERY_SNAPSHOT_HEADERS, "completed_at", now);
    if (payload.redactSnapshot === true) {
      setRecoveryCell_(found.sheet, found.row.rowNumber, ORDER_RECOVERY_SNAPSHOT_HEADERS, "snapshot_json", "");
      found.row.object.snapshot_json = "";
    }
    found.row.object.completed_at = now;
  }
  found.row.object.recovery_state = targetState;
  found.row.object.last_checked_at = now;
  found.row.object.last_error_code = errorCode;
  found.row.object.updated_at = now;
  return { ok: true, result: "RECOVERY_SNAPSHOT_UPDATED", snapshot: found.row.object };
}

function handleListRecoveryAttention_(payload) {
  const schema = ensureRecoverySchema_();
  const limit = boundedRecoveryLimit_(payload.limit, 50);
  const items = [];
  readRecoveryRows_(schema.eventSheet, PAYMENT_RECOVERY_EVENT_HEADERS, "event_key", "RECOVERY_SCHEMA_INVALID").forEach(function(row) {
    if (String(row.object.processing_state) === "completed") return;
    items.push({
      kind: "payment_event",
      external_reference: row.object.external_reference,
      payment_id: row.object.payment_id,
      financial_status: row.object.financial_status,
      state: row.object.processing_state,
      last_error_code: row.object.last_error_code,
      updated_at: row.object.updated_at
    });
  });
  readRecoveryRows_(schema.snapshotSheet, ORDER_RECOVERY_SNAPSHOT_HEADERS, "external_reference", "RECOVERY_SCHEMA_INVALID").forEach(function(row) {
    if (String(row.object.recovery_state) !== "attention") return;
    items.push({
      kind: "snapshot",
      external_reference: row.object.external_reference,
      payment_id: "",
      financial_status: "",
      state: row.object.recovery_state,
      last_error_code: row.object.last_error_code,
      updated_at: row.object.updated_at
    });
  });
  items.sort(function(left, right) { return Date.parse(String(right.updated_at || "")) - Date.parse(String(left.updated_at || "")); });
  return { ok: true, result: "RECOVERY_ATTENTION_LISTED", items: items.slice(0, limit) };
}

function safeEmailErrorCode_(value) {
  const code = String(value || "").trim();
  if (!code) return "EMAIL_OUTBOX_TECHNICAL_FAILURE";
  return /^[A-Z0-9_]{3,120}$/.test(code) ? code : "EMAIL_OUTBOX_TECHNICAL_FAILURE";
}

function readEmailOutboxRows_() {
  const schema = getEmailOutboxSchema_();
  return {
    schema: schema,
    rows: readRecoveryRows_(
      schema.sheet,
      EMAIL_OUTBOX_EVENT_HEADERS,
      "event_key",
      "EMAIL_OUTBOX_SCHEMA_INVALID"
    )
  };
}

function findEmailOutboxEvent_(eventKey) {
  const data = readEmailOutboxRows_();
  const key = String(eventKey || "").trim();
  const rows = data.rows.filter(function(row) { return String(row.object.event_key) === key; });
  if (rows.length > 1) throw recoveryError_("EMAIL_OUTBOX_SCHEMA_INVALID", "Duplicate email event keys");
  return { schema: data.schema, row: rows.length === 1 ? rows[0] : null };
}

function validateEmailOutboxEventInput_(input) {
  assertExactObjectKeys_(input, EMAIL_OUTBOX_EVENT_HEADERS, "EMAIL_OUTBOX_SCHEMA_INVALID");
  const eventKey = String(input.event_key || "").trim();
  const externalReference = String(input.external_reference || "").trim();
  const payloadHash = String(input.payload_hash || "").trim();
  const payloadJson = String(input.payload_json || "");
  const idempotencyKey = String(input.idempotency_key || "").trim();
  if (
    !/^purchase-receipt\/es-[a-z0-9-]{6,80}\/v1$/i.test(eventKey) ||
    !/^es-[a-z0-9-]{6,80}$/i.test(externalReference) ||
    eventKey !== "purchase-receipt/" + externalReference + "/v1" ||
    idempotencyKey !== eventKey ||
    idempotencyKey.length > 256
  ) {
    throw recoveryError_("EMAIL_OUTBOX_SCHEMA_INVALID", "Invalid email event identity");
  }
  if (
    String(input.notification_type) !== "purchase_receipt" ||
    Number(input.schema_version) !== EMAIL_OUTBOX_SCHEMA_VERSION ||
    Number(input.template_version) !== 1 ||
    !/^[a-f0-9]{64}$/.test(payloadHash) ||
    sha256Hex_(payloadJson) !== payloadHash
  ) {
    throw recoveryError_("EMAIL_OUTBOX_SCHEMA_INVALID", "Invalid email event schema or hash");
  }
  let parsed;
  try {
    parsed = JSON.parse(payloadJson);
  } catch (error) {
    throw recoveryError_("EMAIL_OUTBOX_SCHEMA_INVALID", "Email payload JSON is malformed");
  }
  if (
    !parsed ||
    typeof parsed !== "object" ||
    Array.isArray(parsed) ||
    parsed.externalReference !== externalReference ||
    Number(parsed.templateVersion) !== 1 ||
    !Array.isArray(parsed.items) ||
    parsed.currency !== "ARS"
  ) {
    throw recoveryError_("EMAIL_OUTBOX_EVENT_CONFLICT", "Email payload identity mismatch");
  }
  if (
    String(input.state) !== "pending" ||
    Number(input.attempt_count) !== 0 ||
    String(input.lease_owner || "") ||
    String(input.lease_expires_at || "") ||
    String(input.next_attempt_at || "") ||
    String(input.provider_first_attempt_at || "") ||
    String(input.provider_outcome_unknown_since || "") ||
    String(input.last_attempt_at || "") ||
    String(input.provider_message_id || "") ||
    String(input.accepted_at || "") ||
    String(input.completed_at || "")
  ) {
    throw recoveryError_("EMAIL_OUTBOX_SCHEMA_INVALID", "Invalid initial email event state");
  }
  assertRecoveryIsoDate_(input.created_at, "email created_at", false);
  assertRecoveryIsoDate_(input.updated_at, "email updated_at", false);
  return EMAIL_OUTBOX_EVENT_HEADERS.map(function(header) { return input[header]; });
}

function emailOutboxImmutableMatches_(existing, candidate) {
  const immutableHeaders = [
    "event_key",
    "external_reference",
    "notification_type",
    "schema_version",
    "template_version",
    "payload_hash",
    "idempotency_key"
  ];
  const coreMatches = immutableHeaders.every(function(header) {
    return String(existing[header]) === String(candidate[header]);
  });
  if (!coreMatches) return false;
  if (String(existing.payload_json || "")) {
    return String(existing.payload_json) === String(candidate.payload_json);
  }
  return String(existing.state) === "accepted";
}

function handleUpsertEmailOutboxEvent_(payload) {
  const rowValues = validateEmailOutboxEventInput_(payload.event);
  const data = readEmailOutboxRows_();
  const eventKey = String(payload.event.event_key);
  const existing = data.rows.filter(function(row) { return String(row.object.event_key) === eventKey; });
  if (existing.length > 1) throw recoveryError_("EMAIL_OUTBOX_SCHEMA_INVALID", "Duplicate email events");
  if (existing.length === 1) {
    if (!emailOutboxImmutableMatches_(existing[0].object, payload.event)) {
      if (["accepted", "skipped"].indexOf(String(existing[0].object.state)) === -1) {
        const now = new Date().toISOString();
        setRecoveryCell_(data.schema.sheet, existing[0].rowNumber, EMAIL_OUTBOX_EVENT_HEADERS, "state", "attention");
        setRecoveryCell_(data.schema.sheet, existing[0].rowNumber, EMAIL_OUTBOX_EVENT_HEADERS, "last_error_code", "EMAIL_OUTBOX_EVENT_CONFLICT");
        setRecoveryCell_(data.schema.sheet, existing[0].rowNumber, EMAIL_OUTBOX_EVENT_HEADERS, "updated_at", now);
      }
      console.info(JSON.stringify({ event: "email.outbox.conflict", orderId: payload.event.external_reference }));
      throw recoveryError_("EMAIL_OUTBOX_EVENT_CONFLICT", "Email event already exists with different content");
    }
    console.info(JSON.stringify({ event: "email.outbox.replayed", orderId: existing[0].object.external_reference }));
    return { ok: true, result: "EMAIL_EVENT_ALREADY_EXISTS", event: existing[0].object };
  }
  data.schema.sheet.appendRow(rowValues);
  const stored = recoveryRowToObject_(EMAIL_OUTBOX_EVENT_HEADERS, rowValues);
  console.info(JSON.stringify({ event: "email.outbox.created", orderId: stored.external_reference, state: stored.state }));
  return { ok: true, result: "EMAIL_EVENT_STORED", event: stored };
}

function handleGetEmailOutboxEvent_(payload) {
  const found = findEmailOutboxEvent_(payload.eventKey);
  if (!found.row) return { ok: true, result: "EMAIL_EVENT_NOT_FOUND" };
  return { ok: true, result: "EMAIL_EVENT_FOUND", event: found.row.object };
}

function handleClaimEmailOutboxWork_(payload) {
  const data = readEmailOutboxRows_();
  const leaseOwner = String(payload.leaseOwner || "").trim();
  const claimedAt = assertRecoveryIsoDate_(payload.claimedAt, "email claimedAt", false);
  const leaseExpiresAt = assertRecoveryIsoDate_(payload.leaseExpiresAt, "email leaseExpiresAt", false);
  const claimedAtMs = Date.parse(claimedAt);
  if (!/^[A-Za-z0-9._:-]{8,160}$/.test(leaseOwner) || Date.parse(leaseExpiresAt) <= claimedAtMs) {
    throw recoveryError_("EMAIL_OUTBOX_LEASE_CONFLICT", "Invalid email work lease");
  }
  const requestedEventKey = String(payload.eventKey || "").trim();
  const maxEvents = boundedRecoveryLimit_(payload.maxEvents, 20);
  const responseReplays = [];
  const eligible = [];
  data.rows.forEach(function(row) {
    if (requestedEventKey && String(row.object.event_key) !== requestedEventKey) return;
    const state = String(row.object.state);
    const currentOwner = String(row.object.lease_owner || "");
    const currentExpiry = Date.parse(String(row.object.lease_expires_at || ""));
    const nextAttemptAt = Date.parse(String(row.object.next_attempt_at || ""));
    const attemptCount = Number(row.object.attempt_count || 0);
    const expiredProcessing =
      state === "processing" && (!isFinite(currentExpiry) || currentExpiry <= claimedAtMs);
    const providerOutcomeUnknownSince = Date.parse(String(row.object.provider_outcome_unknown_since || ""));
    if (
      (expiredProcessing || state === "retryable") &&
      isFinite(providerOutcomeUnknownSince) &&
      claimedAtMs - providerOutcomeUnknownSince >= EMAIL_OUTBOX_PROVIDER_IDEMPOTENCY_WINDOW_MS
    ) {
      completeEmailOutboxState_(
        { schema: data.schema, row: row },
        "attention",
        "RESEND_OUTCOME_UNKNOWN",
        claimedAt
      );
      return;
    }
    if (
      attemptCount >= EMAIL_OUTBOX_MAX_ATTEMPTS &&
      !isFinite(providerOutcomeUnknownSince) &&
      (state === "retryable" || expiredProcessing)
    ) {
      completeEmailOutboxState_(
        { schema: data.schema, row: row },
        "attention",
        "EMAIL_OUTBOX_ATTEMPTS_EXHAUSTED",
        claimedAt
      );
      return;
    }
    const responseReplay =
      state === "processing" &&
      currentOwner === leaseOwner &&
      String(row.object.last_attempt_at || "") === claimedAt &&
      currentExpiry > claimedAtMs;
    const due = !isFinite(nextAttemptAt) || nextAttemptAt <= claimedAtMs;
    const canClaim =
      state === "pending" ||
      (state === "retryable" && due) ||
      expiredProcessing;
    if (responseReplay) responseReplays.push(row);
    else if (canClaim) eligible.push(row);
  });
  eligible.sort(function(left, right) {
    const leftNext = Date.parse(String(left.object.next_attempt_at || left.object.created_at || ""));
    const rightNext = Date.parse(String(right.object.next_attempt_at || right.object.created_at || ""));
    return (isFinite(leftNext) ? leftNext : 0) - (isFinite(rightNext) ? rightNext : 0) || left.rowNumber - right.rowNumber;
  });
  const claimed = [];
  responseReplays.concat(eligible).slice(0, maxEvents).forEach(function(row) {
    const replay =
      String(row.object.state) === "processing" &&
      String(row.object.lease_owner || "") === leaseOwner &&
      String(row.object.last_attempt_at || "") === claimedAt;
    if (!replay) {
      const attemptCount = Number(row.object.attempt_count || 0) + 1;
      setRecoveryCell_(data.schema.sheet, row.rowNumber, EMAIL_OUTBOX_EVENT_HEADERS, "state", "processing");
      setRecoveryCell_(data.schema.sheet, row.rowNumber, EMAIL_OUTBOX_EVENT_HEADERS, "attempt_count", attemptCount);
      setRecoveryCell_(data.schema.sheet, row.rowNumber, EMAIL_OUTBOX_EVENT_HEADERS, "lease_owner", leaseOwner);
      setRecoveryCell_(data.schema.sheet, row.rowNumber, EMAIL_OUTBOX_EVENT_HEADERS, "lease_expires_at", leaseExpiresAt);
      setRecoveryCell_(data.schema.sheet, row.rowNumber, EMAIL_OUTBOX_EVENT_HEADERS, "next_attempt_at", "");
      if (!String(row.object.provider_first_attempt_at || "")) {
        setRecoveryCell_(data.schema.sheet, row.rowNumber, EMAIL_OUTBOX_EVENT_HEADERS, "provider_first_attempt_at", claimedAt);
        row.object.provider_first_attempt_at = claimedAt;
      }
      setRecoveryCell_(data.schema.sheet, row.rowNumber, EMAIL_OUTBOX_EVENT_HEADERS, "last_attempt_at", claimedAt);
      setRecoveryCell_(data.schema.sheet, row.rowNumber, EMAIL_OUTBOX_EVENT_HEADERS, "updated_at", claimedAt);
      row.object.state = "processing";
      row.object.attempt_count = attemptCount;
      row.object.lease_owner = leaseOwner;
      row.object.lease_expires_at = leaseExpiresAt;
      row.object.next_attempt_at = "";
      row.object.last_attempt_at = claimedAt;
      row.object.updated_at = claimedAt;
    }
    claimed.push(row.object);
  });
  return { ok: true, result: "EMAIL_WORK_CLAIMED", events: claimed };
}

function assertEmailLeaseOwner_(found, leaseOwner) {
  if (!found.row) throw recoveryError_("EMAIL_OUTBOX_EVENT_NOT_FOUND", "Email event not found");
  if (String(found.row.object.state) !== "processing" || String(found.row.object.lease_owner || "") !== leaseOwner) {
    throw recoveryError_("EMAIL_OUTBOX_LEASE_CONFLICT", "Email work lease owner mismatch");
  }
}

function writeEmailOutboxRow_(found) {
  found.schema.sheet
    .getRange(found.row.rowNumber, 1, 1, EMAIL_OUTBOX_EVENT_HEADERS.length)
    .setValues([EMAIL_OUTBOX_EVENT_HEADERS.map(function(header) { return found.row.object[header]; })]);
}

function completeEmailOutboxState_(found, targetState, errorCode, completedAt, nextAttemptAt) {
  const now = new Date().toISOString();
  found.row.object.state = targetState;
  found.row.object.lease_owner = "";
  found.row.object.lease_expires_at = "";
  found.row.object.next_attempt_at = nextAttemptAt || "";
  found.row.object.last_error_code = errorCode || "";
  found.row.object.updated_at = now;
  if (completedAt) found.row.object.completed_at = completedAt;
  writeEmailOutboxRow_(found);
}

function handleMarkEmailOutboxProviderOutcomeUnknown_(payload) {
  const found = findEmailOutboxEvent_(payload.eventKey);
  assertEmailLeaseOwner_(found, String(payload.leaseOwner || "").trim());
  const unknownSince = assertRecoveryIsoDate_(payload.unknownSince, "provider outcome unknownSince", false);
  if (!String(found.row.object.provider_outcome_unknown_since || "")) {
    found.row.object.provider_outcome_unknown_since = unknownSince;
    found.row.object.updated_at = new Date().toISOString();
    writeEmailOutboxRow_(found);
  }
  return { ok: true, result: "EMAIL_PROVIDER_OUTCOME_UNKNOWN", event: found.row.object };
}

function handleClearEmailOutboxProviderOutcomeUnknown_(payload) {
  const found = findEmailOutboxEvent_(payload.eventKey);
  assertEmailLeaseOwner_(found, String(payload.leaseOwner || "").trim());
  found.row.object.provider_outcome_unknown_since = "";
  found.row.object.updated_at = new Date().toISOString();
  writeEmailOutboxRow_(found);
  return { ok: true, result: "EMAIL_PROVIDER_OUTCOME_KNOWN", event: found.row.object };
}

function handleMarkEmailOutboxAccepted_(payload) {
  const found = findEmailOutboxEvent_(payload.eventKey);
  const providerMessageId = String(payload.providerMessageId || "").trim();
  const acceptedAt = assertRecoveryIsoDate_(payload.acceptedAt, "email acceptedAt", false);
  if (!/^[A-Za-z0-9_-]{8,160}$/.test(providerMessageId)) {
    throw recoveryError_("EMAIL_OUTBOX_SCHEMA_INVALID", "Invalid provider message id");
  }
  if (found.row && String(found.row.object.state) === "accepted") {
    if (String(found.row.object.provider_message_id) !== providerMessageId) {
      throw recoveryError_("EMAIL_OUTBOX_EVENT_CONFLICT", "Accepted provider id is immutable");
    }
    if (String(found.row.object.provider_outcome_unknown_since || "")) {
      found.row.object.provider_outcome_unknown_since = "";
      writeEmailOutboxRow_(found);
    }
    return { ok: true, result: "EMAIL_EVENT_ACCEPTED", event: found.row.object };
  }
  assertEmailLeaseOwner_(found, String(payload.leaseOwner || "").trim());
  const now = new Date().toISOString();
  found.row.object.state = "accepted";
  found.row.object.lease_owner = "";
  found.row.object.lease_expires_at = "";
  found.row.object.next_attempt_at = "";
  found.row.object.last_error_code = "";
  found.row.object.provider_outcome_unknown_since = "";
  found.row.object.provider_message_id = providerMessageId;
  found.row.object.accepted_at = acceptedAt;
  found.row.object.completed_at = acceptedAt;
  found.row.object.updated_at = now;
  found.row.object.payload_json = "";
  writeEmailOutboxRow_(found);
  console.info(JSON.stringify({ event: "email.outbox.accepted", orderId: found.row.object.external_reference, providerMessageId: providerMessageId, attemptCount: found.row.object.attempt_count, state: "accepted" }));
  return { ok: true, result: "EMAIL_EVENT_ACCEPTED", event: found.row.object };
}

function handleMarkEmailOutboxRetryable_(payload) {
  const found = findEmailOutboxEvent_(payload.eventKey);
  assertEmailLeaseOwner_(found, String(payload.leaseOwner || "").trim());
  const nextAttemptAt = assertRecoveryIsoDate_(payload.nextAttemptAt, "email nextAttemptAt", false);
  const errorCode = safeEmailErrorCode_(payload.errorCode);
  completeEmailOutboxState_(found, "retryable", errorCode, "", nextAttemptAt);
  return { ok: true, result: "EMAIL_EVENT_RETRYABLE", event: found.row.object };
}

function handleMarkEmailOutboxAttention_(payload) {
  const found = findEmailOutboxEvent_(payload.eventKey);
  if (found.row && String(found.row.object.state) === "accepted") {
    throw recoveryError_("EMAIL_OUTBOX_LEASE_CONFLICT", "Accepted email event is terminal");
  }
  assertEmailLeaseOwner_(found, String(payload.leaseOwner || "").trim());
  completeEmailOutboxState_(found, "attention", safeEmailErrorCode_(payload.errorCode), new Date().toISOString());
  return { ok: true, result: "EMAIL_EVENT_ATTENTION", event: found.row.object };
}

function handleMarkEmailOutboxSkipped_(payload) {
  const found = findEmailOutboxEvent_(payload.eventKey);
  assertEmailLeaseOwner_(found, String(payload.leaseOwner || "").trim());
  const errorCode = String(payload.errorCode || "");
  if (errorCode !== "MISSING_CUSTOMER_EMAIL") {
    throw recoveryError_("EMAIL_OUTBOX_SCHEMA_INVALID", "Invalid email skip reason");
  }
  completeEmailOutboxState_(found, "skipped", errorCode, new Date().toISOString());
  return { ok: true, result: "EMAIL_EVENT_SKIPPED", event: found.row.object };
}

function handleListEmailOutboxAttention_(payload) {
  const data = readEmailOutboxRows_();
  const limit = boundedRecoveryLimit_(payload.limit, 50);
  const items = data.rows
    .filter(function(row) { return ["retryable", "attention"].indexOf(String(row.object.state)) !== -1; })
    .map(function(row) {
      return {
        external_reference: row.object.external_reference,
        state: row.object.state,
        attempt_count: Number(row.object.attempt_count || 0),
        last_error_code: row.object.last_error_code,
        updated_at: row.object.updated_at
      };
    })
    .sort(function(left, right) { return Date.parse(String(right.updated_at || "")) - Date.parse(String(left.updated_at || "")); });
  return { ok: true, result: "EMAIL_ATTENTION_LISTED", items: items.slice(0, limit) };
}

function firstSalesValue_(row, names) {
  for (let i = 0; i < names.length; i++) {
    const value = row[normalizeKey(names[i])];
    if (value !== "" && value !== null && value !== undefined) return value;
  }
  return "";
}

function isConfirmedSalesPayment_(value) {
  return ["confirmed", "confirmado", "approved", "aprobado", "paid", "pagado"].indexOf(normalizeKey(value)) !== -1;
}

function handleListMissingReceiptCandidates_(payload) {
  const data = readEmailOutboxRows_();
  const limit = boundedRecoveryLimit_(payload.limit, 20);
  const eventsByKey = {};
  data.rows.forEach(function(row) { eventsByKey[String(row.object.event_key)] = row.object; });
  const candidates = [];
  const markerRepairs = [];
  const seenOrders = {};
  readSheetAsObjects(SHEET_SALES).forEach(function(row) {
    const externalReference = String(firstSalesValue_(row, ORDER_ID_KEYS) || "").trim();
    if (!externalReference) return;
    if (seenOrders[externalReference]) {
      throw recoveryError_("EMAIL_OUTBOX_SCHEMA_INVALID", "Duplicate ventas order identity during email scan");
    }
    seenOrders[externalReference] = true;
    const eventKey = "purchase-receipt/" + externalReference + "/v1";
    const event = eventsByKey[eventKey];
    const sentMarker = firstSalesValue_(row, ["receipt_email_sent_at", "email_enviado_en", "email_sent_at"]);
    if (event && String(event.state) === "accepted" && !sentMarker && event.accepted_at) {
      markerRepairs.push({ external_reference: externalReference, accepted_at: event.accepted_at });
      return;
    }
    if (event || sentMarker || candidates.length >= limit) return;
    const eligibilityVersion = firstSalesValue_(row, [EMAIL_OUTBOX_VENTAS_ELIGIBILITY_HEADER]);
    if (String(eligibilityVersion || "").trim() !== "1") return;
    const paymentStatus = firstSalesValue_(row, ["estado_de_pago", "payment_status", "estado_pago", "payment_state"]);
    if (!isConfirmedSalesPayment_(paymentStatus)) return;
    const approvedAtRaw = firstSalesValue_(row, ["approved_at", "fecha_pago"]);
    const approvedAtMs = Date.parse(String(approvedAtRaw || ""));
    if (!isFinite(approvedAtMs)) return;
    const itemsJson = String(firstSalesValue_(row, ["items_json"]) || "");
    const total = Number(firstSalesValue_(row, ["total", "total_amount", "amount"]));
    if (!itemsJson || !isFinite(total) || total < 0) return;
    const paymentId = String(firstSalesValue_(row, ["mp_payment_id", "id_pago_mp", "mercadopago_payment_id"]) || ("manual-" + externalReference)).trim();
    candidates.push({
      external_reference: externalReference,
      recipient_email: String(firstSalesValue_(row, ["customer_email", "email"]) || ""),
      customer_name: String(firstSalesValue_(row, ["customer_name", "cliente", "nombre_cliente"]) || ""),
      payment_id: paymentId,
      approved_at: new Date(approvedAtMs).toISOString(),
      items_json: itemsJson,
      total: total,
      currency: String(firstSalesValue_(row, ["currency"]) || "ARS").toUpperCase()
    });
  });
  return {
    ok: true,
    result: "EMAIL_CANDIDATES_LISTED",
    rollout_at: data.schema.rolloutAt,
    candidates: candidates,
    marker_repairs: markerRepairs.slice(0, limit)
  };
}

function logInternalError_(context, err) {
  const detail = err && err.stack ? err.stack : String(err && err.message ? err.message : err);
  console.error(context + ": " + detail);
}

function publicErrorMessage_(err) {
  const message = String(err && err.message ? err.message : err);
  if (message === "Unauthorized") return "Unauthorized";
  if (message === "Unsupported action") return "Invalid request";
  if (message.indexOf("not allowed") !== -1) return "Invalid request";
  if (message.indexOf("missing") !== -1 || message.indexOf("Misconfigured") !== -1) {
    return "Server misconfigured";
  }
  return "Request failed";
}

function inventoryPublicErrorMessage_(code) {
  if (code === "INVALID_ORDER_ID") return "Invalid inventory order id";
  if (code === "INVALID_ITEMS" || code === "INVALID_QUANTITY" || code === "TOO_MANY_ITEMS" || code === "AGGREGATED_QUANTITY_LIMIT") {
    return "Invalid inventory items";
  }
  if (code === "PRODUCT_NOT_FOUND") return "Product not found";
  if (code === "DUPLICATE_PRODUCT_ID") return "Inventory catalog integrity error";
  if (code === "PRODUCT_INACTIVE" || code === "PRODUCT_NOT_AVAILABLE") return "Product not available";
  if (code === "INVALID_STOCK_QTY") return "Invalid product stock";
  if (code === "INSUFFICIENT_STOCK") return "Insufficient stock";
  if (code === "INVENTORY_IDEMPOTENCY_CONFLICT") return "Inventory idempotency conflict";
  if (code === "INVENTORY_JOURNAL_INVALID") return "Inventory journal integrity error";
  return "Inventory validation failed";
}

function publicPostErrorPayload_(err) {
  if (!err || typeof err.code !== "string") {
    return { ok: false, error: publicErrorMessage_(err) };
  }

  if (err.name === "RecoveryError") {
    return {
      ok: false,
      error: "Recovery operation failed",
      code: err.code
    };
  }

  if (err.code === "INVALID_ADMIN_ORDER_STATUS_INTENT") {
    return { ok: false, error: "Invalid request", code: err.code };
  }

  const payload = {
    ok: false,
    error: inventoryPublicErrorMessage_(err.code),
    code: err.code
  };
  if (typeof err.itemIndex === "number" && Number.isInteger(err.itemIndex)) payload.itemIndex = err.itemIndex;
  if (isValidInventoryProductId_(err.productId)) payload.productId = err.productId;
  return payload;
}

function doGet(e) {
  try {
    const params = (e && e.parameter) ? e.parameter : {};
    const requestedSheet = params.sheet ? String(params.sheet) : SHEET_PRODUCTS;
    assertAllowedSheet_(requestedSheet);
    requireTokenFor_(params.token, getScopeForGet_(requestedSheet, params));

    if (normalizeKey(requestedSheet) !== normalizeKey(SHEET_PRODUCTS)) {
      const rows = readSheetAsObjects(requestedSheet);
      return jsonOutput({
        ok: true,
        items: rows,
        meta: { count: rows.length, generated_at: new Date().toISOString(), source_sheet: requestedSheet }
      });
    }

    const payloadObj = buildProductsPayloadObject({
      includeInactive: toBool(params.includeInactive) || toBool(params.include_inactive),
      authoritative: toBool(params.authoritative),
      force: toBool(params.force)
    });

    return jsonOutput(payloadObj.items || []);
  } catch (err) {
    logInternalError_("doGet", err);
    return jsonOutput({ ok: false, error: publicErrorMessage_(err) });
  }
}

function doPost(e) {
  let lock;
  try {
    const payload = parsePostBody(e);
    const action = normalizeKey(payload.action || payload.type || payload.op || "");
    requireTokenFor_(payload.token, getPostScope_(payload, action));

    lock = LockService.getScriptLock();
    lock.waitLock(30000);

    if (action === "append_row" || action === "append") return jsonOutput(handleAppendRow(payload));
    if (action === "update_row" || action === "update") return jsonOutput(handleUpdateRow(payload));
    if (action === "apply_admin_order_status_intent") return jsonOutput(handleApplyAdminOrderStatusIntent_(payload));
    if (action === "decrement_stock" || action === "decrementstock") return jsonOutput(handleDecrementStock(payload));
    if (action === "append_order_and_decrement_stock" || action === "appendorderanddecrementstock") return jsonOutput(handleAppendOrderAndDecrementStock(payload));
    if (action === "ensure_recovery_schema") {
      const schema = ensureRecoverySchema_(true);
      return jsonOutput({ ok: true, result: "RECOVERY_SCHEMA_READY", email_outbox_rollout_at: schema.emailOutboxRolloutAt });
    }
    if (action === "upsert_recovery_snapshot") return jsonOutput(handleUpsertRecoverySnapshot_(payload));
    if (action === "get_recovery_snapshot") return jsonOutput(handleGetRecoverySnapshot_(payload));
    if (action === "list_recovery_snapshots_for_scan") return jsonOutput(handleListRecoverySnapshotsForScan_(payload));
    if (action === "append_recovery_payment_event") return jsonOutput(handleAppendRecoveryPaymentEvent_(payload));
    if (action === "get_recovery_payment_event") return jsonOutput(handleGetRecoveryPaymentEvent_(payload));
    if (action === "list_recovery_payment_events") return jsonOutput(handleListRecoveryPaymentEvents_(payload));
    if (action === "claim_recovery_work") return jsonOutput(handleClaimRecoveryWork_(payload));
    if (action === "mark_recovery_work_retryable") return jsonOutput(handleMarkRecoveryWork_(payload, "retryable"));
    if (action === "mark_recovery_work_attention") return jsonOutput(handleMarkRecoveryWork_(payload, "attention"));
    if (action === "mark_recovery_work_completed") return jsonOutput(handleMarkRecoveryWork_(payload, "completed"));
    if (action === "mark_recovery_snapshot_checked") return jsonOutput(handleMarkRecoverySnapshot_(payload, null));
    if (action === "mark_recovery_snapshot_completed") return jsonOutput(handleMarkRecoverySnapshot_(payload, "completed"));
    if (action === "mark_recovery_snapshot_expired_unpaid") return jsonOutput(handleMarkRecoverySnapshot_(payload, "expired_unpaid"));
    if (action === "list_recovery_attention") return jsonOutput(handleListRecoveryAttention_(payload));
    if (action === "upsert_email_outbox_event") return jsonOutput(handleUpsertEmailOutboxEvent_(payload));
    if (action === "get_email_outbox_event") return jsonOutput(handleGetEmailOutboxEvent_(payload));
    if (action === "claim_email_outbox_work") return jsonOutput(handleClaimEmailOutboxWork_(payload));
    if (action === "mark_email_outbox_provider_outcome_unknown") return jsonOutput(handleMarkEmailOutboxProviderOutcomeUnknown_(payload));
    if (action === "clear_email_outbox_provider_outcome_unknown") return jsonOutput(handleClearEmailOutboxProviderOutcomeUnknown_(payload));
    if (action === "mark_email_outbox_accepted") return jsonOutput(handleMarkEmailOutboxAccepted_(payload));
    if (action === "mark_email_outbox_retryable") return jsonOutput(handleMarkEmailOutboxRetryable_(payload));
    if (action === "mark_email_outbox_attention") return jsonOutput(handleMarkEmailOutboxAttention_(payload));
    if (action === "mark_email_outbox_skipped") return jsonOutput(handleMarkEmailOutboxSkipped_(payload));
    if (action === "list_email_outbox_attention") return jsonOutput(handleListEmailOutboxAttention_(payload));
    if (action === "list_missing_receipt_candidates") return jsonOutput(handleListMissingReceiptCandidates_(payload));
    throw new Error("Unsupported action");
  } catch (err) {
    logInternalError_("doPost", err);
    return jsonOutput(publicPostErrorPayload_(err));
  } finally {
    if (lock) lock.releaseLock();
  }
}
