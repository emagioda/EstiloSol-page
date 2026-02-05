import { NextResponse } from "next/server";

// Google Sheets Apps Script endpoint
const SHEETS_ENDPOINT =
  process.env.NEXT_PUBLIC_SHEETS_ENDPOINT ||
  "https://script.google.com/macros/s/AKfycbz6DR8Q1sFG4CuZ0UtMn889EUQNQAUQjdDMbjt689wLfY45jWFvBkgkEKlgapYaQm1sIg/exec";

export async function GET() {
  try {
    console.log("🔍 Fetching from endpoint:", SHEETS_ENDPOINT);
    const res = await fetch(SHEETS_ENDPOINT, { cache: "no-store" });
    console.log("📦 Response status:", res.status);

    if (!res.ok) {
      const errorText = await res.text();
      console.error("❌ Sheets error response:", errorText);
      return NextResponse.json(
        { error: "Failed to fetch products from Sheets", status: res.status },
        { status: 502 }
      );
    }

    const products = await res.json();
    console.log("✅ Products fetched:", products.length);

    // Cache for 60 seconds; revalidate with stale-while-revalidate
    return NextResponse.json(products, {
      status: 200,
      headers: {
        "Cache-Control": "public, s-maxage=60, stale-while-revalidate=120",
        "Content-Type": "application/json",
      },
    });
  } catch (error) {
    console.error("Error fetching products:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
