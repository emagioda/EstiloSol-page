import { NextResponse } from "next/server";

export const runtime = "nodejs";

export async function POST() {
  if (!process.env.MP_ACCESS_TOKEN) {
    return NextResponse.json({ error: "MP_ACCESS_TOKEN missing" }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
