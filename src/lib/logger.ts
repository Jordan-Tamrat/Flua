import "server-only";

import { tryGetEnv } from "@/lib/config/env";

/**
 * Minimal structured logger.
 *
 * Emits single-line JSON so that hosted log aggregators (Vercel, Datadog, …)
 * can index the fields. Values that must never be logged — API keys, passwords,
 * session tokens, raw learner conversation content — are stripped by
 * {@link redact} before serialization.
 */

type LogLevel = "debug" | "info" | "warn" | "error";

const LEVEL_WEIGHT: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

/** Field names whose values are replaced with `[redacted]` at any nesting depth. */
const REDACTED_KEYS = new Set([
  "apikey",
  "api_key",
  "authorization",
  "password",
  "passwordhash",
  "password_hash",
  "token",
  "accesstoken",
  "access_token",
  "refreshtoken",
  "refresh_token",
  "secret",
  "authsecret",
  "auth_secret",
  "cookie",
  "sessiontoken",
  "session_token",
  "databaseurl",
  "database_url",
  "content",
  "message",
  "messages",
  "transcript",
  "prompt",
]);

const MAX_STRING_LENGTH = 500;

function redact(value: unknown, depth = 0): unknown {
  if (depth > 6) return "[max-depth]";

  if (value === null || value === undefined) return value;

  if (typeof value === "string") {
    return value.length > MAX_STRING_LENGTH ? `${value.slice(0, MAX_STRING_LENGTH)}…` : value;
  }

  if (typeof value === "number" || typeof value === "boolean") return value;

  if (value instanceof Error) {
    return {
      name: value.name,
      message: value.message,
      ...(value.cause ? { cause: redact(value.cause, depth + 1) } : {}),
    };
  }

  if (Array.isArray(value)) {
    return value.slice(0, 20).map((entry) => redact(entry, depth + 1));
  }

  if (typeof value === "object") {
    const output: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
      output[key] = REDACTED_KEYS.has(key.toLowerCase()) ? "[redacted]" : redact(entry, depth + 1);
    }
    return output;
  }

  return "[unserializable]";
}

export interface LogContext {
  requestId?: string;
  userId?: string;
  endpoint?: string;
  provider?: string;
  model?: string;
  latencyMs?: number;
  success?: boolean;
  [key: string]: unknown;
}

function currentLevel(): LogLevel {
  return tryGetEnv()?.LOG_LEVEL ?? "info";
}

function write(level: LogLevel, message: string, context?: LogContext): void {
  if (LEVEL_WEIGHT[level] < LEVEL_WEIGHT[currentLevel()]) return;

  const payload = {
    level,
    time: new Date().toISOString(),
    message,
    ...(context ? (redact(context) as Record<string, unknown>) : {}),
  };

  const line = JSON.stringify(payload);

  if (level === "error") {
    console.error(line);
  } else if (level === "warn") {
    console.warn(line);
  } else {
    // Route info/debug through console.error's sibling to keep stdout clean in
    // serverless environments that treat stdout specially.
    console.warn(line);
  }
}

export const logger = {
  debug: (message: string, context?: LogContext) => write("debug", message, context),
  info: (message: string, context?: LogContext) => write("info", message, context),
  warn: (message: string, context?: LogContext) => write("warn", message, context),
  error: (message: string, context?: LogContext) => write("error", message, context),
};

/** Generates a short correlation id for a single inbound request. */
export function createRequestId(): string {
  return crypto.randomUUID().slice(0, 8);
}
