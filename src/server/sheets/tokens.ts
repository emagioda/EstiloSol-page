import "server-only";

import { env } from "@/src/config/env";

export type SheetsTokenPurpose = "read" | "write" | "admin";

const isProduction = () => process.env.NODE_ENV === "production";

const legacyToken = () => env.getOptionalServer("SHEETS_API_TOKEN");

const requireLegacyFallback = (purpose: SheetsTokenPurpose) => {
  if (isProduction()) {
    throw new Error(`SHEETS_${purpose.toUpperCase()}_TOKEN is missing`);
  }

  const token = legacyToken();
  if (!token) {
    throw new Error(`SHEETS_${purpose.toUpperCase()}_TOKEN is missing`);
  }

  return token;
};

export const getSheetsToken = (purpose: SheetsTokenPurpose): string => {
  if (purpose === "read") {
    return (
      env.getOptionalServer("SHEETS_READ_TOKEN") ||
      env.getOptionalServer("SHEETS_ADMIN_TOKEN") ||
      requireLegacyFallback(purpose)
    );
  }

  if (purpose === "write") {
    return (
      env.getOptionalServer("SHEETS_WRITE_TOKEN") ||
      env.getOptionalServer("SHEETS_ADMIN_TOKEN") ||
      requireLegacyFallback(purpose)
    );
  }

  return env.getOptionalServer("SHEETS_ADMIN_TOKEN") || requireLegacyFallback(purpose);
};

export const getMissingProductionSheetsTokens = () => {
  if (!isProduction()) return [];

  const requiredTokens: Array<[string, string | undefined]> = [
    ["SHEETS_READ_TOKEN", env.getOptionalServer("SHEETS_READ_TOKEN")],
    ["SHEETS_WRITE_TOKEN", env.getOptionalServer("SHEETS_WRITE_TOKEN")],
    ["SHEETS_ADMIN_TOKEN", env.getOptionalServer("SHEETS_ADMIN_TOKEN")],
  ];

  return requiredTokens
    .filter(([, value]) => !value)
    .map(([key]) => key);
};
