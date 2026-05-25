import { createHash } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { getActivePickupPointById } from "@/src/config/fulfillment";
import { env } from "@/src/config/env";
import { getProductsCatalog } from "@/src/server/catalog/getProducts";
import { getFulfillmentConfig } from "@/src/server/fulfillment/source";
import { getJson, setJson } from "@/src/server/kv";
import { logEvent } from "@/src/server/observability/log";
import { trackBusinessEvent } from "@/src/server/observability/metrics";
import { buildOrderFromCheckout } from "@/src/server/orders/createFromCheckout";
import { createOrder, markPreferenceCreated } from "@/src/server/orders/store";
import { createPreferenceOnMp } from "@/src/server/payments/mpClient";
import { buildPreferencePayload, buildPreferenceUrls } from "@/src/server/payments/preferencePayload";
import type { MpPreferenceResponse } from "@/src/server/payments/shared";
import { invalidProductsMessage } from "@/src/server/catalog/stock";
import { checkRateLimit } from "@/src/server/security/rateLimit";
import { parseCheckoutBody, type ParsedCheckoutBody } from "@/src/server/validation/payments";

export const runtime = "nodejs";

const RATE_LIMIT_MAX = 20;
const CHECKOUT_ATTEMPT_TTL_SECONDS = 15 * 60;

type CreatePreferenceSuccessPayload = {
  id: MpPreferenceResponse["id"];
  initPoint?: string;
  sandboxInitPoint?: string;
  externalReference: string;
  summaryToken?: string;
};

type CheckoutAttemptRecord = {
  fingerprint: string;
  response: CreatePreferenceSuccessPayload;
  createdAt: number;
};

const checkoutAttemptKey = (attemptId: string) => `es:checkout-attempt:${attemptId}`;

const elapsedSince = (startedAt: number) => Date.now() - startedAt;

const buildCheckoutAttemptFingerprint = (body: ParsedCheckoutBody) =>
  createHash("sha256")
    .update(
      JSON.stringify({
        items: body.items.map((item) => ({
          productId: item.productId,
          qty: item.qty,
          unitPrice: item.unitPrice,
        })),
        paymentMethod: body.paymentMethod,
        deliveryMethod: body.deliveryMethod,
        fulfillment: body.fulfillment,
        payerName: body.payerName,
        payerPhone: body.payerPhone,
        payerEmail: body.payerEmail,
        notes: body.notes,
      })
    )
    .digest("hex");

const buildMpIdempotencyKey = (externalReference: string, checkoutAttemptId?: string) => {
  if (!checkoutAttemptId) return externalReference;
  return createHash("sha256")
    .update(`${externalReference}:${checkoutAttemptId}`)
    .digest("hex");
};

const logCheckoutTiming = (
  startedAt: number,
  timings: Record<string, number>,
  outcome: string,
  context: Record<string, unknown> = {}
) => {
  logEvent("info", "checkout.preference.timing", {
    route: "create-preference",
    outcome,
    durationMs: elapsedSince(startedAt),
    timeToInitPointMs: elapsedSince(startedAt),
    ...timings,
    ...context,
  });
};

