import { NextResponse } from "next/server";

import { fetchProductsFromCatalogSource } from "@/src/server/catalog/source";

export const runtime = "nodejs";
export const revalidate = 180;

const PUBLIC_CATALOG_CACHE_CONTROL = "public, s-maxage=180, stale-while-revalidate=120";
const FRESH_CATALOG_CACHE_CONTROL = "no-store, max-age=0";

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const forceFresh = url.searchParams.has("_ts");
    const products = await fetchProductsFromCatalogSource({
      forceFresh,
      includeInactive: false,
    });

    return NextResponse.json(products, {
      headers: {
        "Cache-Control": forceFresh ? FRESH_CATALOG_CACHE_CONTROL : PUBLIC_CATALOG_CACHE_CONTROL,
      },
    });
  } catch (error) {
    console.error("catalog endpoint failed", error);
    return NextResponse.json(
      {
        ok: false,
        error: "No se pudo cargar el catalogo.",
      },
      { status: 502 },
    );
  }
}
