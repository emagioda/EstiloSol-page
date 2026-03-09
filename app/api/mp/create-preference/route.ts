import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { env } from "@/src/config/env";
import { getProductsCatalog } from "@/src/server/catalog/getProducts";
import { logEvent } from "@/src/server/observability/log";
import { trackBusinessEvent } from "@/src/server/observability/metrics";
import { createOrder, markPreferenceCreated } from "@/src/server/orders/store";
import { checkRateLimit } from "@/src/server/security/rateLimit";
import { createPreferenceOnMp } from "@/src/server/payments/mpClient";
import { buildPreferencePayload, buildPreferenceUrls } from "@/src/server/payments/preferencePayload";
import type { MpPreferenceResponse } from "@/src/server/payments/shared";
import { parseCheckoutBody } from "@/src/server/validation/payments";
import type { Order, OrderItem } from "@/src/server/orders/types";

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
    return NextResponse.json({ error: "Demasiadas solicitudes. Intentá nuevamente en un minuto." }, { status: 429 });
  }

  const rawBody = await request.json().catch(() => null);
  const parsedBody = parseCheckoutBody(rawBody, { requirePayer: true });
  if (!parsedBody.ok) {
    await trackBusinessEvent("checkout.preference.invalid_input", { route: "create-preference" });
    return NextResponse.json({ error: parsedBody.message }, { status: 400 });
  }
  const {
    items: requestedItems,
    payerName: customerName,
    payerPhone: customerPhone,
    payerEmail: customerEmail,
    notes,
  } = parsedBody.value;

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
    ...(customerName || customerPhone || customerEmail
      ? {
          customer: {
            ...(customerName ? { name: customerName } : {}),
            ...(customerPhone ? { phone: customerPhone } : {}),
            ...(customerEmail ? { email: customerEmail } : {}),
          },
        }
      : {}),
    ...(notes ? { notes } : {}),
  };

  await createOrder(order);

  const appBaseUrl = (env.getOptionalServer("APP_BASE_URL") || request.nextUrl.origin).replace(/\/$/, "");
  const urls = buildPreferenceUrls({
    appBaseUrl,
    externalReference,
    successUrl: env.getOptionalServer("MP_SUCCESS_URL"),
    failureUrl: env.getOptionalServer("MP_FAILURE_URL"),
    pendingUrl: env.getOptionalServer("MP_PENDING_URL"),
    webhookUrl: env.getOptionalServer("MP_WEBHOOK_URL"),
  });

  const mpPayload = buildPreferencePayload({
    items,
    customerName,
    customerPhone,
    notes,
    externalReference,
    urls,
    includeAutoReturn: urls.shouldUseAutoReturn,
  });

  let response: Response;
  let data: MpPreferenceResponse | null;

  try {
    const firstAttempt = await createPreferenceOnMp(mpPayload, {
      accessToken,
      idempotencyKey: externalReference,
    });
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
