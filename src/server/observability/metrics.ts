import { kv } from "@/src/server/kv";
import { logEvent } from "@/src/server/observability/log";

const METRICS_TTL_SECONDS = 90 * 24 * 3600;

const dayBucket = () => new Date().toISOString().slice(0, 10);

const dayBucketOffset = (offset: number) => {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() - offset);
  return date.toISOString().slice(0, 10);
};

const metricKey = (name: string, bucket: string) => `es:metrics:${name}:${bucket}`;

export const BUSINESS_METRIC_NAMES = [
  "checkout.preference.requested",
  "checkout.preference.rate_limited",
  "checkout.preference.invalid_input",
  "checkout.preference.catalog_unavailable",
  "checkout.preference.invalid_product",
  "checkout.preference.network_error",
  "checkout.preference.retry_network_error",
  "checkout.preference.failed",
  "checkout.preference.created",
  "payment.verify.rate_limited",
  "payment.verify.invalid_ref",
  "payment.verify.not_found",
  "payment.verify.cached_approved",
  "payment.verify.network_error",
  "payment.verify.search_non_ok",
  "payment.verify.approved",
  "payment.verify.rejected",
  "payment.verify.pending",
  "payment.webhook.rate_limited",
  "payment.webhook.invalid_payload",
  "payment.webhook.no_data_id",
  "payment.webhook.missing_signature_headers",
  "payment.webhook.invalid_signature",
  "payment.webhook.deduped",
  "payment.webhook.payment_lookup_failed",
  "payment.webhook.no_external_reference",
  "payment.webhook.order_not_found",
  "payment.webhook.approved",
  "payment.webhook.rejected",
] as const;

export type BusinessMetricName = (typeof BUSINESS_METRIC_NAMES)[number];

export async function incrementMetric(name: string, amount = 1): Promise<void> {
  const bucket = dayBucket();
  const key = metricKey(name, bucket);
  const current = await kv.incr(key);

  if (current === 1) {
    await kv.expire(key, METRICS_TTL_SECONDS);
  }

  if (amount > 1) {
    for (let i = 1; i < amount; i += 1) {
      await kv.incr(key);
    }
  }
}

export async function trackBusinessEvent(event: BusinessMetricName, context: Record<string, unknown> = {}): Promise<void> {
  await incrementMetric(event);
  logEvent("info", `business.${event}`, context);
}

export async function getBusinessMetricsSnapshot(days: number): Promise<{
  rangeDays: number;
  buckets: Array<{
    day: string;
    totals: Record<string, number>;
  }>;
}> {
  const safeDays = Math.min(Math.max(1, Math.floor(days)), 14);
  const buckets: Array<{ day: string; totals: Record<string, number> }> = [];

  for (let offset = 0; offset < safeDays; offset += 1) {
    const day = dayBucketOffset(offset);
    const totals: Record<string, number> = {};

    for (const name of BUSINESS_METRIC_NAMES) {
      const key = metricKey(name, day);
      const value = Number(await kv.get<number>(key));
      totals[name] = Number.isFinite(value) ? value : 0;
    }

    buckets.push({ day, totals });
  }

  return {
    rangeDays: safeDays,
    buckets,
  };
}
