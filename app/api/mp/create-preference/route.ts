import { NextRequest, NextResponse } from "next/server";
import { getActivePickupPointById } from "@/src/config/fulfillment";
import { env } from "@/src/config/env";
import { getAuthoritativeProductsCatalog } from "@/src/server/catalog/getProducts";
import { invalidProductsMessage, validateAuthoritativeInventory } from "@/src/server/catalog/stock";
import {
  CHECKOUT_ATTEMPT_CONFLICT,
  CHECKOUT_ATTEMPT_IN_PROGRESS,
  CHECKOUT_ATTEMPT_REQUIRED,
  CheckoutAttemptConflictError,
  assertCheckoutAttemptLeaseOwner,
  beginCheckoutAttempt,
  buildCheckoutAttemptFingerprint,
  completeCheckoutAttempt,
  ensureMercadoPagoPreferenceWindow,
  prepareCheckoutAttempt,
  releaseCheckoutAttemptLease,
  restoreCheckoutOrder,
  type CheckoutAttemptRecord,
  type MpCheckoutResult,
} from "@/src/server/checkout/attempts";
import { getFulfillmentConfig } from "@/src/server/fulfillment/source";
import { logEvent } from "@/src/server/observability/log";
import {
  trackBusinessEvent,
  type BusinessMetricName,
} from "@/src/server/observability/metrics";
import { buildOrderFromCheckout } from "@/src/server/orders/createFromCheckout";
import { createOrder, getOrder, markPreferenceCreated } from "@/src/server/orders/store";
import { createPreferenceOnMp, isValidMpPreferenceResponse } from "@/src/server/payments/mpClient";
import { buildPreferencePayload, buildPreferenceUrls } from "@/src/server/payments/preferencePayload";
import { checkRateLimit } from "@/src/server/security/rateLimit";
import { parseCheckoutBody } from "@/src/server/validation/payments";

export const runtime = "nodejs";

const RATE_LIMIT_MAX = 20;

const safeMetric = async (event: BusinessMetricName, properties: Record<string, unknown>) => {
  try {
    await trackBusinessEvent(event, properties);
  } catch (error) {
    logEvent("warn", "checkout.preference.metric_failed", {
      metricName: event,
      errorName: error instanceof Error ? error.name : "unknown",
    });
  }
};

const attemptErrorResponse = (error: unknown) => {
  if (error instanceof CheckoutAttemptConflictError) {
    return NextResponse.json(
      {
        error: "Este intento de checkout corresponde a otra compra. Volve a intentarlo.",
        code: CHECKOUT_ATTEMPT_CONFLICT,
      },
      { status: 409 }
    );
  }

  logEvent("error", "checkout.attempt.unavailable", {
    route: "create-preference",
    errorName: error instanceof Error ? error.name : "unknown",
  });
  return NextResponse.json(
    { error: "No pudimos iniciar la operacion de forma segura. Intenta nuevamente." },
    { status: 503 }
  );
};

const replayMpResult = (attempt: CheckoutAttemptRecord) => {
  if (attempt.result?.kind !== "mercadopago") {
    return NextResponse.json(
      {
        error: "El intento de checkout no es compatible.",
        checkoutAttemptId: attempt.checkoutAttemptId,
      },
      { status: 409 }
    );
  }
  return NextResponse.json(
    { ...attempt.result.response, checkoutAttemptId: attempt.checkoutAttemptId },
    { status: 200 }
  );
};

