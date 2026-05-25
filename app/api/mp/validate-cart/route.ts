import { NextRequest, NextResponse } from "next/server";

import { env } from "@/src/config/env";
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
  const startedAt = Date.now();
  const timings: Record<string, number> = {};
  const hasSheetsEndpoint = Boolean(env.getOptionalServer("SHEETS_ENDPOINT"));
  let googleSheetsCallCount = 0;
  const measure = async <T>(label: string, task: () => Promise<T>): Promise<T> => {
    const stepStartedAt = Date.now();
    try {
      return await task();
    } finally {
      timings[label] = Date.now() - stepStartedAt;
    }
  };
  const respond = (
    body: Record<string, unknown>,
    init: ResponseInit,
    outcome: string,
    context: Record<string, unknown> = {}
  ) => {
    logEvent("info", "checkout.validation.timing", {
      route: "validate-cart",
      outcome,
      status: init.status,
      durationMs: Date.now() - startedAt,
      googleSheetsCallCount,
      ...timings,
      ...context,
    });
    return NextResponse.json(body, init);
  };

  await trackBusinessEvent("checkout.validation.requested", { route: "validate-cart" });

  const allowed = await measure("rateLimitMs", () =>
    checkRateLimit(request, {
      keyPrefix: "es:rl:validatecart",
      max: RATE_LIMIT_MAX,
      windowSeconds: 60,
    })
  );

  if (!allowed) {
    await trackBusinessEvent("checkout.validation.rate_limited", { route: "validate-cart" });
    return respond(
      { error: "Demasiadas solicitudes. Intenta nuevamente en un minuto." },
      { status: 429 },
      "rate_limited"
    );
  }

  const rawBody = await measure("parseBodyMs", () => request.json().catch(() => null));
  timings.rateLimitAndParseBodyMs = (timings.rateLimitMs || 0) + (timings.parseBodyMs || 0);
  const parsedBody = parseCheckoutBody(rawBody);

  if (!parsedBody.ok) {
    await trackBusinessEvent("checkout.validation.invalid_input", { route: "validate-cart" });
    return respond({ error: parsedBody.message }, { status: 400 }, "invalid_input");
  }

  const catalog = await measure("catalogReadMs", () =>
    getProductsCatalog({ forceFresh: true }).catch((error) => {
      logEvent("error", "payments.catalog_fetch_error", {
        route: "validate-cart",
        message: error instanceof Error ? error.message : "unknown",
      });
      return null;
    })
  );
  if (hasSheetsEndpoint) googleSheetsCallCount += 1;

  if (!catalog) {
    await trackBusinessEvent("checkout.validation.catalog_unavailable", { route: "validate-cart" });
    return respond(
      { error: "No se pudo validar el catalogo de productos" },
      { status: 503 },
      "catalog_unavailable",
      { itemCount: parsedBody.value.items.length }
    );
  }

  const invalidProducts = (() => {
    const stepStartedAt = Date.now();
    try {
      return dedupeInvalidProducts(
        parsedBody.value.items
          .map((requestedItem) => validateCatalogItem(catalog, requestedItem))
          .filter((item): item is InvalidCheckoutProduct => Boolean(item)),
      );
    } finally {
      timings.cartValidationMs = Date.now() - stepStartedAt;
    }
  })();

  if (invalidProducts.length > 0) {
    await trackBusinessEvent("checkout.validation.invalid_product", {
      route: "validate-cart",
      invalidCount: invalidProducts.length,
      invalidProducts: invalidProducts.map((item) => item.name),
    });

    return respond(
      {
        valid: false,
        error: invalidProductsMessage(invalidProducts),
        invalidProducts,
      },
      { status: 400 },
      "invalid_product",
      {
        itemCount: parsedBody.value.items.length,
        invalidCount: invalidProducts.length,
      }
    );
  }

  await trackBusinessEvent("checkout.validation.ok", {
    route: "validate-cart",
    itemCount: parsedBody.value.items.length,
  });

  return respond(
    {
      valid: true,
      checkedItems: parsedBody.value.items.length,
    },
    { status: 200 },
    "ok",
    { itemCount: parsedBody.value.items.length }
  );
}
