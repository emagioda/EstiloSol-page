type LogLevel = "info" | "warn" | "error";

type LogContext = Record<string, unknown>;

const REDACTED = "[REDACTED]";
const SENSITIVE_KEY_PATTERN = /authorization|api[_-]?key|access|token|secret/i;
const SENSITIVE_QUERY_PARAMS = new Set(["token", "access_token", "api_key", "secret"]);

const redactUrl = (value: string) => {
  if (!/[?&](token|access_token|api_key|secret)=/i.test(value)) return value;

  try {
    const isAbsolute = /^[a-z][a-z\d+.-]*:\/\//i.test(value);
    const url = new URL(value, isAbsolute ? undefined : "https://redacted.local");
    for (const key of SENSITIVE_QUERY_PARAMS) {
      if (url.searchParams.has(key)) {
        url.searchParams.set(key, REDACTED);
      }
    }
    return isAbsolute ? url.toString() : `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return value;
  }
};

const safeSerialize = (key: string, value: unknown): unknown => {
  if (SENSITIVE_KEY_PATTERN.test(key)) {
    return REDACTED;
  }

  if (value instanceof Error) {
    return process.env.NODE_ENV === "production"
      ? { name: value.name, message: value.message }
      : { name: value.name, message: value.message, stack: value.stack };
  }

  if (typeof value === "string") {
    return redactUrl(value);
  }

  if (Array.isArray(value)) {
    return value.map((entry) => safeSerialize("", entry));
  }

  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([childKey, childValue]) => [
        childKey,
        safeSerialize(childKey, childValue),
      ])
    );
  }

  return value;
};

export function logEvent(level: LogLevel, event: string, context: LogContext = {}) {
  const payload = {
    ts: new Date().toISOString(),
    level,
    event,
    ...Object.fromEntries(Object.entries(context).map(([k, v]) => [k, safeSerialize(k, v)])),
  };

  if (level === "error") {
    console.error(JSON.stringify(payload));
    return;
  }

  if (level === "warn") {
    console.warn(JSON.stringify(payload));
    return;
  }

  console.log(JSON.stringify(payload));
}
