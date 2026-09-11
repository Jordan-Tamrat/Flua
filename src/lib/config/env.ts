import "server-only";

import { z } from "zod";

/**
 * Server-side environment configuration.
 *
 * The schema is intentionally lenient about AI provider keys: Flua must boot
 * and run with zero providers configured, surfacing a clear message in the UI
 * rather than crashing at import time. Only the database URL and the auth
 * secret are genuinely required.
 */

const providerNameSchema = z.enum(["gemini", "groq", "openrouter"]);

/** An empty string in a `.env` file means "not set". */
const optionalSecret = z
  .string()
  .trim()
  .transform((value) => (value.length === 0 ? undefined : value))
  .optional();

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),

  DATABASE_URL: z
    .string()
    .min(1, "DATABASE_URL is required — point it at a PostgreSQL database.")
    .refine(
      (value) => value.startsWith("postgres://") || value.startsWith("postgresql://"),
      "DATABASE_URL must be a PostgreSQL connection string (postgresql://…).",
    ),

  AUTH_SECRET: z
    .string()
    .min(
      32,
      "AUTH_SECRET must be at least 32 characters. Generate one with: openssl rand -base64 32",
    ),

  GEMINI_API_KEY: optionalSecret,
  GROQ_API_KEY: optionalSecret,
  OPENROUTER_API_KEY: optionalSecret,

  PRIMARY_AI_PROVIDER: providerNameSchema.default("gemini"),
  SECONDARY_AI_PROVIDER: providerNameSchema.default("groq"),
  TERTIARY_AI_PROVIDER: providerNameSchema.default("openrouter"),

  AI_REQUEST_TIMEOUT_MS: z.coerce.number().int().positive().max(300_000).default(45_000),
  AI_MAX_ATTEMPTS_PER_PROVIDER: z.coerce.number().int().min(1).max(5).default(2),

  ADMIN_EMAILS: z
    .string()
    .default("")
    .transform((value) =>
      value
        .split(",")
        .map((entry) => entry.trim().toLowerCase())
        .filter((entry) => entry.length > 0),
    ),

  LOG_LEVEL: z.enum(["debug", "info", "warn", "error"]).default("info"),

  NEXT_PUBLIC_APP_URL: z.string().url().default("http://localhost:3000"),
});

export type Env = z.infer<typeof envSchema>;

/**
 * Describes a configuration problem in a way that can be shown to a developer
 * without leaking the offending value.
 */
export interface EnvIssue {
  variable: string;
  message: string;
}

interface ParsedEnv {
  env: Env | null;
  issues: EnvIssue[];
}

function parseEnv(): ParsedEnv {
  const result = envSchema.safeParse(process.env);

  if (result.success) {
    return { env: result.data, issues: [] };
  }

  const issues: EnvIssue[] = result.error.issues.map((issue) => ({
    variable: issue.path.join(".") || "(root)",
    message: issue.message,
  }));

  return { env: null, issues };
}

const parsed = parseEnv();

/**
 * Configuration problems that prevent the app from operating normally.
 * Empty when everything required is present.
 */
export const envIssues: EnvIssue[] = parsed.issues;

/** True when all required configuration is present and valid. */
export const isEnvValid = parsed.env !== null;

/**
 * Validated environment. Throws a descriptive error if required configuration
 * is missing, so that route handlers fail loudly rather than silently
 * misbehaving. UI surfaces should check {@link isEnvValid} first.
 */
export function getEnv(): Env {
  if (!parsed.env) {
    const detail = parsed.issues
      .map((issue) => `  - ${issue.variable}: ${issue.message}`)
      .join("\n");
    throw new Error(
      `Flua is not configured correctly. Fix these environment variables in your .env file:\n${detail}`,
    );
  }
  return parsed.env;
}

/**
 * Non-throwing accessor for surfaces that must render even when the app is
 * misconfigured (for example the setup screen that explains what is missing).
 */
export function tryGetEnv(): Env | null {
  return parsed.env;
}
