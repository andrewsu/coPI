/**
 * Route protection middleware.
 * Redirects unauthenticated users to /login for all routes
 * except the login page, NextAuth API routes, unsubscribe routes,
 * health check endpoint, and static assets.
 *
 * Unsubscribe routes are excluded because users click unsubscribe
 * links from email without being logged in. Token signature serves
 * as authentication for the unsubscribe API.
 *
 * The health check endpoint is excluded so Docker HEALTHCHECK,
 * load balancers, and uptime monitors can probe without auth.
 */

export { default } from "next-auth/middleware";

export const config = {
  matcher: [
    "/((?!login|unsubscribe|api/auth|api/email/unsubscribe|api/health|_next/static|_next/image|favicon\\.ico).*)",
  ],
};
