import { env } from "@/src/config/env";
import { logEvent } from "@/src/server/observability/log";

type StartupCheckReport = {
  ok: boolean;
  missingCritical: string[];
  warnings: string[];
  checkedAt: string;
};

let cachedReport: StartupCheckReport | null = null;

const isPlaceholder = (value: string | undefined) => {
  if (!value) return false;
  return /changeme|example|dummy|test|placeholder/i.test(value);
};

const MAX_ROTATION_AGE_DAYS = 90;

const parseIsoDate = (value: string | undefined): Date | null => {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date;
};

const dateAgeInDays = (date: Date) => {
  const diffMs = Date.now() - date.getTime();
  return Math.floor(diffMs / (24 * 3600 * 1000));
};

const run = (): StartupCheckReport => {
  const warnings: string[] = [];
  const missingCritical: string[] = [];

  const paymentsEnv = env.validatePaymentsServerEnv();
  if (!paymentsEnv.ok) {
    missingCritical.push(...paymentsEnv.missing);
  }

  const serverEnv = env.validateServerEnv();
  if (!serverEnv.ok) {
    missingCritical.push(...serverEnv.missing);
  }

  const publicEnv = env.validatePublicEnv();
  if (!publicEnv.ok) {
    warnings.push(`Public env missing: ${publicEnv.missing.join(", ")}`);
  }

  const webhookSecret = env.getOptionalServer("MP_WEBHOOK_SECRET");
  if (process.env.NODE_ENV === "production" && !webhookSecret) {
    missingCritical.push("MP_WEBHOOK_SECRET");
  }

  const metricsToken = env.getOptionalServer("OPS_METRICS_TOKEN");
  if (process.env.NODE_ENV === "production" && !metricsToken) {
    warnings.push("OPS_METRICS_TOKEN missing: /api/ops/metrics endpoint will be disabled");
  }

  const accessTokenRotatedAtRaw = env.getOptionalServer("MP_ACCESS_TOKEN_ROTATED_AT");
  const accessTokenRotatedAt = parseIsoDate(accessTokenRotatedAtRaw);
  if (accessTokenRotatedAtRaw && !accessTokenRotatedAt) {
    warnings.push("MP_ACCESS_TOKEN_ROTATED_AT has invalid date format");
  }
  if (accessTokenRotatedAt) {
    const age = dateAgeInDays(accessTokenRotatedAt);
    if (age > MAX_ROTATION_AGE_DAYS) {
      warnings.push(`MP_ACCESS_TOKEN rotation age exceeded (${age} days)`);
    }
  }

  const webhookRotatedAtRaw = env.getOptionalServer("MP_WEBHOOK_SECRET_ROTATED_AT");
  const webhookRotatedAt = parseIsoDate(webhookRotatedAtRaw);
  if (webhookRotatedAtRaw && !webhookRotatedAt) {
    warnings.push("MP_WEBHOOK_SECRET_ROTATED_AT has invalid date format");
  }
  if (webhookRotatedAt) {
    const age = dateAgeInDays(webhookRotatedAt);
    if (age > MAX_ROTATION_AGE_DAYS) {
      warnings.push(`MP_WEBHOOK_SECRET rotation age exceeded (${age} days)`);
    }
  }

  if (isPlaceholder(webhookSecret)) {
    warnings.push("MP_WEBHOOK_SECRET looks like placeholder value");
  }

  if (isPlaceholder(metricsToken)) {
    warnings.push("OPS_METRICS_TOKEN looks like placeholder value");
  }

  const uniqueMissingCritical = Array.from(new Set(missingCritical));

  const report: StartupCheckReport = {
    ok: uniqueMissingCritical.length === 0,
    missingCritical: uniqueMissingCritical,
    warnings,
    checkedAt: new Date().toISOString(),
  };

  if (!report.ok) {
    logEvent("error", "startup.secret_checks_failed", report);
  } else if (warnings.length > 0) {
    logEvent("warn", "startup.secret_checks_warnings", report);
  } else {
    logEvent("info", "startup.secret_checks_ok", report);
  }

  return report;
};

export const runStartupChecks = (): StartupCheckReport => {
  if (cachedReport) return cachedReport;
  cachedReport = run();
  return cachedReport;
};

export const getStartupCheckReport = (): StartupCheckReport | null => cachedReport;
