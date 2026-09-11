/**
 * Centralized application errors.
 *
 * Every error carries a stable machine-readable `code`, an HTTP `status`, and a
 * `publicMessage` that is safe to show an end user. Internal detail (provider
 * responses, stack traces, SQL) never crosses into `publicMessage`.
 */

export type AppErrorCode =
  | "VALIDATION_ERROR"
  | "AUTHENTICATION_REQUIRED"
  | "INVALID_CREDENTIALS"
  | "EMAIL_ALREADY_REGISTERED"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "RATE_LIMITED"
  | "AI_NOT_CONFIGURED"
  | "AI_PROVIDER_UNAVAILABLE"
  | "AI_PROVIDER_RATE_LIMIT"
  | "AI_PROVIDER_QUOTA_EXCEEDED"
  | "AI_PROVIDER_AUTH_ERROR"
  | "AI_INVALID_REQUEST"
  | "AI_CAPABILITY_UNSUPPORTED"
  | "AI_RESPONSE_PARSE_ERROR"
  | "AI_TIMEOUT"
  | "UPLOAD_INVALID"
  | "DATABASE_ERROR"
  | "INTERNAL_ERROR";

export class AppError extends Error {
  readonly code: AppErrorCode;
  readonly status: number;
  readonly publicMessage: string;
  readonly details?: unknown;

  constructor(params: {
    code: AppErrorCode;
    status: number;
    publicMessage: string;
    /** Internal message for logs. Defaults to `publicMessage`. */
    internalMessage?: string;
    details?: unknown;
    cause?: unknown;
  }) {
    super(params.internalMessage ?? params.publicMessage, { cause: params.cause });
    this.name = new.target.name;
    this.code = params.code;
    this.status = params.status;
    this.publicMessage = params.publicMessage;
    this.details = params.details;
  }
}

export class ValidationError extends AppError {
  constructor(publicMessage = "Some of the information you sent isn't valid.", details?: unknown) {
    super({ code: "VALIDATION_ERROR", status: 400, publicMessage, details });
  }
}

export class AuthenticationError extends AppError {
  constructor(publicMessage = "You need to sign in to do that.") {
    super({ code: "AUTHENTICATION_REQUIRED", status: 401, publicMessage });
  }
}

export class InvalidCredentialsError extends AppError {
  constructor() {
    super({
      code: "INVALID_CREDENTIALS",
      status: 401,
      publicMessage: "That email and password combination doesn't match an account.",
    });
  }
}

export class EmailAlreadyRegisteredError extends AppError {
  constructor() {
    super({
      code: "EMAIL_ALREADY_REGISTERED",
      status: 409,
      publicMessage: "An account with that email already exists.",
    });
  }
}

export class AuthorizationError extends AppError {
  constructor(publicMessage = "You don't have access to that.") {
    super({ code: "FORBIDDEN", status: 403, publicMessage });
  }
}

export class NotFoundError extends AppError {
  constructor(publicMessage = "We couldn't find what you were looking for.") {
    super({ code: "NOT_FOUND", status: 404, publicMessage });
  }
}

export class RateLimitError extends AppError {
  readonly retryAfterSeconds: number;

