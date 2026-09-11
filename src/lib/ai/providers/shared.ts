import "server-only";

import { z } from "zod";

import { AIProviderError, type AIErrorKind } from "@/lib/errors";

/**
 * Helpers shared by every provider adapter: HTTP-status-based error
 * classification, timeout handling, and tolerant JSON extraction.
 *
 * Adapters differ in how they *report* failures, but the taxonomy the rest of
 * the app reasons about is uniform, so the mapping lives here.
 */

/** Maps an HTTP status code onto the failure taxonomy. */
export function classifyHttpStatus(status: number, bodyText?: string): AIErrorKind {
  if (status === 401 || status === 403) return "auth";
  if (status === 404) return "model_unsupported";
  if (status === 408) return "timeout";

  /*
   * Not every provider uses 401 for a bad key: Gemini answers an invalid API
   * key with 400 INVALID_ARGUMENT. Left as `invalid_request` that would stop
   * the whole route — one bad key taking the app down even with two healthy
   * providers configured — so credential failures are detected by content too.
   */
  if (looksLikeAuthFailure(bodyText)) return "auth";

  if (status === 429) {
    // Providers overload 429 for both "too fast" and "out of credit". The body
    // is the only signal that separates them, and the distinction matters:
    // a rate limit is worth retrying, an exhausted quota is not.
    const haystack = (bodyText ?? "").toLowerCase();
    const quotaSignals = ["quota", "insufficient", "credit", "billing", "exceeded your current"];
    return quotaSignals.some((signal) => haystack.includes(signal))
      ? "quota_exceeded"
      : "rate_limit";
  }
  if (status === 400 || status === 422) return "invalid_request";
  if (status >= 500) return "server_error";
  return "unknown";
}

/**
 * Recognises credential failures from a provider's message text.
 *
 * Deliberately specific: these phrases are about the *key* itself, so they
 * can't be confused with an ordinary malformed-request error that happens to
 * mention a parameter. Getting this wrong in the permissive direction would
 * fail over on our own bugs and waste three providers' quota.
 */
function looksLikeAuthFailure(bodyText: string | undefined): boolean {
  if (!bodyText) return false;
  const haystack = bodyText.toLowerCase();

  return [
    "api key not valid",
    "api_key_invalid",
    "invalid api key",
    "invalid_api_key",
    "api key expired",
    "unauthenticated",
    "permission_denied",
    "missing api key",
    "no api key",
    "incorrect api key",
    "invalid authentication",
  ].some((signal) => haystack.includes(signal));
}

/** Extracts `Retry-After` in seconds, when the provider sends one. */
export function parseRetryAfter(headers: Headers): number | undefined {
  const raw = headers.get("retry-after");
  if (!raw) return undefined;

  const seconds = Number(raw);
  if (Number.isFinite(seconds) && seconds >= 0) return seconds;

  const date = Date.parse(raw);
  if (Number.isFinite(date)) {
    return Math.max(0, Math.round((date - Date.now()) / 1000));
  }
  return undefined;
}

/**
 * Classifies an exception thrown by an SDK or by `fetch`.
 *
 * SDKs expose status codes inconsistently, so this checks the common shapes
 * (`status`, `statusCode`, `response.status`) before falling back to message
 * inspection.
 */
export function classifyThrownError(error: unknown): {
  kind: AIErrorKind;
  message: string;
  retryAfterSeconds?: number;
} {
  if (error instanceof DOMException && error.name === "AbortError") {
    return { kind: "timeout", message: "Request aborted or timed out." };
  }

  if (typeof error === "object" && error !== null) {
    const candidate = error as {
      status?: unknown;
      statusCode?: unknown;
      response?: { status?: unknown };
      message?: unknown;
      code?: unknown;
    };

    const status =
      typeof candidate.status === "number"
        ? candidate.status
        : typeof candidate.statusCode === "number"
          ? candidate.statusCode
          : typeof candidate.response?.status === "number"
            ? candidate.response.status
            : undefined;

    const message = typeof candidate.message === "string" ? candidate.message : String(error);

    if (status !== undefined) {
      return { kind: classifyHttpStatus(status, message), message };
    }

    // Node's fetch surfaces connectivity problems as generic TypeErrors with a
    // cause code, so match on those before giving up.
    const code = typeof candidate.code === "string" ? candidate.code : "";
    const networkCodes = [
      "ECONNREFUSED",
      "ENOTFOUND",
      "ECONNRESET",
      "EAI_AGAIN",
      "ETIMEDOUT",
      "UND_ERR_CONNECT_TIMEOUT",
    ];
    if (networkCodes.includes(code)) {
      return { kind: "network", message: `${code}: ${message}` };
    }

    const lowered = message.toLowerCase();
    if (lowered.includes("timeout") || lowered.includes("timed out")) {
      return { kind: "timeout", message };
    }
    if (lowered.includes("fetch failed") || lowered.includes("network")) {
      return { kind: "network", message };
    }
    if (lowered.includes("api key") || lowered.includes("unauthorized")) {
      return { kind: "auth", message };
    }
    if (lowered.includes("quota")) {
      return { kind: "quota_exceeded", message };
    }
    if (lowered.includes("rate limit")) {
      return { kind: "rate_limit", message };
    }

    return { kind: "unknown", message };
  }

  return { kind: "unknown", message: String(error) };
}

