import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";

type CheckoutItemInput = {
  productId?: unknown;
  name?: unknown;
  unitPrice?: unknown;
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

const normalizePrice = (value: unknown) => {
  const price = Number(value);
  if (!Number.isFinite(price)) return null;
  if (price < 0 || price > 99_999_999) return null;
  return Number(price.toFixed(2));
};

const mapCheckoutItems = (input: unknown) => {
  if (!Array.isArray(input) || input.length === 0 || input.length > MAX_ITEMS) {
    return null;
  }

  const items = input
    .map((item): CheckoutItemInput => (item && typeof item === "object" ? item : {}))
    .map((item) => {
      const quantity = normalizeQuantity(item.qty);
      const unitPrice = normalizePrice(item.unitPrice);
      const title = sanitizeText(item.name, 120);
      const productId = sanitizeText(item.productId, 80) || randomUUID();

      if (!quantity || unitPrice === null || !title) return null;

      return {
        id: productId,
        title,
        quantity,
        unit_price: unitPrice,
        currency_id: "ARS",
      };
    })
    .filter((item): item is NonNullable<typeof item> => item !== null);

  if (items.length === 0) return null;
  return items;
};

export async function POST(request: NextRequest) {
  const accessToken = process.env.MP_ACCESS_TOKEN;

  if (!accessToken) {
    return NextResponse.json({ error: "MP_ACCESS_TOKEN missing" }, { status: 500 });
  }

  const body = (await request.json().catch(() => null)) as CheckoutBodyInput | null;

  if (!body) {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const items = mapCheckoutItems(body.items);
  if (!items) {
    return NextResponse.json({ error: "Invalid cart items" }, { status: 400 });
  }

  const customerName = sanitizeText(body.payer?.name, 100);
  const customerPhone = sanitizeText(body.payer?.phone, 30).replace(/[^\d+]/g, "");
  const notes = sanitizeText(body.notes, 250);

  const externalReference = `es-${Date.now()}-${randomUUID().slice(0, 8)}`;
  const appBaseUrl = (process.env.APP_BASE_URL || request.nextUrl.origin).replace(/\/$/, "");
  const successUrl = (process.env.MP_SUCCESS_URL || `${appBaseUrl}/tienda/success?ref={EXTERNAL_REFERENCE}`).replace(
    "{EXTERNAL_REFERENCE}",
    externalReference
  );
  const failureUrl = process.env.MP_FAILURE_URL || `${appBaseUrl}/tienda`;
  const pendingUrl = process.env.MP_PENDING_URL || `${appBaseUrl}/tienda`;
  const webhookUrl = process.env.MP_WEBHOOK_URL || `${appBaseUrl}/api/mp/webhook`;
  const shouldUseAutoReturn = successUrl.startsWith("https://");

  const mpPayload = {
    items,
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

  const response = await fetch("https://api.mercadopago.com/checkout/preferences", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
      "X-Idempotency-Key": randomUUID(),
    },
    body: JSON.stringify(mpPayload),
    cache: "no-store",
  });

  const data = await response.json().catch(() => null);

  if (!response.ok || !data) {
    return NextResponse.json(
      {
        error: "No se pudo crear la preferencia de pago",
        details: data,
      },
      { status: 502 }
    );
  }

  return NextResponse.json(
    {
      id: data.id,
      initPoint: data.init_point,
      sandboxInitPoint: data.sandbox_init_point,
      externalReference: mpPayload.external_reference,
    },
    { status: 200 }
  );
}
