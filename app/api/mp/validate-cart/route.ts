import { NextRequest, NextResponse } from "next/server";
import { getProductsCatalog } from "@/src/server/catalog/getProducts";
import { logEvent } from "@/src/server/observability/log";
import { trackBusinessEvent } from "@/src/server/observability/metrics";
import { checkRateLimit } from "@/src/server/security/rateLimit";
import { parseCheckoutBody } from "@/src/server/validation/payments";

export const runtime = "nodejs";

const RATE_LIMIT_MAX = 40;

export async function POST(request: NextRequest) {
  await trackBusinessEvent("checkout.validation.requested", { route: "validate-cart" });

  const allowed = await checkRateLimit(request, {
    keyPrefix: "es:rl:validatecart",
    max: RATE_LIMIT_MAX,
    windowSeconds: 60,
  });

  if (!allowed) {
    await trackBusinessEvent("checkout.validation.rate_limited", { route: "validate-cart" });
    return NextResponse.json({ error: "Demasiadas solicitudes. Intentá nuevamente en un minuto." }, { status: 429 });
  }

  const rawBody = await request.json().catch(() => null);
  const parsedBody = parseCheckoutBody(rawBody);

  if (!parsedBody.ok) {
    await trackBusinessEvent("checkout.validation.invalid_input", { route: "validate-cart" });
    return NextResponse.json({ error: parsedBody.message }, { status: 400 });
  }

  const catalog = await getProductsCatalog().catch((error) => {
    logEvent("error", "payments.catalog_fetch_error", {
      route: "validate-cart",
      message: error instanceof Error ? error.message : "unknown",
    });
    return null;
  });

  if (!catalog) {
    await trackBusinessEvent("checkout.validation.catalog_unavailable", { route: "validate-cart" });
    return NextResponse.json({ error: "No se pudo validar el catálogo de productos" }, { status: 503 });
  }

  const invalidProducts: Array<{ productId: string; name: string }> = [];
  for (const requestedItem of parsedBody.value.items) {
    const product = catalog.get(requestedItem.productId);
    if (!product) {
      invalidProducts.push({
        productId: requestedItem.productId,
        name: requestedItem.name || requestedItem.productId,
      });
    }
  }

  if (invalidProducts.length > 0) {
    const uniqueInvalidProducts = Array.from(
      new Map(invalidProducts.map((item) => [item.productId, item])).values()
    );

    await trackBusinessEvent("checkout.validation.invalid_product", {
      route: "validate-cart",
      invalidCount: uniqueInvalidProducts.length,
      invalidProducts: uniqueInvalidProducts.map((item) => item.name),
    });

    return NextResponse.json(
      {
        valid: false,
        error: "Estos productos ya no están disponibles. Quitalos del carrito para continuar.",
        invalidProducts: uniqueInvalidProducts,
      },
      { status: 400 }
    );
  }

  await trackBusinessEvent("checkout.validation.ok", {
    route: "validate-cart",
    itemCount: parsedBody.value.items.length,
  });

  return NextResponse.json(
    {
      valid: true,
      checkedItems: parsedBody.value.items.length,
    },
    { status: 200 }
  );
}
