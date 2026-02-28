import { NextRequest, NextResponse } from "next/server";
import { env } from "@/src/config/env";
import { fetchWithPolicy } from "@/src/server/http/fetchWithPolicy";
import { logEvent } from "@/src/server/observability/log";
import { trackBusinessEvent } from "@/src/server/observability/metrics";
import { getOrder, markApproved, markRejected, updateOrder } from "@/src/server/orders/store";
import { checkRateLimit } from "@/src/server/security/rateLimit";
import { parseExternalReference } from "@/src/server/validation/payments";

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

const REJECTED_PAYMENT_STATUSES = new Set(["rejected", "cancelled", "charged_back"]);

const amountMatches = (actual: number, expected: number, tolerance = 0.01) => {
  return Math.abs(actual - expected) <= tolerance;
};

export async function GET(request: NextRequest) {
  const envStatus = env.validatePaymentsServerEnv();
  if (!envStatus.ok) {
    logEvent("error", "payments.env_missing", { route: "verify-payment", missing: envStatus.missing });
    return NextResponse.json({ error: "Server misconfigured" }, { status: 500 });
  }
  const accessToken = env.getRequiredServer("MP_ACCESS_TOKEN");

  const allowed = await checkRateLimit(request, {
    keyPrefix: "es:rl:verifypayment",
    max: 40,
    windowSeconds: 60,
  });
  if (!allowed) {
    logEvent("warn", "payments.rate_limited", { route: "verify-payment" });
    await trackBusinessEvent("payment.verify.rate_limited", { route: "verify-payment" });
    return NextResponse.json({ error: "Demasiadas solicitudes. Intentá nuevamente en un minuto." }, { status: 429 });
  }

  const parsedRef = parseExternalReference(request.nextUrl.searchParams.get("ref"));
  if (!parsedRef.ok) {
    await trackBusinessEvent("payment.verify.invalid_ref", { route: "verify-payment" });
    return NextResponse.json({ error: parsedRef.message }, { status: 400 });
  }
  const ref = parsedRef.value;

  const order = await getOrder(ref);

  if (!order) {
    await trackBusinessEvent("payment.verify.not_found", { externalReference: ref });
    return NextResponse.json({ approved: false, message: "Pago no encontrado" }, { status: 200 });
  }

  if (order.status === "approved") {
    await trackBusinessEvent("payment.verify.cached_approved", { externalReference: order.externalReference });
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

  let response: Response;
  try {
    response = await fetchWithPolicy(
      searchUrl.toString(),
      {
        method: "GET",
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
        cache: "no-store",
      },
      {
        timeoutMs: 8000,
        retries: 1,
      }
    );
  } catch (error) {
    logEvent("error", "payments.verify_search_network_error", { externalReference: ref, error });
    await trackBusinessEvent("payment.verify.network_error", { externalReference: ref });
    await updateOrder(ref, { status: "pending" });
    return NextResponse.json({ approved: false, message: "Pago pendiente / procesando" }, { status: 200 });
  }

  if (!response.ok) {
    logEvent("warn", "payments.search_non_ok", { externalReference: ref, status: response.status });
    await trackBusinessEvent("payment.verify.search_non_ok", { externalReference: ref, status: response.status });
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

  const rejectedPayment = data?.results?.find((payment) => {
    const status = String(payment.status || "");
    const externalReference = String(payment.external_reference || "");
    return REJECTED_PAYMENT_STATUSES.has(status) && externalReference === order.externalReference;
  });

  if (approvedPayment) {
    const approvedAt = Date.now();
    await markApproved(order.externalReference, {
      paymentId: String(approvedPayment.id || ""),
      mpStatus: String(approvedPayment.status || "approved"),
      approvedAt,
    });

    logEvent("info", "payments.approved_from_verify", {
      externalReference: order.externalReference,
      paymentId: String(approvedPayment.id || ""),
      amount: approvedPayment.transaction_amount,
    });
    await trackBusinessEvent("payment.verify.approved", {
      externalReference: order.externalReference,
      paymentId: String(approvedPayment.id || ""),
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

  if (rejectedPayment) {
    await markRejected(order.externalReference, {
      paymentId: String(rejectedPayment.id || ""),
      mpStatus: String(rejectedPayment.status || "rejected"),
    });
    await trackBusinessEvent("payment.verify.rejected", {
      externalReference: order.externalReference,
      mpStatus: String(rejectedPayment.status || "rejected"),
    });

    return NextResponse.json(
      {
        approved: false,
        message: "Pago rechazado",
        externalReference: order.externalReference,
      },
      { status: 200 }
    );
  }

  await updateOrder(ref, { status: "pending" });
  await trackBusinessEvent("payment.verify.pending", { externalReference: ref });
  return NextResponse.json({ approved: false, message: "Pago pendiente / procesando" }, { status: 200 });
}
