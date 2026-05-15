/**
 * ESTILO SOL - API APP SCRIPT (V4.0)
 *
 * Script Properties requeridas:
 * - SPREADSHEET_ID: id de la planilla.
 * - SHEETS_API_TOKEN: token compartido con el servidor Next.js.
 *
 * Cambios clave:
 * - doGet/doPost exigen token.
 * - Solo se permiten las hojas "products" y "ventas".
 * - El cliente web ya no debe llamar Apps Script directo: usa /api/catalog.
 * - Productos activos usan CacheService por 180 segundos.
 */

const SHEET_PRODUCTS = "products";
const SHEET_SALES = "ventas";
const CACHE_PRODUCTS_KEY = "catalog:products:active:v4";
const CACHE_PRODUCTS_TTL_SECONDS = 180;
const ALLOWED_SHEETS = [SHEET_PRODUCTS, SHEET_SALES];
const ORDER_ID_KEYS = ["nro_de_compra", "order_id", "id_pedido", "orderid", "external_reference", "id"];

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

function expectedToken_() {
  return getScriptProperty_("SHEETS_API_TOKEN") || getScriptProperty_("API_TOKEN");
}

function requireToken_(token) {
  const expected = expectedToken_();
  if (!expected) throw new Error("SHEETS_API_TOKEN script property is missing");
  if (!token || String(token) !== expected) throw new Error("Unauthorized");
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
  const images = parseCsv_(p.images || p.images_csv || p.imagenes);
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

  const price = toNumberOrNull_(p.price || p.precio);
  const oldPrice = toNumberOrNull_(p.old_price || p.precio_anterior);
  const stockQty = toNumberOrNull_(p.stock_qty || p.stock || p.cantidad_stock);
  const rawStockStatus = compactKey(p.stock_status || p.estado_stock);
  const stockStatus =
    rawStockStatus === "outofstock" || rawStockStatus === "sinstock" || rawStockStatus === "agotado"
      ? "out_of_stock"
      : rawStockStatus === "preorder" || rawStockStatus === "preventa" || rawStockStatus === "reserva"
        ? "preorder"
        : (typeof stockQty === "number" && stockQty <= 0 ? "out_of_stock" : "in_stock");
  const rawSlug = p.slug ? String(p.slug).trim() : "";
  const finalSlug = rawSlug || String(p.id || p.product_id || "");

  return {
    id: p.id ? String(p.id) : null,
    name: p.name ? String(p.name) : null,
    slug: finalSlug,
    departament: p.departament ? String(p.departament).toUpperCase() : null,
    category: p.category ? String(p.category) : null,
    price: typeof price === "number" ? price : null,
    old_price: typeof oldPrice === "number" ? oldPrice : null,
    currency: p.currency ? String(p.currency) : "ARS",
    short_description: p.short_description ? String(p.short_description) : null,
    description: p.description ? String(p.description) : null,
    product_type: compactKey(p.product_type) === "kit" ? "KIT" : "UNICO",
    images: images,
    specifications: specifications,
    is_featured: toBool(p.is_featured || p.destacado),
    is_new: toBool(p.is_new || p.nuevo),
    is_sale: toBool(p.is_sale || p.oferta) || (typeof oldPrice === "number" && typeof price === "number" && oldPrice > price),
    stock_status: stockStatus,
    stock_qty: typeof stockQty === "number" ? stockQty : null,
    active: p.active === undefined && p.activo === undefined ? true : toBool(p.active || p.activo),
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
  const force = Boolean(options && options.force);
  const cache = CacheService.getScriptCache();

  if (!includeInactive && !force) {
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
    if (hasRequiredProductCols) {
      return isNonEmptyCell_(r[idCol]) && isNonEmptyCell_(r[nameCol]) && isNonEmptyCell_(r[priceCol]);
    }
    return r.some(isNonEmptyCell_);
  });
  const items = rows
    .map((r) => rowToObject(headers, r))
    .map(normalizeProduct)
    .filter((p) => p.id && p.name && (includeInactive ? true : p.active));

  if (!includeInactive) cache.put(CACHE_PRODUCTS_KEY, JSON.stringify(items), CACHE_PRODUCTS_TTL_SECONDS);

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
    const value = resolveValueByHeader(normalizeKey(header), updateMap);
    if (value !== undefined) columnUpdates[idx] = toCellValue(value);
  });

  const updatedAtCol = findColumnIndex(headers, ["updated_at", "actualizado_en", "fecha_actualizacion"]);
  if (payload.touchUpdatedAt !== false && updatedAtCol !== -1 && columnUpdates[updatedAtCol] === undefined) {
    columnUpdates[updatedAtCol] = new Date().toISOString();
  }

  const updateCols = Object.keys(columnUpdates);
  if (updateCols.length === 0) throw new Error("No update keys matched headers");

  matchedRows.forEach((rowNumber) => {
    const row = sheet.getRange(rowNumber, 1, 1, headers.length).getValues()[0];
    updateCols.forEach((colIndex) => {
      row[Number(colIndex)] = columnUpdates[colIndex];
    });
    sheet.getRange(rowNumber, 1, 1, headers.length).setValues([row]);
  });

  if (normalizeKey(sheetName) === normalizeKey(SHEET_PRODUCTS)) clearCatalogCache_();
  return { ok: true, action: "updateRow", sheet: sheetName, updatedRows: matchedRows.length, rowNumbers: matchedRows };
}

