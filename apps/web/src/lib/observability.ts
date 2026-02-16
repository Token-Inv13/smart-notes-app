type LogLevel = "info" | "warn" | "error";

type LogPayload = {
  event: string;
  level: LogLevel;
  timestamp: string;
  meta?: unknown;
};

const REDACTED = "[redacted]";
const MAX_STRING_LENGTH = 500;
const SECRET_KEYS = new Set([
  "authorization",
  "cookie",
  "password",
  "secret",
  "token",
  "apikey",
  "api_key",
  "session",
  "stripe_signature",
]);

function truncateString(value: string) {
  if (value.length <= MAX_STRING_LENGTH) return value;
  return `${value.slice(0, MAX_STRING_LENGTH)}…`;
}

function sanitizeMeta(value: unknown, depth = 0): unknown {
  if (depth > 4) return "[max-depth]";
  if (value == null) return value;

  if (typeof value === "string") {
    return truncateString(value);
  }

  if (typeof value === "number" || typeof value === "boolean") {
    return value;
  }

  if (value instanceof Error) {
    return {
      name: value.name,
      message: truncateString(value.message),
    };
  }

  if (Array.isArray(value)) {
    return value.slice(0, 20).map((item) => sanitizeMeta(item, depth + 1));
  }

  if (typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>);
    const out: Record<string, unknown> = {};

    for (const [rawKey, rawVal] of entries) {
      const key = rawKey.toLowerCase();
      if (SECRET_KEYS.has(key) || key.includes("token") || key.includes("secret")) {
        out[rawKey] = REDACTED;
        continue;
      }
      out[rawKey] = sanitizeMeta(rawVal, depth + 1);
    }

    return out;
  }

  return String(value);
}

function emit(level: LogLevel, event: string, meta?: unknown) {
  const payload: LogPayload = {
    event,
    level,
    timestamp: new Date().toISOString(),
    ...(meta !== undefined ? { meta: sanitizeMeta(meta) } : {}),
  };

  const line = JSON.stringify(payload);
  if (level === "error") {
    console.error(line);
  } else if (level === "warn") {
    console.warn(line);
  } else {
    console.info(line);
  }
}

export function logServerInfo(event: string, meta?: unknown) {
  emit("info", event, meta);
}

export function logServerWarn(event: string, meta?: unknown) {
  emit("warn", event, meta);
}

export function logServerError(event: string, meta?: unknown) {
  emit("error", event, meta);
}
