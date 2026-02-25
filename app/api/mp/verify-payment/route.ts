import { NextRequest, NextResponse } from "next/server";
import { getPaymentStatus } from "../webhook/route";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const ref = request.nextUrl.searchParams.get("ref");

  if (!ref || typeof ref !== "string") {
    return NextResponse.json({ error: "Missing ref parameter" }, { status: 400 });
  }

  const payment = getPaymentStatus(ref);

  if (!payment) {
    return NextResponse.json({ approved: false, message: "Pago no encontrado" }, { status: 200 });
  }

  if (payment.status === "approved") {
    return NextResponse.json(
      {
        approved: true,
        message: "Pago confirmado",
        paymentId: payment.id,
        externalReference: payment.externalReference,
        timestamp: payment.timestamp,
        date: new Date(payment.timestamp).toLocaleString("es-AR"),
      },
      { status: 200 }
    );
  }

  return NextResponse.json({ approved: false, message: "Pago pendiente" }, { status: 200 });
}
