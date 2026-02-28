import { getBusinessMetricsSnapshot } from "@/src/server/observability/metrics";

export type OperationalAlert = {
  code: string;
  severity: "info" | "warn" | "critical";
  message: string;
  value: number;
  threshold: number;
};

const ratio = (numerator: number, denominator: number) => {
  if (denominator <= 0) return 0;
  return numerator / denominator;
};

export async function getOperationalAlertsForToday(): Promise<{
  alerts: OperationalAlert[];
  summary: {
    level: "ok" | "warn" | "critical";
    counts: {
      checkoutRequested: number;
      checkoutCreated: number;
      verifyApproved: number;
      verifyRejected: number;
      rateLimitedTotal: number;
      signatureErrors: number;
    };
  };
}> {
  const snapshot = await getBusinessMetricsSnapshot(1);
  const totals = snapshot.buckets[0]?.totals ?? {};

  const checkoutRequested = Number(totals["checkout.preference.requested"] ?? 0);
  const checkoutCreated = Number(totals["checkout.preference.created"] ?? 0);
  const verifyApproved = Number(totals["payment.verify.approved"] ?? 0);
  const verifyRejected = Number(totals["payment.verify.rejected"] ?? 0);
  const verifyPending = Number(totals["payment.verify.pending"] ?? 0);

  const rateLimitedTotal =
    Number(totals["checkout.preference.rate_limited"] ?? 0) +
    Number(totals["payment.verify.rate_limited"] ?? 0) +
    Number(totals["payment.webhook.rate_limited"] ?? 0);

  const signatureErrors =
    Number(totals["payment.webhook.invalid_signature"] ?? 0) +
    Number(totals["payment.webhook.missing_signature_headers"] ?? 0);

  const alerts: OperationalAlert[] = [];

  const checkoutSuccessRatio = ratio(checkoutCreated, checkoutRequested);
  if (checkoutRequested >= 10 && checkoutSuccessRatio < 0.5) {
    alerts.push({
      code: "checkout.success_ratio_low",
      severity: "warn",
      message: "Low checkout preference creation success ratio",
      value: Number(checkoutSuccessRatio.toFixed(3)),
      threshold: 0.5,
    });
  }

  if (rateLimitedTotal >= 20) {
    alerts.push({
      code: "traffic.rate_limited_spike",
      severity: "warn",
      message: "High amount of rate-limited requests",
      value: rateLimitedTotal,
      threshold: 20,
    });
  }

  if (signatureErrors >= 3) {
    alerts.push({
      code: "webhook.signature_errors",
      severity: "critical",
      message: "Multiple webhook signature failures detected",
      value: signatureErrors,
      threshold: 3,
    });
  }

  const rejectionRatio = ratio(verifyRejected, verifyApproved + verifyRejected + verifyPending);
  if (verifyRejected >= 5 && rejectionRatio >= 0.35) {
    alerts.push({
      code: "payment.rejection_ratio_high",
      severity: "warn",
      message: "Payment rejection ratio is high",
      value: Number(rejectionRatio.toFixed(3)),
      threshold: 0.35,
    });
  }

  const level = alerts.some((alert) => alert.severity === "critical")
    ? "critical"
    : alerts.length > 0
    ? "warn"
    : "ok";

  return {
    alerts,
    summary: {
      level,
      counts: {
        checkoutRequested,
        checkoutCreated,
        verifyApproved,
        verifyRejected,
        rateLimitedTotal,
        signatureErrors,
      },
    },
  };
}
