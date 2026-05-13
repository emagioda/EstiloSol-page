import { NextResponse } from "next/server";

import { fetchProductsFromCatalogSource } from "@/src/server/catalog/source";

export const runtime = "nodejs";
export const revalidate = 180;

export async function GET(request: Request) {
  const url = new URL(request.url);
  const forceFresh = url.searchParams.get("force") === "1";

  try {
    const products = await fetchProductsFromCatalogSource({
      forceFresh,
      includeInactive: false,
      allowMockFallback: false,
    });

    return NextResponse.json(products, {
      headers: {
        "Cache-Control": forceFresh
          ? "no-store"
          : "public, s-maxage=180, stale-while-revalidate=600",
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
