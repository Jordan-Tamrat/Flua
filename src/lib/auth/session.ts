import "server-only";

import { SignJWT, jwtVerify } from "jose";
import { cookies } from "next/headers";

import { getEnv } from "@/lib/config/env";
import { logger } from "@/lib/logger";

/**
 * Session management.
 *
 * Sessions are stateless signed JWTs held in an httpOnly cookie. This keeps the
 * MVP free of a session table while remaining straightforward to extend: adding
 * OAuth later means adding another way to *mint* this cookie, not changing how
 * it is read.
 */

export const SESSION_COOKIE_NAME = "flua_session";
const SESSION_DURATION_SECONDS = 60 * 60 * 24 * 30; // 30 days
const JWT_ISSUER = "flua";
const JWT_AUDIENCE = "flua-app";

export interface SessionPayload {
  userId: string;
  email: string;
  name: string;
}

function getSigningKey(): Uint8Array {
  return new TextEncoder().encode(getEnv().AUTH_SECRET);
}

export async function createSessionToken(payload: SessionPayload): Promise<string> {
  return new SignJWT({ email: payload.email, name: payload.name })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(payload.userId)
    .setIssuedAt()
    .setIssuer(JWT_ISSUER)
    .setAudience(JWT_AUDIENCE)
    .setExpirationTime(`${SESSION_DURATION_SECONDS}s`)
    .sign(getSigningKey());
}

export async function verifySessionToken(token: string): Promise<SessionPayload | null> {
  try {
    const { payload } = await jwtVerify(token, getSigningKey(), {
      issuer: JWT_ISSUER,
      audience: JWT_AUDIENCE,
      algorithms: ["HS256"],
    });

    if (typeof payload.sub !== "string" || typeof payload.email !== "string") {
      return null;
    }

    return {
      userId: payload.sub,
      email: payload.email,
      name: typeof payload.name === "string" ? payload.name : "",
    };
  } catch {
    // Expired or tampered tokens are simply "not signed in".
    return null;
  }
}

/** Writes the session cookie. Must be called from a Server Action or handler. */
export async function setSessionCookie(payload: SessionPayload): Promise<void> {
  const token = await createSessionToken(payload);
  const cookieStore = await cookies();

  cookieStore.set(SESSION_COOKIE_NAME, token, {
    httpOnly: true,
    // Secure cookies would never be sent over plain http://localhost in dev.
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_DURATION_SECONDS,
  });
}

export async function clearSessionCookie(): Promise<void> {
  const cookieStore = await cookies();
  cookieStore.set(SESSION_COOKIE_NAME, "", {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 0,
  });
}

/**
 * Reads and verifies the current session, or null when signed out.
 *
 * Note the deliberately narrow catch. During a build, `cookies()` throws a
 * special error that Next.js uses to detect that a route must be rendered
 * dynamically. Swallowing it would both break that detection and fill the build
 * log with alarming-looking failures, so it is rethrown; only genuine
 * cookie-reading problems are treated as "signed out".
 */
export async function getSession(): Promise<SessionPayload | null> {
  try {
    const cookieStore = await cookies();
    const token = cookieStore.get(SESSION_COOKIE_NAME)?.value;
    if (!token) return null;
    return await verifySessionToken(token);
  } catch (error) {
    if (isNextControlFlowError(error)) {
      throw error;
    }
    logger.warn("Failed to read session cookie", { error: String(error) });
    return null;
  }
}

/**
 * Detects framework errors that use exceptions as control flow (dynamic-render
 * bailouts, redirects, not-found). These must never be caught by application code.
 */
function isNextControlFlowError(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false;

  const digest = (error as { digest?: unknown }).digest;
  if (typeof digest === "string") {
    return (
      digest === "DYNAMIC_SERVER_USAGE" ||
      digest.startsWith("NEXT_REDIRECT") ||
      digest === "NEXT_NOT_FOUND" ||
      digest === "NEXT_HTTP_ERROR_FALLBACK"
    );
  }

  // Older bailout errors carry no digest, only a recognizable name.
  const name = (error as { name?: unknown }).name;
  return name === "DynamicServerError" || name === "BailoutToCSRError";
}
