import { NextResponse, type NextRequest } from "next/server";

import { SESSION_COOKIE_NAME } from "@/lib/auth/session";

/**
 * Route protection.
 *
 * Middleware runs on the Edge runtime, where Prisma and Node crypto aren't
 * available, so this only checks for the *presence* of a session cookie and
 * redirects. Real verification happens server-side in every page and route
 * handler via `requireSession()` — a forged cookie gets past this redirect and
 * straight into a 401.
 */

const PROTECTED_PREFIXES = [
  "/learn",
  "/conversation",
  "/teacher",
  "/grammar",
  "/vocabulary",
  "/writing",
  "/speaking",
  "/progress",
  "/settings",
  "/profile",
  "/onboarding",
  "/assessment",
  "/admin",
];

const AUTH_ROUTES = ["/login", "/register", "/forgot-password", "/reset-password"];

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const hasSessionCookie = request.cookies.has(SESSION_COOKIE_NAME);

  const isProtected = PROTECTED_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );

  if (isProtected && !hasSessionCookie) {
    const loginUrl = new URL("/login", request.url);
    // Preserve where they were heading so sign-in can return them there.
    loginUrl.searchParams.set("next", pathname);
    return NextResponse.redirect(loginUrl);
  }

  // Someone already signed in has no use for the login page.
  if (AUTH_ROUTES.includes(pathname) && hasSessionCookie) {
    return NextResponse.redirect(new URL("/learn", request.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    /*
     * Everything except Next internals, the API (which does its own auth and
     * must return JSON rather than a redirect), and static assets.
     */
    "/((?!api|_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)",
  ],
};
