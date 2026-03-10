import { NextRequest, NextResponse } from "next/server";
import { env } from "@/src/config/env";
import { getProductsCatalog } from "@/src/server/catalog/getProducts";
import { logEvent } from "@/src/server/observability/log";
import { trackBusinessEvent } from "@/src/server/observability/metrics";
import { buildOrderFromCheckout } from "@/src/server/orders/createFromCheckout";
import { createOrder, markPreferenceCreated } from "@/src/server/orders/store";
import { createPreferenceOnMp } from "@/src/server/payments/mpClient";
import { buildPreferencePayload, buildPreferenceUrls } from "@/src/server/payments/preferencePayload";
import type { MpPreferenceResponse } from "@/src/server/payments/shared";
import { checkRateLimit } from "@/src/server/security/rateLimit";
import { parseCheckoutBody } from "@/src/server/validation/payments";

export const runtime = "nodejs";

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
    return NextResponse.json({ error: "Demasiadas solicitudes. Intenta nuevamente en un minuto." }, { status: 429 });
  }

  const rawBody = await request.json().catch(() => null);
  const parsedBody = parseCheckoutBody(rawBody, { requirePayer: true });
  if (!parsedBody.ok) {
    await trackBusinessEvent("checkout.preference.invalid_input", { route: "create-preference" });
    return NextResponse.json({ error: parsedBody.message }, { status: 400 });
  }

  const {
    items: requestedItems,
    paymentMethod,
    deliveryMethod,
    payerName: customerName,
    payerPhone: customerPhone,
    payerEmail: customerEmail,
    notes,
  } = parsedBody.value;

  const resolvedPaymentMethod = paymentMethod || "mercadopago";
  if (resolvedPaymentMethod !== "mercadopago") {
    return NextResponse.json({ error: "Metodo de pago invalido para esta operacion" }, { status: 400 });
  }
  const resolvedDeliveryMethod = deliveryMethod || "delivery";

  const catalog = await getProductsCatalog({ forceFresh: true }).catch((error) => {
    logEvent("error", "payments.catalog_fetch_error", {
      route: "create-preference",
      message: error instanceof Error ? error.message : "unknown",
    });
    return null;
  });

  if (!catalog) {
    await trackBusinessEvent("checkout.preference.catalog_unavailable", { route: "create-preference" });
    return NextResponse.json({ error: "No se pudo validar el catalogo de productos" }, { status: 503 });
  }

  const { order, invalidProducts } = buildOrderFromCheckout({
    items: requestedItems,
    catalog,
    customerName,
    customerPhone,
    customerEmail,
    notes,
    paymentMethod: resolvedPaymentMethod,
    deliveryMethod: resolvedDeliveryMethod,
  });

  if (invalidProducts.length > 0) {
    await trackBusinessEvent("checkout.preference.invalid_product", {
      route: "create-preference",
      invalidCount: invalidProducts.length,
      invalidProducts: invalidProducts.map((item) => item.name),
    });

    return NextResponse.json(
      {
        error: "Estos productos ya no estan disponibles. Quitalos del carrito para continuar.",
        invalidProducts,
      },
      { status: 400 }
    );
  }

  if (!order) {
    return NextResponse.json({ error: "No se pudo construir la orden" }, { status: 500 });
  }

  try {
    await createOrder(order);
  } catch (error) {
    logEvent("error", "checkout.preference.order_create_failed", {
      externalReference: order.externalReference,
      error,
    });
    return NextResponse.json({ error: "No pudimos registrar tu pedido. Intenta nuevamente." }, { status: 502 });
  }

  const appBaseUrl = (env.getOptionalServer("APP_BASE_URL") || request.nextUrl.origin).replace(/\/$/, "");
  const urls = buildPreferenceUrls({
    appBaseUrl,
    externalReference: order.externalReference,
    successUrl: env.getOptionalServer("MP_SUCCESS_URL"),
    failureUrl: env.getOptionalServer("MP_FAILURE_URL"),
    pendingUrl: env.getOptionalServer("MP_PENDING_URL"),
    webhookUrl: env.getOptionalServer("MP_WEBHOOK_URL"),
  });

  const mpPayload = buildPreferencePayload({
    items: order.items,
    customerName,
    customerPhone,
    notes,
    externalReference: order.externalReference,
    urls,
    includeAutoReturn: urls.shouldUseAutoReturn,
  });

  let response: Response;
  let data: MpPreferenceResponse | null;

  try {
    const firstAttempt = await createPreferenceOnMp(mpPayload, {
      accessToken,
      idempotencyKey: order.externalReference,
    });
    response = firstAttempt.response;
    data = firstAttempt.data;
  } catch (error) {
    logEvent("error", "payments.create_preference_network_error", {
      externalReference: order.externalReference,
      error,
    });
    await trackBusinessEvent("checkout.preference.network_error", { externalReference: order.externalReference });
    return NextResponse.json({ error: "No se pudo crear la preferencia de pago" }, { status: 502 });
  }

  if (!response.ok || !data) {
    logEvent("error", "payments.create_preference_failed", {
      externalReference: order.externalReference,
      status: response.status,
      message: typeof data?.message === "string" ? data.message : "unknown",
      cause: typeof data?.cause === "object" && data.cause !== null ? data.cause : undefined,
    });
    await trackBusinessEvent("checkout.preference.failed", {
      externalReference: order.externalReference,
      status: response.status,
    });
    return NextResponse.json({ error: "No se pudo crear la preferencia de pago" }, { status: 502 });
  }

  await markPreferenceCreated(order.externalReference, { preferenceId: String(data.id) });
  await trackBusinessEvent("checkout.preference.created", {
    externalReference: order.externalReference,
    preferenceId: String(data.id),
    total: order.total,
  });

  logEvent("info", "payments.preference_created", {
    externalReference: order.externalReference,
    preferenceId: String(data.id),
  });

  return NextResponse.json(
    {
      id: data.id,
      initPoint: data.init_point,
      sandboxInitPoint: data.sandbox_init_point,
      externalReference: order.externalReference,
    },
    { status: 200 }
  );
}
