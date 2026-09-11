/**
 * Typed fetch wrapper for the browser.
 *
 * Unwraps the `{ success, data | error }` envelope so callers work with plain
 * data and a single error type, instead of re-checking `success` everywhere.
 */

export class ApiError extends Error {
  readonly code: string;
  readonly status: number;
  readonly fields?: Record<string, string[]>;

  constructor(params: {
    code: string;
    message: string;
    status: number;
    fields?: Record<string, string[]>;
  }) {
    super(params.message);
    this.name = "ApiError";
    this.code = params.code;
    this.status = params.status;
    this.fields = params.fields;
  }
}

interface ApiEnvelope<T> {
  success: boolean;
  data?: T;
  error?: { code: string; message: string; fields?: Record<string, string[]> };
}

export async function apiRequest<T>(path: string, options: RequestInit = {}): Promise<T> {
  let response: Response;

  try {
    response = await fetch(path, {
      ...options,
      headers: {
        ...(options.body instanceof FormData ? {} : { "Content-Type": "application/json" }),
        ...options.headers,
      },
    });
  } catch (error) {
    // A network failure never produces a response to parse, so it needs its own
    // error rather than falling through to the JSON branch below.
    if (error instanceof DOMException && error.name === "AbortError") {
      throw error;
    }
    throw new ApiError({
      code: "NETWORK_ERROR",
      message: "We couldn't reach the server. Check your connection and try again.",
      status: 0,
    });
  }

  let payload: ApiEnvelope<T> | null = null;

  try {
    payload = (await response.json()) as ApiEnvelope<T>;
  } catch {
    payload = null;
  }

  if (!response.ok || !payload?.success) {
    throw new ApiError({
      code: payload?.error?.code ?? "INTERNAL_ERROR",
      message: payload?.error?.message ?? "Something went wrong. Please try again.",
      status: response.status,
      fields: payload?.error?.fields,
    });
  }

  return payload.data as T;
}

export function apiGet<T>(path: string, signal?: AbortSignal): Promise<T> {
  return apiRequest<T>(path, { method: "GET", signal });
}

export function apiPost<T>(path: string, body?: unknown, signal?: AbortSignal): Promise<T> {
  return apiRequest<T>(path, {
    method: "POST",
    body: body instanceof FormData ? body : JSON.stringify(body ?? {}),
    signal,
  });
}

export function apiPatch<T>(path: string, body: unknown, signal?: AbortSignal): Promise<T> {
  return apiRequest<T>(path, { method: "PATCH", body: JSON.stringify(body), signal });
}

export function apiDelete<T>(path: string, signal?: AbortSignal): Promise<T> {
  return apiRequest<T>(path, { method: "DELETE", signal });
}
