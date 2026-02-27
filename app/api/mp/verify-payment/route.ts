import { NextRequest, NextResponse } from "next/server";
import { env } from "@/src/config/env";
import { getOrder, markApproved, updateOrder } from "@/src/server/orders/store";

export const runtime = "nodejs";

type MpSearchResponse = {
  results?: Array<{
    id?: string | number;
    status?: string;
    external_reference?: string;
    transaction_amount?: number;
    currency_id?: string;
  }>;
};

const amountMatches = (actual: number, expected: number, tolerance = 0.01) => {
  return Math.abs(actual - expected) <= tolerance;
};

export async function GET(request: NextRequest) {
  const accessToken = env.getOptionalServer("MP_ACCESS_TOKEN");
  if (!accessToken) {
    return NextResponse.json({ error: "MP_ACCESS_TOKEN missing" }, { status: 500 });
  }

  const ref = request.nextUrl.searchParams.get("ref");

  if (!ref || typeof ref !== "string") {
    return NextResponse.json({ error: "Missing ref parameter" }, { status: 400 });
  }

  const order = await getOrder(ref);

  if (!order) {
    return NextResponse.json({ approved: false, message: "Pago no encontrado" }, { status: 200 });
  }

  if (order.status === "approved") {
    const timestamp = order.approvedAt || order.updatedAt;
    return NextResponse.json(
      {
        approved: true,
        message: "Pago confirmado",
        paymentId: order.mpPaymentId,
        externalReference: order.externalReference,
        timestamp,
        date: new Date(timestamp).toLocaleString("es-AR"),
      },
      { status: 200 }
    );
  }

  const searchUrl = new URL("https://api.mercadopago.com/v1/payments/search");
  searchUrl.searchParams.set("external_reference", ref);
  searchUrl.searchParams.set("sort", "date_created");
  searchUrl.searchParams.set("criteria", "desc");
  searchUrl.searchParams.set("limit", "5");

  const response = await fetch(searchUrl.toString(), {
    method: "GET",
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
    cache: "no-store",
  });

  if (!response.ok) {
    await updateOrder(ref, { status: "pending" });
    return NextResponse.json({ approved: false, message: "Pago pendiente / procesando" }, { status: 200 });
  }

  const data = (await response.json().catch(() => null)) as MpSearchResponse | null;
  const approvedPayment = data?.results?.find((payment) => {
    const status = String(payment.status || "");
    const externalReference = String(payment.external_reference || "");
    const amount = Number(payment.transaction_amount);
    const currency = String(payment.currency_id || "").toUpperCase();

    return (
      status === "approved" &&
      externalReference === order.externalReference &&
      currency === "ARS" &&
      Number.isFinite(amount) &&
      amountMatches(amount, order.total)
    );
  });

  if (approvedPayment) {
    const approvedAt = Date.now();
    await markApproved(order.externalReference, {
      paymentId: String(approvedPayment.id || ""),
      mpStatus: String(approvedPayment.status || "approved"),
      approvedAt,
    });

    return NextResponse.json(
      {
        approved: true,
        message: "Pago confirmado",
        paymentId: approvedPayment.id,
        externalReference: order.externalReference,
        timestamp: approvedAt,
        date: new Date(approvedAt).toLocaleString("es-AR"),
      },
      { status: 200 }
    );
  }

  await updateOrder(ref, { status: "pending" });
  return NextResponse.json({ approved: false, message: "Pago pendiente / procesando" }, { status: 200 });
}
