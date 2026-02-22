/**
 * Route protection middleware.
 * Redirects unauthenticated users to /login for all routes
 * except the login page, NextAuth API routes, and static assets.
 */

export { default } from "next-auth/middleware";

export const config = {
  matcher: [
    "/((?!login|api/auth|_next/static|_next/image|favicon\\.ico).*)",
  ],
};
