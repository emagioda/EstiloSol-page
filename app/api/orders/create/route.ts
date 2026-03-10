import { NextRequest, NextResponse } from "next/server";
import { getProductsCatalog } from "@/src/server/catalog/getProducts";
import { logEvent } from "@/src/server/observability/log";
import { trackBusinessEvent } from "@/src/server/observability/metrics";
import { buildOrderFromCheckout } from "@/src/server/orders/createFromCheckout";
import { createOrder } from "@/src/server/orders/store";
import { checkRateLimit } from "@/src/server/security/rateLimit";
import { parseCheckoutBody } from "@/src/server/validation/payments";

export const runtime = "nodejs";

const RATE_LIMIT_MAX = 30;

export async function POST(request: NextRequest) {
  await trackBusinessEvent("checkout.order_create.requested", { route: "orders-create" });

  const allowed = await checkRateLimit(request, {
    keyPrefix: "es:rl:orderscreate",
    max: RATE_LIMIT_MAX,
    windowSeconds: 60,
  });
  if (!allowed) {
    await trackBusinessEvent("checkout.order_create.rate_limited", { route: "orders-create" });
    return NextResponse.json({ error: "Demasiadas solicitudes. Intenta nuevamente en un minuto." }, { status: 429 });
  }

  const rawBody = await request.json().catch(() => null);
  const parsedBody = parseCheckoutBody(rawBody, { requirePayer: true });
  if (!parsedBody.ok) {
    await trackBusinessEvent("checkout.order_create.invalid_input", { route: "orders-create" });
    return NextResponse.json({ error: parsedBody.message }, { status: 400 });
  }

  const {
    items,
    paymentMethod,
    deliveryMethod,
    payerName: customerName,
    payerPhone: customerPhone,
    payerEmail: customerEmail,
    notes,
  } = parsedBody.value;

  if (paymentMethod !== "cash" && paymentMethod !== "transfer") {
    return NextResponse.json(
      { error: "Este endpoint solo permite pedidos con pago en efectivo o transferencia." },
      { status: 400 }
    );
  }

  const catalog = await getProductsCatalog({ forceFresh: true }).catch((error) => {
    logEvent("error", "orders.catalog_fetch_error", {
      route: "orders-create",
      message: error instanceof Error ? error.message : "unknown",
    });
    return null;
  });

  if (!catalog) {
    await trackBusinessEvent("checkout.order_create.catalog_unavailable", { route: "orders-create" });
    return NextResponse.json({ error: "No se pudo validar el catalogo de productos" }, { status: 503 });
  }

  const { order, invalidProducts } = buildOrderFromCheckout({
    items,
    catalog,
    customerName,
    customerPhone,
    customerEmail,
    notes,
    paymentMethod,
    deliveryMethod: deliveryMethod || "delivery",
    status: "pending",
  });

  if (invalidProducts.length > 0) {
    await trackBusinessEvent("checkout.order_create.invalid_product", {
      route: "orders-create",
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
    logEvent("error", "orders.create_persist_failed", {
      externalReference: order.externalReference,
      route: "orders-create",
      error,
    });
    return NextResponse.json({ error: "No pudimos registrar tu pedido. Intenta nuevamente." }, { status: 502 });
  }

  await trackBusinessEvent("checkout.order_create.created", {
    externalReference: order.externalReference,
    paymentMethod: order.paymentMethod,
    total: order.total,
  });

  return NextResponse.json(
    {
      externalReference: order.externalReference,
      total: order.total,
      currency: order.currency,
      paymentMethod: order.paymentMethod,
      deliveryMethod: order.deliveryMethod,
    },
    { status: 200 }
  );
}