export async function POST(request: NextRequest) {
  const startedAt = Date.now();
  const timings: Record<string, number> = {};
  const hasSheetsEndpoint = Boolean(env.getOptionalServer("SHEETS_ENDPOINT"));
  let googleSheetsCallCount = 0;
  const measure = async <T>(label: string, task: () => Promise<T>): Promise<T> => {
    const stepStartedAt = Date.now();
    try {
      return await task();
    } finally {
      timings[label] = elapsedSince(stepStartedAt);
    }
  };
  const respond = (
    body: Record<string, unknown>,
    init: ResponseInit,
    outcome: string,
    context: Record<string, unknown> = {}
  ) => {
    logCheckoutTiming(startedAt, timings, outcome, {
      status: init.status,
      googleSheetsCallCount,
      ...context,
    });
    return NextResponse.json(body, init);
  };

  const envStatus = env.validatePaymentsServerEnv();
  if (!envStatus.ok) {
    logEvent("error", "payments.env_missing", { route: "create-preference", missing: envStatus.missing });
    return respond({ error: "Server misconfigured" }, { status: 500 }, "env_missing", {
      missingCount: envStatus.missing.length,
    });
  }
  const accessToken = env.getRequiredServer("MP_ACCESS_TOKEN");
  await trackBusinessEvent("checkout.preference.requested", { route: "create-preference" });

  const allowed = await measure("rateLimitMs", () =>
    checkRateLimit(request, {
      keyPrefix: "es:rl:createpref",
      max: RATE_LIMIT_MAX,
      windowSeconds: 60,
    })
  );
  if (!allowed) {
    logEvent("warn", "payments.rate_limited", { route: "create-preference" });
    await trackBusinessEvent("checkout.preference.rate_limited", { route: "create-preference" });
    return respond(
      { error: "Demasiadas solicitudes. Intenta nuevamente en un minuto." },
      { status: 429 },
      "rate_limited"
    );
  }

  const rawBody = await measure("parseBodyMs", () => request.json().catch(() => null));
  timings.rateLimitAndParseBodyMs = (timings.rateLimitMs || 0) + (timings.parseBodyMs || 0);
  const parsedBody = parseCheckoutBody(rawBody, { requirePayer: true, requireFulfillment: true });
  if (!parsedBody.ok) {
    await trackBusinessEvent("checkout.preference.invalid_input", { route: "create-preference" });
    return respond({ error: parsedBody.message }, { status: 400 }, "invalid_input");
  }

  const checkoutFingerprint = buildCheckoutAttemptFingerprint(parsedBody.value);
  const checkoutAttemptId = parsedBody.value.checkoutAttemptId;
  if (checkoutAttemptId) {
    const attemptRecord = await measure("idempotencyLookupMs", () =>
      getJson<CheckoutAttemptRecord>(checkoutAttemptKey(checkoutAttemptId))
    );

    if (attemptRecord?.fingerprint === checkoutFingerprint) {
      logEvent("info", "checkout.preference.idempotent_replay", {
        externalReference: attemptRecord.response.externalReference,
      });
      return respond(
        attemptRecord.response as unknown as Record<string, unknown>,
        { status: 200 },
        "idempotent_replay",
        {
          externalReference: attemptRecord.response.externalReference,
          itemCount: parsedBody.value.items.length,
        }
      );
    }
  }

  const {
    items: requestedItems,
    paymentMethod,
    deliveryMethod,
    fulfillment,
    payerName: customerName,
    payerPhone: customerPhone,
    payerEmail: customerEmail,
    notes,
  } = parsedBody.value;

  const resolvedPaymentMethod = paymentMethod || "mercadopago";
  if (resolvedPaymentMethod !== "mercadopago") {
    return respond({ error: "Metodo de pago invalido para esta operacion" }, { status: 400 }, "invalid_payment_method");
  }
  if (!deliveryMethod) {
    return respond({ error: "Metodo de entrega invalido" }, { status: 400 }, "invalid_delivery_method");
  }

  const fulfillmentConfig = await measure("fulfillmentReadMs", () => getFulfillmentConfig());
  if (hasSheetsEndpoint) googleSheetsCallCount += 1;
  if (
    deliveryMethod === "pickup" &&
    !getActivePickupPointById(fulfillmentConfig, fulfillment.pickupPointId || "")
  ) {
    return respond({ error: "Punto de encuentro inválido." }, { status: 400 }, "invalid_pickup_point");
  }

  const catalog = await measure("catalogReadMs", () =>
    getProductsCatalog({ forceFresh: true }).catch((error) => {
      logEvent("error", "payments.catalog_fetch_error", {
        route: "create-preference",
        message: error instanceof Error ? error.message : "unknown",
      });
      return null;
    })
  );
  if (hasSheetsEndpoint) googleSheetsCallCount += 1;

  if (!catalog) {
    await trackBusinessEvent("checkout.preference.catalog_unavailable", { route: "create-preference" });
    return respond(
      { error: "No se pudo validar el catalogo de productos" },
      { status: 503 },
      "catalog_unavailable"
    );
  }

  const { order, invalidProducts } = (() => {
    const stepStartedAt = Date.now();
    try {
      return buildOrderFromCheckout({
        items: requestedItems,
        catalog,
        customerName,
        customerPhone,
        customerEmail,
        notes,
        paymentMethod: resolvedPaymentMethod,
        deliveryMethod,
        fulfillment,
        fulfillmentConfig,
      });
    } finally {
      timings.orderBuildMs = elapsedSince(stepStartedAt);
    }
  })();

  if (invalidProducts.length > 0) {
    await trackBusinessEvent("checkout.preference.invalid_product", {
      route: "create-preference",
      invalidCount: invalidProducts.length,
      invalidProducts: invalidProducts.map((item) => item.name),
    });

    return respond(
      {
        error: invalidProductsMessage(invalidProducts),
        invalidProducts,
      },
      { status: 400 },
      "invalid_product",
      {
        invalidCount: invalidProducts.length,
        itemCount: requestedItems.length,
      }
    );
  }

  if (!order) {
    return respond(
      { error: "No se pudo construir la orden con los datos de entrega." },
      { status: 400 },
      "order_build_failed"
    );
  }

  try {
    await measure("orderCreateMs", () => createOrder(order, { syncSheet: false }));
  } catch (error) {
    logEvent("error", "checkout.preference.order_create_failed", {
      externalReference: order.externalReference,
      error,
    });
    return respond(
      { error: "No pudimos registrar tu pedido. Intenta nuevamente." },
      { status: 502 },
      "order_create_failed",
      { externalReference: order.externalReference }
    );
  }

  const appBaseUrl = (env.getOptionalServer("APP_BASE_URL") || request.nextUrl.origin).replace(/\/$/, "");
  const urls = buildPreferenceUrls({
    appBaseUrl,
    externalReference: order.externalReference,
    summaryToken: order.summaryToken,
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
    deliveryMethod: order.deliveryMethod,
    fulfillment: order.fulfillment,
    externalReference: order.externalReference,
    urls,
    includeAutoReturn: urls.shouldUseAutoReturn,
  });

  let response: Response;
  let data: MpPreferenceResponse | null;

  try {
    const firstAttempt = await measure("mpCreatePreferenceMs", () =>
      createPreferenceOnMp(mpPayload, {
        accessToken,
        idempotencyKey: buildMpIdempotencyKey(order.externalReference, checkoutAttemptId),
      })
    );
    response = firstAttempt.response;
    data = firstAttempt.data;
  } catch (error) {
    logEvent("error", "payments.create_preference_network_error", {
      externalReference: order.externalReference,
      error,
    });
    await trackBusinessEvent("checkout.preference.network_error", { externalReference: order.externalReference });
    return respond(
      { error: "No se pudo crear la preferencia de pago" },
      { status: 502 },
      "mp_network_error",
      { externalReference: order.externalReference }
    );
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
    return respond(
      { error: "No se pudo crear la preferencia de pago" },
      { status: 502 },
      "mp_failed",
      { externalReference: order.externalReference, mpStatus: response.status }
    );
  }

  await measure("markPreferenceCreatedMs", () =>
    markPreferenceCreated(
      order.externalReference,
      { preferenceId: String(data.id) },
      { syncSheet: false }
    )
  );
  await trackBusinessEvent("checkout.preference.created", {
    externalReference: order.externalReference,
    preferenceId: String(data.id),
    total: order.total,
  });

  logEvent("info", "payments.preference_created", {
    externalReference: order.externalReference,
    preferenceId: String(data.id),
  });

  const responseBody: CreatePreferenceSuccessPayload = {
    id: data.id,
    initPoint: data.init_point,
    sandboxInitPoint: data.sandbox_init_point,
    externalReference: order.externalReference,
    summaryToken: order.summaryToken,
  };

  if (checkoutAttemptId) {
    await measure("idempotencyStoreMs", () =>
      setJson(
        checkoutAttemptKey(checkoutAttemptId),
        {
          fingerprint: checkoutFingerprint,
          response: responseBody,
          createdAt: Date.now(),
        },
        CHECKOUT_ATTEMPT_TTL_SECONDS
      )
    );
  }

  return respond(responseBody as unknown as Record<string, unknown>, { status: 200 }, "created", {
    externalReference: order.externalReference,
    preferenceId: String(data.id),
    itemCount: order.items.length,
  });
}
