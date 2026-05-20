import { NextResponse } from "next/server";

import { fetchProductsFromCatalogSource } from "@/src/server/catalog/source";

export const runtime = "nodejs";
export const revalidate = 180;

export async function GET() {
  try {
    const products = await fetchProductsFromCatalogSource({
      forceFresh: false,
      includeInactive: false,
    });

    return NextResponse.json(products, {
      headers: {
        "Cache-Control": "public, s-maxage=180, stale-while-revalidate=600",
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
