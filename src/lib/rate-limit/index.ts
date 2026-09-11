import "server-only";

import { RateLimitError } from "@/lib/errors";

/**
 * Application-level rate limiting.
 *
 * A fixed-window counter held in process memory. This is deliberately simple:
 * Redis would be the right answer for a multi-instance deployment, but adding
 * it for an MVP contradicts the "don't overengineer" constraint. The limitation
 * is real and documented — on serverless platforms each instance keeps its own
 * counters, so effective limits scale with instance count.
 *
 * Provider quotas are the backstop; these limits exist to stop one user from
 * burning a shared free tier in a minute.
 */

interface WindowState {
  count: number;
  resetAt: number;
}

const buckets = new Map<string, WindowState>();

/** Evict expired windows so the map can't grow without bound. */
function sweep(now: number): void {
  if (buckets.size < 1000) return;
  for (const [key, state] of buckets) {
    if (state.resetAt <= now) buckets.delete(key);
  }
}

export interface RateLimitRule {
  /** Requests allowed per window. */
  limit: number;
  /** Window length in seconds. */
  windowSeconds: number;
}

/**
 * Per-endpoint budgets. Expensive AI calls are tighter than reads.
 * These are per user (or per IP for unauthenticated endpoints).
 */
export const RATE_LIMITS = {
  // Conversation is the core loop, so it gets the most headroom.
  chat: { limit: 30, windowSeconds: 60 },
  // Analysis calls are heavier and less frequent by nature.
  analysis: { limit: 15, windowSeconds: 60 },
  // Transcription is the most expensive per request.
  transcription: { limit: 12, windowSeconds: 60 },
  // Exercise generation is cheap but easy to hammer from a loop.
  generation: { limit: 20, windowSeconds: 60 },
  // Auth endpoints are limited per IP to slow credential stuffing.
  auth: { limit: 10, windowSeconds: 300 },
  // Ordinary CRUD.
  standard: { limit: 120, windowSeconds: 60 },
} as const satisfies Record<string, RateLimitRule>;

export type RateLimitName = keyof typeof RATE_LIMITS;

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  retryAfterSeconds: number;
  limit: number;
}

export function checkRateLimit(
  identifier: string,
  rule: RateLimitName | RateLimitRule,
): RateLimitResult {
  const resolved: RateLimitRule = typeof rule === "string" ? RATE_LIMITS[rule] : rule;
  const scope = typeof rule === "string" ? rule : `${resolved.limit}/${resolved.windowSeconds}`;
  const key = `${scope}:${identifier}`;

  const now = Date.now();
  sweep(now);

  const existing = buckets.get(key);

  if (!existing || existing.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + resolved.windowSeconds * 1000 });
    return {
      allowed: true,
      remaining: resolved.limit - 1,
      retryAfterSeconds: resolved.windowSeconds,
      limit: resolved.limit,
    };
  }

  if (existing.count >= resolved.limit) {
    return {
      allowed: false,
      remaining: 0,
      retryAfterSeconds: Math.max(1, Math.ceil((existing.resetAt - now) / 1000)),
      limit: resolved.limit,
    };
  }

  existing.count += 1;
  return {
    allowed: true,
    remaining: resolved.limit - existing.count,
    retryAfterSeconds: Math.max(1, Math.ceil((existing.resetAt - now) / 1000)),
    limit: resolved.limit,
  };
}

/** Throws a {@link RateLimitError} when the caller is over budget. */
export function enforceRateLimit(identifier: string, rule: RateLimitName | RateLimitRule): void {
  const result = checkRateLimit(identifier, rule);
  if (!result.allowed) {
    throw new RateLimitError(result.retryAfterSeconds);
  }
}

/** Test/dev helper — clears all counters. */
export function resetRateLimits(): void {
  buckets.clear();
}
