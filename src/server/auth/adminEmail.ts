import { env } from "@/src/config/env";

const DEFAULT_ADMIN_EMAIL = "estilosol26@gmail.com";

const normalizeEmail = (value: string | null | undefined) => value?.trim().toLowerCase() || "";

export const getAdminEmail = () => normalizeEmail(env.getOptionalServer("ADMIN_EMAIL") || DEFAULT_ADMIN_EMAIL);

export const isAdminEmail = (value: string | null | undefined) =>
  normalizeEmail(value) === getAdminEmail();

