import { NextRequest, NextResponse } from "next/server";
import { getActivePickupPointById } from "@/src/config/fulfillment";
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
  prepareCheckoutAttempt,
  releaseCheckoutAttemptLease,
  restoreCheckoutOrder,
  type CheckoutAttemptRecord,
  type ManualCheckoutResult,
} from "@/src/server/checkout/attempts";
import { getFulfillmentConfig } from "@/src/server/fulfillment/source";
import { scheduleAfterResponse } from "@/src/server/http/afterResponse";
import { logEvent } from "@/src/server/observability/log";
import {
  trackBusinessEvent,
  type BusinessMetricName,
} from "@/src/server/observability/metrics";
import { sendOrderReceivedEmail } from "@/src/server/notifications/orderReceived";
import { buildOrderFromCheckout } from "@/src/server/orders/createFromCheckout";
import { createOrder, getOrder } from "@/src/server/orders/store";
import { checkRateLimit } from "@/src/server/security/rateLimit";
import { parseCheckoutBody } from "@/src/server/validation/payments";

export const runtime = "nodejs";

const RATE_LIMIT_MAX = 30;

const safeMetric = async (event: BusinessMetricName, properties: Record<string, unknown>) => {
  try {
    await trackBusinessEvent(event, properties);
  } catch (error) {
    logEvent("warn", "checkout.order_create.metric_failed", {
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
    route: "orders-create",
    errorName: error instanceof Error ? error.name : "unknown",
  });
  return NextResponse.json(
    { error: "No pudimos iniciar la operacion de forma segura. Intenta nuevamente." },
    { status: 503 }
  );
};

const replayManualResult = (attempt: CheckoutAttemptRecord) => {
  if (attempt.result?.kind !== "manual") {
    return NextResponse.json({ error: "El intento de checkout no es compatible." }, { status: 409 });
  }
  return NextResponse.json(attempt.result.response, { status: 200 });
};

export async function POST(request: NextRequest) {
  const allowed = await checkRateLimit(request, {
    keyPrefix: "es:rl:orderscreate",
    max: RATE_LIMIT_MAX,
    windowSeconds: 60,
  });
  if (!allowed) {
    await safeMetric("checkout.order_create.rate_limited", { route: "orders-create" });
    return NextResponse.json(
      { error: "Demasiadas solicitudes. Intenta nuevamente en un minuto." },
      { status: 429 }
    );
  }

  const rawBody = await request.json().catch(() => null);
  const parsedBody = parseCheckoutBody(rawBody, { requirePayer: true, requireFulfillment: true });
  if (!parsedBody.ok) {
    await safeMetric("checkout.order_create.invalid_input", { route: "orders-create" });
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
  if (body.paymentMethod !== "cash" && body.paymentMethod !== "transfer") {
    return NextResponse.json(
      { error: "Este endpoint solo permite pedidos con pago en efectivo o transferencia." },
      { status: 400 }
    );
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

  if (beginning.outcome === "replay") return replayManualResult(beginning.attempt);
  if (beginning.outcome === "in_progress") {
    return NextResponse.json(
      {
        error: "Tu pedido todavia se esta registrando.",
        code: CHECKOUT_ATTEMPT_IN_PROGRESS,
      },
      { status: 409 }
    );
  }

  const { ownerToken } = beginning;
  let attempt = beginning.attempt;
  let sideEffectsStarted = false;

  try {
    let order = restoreCheckoutOrder(attempt, body);

    if (!order) {
      const fulfillmentConfig = await getFulfillmentConfig();
      if (
        body.deliveryMethod === "pickup" &&
        !getActivePickupPointById(fulfillmentConfig, body.fulfillment.pickupPointId || "")
      ) {
        return NextResponse.json({ error: "Punto de encuentro inválido." }, { status: 400 });
      }

      const catalog = await getAuthoritativeProductsCatalog().catch((error) => {
        logEvent("error", "orders.catalog_fetch_error", {
          route: "orders-create",
          message: error instanceof Error ? error.message : "unknown",
        });
        return null;
      });
      if (!catalog) {
        return NextResponse.json(
          { error: "No se pudo validar el catalogo de productos" },
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
        paymentMethod: body.paymentMethod,
        deliveryMethod: body.deliveryMethod,
        fulfillment: body.fulfillment,
        fulfillmentConfig,
        status: "pending",
        identity: {
          externalReference: attempt.externalReference,
          summaryToken: attempt.summaryToken,
        },
      });
      if (!built.order) {
        return NextResponse.json(
          { error: "No se pudo construir la orden con los datos de entrega." },
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
      await createOrder(order);
    }

    const result: ManualCheckoutResult = {
      kind: "manual",
      response: {
        externalReference: order.externalReference,
        summaryToken: order.summaryToken,
        total: order.total,
        currency: order.currency,
        paymentMethod: body.paymentMethod,
        deliveryMethod: body.deliveryMethod,
      },
    };

    attempt = await completeCheckoutAttempt(attempt, result, ownerToken);
    await safeMetric("checkout.order_create.created", {
      externalReference: order.externalReference,
      paymentMethod: order.paymentMethod,
      total: order.total,
    });

    scheduleAfterResponse(async () => {
      const emailResult = await sendOrderReceivedEmail({ order });
      if (!emailResult.sent && emailResult.reason !== "missing_customer_email") {
        logEvent("warn", "orders.received_email_failed", {
          externalReference: order.externalReference,
          paymentMethod: order.paymentMethod,
          reason: emailResult.reason,
        });
      }
    });

    return NextResponse.json(result.response, { status: 200 });
  } catch (error) {
    logEvent("error", "checkout.order_create.processing_failed", {
      checkoutAttemptId: attempt.checkoutAttemptId,
      externalReference: attempt.externalReference,
      sideEffectsStarted,
      errorName: error instanceof Error ? error.name : "unknown",
    });
    return NextResponse.json(
      {
        error: sideEffectsStarted
          ? "No pudimos confirmar el resultado. Reintentaremos el mismo pedido."
          : "No pudimos iniciar la operacion de forma segura. Intenta nuevamente.",
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
