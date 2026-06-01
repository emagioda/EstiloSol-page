import { NextResponse } from "next/server";

import { getFulfillmentConfig } from "@/src/server/fulfillment/source";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET() {
  const config = await getFulfillmentConfig();

  return NextResponse.json(config, {
    headers: {
      "Cache-Control": "no-store",
    },
  });
}
