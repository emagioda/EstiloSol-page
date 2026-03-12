import { env } from "@/src/config/env";

const normalizeEmail = (value: string | null | undefined) => value?.trim().toLowerCase() || "";

export const getAdminEmail = (): string => {
  const email = env.getOptionalServer("ADMIN_EMAIL");
  if (!email) throw new Error("ADMIN_EMAIL env var is required but not set");
  return normalizeEmail(email);
};

export const isAdminEmail = (value: string | null | undefined): boolean => {
  try {
    return normalizeEmail(value) === getAdminEmail();
  } catch {
    return false;
  }
};

