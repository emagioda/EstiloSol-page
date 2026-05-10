import { NextResponse } from "next/server";

import { fetchProductsFromCatalogSource } from "@/src/server/catalog/source";

export const runtime = "nodejs";
export const revalidate = 60;

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
          : "public, s-maxage=60, stale-while-revalidate=300",
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
