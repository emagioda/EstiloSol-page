#!/usr/bin/env node

const baseUrl = (process.env.APP_BASE_URL || process.argv[2] || "http://localhost:3000").replace(/\/$/, "");
const opsToken = process.env.OPS_METRICS_TOKEN || "";

const print = (label, ok, details = "") => {
  const status = ok ? "OK" : "FAIL";
  console.log(`[${status}] ${label}${details ? ` - ${details}` : ""}`);
};

const safeJson = async (response) => {
  try {
    return await response.json();
  } catch {
    return null;
  }
};

const checkHealth = async () => {
  const response = await fetch(`${baseUrl}/api/health`, { cache: "no-store" });
  const body = await safeJson(response);
  const ok = response.ok && body?.ok !== undefined;
  print("Health endpoint", ok, `status=${response.status}`);
  if (!ok) return false;

  if (body?.startup?.ok === false) {
    print("Startup checks", false, `missing=${(body?.startup?.missingCritical || []).join(",") || "unknown"}`);
    return false;
  }

  print("Startup checks", true, `warnings=${(body?.startup?.warnings || []).length}`);
  print("Ops level", true, `level=${body?.operations?.level || "unknown"}`);
  return true;
};

const checkVerifyValidation = async () => {
  const response = await fetch(`${baseUrl}/api/mp/verify-payment`, { cache: "no-store" });
  const body = await safeJson(response);
  const ok = response.status === 400 && typeof body?.error === "string";
  print("Verify-payment validation", ok, `status=${response.status}`);
  return ok;
};

const checkOpsMetrics = async () => {
  if (!opsToken) {
    print("Ops metrics endpoint", true, "skipped (OPS_METRICS_TOKEN not set)");
    return true;
  }

  const response = await fetch(`${baseUrl}/api/ops/metrics?days=1`, {
    headers: {
      "x-ops-token": opsToken,
    },
    cache: "no-store",
  });

  const body = await safeJson(response);
  const ok = response.ok && body?.ok === true;
  print("Ops metrics endpoint", ok, `status=${response.status}`);
  return ok;
};

const checkOpsAlerts = async () => {
  if (!opsToken) {
    print("Ops alerts endpoint", true, "skipped (OPS_METRICS_TOKEN not set)");
    return true;
  }

  const response = await fetch(`${baseUrl}/api/ops/alerts`, {
    headers: {
      "x-ops-token": opsToken,
    },
    cache: "no-store",
  });

  const body = await safeJson(response);
  const ok = response.ok && body?.ok === true;
  print("Ops alerts endpoint", ok, `status=${response.status}`);
  return ok;
};

const run = async () => {
  console.log(`Running post-deploy checks against ${baseUrl}`);

  const checks = await Promise.all([
    checkHealth(),
    checkVerifyValidation(),
    checkOpsMetrics(),
    checkOpsAlerts(),
  ]);

  const allOk = checks.every(Boolean);
  if (!allOk) {
    process.exitCode = 1;
    return;
  }

  console.log("All post-deploy checks passed.");
};

run().catch((error) => {
  print("Post-deploy runner", false, error instanceof Error ? error.message : "unknown error");
  process.exitCode = 1;
});
