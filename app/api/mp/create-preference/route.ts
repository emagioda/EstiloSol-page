import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { kv } from "@/src/server/kv";
import { getProductsCatalog } from "@/src/server/catalog/getProducts";
import { createOrder, markPreferenceCreated } from "@/src/server/orders/store";
import type { Order, OrderItem } from "@/src/server/orders/types";

export const runtime = "nodejs";

type CheckoutItemInput = {
  productId?: unknown;
  qty?: unknown;
};

type CheckoutBodyInput = {
  items?: unknown;
  payer?: {
    name?: unknown;
    phone?: unknown;
  };
  notes?: unknown;
};

const MAX_ITEMS = 30;
const RATE_LIMIT_MAX = 20;

const sanitizeText = (value: unknown, maxLength: number) => {
  if (typeof value !== "string") return "";

  return value
    .replace(/[\u0000-\u001F\u007F]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxLength);
};

const normalizeQuantity = (value: unknown) => {
  const quantity = Number(value);
  if (!Number.isInteger(quantity)) return null;
  if (quantity < 1 || quantity > 50) return null;
  return quantity;
};

const getClientIp = (request: NextRequest) => {
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0]?.trim() || "unknown";
  return request.headers.get("x-real-ip") || "unknown";
};

const checkRateLimit = async (request: NextRequest) => {
  const ip = getClientIp(request);
  const minuteBucket = Math.floor(Date.now() / 60_000);
  const key = `es:rl:createpref:${ip}:${minuteBucket}`;
  const count = await kv.incr(key);

  if (count === 1) {
    await kv.expire(key, 61);
  }

  return count <= RATE_LIMIT_MAX;
};

const parseItems = (input: unknown): Array<{ productId: string; qty: number }> | null => {
  if (!Array.isArray(input) || input.length === 0 || input.length > MAX_ITEMS) {
    return null;
  }

  const parsed = input
    .map((item): CheckoutItemInput => (item && typeof item === "object" ? item : {}))
    .map((item) => {
      const productId = sanitizeText(item.productId, 120);
      const qty = normalizeQuantity(item.qty);

      if (!productId || !qty) return null;
      return { productId, qty };
    })
    .filter((item): item is NonNullable<typeof item> => item !== null);

  if (parsed.length === 0) return null;
  return parsed;
};