  constructor(retryAfterSeconds: number, publicMessage?: string) {
    super({
      code: "RATE_LIMITED",
      status: 429,
      publicMessage:
        publicMessage ??
        `You're going a little fast. Try again in ${retryAfterSeconds} second${
          retryAfterSeconds === 1 ? "" : "s"
        }.`,
    });
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

export class UploadValidationError extends AppError {
  constructor(publicMessage: string) {
    super({ code: "UPLOAD_INVALID", status: 400, publicMessage });
  }
}

export class DatabaseError extends AppError {
  constructor(internalMessage: string, cause?: unknown) {
    super({
      code: "DATABASE_ERROR",
      status: 500,
      publicMessage: "We had trouble saving your progress. Please try again.",
      internalMessage,
      cause,
    });
  }
}

/* -------------------------------------------------------------------------- */
/*                              AI-specific errors                            */
/* -------------------------------------------------------------------------- */

/**
 * Classification of a failure that came out of an AI provider. This drives the
 * failover decision: only `retryable` classes cause the ProviderManager to move
 * on to the next provider.
 */
export type AIErrorKind =
  | "auth" // bad/missing API key — do NOT fail over blindly, but try next provider
  | "invalid_request" // our request was malformed — failing over won't help
  | "model_unsupported" // this provider can't serve the model/capability
  | "rate_limit" // temporary, retryable
  | "quota_exceeded" // free tier exhausted, retryable on another provider
  | "timeout" // retryable
  | "network" // retryable
  | "server_error" // provider 5xx, retryable
  | "content_filtered" // provider refused the content — not retryable
  | "parse_error" // provider replied, but not in the shape we required
  | "unknown";

/** Failure kinds where trying a *different* provider is worthwhile. */
const FAILOVER_KINDS: ReadonlySet<AIErrorKind> = new Set<AIErrorKind>([
  "auth",
  "rate_limit",
  "quota_exceeded",
  "timeout",
  "network",
  "server_error",
  "model_unsupported",
]);

/** Failure kinds where retrying the *same* provider after a backoff is worthwhile. */
const SAME_PROVIDER_RETRY_KINDS: ReadonlySet<AIErrorKind> = new Set<AIErrorKind>([
  "rate_limit",
  "timeout",
  "network",
  "server_error",
]);

export function shouldFailOver(kind: AIErrorKind): boolean {
  return FAILOVER_KINDS.has(kind);
}

export function shouldRetrySameProvider(kind: AIErrorKind): boolean {
  return SAME_PROVIDER_RETRY_KINDS.has(kind);
}

const AI_ERROR_PRESENTATION: Record<AIErrorKind, { code: AppErrorCode; message: string }> = {
  auth: {
    code: "AI_PROVIDER_AUTH_ERROR",
    message: "The AI service rejected our credentials. Please check the provider configuration.",
  },
  invalid_request: {
    code: "AI_INVALID_REQUEST",
    message: "We couldn't build a valid request for the AI service.",
  },
  model_unsupported: {
    code: "AI_CAPABILITY_UNSUPPORTED",
    message: "No configured AI provider supports this feature yet.",
  },
  rate_limit: {
    code: "AI_PROVIDER_RATE_LIMIT",
    message: "The AI service is busy right now. Please try again in a moment.",
  },
  quota_exceeded: {
    code: "AI_PROVIDER_QUOTA_EXCEEDED",
    message: "The AI service has reached its usage limit. Please try again later.",
  },
  timeout: {
    code: "AI_TIMEOUT",
    message: "The AI service took too long to respond. Please try again.",
  },
  network: {
    code: "AI_PROVIDER_UNAVAILABLE",
    message: "We couldn't reach the AI service. Please check your connection and try again.",
  },
  server_error: {
    code: "AI_PROVIDER_UNAVAILABLE",
    message: "The AI service is temporarily unavailable. Please try again.",
  },
  content_filtered: {
    code: "AI_INVALID_REQUEST",
    message: "The AI service declined to respond to that message. Try rephrasing it.",
  },
  parse_error: {
    code: "AI_RESPONSE_PARSE_ERROR",
    message: "The AI service returned an unexpected response. Please try again.",
  },
  unknown: {
    code: "AI_PROVIDER_UNAVAILABLE",
    message: "The AI service is temporarily unavailable. Please try again.",
  },
};

/**
 * An error raised by a single provider adapter. The ProviderManager inspects
 * `kind` to decide whether to retry, fail over, or give up.
 */
export class AIProviderError extends AppError {
  readonly kind: AIErrorKind;
  readonly provider: string;
  readonly model?: string;
  readonly retryAfterSeconds?: number;

  constructor(params: {
    kind: AIErrorKind;
    provider: string;
    model?: string;
    internalMessage: string;
    retryAfterSeconds?: number;
    cause?: unknown;
  }) {
    const presentation = AI_ERROR_PRESENTATION[params.kind];
    super({
      code: presentation.code,
      status: params.kind === "rate_limit" || params.kind === "quota_exceeded" ? 429 : 503,
      publicMessage: presentation.message,
      internalMessage: `[${params.provider}] ${params.internalMessage}`,
      cause: params.cause,
    });
    this.kind = params.kind;
    this.provider = params.provider;
    this.model = params.model;
    this.retryAfterSeconds = params.retryAfterSeconds;
  }

  get isRetryableOnSameProvider(): boolean {
    return shouldRetrySameProvider(this.kind);
  }

  get shouldFailOver(): boolean {
    return shouldFailOver(this.kind);
  }
}

/** Raised when every configured provider has been tried and all of them failed. */
export class AllProvidersFailedError extends AppError {
  readonly attempts: ReadonlyArray<{ provider: string; kind: AIErrorKind; message: string }>;

  constructor(attempts: ReadonlyArray<{ provider: string; kind: AIErrorKind; message: string }>) {
    const worst = attempts.at(-1);
    const presentation = worst ? AI_ERROR_PRESENTATION[worst.kind] : AI_ERROR_PRESENTATION.unknown;

    super({
      code: presentation.code,
      status: 503,
      publicMessage: presentation.message,
      internalMessage: `All AI providers failed: ${attempts
        .map((attempt) => `${attempt.provider}(${attempt.kind})`)
        .join(" → ")}`,
    });
    this.attempts = attempts;
  }
}

/** Raised when no provider is configured at all (no API keys present). */
export class AINotConfiguredError extends AppError {
  constructor(capability?: string) {
    super({
      code: "AI_NOT_CONFIGURED",
      status: 503,
      publicMessage: capability
        ? `No AI provider is configured for ${capability} yet. Add an API key in your environment to enable this feature.`
        : "No AI provider is configured yet. Add a provider API key in your environment to start learning.",
    });
  }
}

/** Raised when a structured AI response fails Zod validation after retries. */
export class AIResponseParseError extends AppError {
  constructor(internalMessage: string, details?: unknown) {
    super({
      code: "AI_RESPONSE_PARSE_ERROR",
      status: 502,
      publicMessage: "The AI service returned an unexpected response. Please try again.",
      internalMessage,
      details,
    });
  }
}

/* -------------------------------------------------------------------------- */
/*                                  Helpers                                   */
/* -------------------------------------------------------------------------- */

export function isAppError(error: unknown): error is AppError {
  return error instanceof AppError;
}

/**
 * Converts any thrown value into an AppError so route handlers always have a
 * safe, structured error to serialize.
 */
export function toAppError(error: unknown): AppError {
  if (isAppError(error)) {
    return error;
  }

  if (error instanceof Error) {
    return new AppError({
      code: "INTERNAL_ERROR",
      status: 500,
      publicMessage: "Something went wrong on our side. Please try again.",
      internalMessage: error.message,
      cause: error,
    });
  }

  return new AppError({
    code: "INTERNAL_ERROR",
    status: 500,
    publicMessage: "Something went wrong on our side. Please try again.",
    internalMessage: `Non-Error thrown: ${String(error)}`,
  });
}
