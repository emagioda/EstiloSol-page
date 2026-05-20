import { NextRequest, NextResponse } from "next/server";
import { getOrder } from "@/src/server/orders/store";
import { checkRateLimit } from "@/src/server/security/rateLimit";
import { parseExternalReference } from "@/src/server/validation/payments";

export const runtime = "nodejs";

type RouteParams = {
  params: Promise<{ ref: string }>;
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
  if (!order) {
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
