import { NextResponse } from "next/server";
import { ZodError, type z } from "zod";

import { requireSession } from "@/lib/api/guards";
import type { SessionPayload } from "@/lib/auth/session";
import {
  AppError,
  AuthenticationError,
  RateLimitError,
  ValidationError,
  toAppError,
} from "@/lib/errors";
import { createRequestId, logger } from "@/lib/logger";

/**
 * Uniform API envelope.
 *
 * Every route handler returns either `{ success: true, data }` or
 * `{ success: false, error: { code, message } }`, so the client has exactly one
 * shape to reason about. Stack traces and internal messages never appear here.
 */

export interface ApiSuccess<T> {
  success: true;
  data: T;
}

export interface ApiFailure {
  success: false;
  error: {
    code: string;
    message: string;
    /** Field-level messages, present only for validation failures. */
    fields?: Record<string, string[]>;
  };
}

export type ApiResult<T> = ApiSuccess<T> | ApiFailure;

export function apiSuccess<T>(data: T, init?: ResponseInit): NextResponse<ApiSuccess<T>> {
  return NextResponse.json({ success: true, data }, init);
}

export function apiFailure(error: AppError, requestId?: string): NextResponse<ApiFailure> {
  const headers = new Headers();
  if (error instanceof RateLimitError) {
    headers.set("Retry-After", String(error.retryAfterSeconds));
  }
  if (requestId) {
    headers.set("X-Request-Id", requestId);
  }

  const fields =
    error instanceof ValidationError && isFieldErrors(error.details) ? error.details : undefined;

  return NextResponse.json(
    {
      success: false,
      error: {
        code: error.code,
        message: error.publicMessage,
        ...(fields ? { fields } : {}),
      },
    },
    { status: error.status, headers },
  );
}

function isFieldErrors(value: unknown): value is Record<string, string[]> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Wraps a handler with request-id generation, logging and error translation.
 * Any thrown AppError becomes a safe JSON response; anything else becomes a
 * generic 500 with the detail confined to the logs.
 *
 * The handler's return type is intentionally loose: a handler that branches
 * (returning different success shapes per action) would otherwise fail to
 * unify against a single `NextResponse<ApiSuccess<T>>`.
 *
 * Use this only for endpoints that do not require a session — anything
 * authenticated should use {@link handleAuthedRoute}, which resolves the
 * session inside the try block so a 401 is returned rather than thrown.
 */
export async function handleRoute(
  context: { endpoint: string; userId?: string },
  handler: () => Promise<NextResponse>,
): Promise<NextResponse> {
  const requestId = createRequestId();
  const startedAt = Date.now();

  try {
    const response = await handler();
    response.headers.set("X-Request-Id", requestId);

    logger.info("Request completed", {
      requestId,
      endpoint: context.endpoint,
      userId: context.userId,
      latencyMs: Date.now() - startedAt,
      success: true,
      status: response.status,
    });

    return response;
  } catch (error) {
    const appError = toAppError(error);

    // 5xx means we broke; 4xx means the caller did. Only the former deserves
    // error-level noise in the logs.
    const level = appError.status >= 500 ? "error" : "warn";
    logger[level]("Request failed", {
      requestId,
      endpoint: context.endpoint,
      userId: context.userId,
      latencyMs: Date.now() - startedAt,
      success: false,
      code: appError.code,
      status: appError.status,
      error: appError.message,
    });

    return apiFailure(appError, requestId);
  }
}

/**
 * `handleRoute` for endpoints that require a signed-in user.
 *
 * Authentication happens inside the wrapped try block, so an unauthenticated
 * request produces a proper 401 envelope instead of an uncaught error. Every
 * protected route should use this rather than resolving the session itself.
 */
export async function handleAuthedRoute(
  context: { endpoint: string },
  handler: (session: SessionPayload) => Promise<NextResponse>,
): Promise<NextResponse> {
  const requestId = createRequestId();
  const startedAt = Date.now();

  let userId: string | undefined;

  try {
    const session = await requireSession();
    userId = session.userId;

    const response = await handler(session);
    response.headers.set("X-Request-Id", requestId);

    logger.info("Request completed", {
      requestId,
      endpoint: context.endpoint,
      userId,
      latencyMs: Date.now() - startedAt,
      success: true,
      status: response.status,
    });

    return response;
  } catch (error) {
    const appError = toAppError(error);

    const level = appError.status >= 500 ? "error" : "warn";
    logger[level]("Request failed", {
      requestId,
      endpoint: context.endpoint,
      userId,
      latencyMs: Date.now() - startedAt,
      success: false,
      code: appError.code,
      status: appError.status,
      error: appError.message,
    });

    return apiFailure(appError, requestId);
  }
}

/** Parses and validates a JSON request body, throwing a ValidationError. */
export async function parseJsonBody<TSchema extends z.ZodType>(
  request: Request,
  schema: TSchema,
): Promise<z.infer<TSchema>> {
  let body: unknown;

  try {
    body = await request.json();
  } catch {
    throw new ValidationError("The request body must be valid JSON.");
  }

  const result = schema.safeParse(body);
  if (!result.success) {
    throw new ValidationError(
      "Some of the information you sent isn't valid.",
      flattenZodError(result.error),
    );
  }

  return result.data;
}

/** Validates URL search params against a schema. */
export function parseSearchParams<TSchema extends z.ZodType>(
  request: Request,
  schema: TSchema,
): z.infer<TSchema> {
  const url = new URL(request.url);
  const raw = Object.fromEntries(url.searchParams.entries());

  const result = schema.safeParse(raw);
  if (!result.success) {
    throw new ValidationError(
      "Some of the query parameters aren't valid.",
      flattenZodError(result.error),
    );
  }

  return result.data;
}

export function flattenZodError(error: ZodError): Record<string, string[]> {
  const fields: Record<string, string[]> = {};
  for (const issue of error.issues) {
    const key = issue.path.join(".") || "_";
    (fields[key] ??= []).push(issue.message);
  }
  return fields;
}

export { AuthenticationError };
