import "server-only";

import { getSession, type SessionPayload } from "@/lib/auth/session";
import { getEnv } from "@/lib/config/env";
import { AuthenticationError, AuthorizationError } from "@/lib/errors";
import { enforceRateLimit, type RateLimitName, type RateLimitRule } from "@/lib/rate-limit";

/**
 * Guards used at the top of route handlers.
 *
 * The pattern every protected handler follows is: authenticate, rate limit,
 * validate, delegate to a service. These helpers cover the first two.
 */

/** Requires a signed-in user, throwing a 401 otherwise. */
export async function requireSession(): Promise<SessionPayload> {
  const session = await getSession();
  if (!session) {
    throw new AuthenticationError();
  }
  return session;
}

/** Requires a signed-in user whose email is in ADMIN_EMAILS. */
export async function requireAdmin(): Promise<SessionPayload> {
  const session = await requireSession();
  const adminEmails = getEnv().ADMIN_EMAILS;

  if (!adminEmails.includes(session.email.toLowerCase())) {
    // A 403 would confirm the admin area exists; 404 semantics are handled by
    // the page layer, and API callers get a plain authorization failure.
    throw new AuthorizationError("You don't have access to that.");
  }

  return session;
}

/**
 * Best-effort client IP for unauthenticated rate limiting.
 *
 * Header values are attacker-controlled, so this is only ever used to bucket
 * anonymous traffic — never for authorization.
 */
export function getClientIdentifier(request: Request): string {
  const forwardedFor = request.headers.get("x-forwarded-for");
  if (forwardedFor) {
    const first = forwardedFor.split(",")[0]?.trim();
    if (first) return first;
  }
  return request.headers.get("x-real-ip")?.trim() ?? "unknown";
}

/** Rate limits a signed-in user by user id. */
export function limitByUser(userId: string, rule: RateLimitName | RateLimitRule): void {
  enforceRateLimit(`user:${userId}`, rule);
}

/** Rate limits an anonymous caller by IP. */
export function limitByIp(request: Request, rule: RateLimitName | RateLimitRule): void {
  enforceRateLimit(`ip:${getClientIdentifier(request)}`, rule);
}

/**
 * Asserts that a resource belongs to the requesting user.
 *
 * Called after loading a row, so that one user can never read or mutate
 * another's conversations, vocabulary or writing.
 */
export function assertOwnership(resourceUserId: string | null | undefined, userId: string): void {
  if (resourceUserId !== userId) {
    throw new AuthorizationError();
  }
}
