import { NextRequest, NextResponse } from "next/server";

import { getProductsCatalog } from "@/src/server/catalog/getProducts";
import {
  dedupeInvalidProducts,
  type InvalidCheckoutProduct,
  invalidProductsMessage,
  validateCatalogItem,
} from "@/src/server/catalog/stock";
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
    return NextResponse.json({ error: "Demasiadas solicitudes. Intenta nuevamente en un minuto." }, { status: 429 });
  }

  const rawBody = await request.json().catch(() => null);
  const parsedBody = parseCheckoutBody(rawBody);

  if (!parsedBody.ok) {
    await trackBusinessEvent("checkout.validation.invalid_input", { route: "validate-cart" });
    return NextResponse.json({ error: parsedBody.message }, { status: 400 });
  }

  const catalog = await getProductsCatalog({ forceFresh: true }).catch((error) => {
    logEvent("error", "payments.catalog_fetch_error", {
      route: "validate-cart",
      message: error instanceof Error ? error.message : "unknown",
    });
    return null;
  });

  if (!catalog) {
    await trackBusinessEvent("checkout.validation.catalog_unavailable", { route: "validate-cart" });
    return NextResponse.json({ error: "No se pudo validar el catalogo de productos" }, { status: 503 });
  }

  const invalidProducts = dedupeInvalidProducts(
    parsedBody.value.items
      .map((requestedItem) => validateCatalogItem(catalog, requestedItem))
      .filter((item): item is InvalidCheckoutProduct => Boolean(item)),
  );

  if (invalidProducts.length > 0) {
    await trackBusinessEvent("checkout.validation.invalid_product", {
      route: "validate-cart",
      invalidCount: invalidProducts.length,
      invalidProducts: invalidProducts.map((item) => item.name),
    });

    return NextResponse.json(
      {
        valid: false,
        error: invalidProductsMessage(invalidProducts),
        invalidProducts,
      },
      { status: 400 },
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
    { status: 200 },
  );
}