export async function POST(request: NextRequest) {
  const accessToken = process.env.MP_ACCESS_TOKEN;

  if (!accessToken) {
    return NextResponse.json({ error: "MP_ACCESS_TOKEN missing" }, { status: 500 });
  }

  const allowed = await checkRateLimit(request);
  if (!allowed) {
    return NextResponse.json({ error: "Demasiadas solicitudes. Intentá nuevamente en un minuto." }, { status: 429 });
  }

  const body = (await request.json().catch(() => null)) as CheckoutBodyInput | null;

  if (!body) {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const requestedItems = parseItems(body.items);
  if (!requestedItems) {
    return NextResponse.json({ error: "Invalid cart items" }, { status: 400 });
  }

  const catalog = await getProductsCatalog().catch((error) => {
    console.error("create-preference catalog error", { message: error instanceof Error ? error.message : "unknown" });
    return null;
  });

  if (!catalog) {
    return NextResponse.json({ error: "No se pudo validar el catálogo de productos" }, { status: 503 });
  }

  const items: OrderItem[] = [];
  for (const requestedItem of requestedItems) {
    const product = catalog.get(requestedItem.productId);
    if (!product) {
      return NextResponse.json({ error: `Producto inválido: ${requestedItem.productId}` }, { status: 400 });
    }

    items.push({
      productId: product.id,
      title: product.name,
      unitPrice: product.price,
      qty: requestedItem.qty,
      currency: "ARS",
    });
  }

  const total = Number(items.reduce((sum, item) => sum + item.unitPrice * item.qty, 0).toFixed(2));
  const customerName = sanitizeText(body.payer?.name, 100);
  const customerPhone = sanitizeText(body.payer?.phone, 30).replace(/[^\d+]/g, "");
  const notes = sanitizeText(body.notes, 250);

  const externalReference = `es-${Date.now()}-${randomUUID().slice(0, 8)}`;
  const now = Date.now();

  const order: Order = {
    externalReference,
    status: "created",
    items,
    total,
    currency: "ARS",
    createdAt: now,
    updatedAt: now,
    ...(customerName || customerPhone
      ? {
          customer: {
            ...(customerName ? { name: customerName } : {}),
            ...(customerPhone ? { phone: customerPhone } : {}),
          },
        }
      : {}),
    ...(notes ? { notes } : {}),
  };

  await createOrder(order);

  const appBaseUrl = (process.env.APP_BASE_URL || request.nextUrl.origin).replace(/\/$/, "");
  const successUrl = (process.env.MP_SUCCESS_URL || `${appBaseUrl}/tienda/success?ref={EXTERNAL_REFERENCE}`).replace(
    "{EXTERNAL_REFERENCE}",
    externalReference
  );
  const failureUrl = process.env.MP_FAILURE_URL || `${appBaseUrl}/tienda`;
  const pendingUrl = process.env.MP_PENDING_URL || `${appBaseUrl}/tienda`;
  const webhookUrl = process.env.MP_WEBHOOK_URL || `${appBaseUrl}/api/mp/webhook`;
  const isHttpsSuccessUrl = successUrl.startsWith("https://");
  const isLocalSuccessUrl =
    successUrl.startsWith("http://localhost") || successUrl.startsWith("http://127.0.0.1");
  const shouldUseAutoReturn = isHttpsSuccessUrl || isLocalSuccessUrl;

  const mpPayload = {
    items: items.map((item) => ({
      id: item.productId,
      title: item.title,
      quantity: item.qty,
      unit_price: item.unitPrice,
      currency_id: "ARS",
    })),
    payer: {
      ...(customerName ? { name: customerName } : {}),
      ...(customerPhone ? { phone: { number: customerPhone } } : {}),
    },
    back_urls: {
      success: successUrl,
      failure: failureUrl,
      pending: pendingUrl,
    },
    ...(shouldUseAutoReturn ? { auto_return: "approved" as const } : {}),
    binary_mode: true,
    notification_url: webhookUrl,
    external_reference: externalReference,
    metadata: {
      store: "estilo-sol",
      ...(notes ? { notes } : {}),
    },
  };

  const createPreference = async (payload: typeof mpPayload) => {
    const response = await fetch("https://api.mercadopago.com/checkout/preferences", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
        "X-Idempotency-Key": externalReference,
      },
      body: JSON.stringify(payload),
      cache: "no-store",
    });

    const data = await response.json().catch(() => null);
    return { response, data };
  };

  let { response, data } = await createPreference(mpPayload);

  if (!response.ok && shouldUseAutoReturn && !isHttpsSuccessUrl) {
    const { auto_return, ...mpPayloadWithoutAutoReturn } = mpPayload;
    const retryResult = await createPreference(mpPayloadWithoutAutoReturn);
    response = retryResult.response;
    data = retryResult.data;
  }

  if (!response.ok || !data) {
    console.error("create-preference mp error", {
      externalReference,
      status: response.status,
      message: typeof data?.message === "string" ? data.message : "unknown",
      cause: typeof data?.cause === "object" && data.cause !== null ? data.cause : undefined,
    });
    return NextResponse.json(
      {
        error: "No se pudo crear la preferencia de pago",
      },
      { status: 502 }
    );
  }

  await markPreferenceCreated(externalReference, { preferenceId: String(data.id) });

  return NextResponse.json(
    {
      id: data.id,
      initPoint: data.init_point,
      sandboxInitPoint: data.sandbox_init_point,
      externalReference,
    },
    { status: 200 }
  );
}