/** Wraps any thrown value into an {@link AIProviderError} for a given provider. */
export function toProviderError(provider: string, error: unknown, model?: string): AIProviderError {
  if (error instanceof AIProviderError) return error;

  const { kind, message, retryAfterSeconds } = classifyThrownError(error);
  return new AIProviderError({
    kind,
    provider,
    model,
    internalMessage: message,
    retryAfterSeconds,
    cause: error,
  });
}

/**
 * Combines a caller-supplied abort signal with a timeout.
 * Returns the signal plus a cleanup function that must be called in a `finally`
 * block so the timer never outlives the request.
 */
export function withTimeout(
  timeoutMs: number,
  signal?: AbortSignal,
): { signal: AbortSignal; cleanup: () => void } {
  const controller = new AbortController();

  const timer = setTimeout(() => {
    controller.abort(new DOMException("Provider request timed out", "AbortError"));
  }, timeoutMs);

  const onAbort = () => controller.abort(signal?.reason);
  if (signal) {
    if (signal.aborted) {
      controller.abort(signal.reason);
    } else {
      signal.addEventListener("abort", onAbort, { once: true });
    }
  }

  return {
    signal: controller.signal,
    cleanup: () => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
    },
  };
}

/**
 * Pulls a JSON object out of a model response.
 *
 * Even with structured-output modes enabled, models wrap JSON in prose or
 * fenced code blocks often enough that a tolerant extractor is worth having.
 * This never `eval`s — it only trims to the outermost balanced braces.
 */
export function extractJson(raw: string): string {
  const trimmed = raw.trim();

  // Strip a fenced code block if present.
  const fenceMatch = trimmed.match(/^```(?:json)?\s*\n?([\s\S]*?)\n?```$/);
  const body = (fenceMatch?.[1] ?? trimmed).trim();

  if (body.startsWith("{") || body.startsWith("[")) {
    return body;
  }

  // Fall back to the first balanced {...} or [...] span.
  const firstBrace = body.search(/[{[]/);
  if (firstBrace === -1) return body;

  const opening = body[firstBrace];
  const closing = opening === "{" ? "}" : "]";
  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let index = firstBrace; index < body.length; index += 1) {
    const char = body[index];

    if (escaped) {
      escaped = false;
      continue;
    }
    if (char === "\\") {
      escaped = true;
      continue;
    }
    if (char === '"') {
      inString = !inString;
      continue;
    }
    if (inString) continue;

    if (char === opening) depth += 1;
    else if (char === closing) {
      depth -= 1;
      if (depth === 0) {
        return body.slice(firstBrace, index + 1);
      }
    }
  }

  return body.slice(firstBrace);
}

/**
 * Parses and validates a structured response.
 * Throws a `parse_error`-kind provider error so the manager can decide whether
 * a retry is worthwhile.
 */
export function parseStructured<TSchema extends z.ZodType>(
  provider: string,
  model: string,
  raw: string,
  schema: TSchema,
): z.infer<TSchema> {
  const candidate = extractJson(raw);

  let parsed: unknown;
  try {
    parsed = JSON.parse(candidate);
  } catch (error) {
    throw new AIProviderError({
      kind: "parse_error",
      provider,
      model,
      internalMessage: `Response was not valid JSON: ${(error as Error).message}`,
      cause: error,
    });
  }

  const result = schema.safeParse(parsed);
  if (!result.success) {
    throw new AIProviderError({
      kind: "parse_error",
      provider,
      model,
      internalMessage: `Response failed schema validation: ${result.error.issues
        .map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`)
        .slice(0, 5)
        .join("; ")}`,
    });
  }

  return result.data;
}

/**
 * Builds the JSON-shape instruction appended to a system prompt when a provider
 * has no native structured-output mode (or when we want belt-and-braces).
 */
export function buildJsonInstruction(schemaName: string, jsonSchema: unknown): string {
  return [
    `Respond with a single JSON object named "${schemaName}" and nothing else.`,
    "Do not wrap it in markdown fences. Do not add commentary before or after.",
    "The object must conform to this JSON Schema:",
    JSON.stringify(jsonSchema),
  ].join("\n");
}

/**
 * Converts a Zod schema to JSON Schema for providers that accept one.
 * Zod 4 ships this natively.
 */
export function toJsonSchema(schema: z.ZodType): unknown {
  return z.toJSONSchema(schema, { io: "output", unrepresentable: "any" });
}
