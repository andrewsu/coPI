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
    // For admin page routes, return an inline 403 page.
    // A proper /forbidden page will be built as a separate task.
    return new NextResponse(
      `<!DOCTYPE html>
<html>
<head><title>403 Forbidden</title></head>
<body style="font-family: system-ui, sans-serif; display: flex; justify-content: center; align-items: center; min-height: 100vh; margin: 0; background: #f9fafb;">
  <div style="text-align: center;">
    <h1 style="font-size: 3rem; color: #6b7280; margin-bottom: 0.5rem;">403</h1>
    <p style="color: #374151; margin-bottom: 1.5rem;">You do not have admin access.</p>
    <a href="/" style="color: #2563eb; text-decoration: underline;">Go Home</a>
  </div>
</body>
</html>`,
      {
        status: 403,
        headers: { "Content-Type": "text/html" },
      },
    );
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    "/((?!login|unsubscribe|api/auth|api/email/unsubscribe|api/health|_next/static|_next/image|favicon\\.ico).*)",
  ],
};
