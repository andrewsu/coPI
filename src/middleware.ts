/**
 * Route protection middleware.
 *
 * Two layers of protection:
 * 1. Authentication: Unauthenticated users are redirected to /login for all
 *    routes except the login page, NextAuth API routes, unsubscribe routes,
 *    health check endpoint, and static assets.
 * 2. Admin authorization: Routes under /admin/* and /api/admin/* require
 *    isAdmin = true on the JWT. Non-admin users receive a 403 response.
 *
 * Unsubscribe routes are excluded because users click unsubscribe
 * links from email without being logged in. Token signature serves
 * as authentication for the unsubscribe API.
 *
 * The health check endpoint is excluded so Docker HEALTHCHECK,
 * load balancers, and uptime monitors can probe without auth.
 */

import { getToken } from "next-auth/jwt";
import { NextRequest, NextResponse } from "next/server";

export async function middleware(request: NextRequest) {
  const token = await getToken({ req: request });

  // Not authenticated → redirect to login
  if (!token) {
    const loginUrl = new URL("/login", request.url);
    loginUrl.searchParams.set("callbackUrl", request.url);
    return NextResponse.redirect(loginUrl);
  }

  // Admin route protection: /admin/* and /api/admin/*
  const { pathname } = request.nextUrl;
  const isAdminRoute =
    pathname.startsWith("/admin") || pathname.startsWith("/api/admin");

  if (isAdminRoute && !token.isAdmin) {
    if (pathname.startsWith("/api/admin")) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    // Redirect to the dedicated /forbidden page.
    const forbiddenUrl = new URL("/forbidden", request.url);
    return NextResponse.redirect(forbiddenUrl);
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    "/((?!login|unsubscribe|api/auth|api/email/unsubscribe|api/health|_next/static|_next/image|favicon\\.ico).*)",
  ],
};