export async function POST(request: NextRequest) {
  const allowed = await checkRateLimit(request, {
    keyPrefix: "es:rl:createpref",
    max: RATE_LIMIT_MAX,
    windowSeconds: 60,
  });
  if (!allowed) {
    await safeMetric("checkout.preference.rate_limited", { route: "create-preference" });
    return NextResponse.json(
      { error: "Demasiadas solicitudes. Intenta nuevamente en un minuto." },
      { status: 429 }
    );
  }

  const rawBody = await request.json().catch(() => null);
  const parsedBody = parseCheckoutBody(rawBody, { requirePayer: true, requireFulfillment: true });
  if (!parsedBody.ok) {
    await safeMetric("checkout.preference.invalid_input", { route: "create-preference" });
    return NextResponse.json(
      {
        error: parsedBody.message,
        ...(parsedBody.code ? { code: parsedBody.code } : {}),
        ...(parsedBody.itemIndex !== undefined ? { itemIndex: parsedBody.itemIndex } : {}),
        ...(parsedBody.productId ? { productId: parsedBody.productId } : {}),
      },
      { status: 400 }
    );
  }

  const body = parsedBody.value;
  if (!body.checkoutAttemptId) {
    return NextResponse.json(
      {
        error: "Actualiza la pagina para iniciar el checkout de forma segura.",
        code: CHECKOUT_ATTEMPT_REQUIRED,
      },
      { status: 400 }
    );
  }
  if (body.paymentMethod !== "mercadopago") {
    return NextResponse.json({ error: "Metodo de pago invalido para esta operacion" }, { status: 400 });
  }
  if (!body.deliveryMethod) {
    return NextResponse.json({ error: "Metodo de entrega invalido" }, { status: 400 });
  }

  const fingerprint = buildCheckoutAttemptFingerprint(body);
  let beginning;
  try {
    beginning = await beginCheckoutAttempt(body.checkoutAttemptId, fingerprint);
  } catch (error) {
    return attemptErrorResponse(error);
  }

  if (beginning.outcome === "replay") return replayMpResult(beginning.attempt);
  if (beginning.outcome === "in_progress") {
    return NextResponse.json(
      {
        error: "Tu pago todavia se esta preparando.",
        code: CHECKOUT_ATTEMPT_IN_PROGRESS,
        checkoutAttemptId: beginning.attempt.checkoutAttemptId,
      },
      { status: 409 }
    );
  }

  const { ownerToken } = beginning;
  let attempt = beginning.attempt;
  let sideEffectsStarted = false;

  try {
    const envStatus = env.validatePaymentsServerEnv();
    if (!envStatus.ok) {
      logEvent("error", "payments.env_missing", {
        route: "create-preference",
        missing: envStatus.missing,
      });
      return NextResponse.json(
        { error: "Server misconfigured", checkoutAttemptId: attempt.checkoutAttemptId },
        { status: 500 }
      );
    }

    let order = restoreCheckoutOrder(attempt, body);

    if (!order) {
      const fulfillmentConfig = await getFulfillmentConfig();
      if (
        body.deliveryMethod === "pickup" &&
        !getActivePickupPointById(fulfillmentConfig, body.fulfillment.pickupPointId || "")
      ) {
        return NextResponse.json(
          { error: "Punto de encuentro inválido.", checkoutAttemptId: attempt.checkoutAttemptId },
          { status: 400 }
        );
      }

      const catalog = await getAuthoritativeProductsCatalog().catch((error) => {
        logEvent("error", "payments.catalog_fetch_error", {
          route: "create-preference",
          message: error instanceof Error ? error.message : "unknown",
        });
        return null;
      });
      if (!catalog) {
        await safeMetric("checkout.preference.catalog_unavailable", { route: "create-preference" });
        return NextResponse.json(
          {
            error: "No se pudo validar el catalogo de productos",
            checkoutAttemptId: attempt.checkoutAttemptId,
          },
          { status: 503 }
        );
      }

      const inventory = validateAuthoritativeInventory(catalog, body.items);
      if (!inventory.ok) {
        const primaryError = inventory.errors[0];
        return NextResponse.json(
          {
            error: invalidProductsMessage(inventory.errors),
            code: primaryError.code,
            invalidProducts: inventory.errors,
            checkoutAttemptId: attempt.checkoutAttemptId,
          },
          { status: 400 }
        );
      }

      const built = buildOrderFromCheckout({
        items: inventory.items,
        customerName: body.payerName,
        customerPhone: body.payerPhone,
        customerEmail: body.payerEmail,
        notes: body.notes,
        paymentMethod: "mercadopago",
        deliveryMethod: body.deliveryMethod,
        fulfillment: body.fulfillment,
        fulfillmentConfig,
        identity: {
          externalReference: attempt.externalReference,
          summaryToken: attempt.summaryToken,
        },
      });
      if (!built.order) {
        return NextResponse.json(
          {
            error: "No se pudo construir la orden con los datos de entrega.",
            checkoutAttemptId: attempt.checkoutAttemptId,
          },
          { status: 400 }
        );
      }
      order = built.order;
      attempt = await prepareCheckoutAttempt(attempt, order, ownerToken);
    }

    await assertCheckoutAttemptLeaseOwner(attempt.checkoutAttemptId, ownerToken);
    const persistedOrder = await getOrder(attempt.externalReference);
    if (persistedOrder) {
      order = persistedOrder;
    } else {
      sideEffectsStarted = true;
      await createOrder(order, { syncSheet: false });
    }

    const appBaseUrl = (env.getOptionalServer("APP_BASE_URL") || request.nextUrl.origin).replace(/\/$/, "");
    attempt = await ensureMercadoPagoPreferenceWindow(attempt, ownerToken);
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
      customerName: body.payerName,
      customerPhone: body.payerPhone,
      notes: body.notes,
      deliveryMethod: order.deliveryMethod,
      fulfillment: order.fulfillment,
      externalReference: order.externalReference,
      urls,
      includeAutoReturn: urls.shouldUseAutoReturn,
      preferenceValidFrom: attempt.preferenceValidFrom!,
      preferenceExpiresAt: attempt.preferenceExpiresAt!,
    });

    await assertCheckoutAttemptLeaseOwner(attempt.checkoutAttemptId, ownerToken);
    sideEffectsStarted = true;
    const mpAttempt = await createPreferenceOnMp(mpPayload, {
      accessToken: env.getRequiredServer("MP_ACCESS_TOKEN"),
      idempotencyKey: attempt.mpIdempotencyKey,
    });

    if (!mpAttempt.response.ok || !isValidMpPreferenceResponse(mpAttempt.data)) {
      logEvent("error", "payments.create_preference_failed", {
        externalReference: order.externalReference,
        status: mpAttempt.response.status,
        malformed: mpAttempt.response.ok,
      });
      return NextResponse.json(
        {
          error: "No se pudo crear la preferencia de pago",
          checkoutAttemptId: attempt.checkoutAttemptId,
        },
        { status: 502 }
      );
    }

    await assertCheckoutAttemptLeaseOwner(attempt.checkoutAttemptId, ownerToken);
    await markPreferenceCreated(
      order.externalReference,
      { preferenceId: String(mpAttempt.data.id) },
      { syncSheet: false }
    );

    const result: MpCheckoutResult = {
      kind: "mercadopago",
      response: {
        id: mpAttempt.data.id,
        ...(mpAttempt.data.init_point ? { initPoint: mpAttempt.data.init_point } : {}),
        ...(mpAttempt.data.sandbox_init_point
          ? { sandboxInitPoint: mpAttempt.data.sandbox_init_point }
          : {}),
        externalReference: order.externalReference,
        summaryToken: order.summaryToken,
        checkoutAttemptId: attempt.checkoutAttemptId,
      },
    };

    // Persist the replayable truth before metrics or any other non-essential work.
    attempt = await completeCheckoutAttempt(attempt, result, ownerToken);
    await safeMetric("checkout.preference.created", {
      externalReference: order.externalReference,
      preferenceId: String(mpAttempt.data.id),
      total: order.total,
    });
    logEvent("info", "payments.preference_created", {
      externalReference: order.externalReference,
      preferenceId: String(mpAttempt.data.id),
    });
    return NextResponse.json(result.response, { status: 200 });
  } catch (error) {
    logEvent("error", "checkout.preference.processing_failed", {
      checkoutAttemptId: attempt.checkoutAttemptId,
      externalReference: attempt.externalReference,
      sideEffectsStarted,
      errorName: error instanceof Error ? error.name : "unknown",
    });
    return NextResponse.json(
      {
        error: sideEffectsStarted
          ? "No pudimos confirmar el resultado. Reintentaremos la misma operacion."
          : "No pudimos iniciar la operacion de forma segura. Intenta nuevamente.",
        checkoutAttemptId: attempt.checkoutAttemptId,
      },
      { status: sideEffectsStarted ? 502 : 503 }
    );
  } finally {
    await releaseCheckoutAttemptLease(attempt.checkoutAttemptId, ownerToken).catch((error) => {
      logEvent("warn", "checkout.attempt.lease_release_failed", {
        checkoutAttemptId: attempt.checkoutAttemptId,
        errorName: error instanceof Error ? error.name : "unknown",
      });
    });
  }
}
