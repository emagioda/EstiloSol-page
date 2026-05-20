import { timingSafeEqual } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { getOrder } from "@/src/server/orders/store";
import { checkRateLimit } from "@/src/server/security/rateLimit";
import { parseExternalReference } from "@/src/server/validation/payments";

export const runtime = "nodejs";

type RouteParams = {
  params: Promise<{ ref: string }>;
};

const matchesSummaryToken = (provided: string | null, expected: string | undefined) => {
  if (!provided || !expected) return false;

  const providedBuffer = Buffer.from(provided, "utf8");
  const expectedBuffer = Buffer.from(expected, "utf8");

  if (providedBuffer.length !== expectedBuffer.length) return false;

  return timingSafeEqual(providedBuffer, expectedBuffer);
};

export async function GET(request: NextRequest, { params }: RouteParams) {
  const allowed = await checkRateLimit(request, {
    keyPrefix: "es:rl:order-summary",
    max: 45,
    windowSeconds: 60,
  });
  if (!allowed) {
    return NextResponse.json({ error: "Too many requests" }, { status: 429 });
  }

  const { ref } = await params;
  const parsedRef = parseExternalReference(ref);

  if (!parsedRef.ok) {
    return NextResponse.json({ error: parsedRef.message }, { status: 400 });
  }

  const order = await getOrder(parsedRef.value);
  if (!order || !matchesSummaryToken(request.nextUrl.searchParams.get("summaryToken"), order.summaryToken)) {
    return NextResponse.json({ error: "Pedido no encontrado" }, { status: 404 });
  }

  return NextResponse.json(
    {
      externalReference: order.externalReference,
      status: order.status,
      paymentStatus: order.paymentStatus,
      shippingStatus: order.shippingStatus,
      paymentMethod: order.paymentMethod,
      deliveryMethod: order.deliveryMethod,
      total: order.total,
      currency: order.currency,
      createdAt: order.createdAt,
      items: order.items.map((item) => ({
        productId: item.productId,
        title: item.title,
        qty: item.qty,
        unitPrice: item.unitPrice,
        currency: item.currency,
      })),
    },
    { status: 200 }
  );
}
