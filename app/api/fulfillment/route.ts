import { NextResponse } from "next/server";

import { getFulfillmentConfig } from "@/src/server/fulfillment/source";

export const runtime = "nodejs";
export const revalidate = 180;

export async function GET() {
  const config = await getFulfillmentConfig();

  return NextResponse.json(config, {
    headers: {
      "Cache-Control": "public, s-maxage=180, stale-while-revalidate=600",
    },
  });
}
