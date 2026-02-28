type LogLevel = "info" | "warn" | "error";

type LogContext = Record<string, unknown>;

const safeSerialize = (value: unknown) => {
  if (value instanceof Error) {
    return { message: value.message, stack: value.stack };
  }
  return value;
};

export function logEvent(level: LogLevel, event: string, context: LogContext = {}) {
  const payload = {
    ts: new Date().toISOString(),
    level,
    event,
    ...Object.fromEntries(Object.entries(context).map(([k, v]) => [k, safeSerialize(v)])),
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
