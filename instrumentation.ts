import { runStartupChecks } from "@/src/server/bootstrap/startupChecks";

export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;

  const report = runStartupChecks();
  if (!report.ok && process.env.NODE_ENV === "production") {
    throw new Error(`Startup secret checks failed: ${report.missingCritical.join(", ")}`);
  }
}
