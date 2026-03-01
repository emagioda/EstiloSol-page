import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { env } from "@/src/config/env";
import { getProductsCatalog } from "@/src/server/catalog/getProducts";
import { fetchWithPolicy } from "@/src/server/http/fetchWithPolicy";
import { logEvent } from "@/src/server/observability/log";
import { trackBusinessEvent } from "@/src/server/observability/metrics";
import { createOrder, markPreferenceCreated } from "@/src/server/orders/store";
import { checkRateLimit } from "@/src/server/security/rateLimit";
import { parseCheckoutBody } from "@/src/server/validation/payments";
import type { Order, OrderItem } from "@/src/server/orders/types";

export const runtime = "nodejs";

type MpPreferenceResponse = {
  id?: string | number;
  init_point?: string;
  sandbox_init_point?: string;
  message?: string;
  cause?: unknown;
};

const RATE_LIMIT_MAX = 20;

export async function POST(request: NextRequest) {
  const envStatus = env.validatePaymentsServerEnv();
  if (!envStatus.ok) {
    logEvent("error", "payments.env_missing", { route: "create-preference", missing: envStatus.missing });
    return NextResponse.json({ error: "Server misconfigured" }, { status: 500 });
  }
  const accessToken = env.getRequiredServer("MP_ACCESS_TOKEN");
  await trackBusinessEvent("checkout.preference.requested", { route: "create-preference" });

  const allowed = await checkRateLimit(request, {
    keyPrefix: "es:rl:createpref",
    max: RATE_LIMIT_MAX,
    windowSeconds: 60,
  });
  if (!allowed) {
    logEvent("warn", "payments.rate_limited", { route: "create-preference" });
    await trackBusinessEvent("checkout.preference.rate_limited", { route: "create-preference" });
    return NextResponse.json({ error: "Demasiadas solicitudes. Intentá nuevamente en un minuto." }, { status: 429 });
  }

  const rawBody = await request.json().catch(() => null);
  const parsedBody = parseCheckoutBody(rawBody);
  if (!parsedBody.ok) {
    await trackBusinessEvent("checkout.preference.invalid_input", { route: "create-preference" });
    return NextResponse.json({ error: parsedBody.message }, { status: 400 });
  }
  const { items: requestedItems, payerName: customerName, payerPhone: customerPhone, notes } = parsedBody.value;

  const catalog = await getProductsCatalog({ forceFresh: true }).catch((error) => {
    logEvent("error", "payments.catalog_fetch_error", {
      route: "create-preference",
      message: error instanceof Error ? error.message : "unknown",
    });
    return null;
  });

  if (!catalog) {
    await trackBusinessEvent("checkout.preference.catalog_unavailable", { route: "create-preference" });
    return NextResponse.json({ error: "No se pudo validar el catálogo de productos" }, { status: 503 });
  }

  const items: OrderItem[] = [];
  const invalidProducts: Array<{ productId: string; name: string }> = [];
  for (const requestedItem of requestedItems) {
    const product = catalog.get(requestedItem.productId);
    if (!product) {
      invalidProducts.push({
        productId: requestedItem.productId,
        name: requestedItem.name || requestedItem.productId,
      });
      continue;
    }

    items.push({
      productId: product.id,
      title: product.name,
      unitPrice: product.price,
      qty: requestedItem.qty,
      currency: "ARS",
    });
  }

  if (invalidProducts.length > 0) {
    const uniqueInvalidProducts = Array.from(
      new Map(invalidProducts.map((item) => [item.productId, item])).values()
    );
    await trackBusinessEvent("checkout.preference.invalid_product", {
      route: "create-preference",
      invalidCount: uniqueInvalidProducts.length,
      invalidProducts: uniqueInvalidProducts.map((item) => item.name),
    });

    return NextResponse.json(
      {
        error: "Estos productos ya no están disponibles. Quitalos del carrito para continuar.",
        invalidProducts: uniqueInvalidProducts,
      },
      { status: 400 }
    );
  }

  const total = Number(items.reduce((sum, item) => sum + item.unitPrice * item.qty, 0).toFixed(2));

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

  const appBaseUrl = (env.getOptionalServer("APP_BASE_URL") || request.nextUrl.origin).replace(/\/$/, "");
  const successUrl = (env.getOptionalServer("MP_SUCCESS_URL") || `${appBaseUrl}/tienda/success?ref={EXTERNAL_REFERENCE}`).replace(
    "{EXTERNAL_REFERENCE}",
    externalReference
  );
  const failureUrl = env.getOptionalServer("MP_FAILURE_URL") || `${appBaseUrl}/tienda`;
  const pendingUrl = env.getOptionalServer("MP_PENDING_URL") || `${appBaseUrl}/tienda`;
  const webhookUrl = env.getOptionalServer("MP_WEBHOOK_URL") || `${appBaseUrl}/api/mp/webhook`;
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
    const response = await fetchWithPolicy(
      "https://api.mercadopago.com/checkout/preferences",
      {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
        "X-Idempotency-Key": externalReference,
      },
      body: JSON.stringify(payload),
      cache: "no-store",
      },
      {
        timeoutMs: 8000,
        retries: 1,
      }
    );

    const data = await response.json().catch(() => null);
    return { response, data };
  };

  let response: Response;
  let data: MpPreferenceResponse | null;

  try {
    const firstAttempt = await createPreference(mpPayload);
    response = firstAttempt.response;
    data = firstAttempt.data;
  } catch (error) {
    logEvent("error", "payments.create_preference_network_error", {
      externalReference,
      error,
    });
    await trackBusinessEvent("checkout.preference.network_error", { externalReference });
    return NextResponse.json({ error: "No se pudo crear la preferencia de pago" }, { status: 502 });
  }

  if (!response.ok && shouldUseAutoReturn && !isHttpsSuccessUrl) {
    const mpPayloadWithoutAutoReturn: typeof mpPayload = { ...mpPayload };
    delete mpPayloadWithoutAutoReturn.auto_return;
    try {
      const retryResult = await createPreference(mpPayloadWithoutAutoReturn);
      response = retryResult.response;
      data = retryResult.data;
    } catch (error) {
      logEvent("error", "payments.create_preference_retry_network_error", {
        externalReference,
        error,
      });
      await trackBusinessEvent("checkout.preference.retry_network_error", { externalReference });
      return NextResponse.json({ error: "No se pudo crear la preferencia de pago" }, { status: 502 });
    }
  }

  if (!response.ok || !data) {
    logEvent("error", "payments.create_preference_failed", {
      externalReference,
      status: response.status,
      message: typeof data?.message === "string" ? data.message : "unknown",
      cause: typeof data?.cause === "object" && data.cause !== null ? data.cause : undefined,
    });
    await trackBusinessEvent("checkout.preference.failed", {
      externalReference,
      status: response.status,
    });
    return NextResponse.json(
      {
        error: "No se pudo crear la preferencia de pago",
      },
      { status: 502 }
    );
  }

  await markPreferenceCreated(externalReference, { preferenceId: String(data.id) });
  await trackBusinessEvent("checkout.preference.created", {
    externalReference,
    preferenceId: String(data.id),
    total,
  });

  logEvent("info", "payments.preference_created", {
    externalReference,
    preferenceId: String(data.id),
  });

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