function normalizeStockItems_(items) {
  if (!Array.isArray(items)) throw new Error("decrementStock requires items array");
  return items.map(function(item) {
    const productId = String(item && (item.productId || item.product_id || item.id) || "").trim();
    const qty = Math.trunc(Number(item && item.qty));
    const title = String(item && (item.title || item.name) || "").trim();
    if (!productId || !isFinite(qty) || qty <= 0) return null;
    return { productId: productId, qty: qty, title: title };
  }).filter(Boolean);
}

function stockDeductionPropertyKey_(orderId) {
  return "stock_deducted:" + String(orderId || "").trim();
}

function handleDecrementStock(payload) {
  const sheetName = payload.sheet || payload.sheetName || SHEET_PRODUCTS;
  assertAllowedSheet_(sheetName);
  if (normalizeKey(sheetName) !== normalizeKey(SHEET_PRODUCTS)) {
    throw new Error("decrementStock only supports products sheet");
  }

  const orderId = String(payload.orderId || payload.order_id || payload.externalReference || "").trim();
  if (!orderId) throw new Error("decrementStock requires orderId");

  const items = normalizeStockItems_(payload.items);
  if (items.length === 0) throw new Error("decrementStock requires at least one valid item");

  const props = PropertiesService.getScriptProperties();
  const deductionKey = stockDeductionPropertyKey_(orderId);
  if (props.getProperty(deductionKey)) {
    return { ok: true, action: "decrementStock", deduped: true, orderId: orderId };
  }

  const sheet = getSheetOrThrow(SHEET_PRODUCTS);
  const headers = getHeaders(sheet);
  const lastRow = sheet.getLastRow();
  if (headers.length === 0 || lastRow < 2) throw new Error("Products sheet has no data rows");

  const idCol = findColumnIndex(headers, ["id", "product_id", "id_producto"]);
  const stockQtyCol = findColumnIndex(headers, ["stock_qty", "stock", "cantidad_stock"]);
  const updatedAtCol = findColumnIndex(headers, ["updated_at", "actualizado_en", "fecha_actualizacion"]);

  if (idCol === -1) throw new Error("Products sheet is missing product id column");
  if (stockQtyCol === -1) throw new Error("Products sheet is missing stock_qty column");

  const data = sheet.getRange(2, 1, lastRow - 1, headers.length).getValues();
  const rowsByProductId = {};
  for (let i = 0; i < data.length; i++) {
    rowsByProductId[normalizeCompareValue(data[i][idCol])] = {
      rowNumber: i + 2,
      row: data[i]
    };
  }

  const updates = [];
  const skipped = [];
  items.forEach(function(item) {
    const found = rowsByProductId[normalizeCompareValue(item.productId)];
    if (!found) throw new Error("Product not found for stock decrement: " + item.productId);

    const currentStock = toNumberOrNull_(found.row[stockQtyCol]);
    if (currentStock === null) {
      skipped.push({ productId: item.productId, reason: "stock_untracked" });
      return;
    }

    const currentQty = Math.max(0, Math.trunc(currentStock));
    if (currentQty < item.qty) {
      throw new Error("Insufficient stock for " + (item.title || item.productId) + ". Available: " + currentQty + ", requested: " + item.qty);
    }

    const nextQty = currentQty - item.qty;
    updates.push({
      productId: item.productId,
      rowNumber: found.rowNumber,
      row: found.row.slice(),
      previousQty: currentQty,
      nextQty: nextQty
    });
  });

  const now = new Date().toISOString();
  updates.forEach(function(update) {
    update.row[stockQtyCol] = update.nextQty;
    if (updatedAtCol !== -1) update.row[updatedAtCol] = now;
    sheet.getRange(update.rowNumber, 1, 1, headers.length).setValues([update.row]);
  });

  props.setProperty(deductionKey, now);
  clearCatalogCache_();

  return {
    ok: true,
    action: "decrementStock",
    orderId: orderId,
    updated: updates.map(function(update) {
      return {
        productId: update.productId,
        previousQty: update.previousQty,
        nextQty: update.nextQty
      };
    }),
    skipped: skipped
  };
}

function planStockDecrement_(items) {
  const sheet = getSheetOrThrow(SHEET_PRODUCTS);
  const headers = getHeaders(sheet);
  const lastRow = sheet.getLastRow();
  if (headers.length === 0 || lastRow < 2) throw new Error("Products sheet has no data rows");

  const idCol = findColumnIndex(headers, ["id", "product_id", "id_producto"]);
  const stockQtyCol = findColumnIndex(headers, ["stock_qty", "stock", "cantidad_stock"]);
  const updatedAtCol = findColumnIndex(headers, ["updated_at", "actualizado_en", "fecha_actualizacion"]);

  if (idCol === -1) throw new Error("Products sheet is missing product id column");
  if (stockQtyCol === -1) throw new Error("Products sheet is missing stock_qty column");

  const data = sheet.getRange(2, 1, lastRow - 1, headers.length).getValues();
  const rowsByProductId = {};
  for (let i = 0; i < data.length; i++) {
    rowsByProductId[normalizeCompareValue(data[i][idCol])] = {
      rowNumber: i + 2,
      row: data[i]
    };
  }

  const updates = [];
  const skipped = [];
  items.forEach(function(item) {
    const found = rowsByProductId[normalizeCompareValue(item.productId)];
    if (!found) throw new Error("Product not found for stock decrement: " + item.productId);

    const currentStock = toNumberOrNull_(found.row[stockQtyCol]);
    if (currentStock === null) {
      skipped.push({ productId: item.productId, reason: "stock_untracked" });
      return;
    }

    const currentQty = Math.max(0, Math.trunc(currentStock));
    if (currentQty < item.qty) {
      throw new Error("Insufficient stock for " + (item.title || item.productId) + ". Available: " + currentQty + ", requested: " + item.qty);
    }

    const nextQty = currentQty - item.qty;
    updates.push({
      productId: item.productId,
      rowNumber: found.rowNumber,
      row: found.row.slice(),
      previousQty: currentQty,
      nextQty: nextQty
    });
  });

  return {
    sheet: sheet,
    headers: headers,
    stockQtyCol: stockQtyCol,
    updatedAtCol: updatedAtCol,
    updates: updates,
    skipped: skipped
  };
}

function applyStockPlan_(plan, now) {
  plan.updates.forEach(function(update) {
    update.row[plan.stockQtyCol] = update.nextQty;
    if (plan.updatedAtCol !== -1) update.row[plan.updatedAtCol] = now;
    plan.sheet.getRange(update.rowNumber, 1, 1, plan.headers.length).setValues([update.row]);
  });
}

function handleAppendOrderAndDecrementStock(payload) {
  const orderId = String(payload.orderId || payload.order_id || payload.externalReference || "").trim();
  if (!orderId) throw new Error("appendOrderAndDecrementStock requires orderId");

  const props = PropertiesService.getScriptProperties();
  const deductionKey = stockDeductionPropertyKey_(orderId);
  if (props.getProperty(deductionKey)) {
    return { ok: true, action: "appendOrderAndDecrementStock", deduped: true, orderId: orderId };
  }

  const salesSheetName = payload.sheet || payload.sheetName || SHEET_SALES;
  assertAllowedSheet_(salesSheetName);
  if (normalizeKey(salesSheetName) !== normalizeKey(SHEET_SALES)) {
    throw new Error("appendOrderAndDecrementStock only supports ventas sheet");
  }

  const rowInput = payload.row || payload.data || payload.values || payload.order;
  if (rowInput === undefined || rowInput === null) throw new Error("appendOrderAndDecrementStock requires row");

  const items = normalizeStockItems_(payload.items);
  if (items.length === 0) throw new Error("appendOrderAndDecrementStock requires at least one valid item");

  const salesSheet = getSheetOrThrow(SHEET_SALES);
  const salesHeaders = getHeaders(salesSheet);
  const rowValues = buildAppendRowValues_(salesSheet, rowInput);
  const existingSalesRow = findOrderRowNumber_(salesSheet, salesHeaders, orderId);
  const stockPlan = planStockDecrement_(items);
  const now = new Date().toISOString();

  if (existingSalesRow === -1) {
    salesSheet.appendRow(rowValues);
  }
  applyStockPlan_(stockPlan, now);
  props.setProperty(deductionKey, now);
  clearCatalogCache_();

  return {
    ok: true,
    action: "appendOrderAndDecrementStock",
    orderId: orderId,
    salesRowNumber: existingSalesRow === -1 ? salesSheet.getLastRow() : existingSalesRow,
    dedupedSalesRow: existingSalesRow !== -1,
    updated: stockPlan.updates.map(function(update) {
      return {
        productId: update.productId,
        previousQty: update.previousQty,
        nextQty: update.nextQty
      };
    }),
    skipped: stockPlan.skipped
  };
}

function doGet(e) {
  try {
    const params = (e && e.parameter) ? e.parameter : {};
    requireToken_(params.token);

    const requestedSheet = params.sheet ? String(params.sheet) : SHEET_PRODUCTS;
    assertAllowedSheet_(requestedSheet);

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
      force: toBool(params.force)
    });

    return jsonOutput(payloadObj.items || []);
  } catch (err) {
    return jsonOutput({ ok: false, error: String(err && err.message ? err.message : err) });
  }
}

function doPost(e) {
  let lock;
  try {
    const payload = parsePostBody(e);
    requireToken_(payload.token);

    lock = LockService.getScriptLock();
    lock.waitLock(30000);

    const action = normalizeKey(payload.action || payload.type || payload.op || "");
    if (action === "append_row" || action === "append") return jsonOutput(handleAppendRow(payload));
    if (action === "update_row" || action === "update") return jsonOutput(handleUpdateRow(payload));
    if (action === "decrement_stock" || action === "decrementstock") return jsonOutput(handleDecrementStock(payload));
    if (action === "append_order_and_decrement_stock" || action === "appendorderanddecrementstock") return jsonOutput(handleAppendOrderAndDecrementStock(payload));
    throw new Error("Unsupported action");
  } catch (err) {
    return jsonOutput({ ok: false, error: String(err && err.message ? err.message : err) });
  } finally {
    if (lock) lock.releaseLock();
  }
}
