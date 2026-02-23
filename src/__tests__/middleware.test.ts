/**
 * Tests for the route protection middleware.
 *
 * Validates two layers of protection:
 * 1. Authentication: unauthenticated users are redirected to /login
 * 2. Admin authorization: /admin/* and /api/admin/* routes require isAdmin=true,
 *    returning 403 for non-admin users (JSON for API routes, HTML for page routes)
 *
 * The middleware uses next-auth/jwt getToken() to read the JWT from the request,
 * avoiding a database call on every request. The isAdmin flag is stored in the JWT
 * at sign-in time (see auth.ts jwt callback).
 */

import { NextRequest } from "next/server";

// Mock getToken before importing middleware
const mockGetToken = jest.fn();
jest.mock("next-auth/jwt", () => ({
  getToken: (...args: unknown[]) => mockGetToken(...args),
}));

import { middleware, config } from "../middleware";

function createRequest(path: string): NextRequest {
  return new NextRequest(new URL(path, "http://localhost:3000"));
}

describe("middleware", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe("matcher config", () => {
    // Ensures public routes are excluded from the middleware matcher
    // so they remain accessible without authentication.
    it("exports a matcher that excludes public routes", () => {
      expect(config.matcher).toBeDefined();
      const pattern = config.matcher[0];
      // These paths should NOT be matched (excluded from middleware)
      expect(pattern).toContain("login");
      expect(pattern).toContain("unsubscribe");
      expect(pattern).toContain("api/auth");
      expect(pattern).toContain("api/email/unsubscribe");
      expect(pattern).toContain("api/health");
      expect(pattern).toContain("_next/static");
      expect(pattern).toContain("_next/image");
      expect(pattern).toContain("favicon");
    });
  });

  describe("authentication", () => {
    // Unauthenticated users must be redirected to /login with a callbackUrl
    // so they return to their intended destination after signing in.
    it("redirects unauthenticated users to /login with callbackUrl", async () => {
      mockGetToken.mockResolvedValue(null);

      const response = await middleware(createRequest("/"));
      expect(response.status).toBe(307);
      const location = response.headers.get("location")!;
      const url = new URL(location);
      expect(url.pathname).toBe("/login");
      expect(url.searchParams.get("callbackUrl")).toBe("http://localhost:3000/");
    });

    // Unauthenticated users trying to access admin routes should be redirected
    // to login, not shown a 403 — authentication check comes first.
    it("redirects unauthenticated users to /login even for admin routes", async () => {
      mockGetToken.mockResolvedValue(null);

      const response = await middleware(createRequest("/admin/users"));
      expect(response.status).toBe(307);
      const location = response.headers.get("location")!;
      const url = new URL(location);
      expect(url.pathname).toBe("/login");
    });

    // Authenticated non-admin users should pass through to regular routes
    // without any interference from the admin protection layer.
    it("allows authenticated users to access regular routes", async () => {
      mockGetToken.mockResolvedValue({
        userId: "user-1",
        orcid: "0000-0001-2345-6789",
        isAdmin: false,
      });

      const response = await middleware(createRequest("/"));
      // NextResponse.next() returns 200
      expect(response.status).toBe(200);
      // No redirect
      expect(response.headers.get("location")).toBeNull();
    });

    // Authenticated users should access API routes without admin checks
    // unless the route is under /api/admin.
    it("allows authenticated users to access regular API routes", async () => {
      mockGetToken.mockResolvedValue({
        userId: "user-1",
        orcid: "0000-0001-2345-6789",
        isAdmin: false,
      });

      const response = await middleware(createRequest("/api/proposals"));
      expect(response.status).toBe(200);
    });
  });

  describe("admin page route protection", () => {
    // Non-admin users navigating to /admin/* pages are redirected to /forbidden.
    // The spec requires: "Non-admin users who navigate to /admin see a 403 page."
    // The /forbidden page renders the styled 403 content.
    it("redirects non-admin users to /forbidden on /admin", async () => {
      mockGetToken.mockResolvedValue({
        userId: "user-1",
        orcid: "0000-0001-2345-6789",
        isAdmin: false,
      });

      const response = await middleware(createRequest("/admin"));
      expect(response.status).toBe(307);
      const location = response.headers.get("location")!;
      const url = new URL(location);
      expect(url.pathname).toBe("/forbidden");
    });

    // Nested admin page routes should also redirect to /forbidden.
    it("redirects non-admin users to /forbidden on /admin/users", async () => {
      mockGetToken.mockResolvedValue({
        userId: "user-1",
        orcid: "0000-0001-2345-6789",
        isAdmin: false,
      });

      const response = await middleware(createRequest("/admin/users"));
      expect(response.status).toBe(307);
      const location = response.headers.get("location")!;
      const url = new URL(location);
      expect(url.pathname).toBe("/forbidden");
    });

    it("redirects non-admin users to /forbidden on /admin/users/some-id", async () => {
      mockGetToken.mockResolvedValue({
        userId: "user-1",
        orcid: "0000-0001-2345-6789",
        isAdmin: false,
      });

      const response = await middleware(createRequest("/admin/users/abc-123"));
      expect(response.status).toBe(307);
      const location = response.headers.get("location")!;
      const url = new URL(location);
      expect(url.pathname).toBe("/forbidden");
    });

    it("redirects non-admin users to /forbidden on /admin/stats", async () => {
      mockGetToken.mockResolvedValue({
        userId: "user-1",
        orcid: "0000-0001-2345-6789",
        isAdmin: false,
      });

      const response = await middleware(createRequest("/admin/stats"));
      expect(response.status).toBe(307);
      const location = response.headers.get("location")!;
      const url = new URL(location);
      expect(url.pathname).toBe("/forbidden");
    });

    // Admin users should pass through to admin page routes without interference.
    it("allows admin users to access /admin", async () => {
      mockGetToken.mockResolvedValue({
        userId: "admin-1",
        orcid: "0000-0002-3456-7890",
        isAdmin: true,
      });

      const response = await middleware(createRequest("/admin"));
      expect(response.status).toBe(200);
    });

    it("allows admin users to access /admin/users", async () => {
      mockGetToken.mockResolvedValue({
        userId: "admin-1",
        orcid: "0000-0002-3456-7890",
        isAdmin: true,
      });

      const response = await middleware(createRequest("/admin/users"));
      expect(response.status).toBe(200);
    });

    it("allows admin users to access /admin/proposals/some-id", async () => {
      mockGetToken.mockResolvedValue({
        userId: "admin-1",
        orcid: "0000-0002-3456-7890",
        isAdmin: true,
      });

      const response = await middleware(
        createRequest("/admin/proposals/abc-123"),
      );
      expect(response.status).toBe(200);
    });
  });

  describe("admin API route protection", () => {
    // Non-admin users calling admin API routes should get a JSON 403 response
    // (not HTML), so client-side code can handle the error programmatically.
    it("returns 403 JSON for non-admin users on /api/admin/users", async () => {
      mockGetToken.mockResolvedValue({
        userId: "user-1",
        orcid: "0000-0001-2345-6789",
        isAdmin: false,
      });

      const response = await middleware(createRequest("/api/admin/users"));
      expect(response.status).toBe(403);
      const body = await response.json();
      expect(body).toEqual({ error: "Forbidden" });
    });

    it("returns 403 JSON for non-admin users on /api/admin/stats", async () => {
      mockGetToken.mockResolvedValue({
        userId: "user-1",
        orcid: "0000-0001-2345-6789",
        isAdmin: false,
      });

      const response = await middleware(createRequest("/api/admin/stats"));
      expect(response.status).toBe(403);
      const body = await response.json();
      expect(body).toEqual({ error: "Forbidden" });
    });

    it("returns 403 JSON for non-admin users on nested admin API routes", async () => {
      mockGetToken.mockResolvedValue({
        userId: "user-1",
        orcid: "0000-0001-2345-6789",
        isAdmin: false,
      });

      const response = await middleware(
        createRequest("/api/admin/proposals/abc-123"),
      );
      expect(response.status).toBe(403);
      const body = await response.json();
      expect(body).toEqual({ error: "Forbidden" });
    });

    // Admin users should pass through to admin API routes.
    it("allows admin users to access /api/admin/users", async () => {
      mockGetToken.mockResolvedValue({
        userId: "admin-1",
        orcid: "0000-0002-3456-7890",
        isAdmin: true,
      });

      const response = await middleware(createRequest("/api/admin/users"));
      expect(response.status).toBe(200);
    });

    it("allows admin users to access /api/admin/stats", async () => {
      mockGetToken.mockResolvedValue({
        userId: "admin-1",
        orcid: "0000-0002-3456-7890",
        isAdmin: true,
      });

      const response = await middleware(createRequest("/api/admin/stats"));
      expect(response.status).toBe(200);
    });
  });

  describe("edge cases", () => {
    // A token that doesn't have the isAdmin field at all (e.g., pre-migration
    // JWTs) should be treated as non-admin. The ?? false fallback in the
    // session callback handles this at the session level, but the middleware
    // also needs to handle it since it reads the token directly.
    it("treats missing isAdmin as non-admin", async () => {
      mockGetToken.mockResolvedValue({
        userId: "user-1",
        orcid: "0000-0001-2345-6789",
        // isAdmin not set — simulates pre-migration JWT
      });

      const response = await middleware(createRequest("/admin/users"));
      expect(response.status).toBe(307);
      const location = response.headers.get("location")!;
      const url = new URL(location);
      expect(url.pathname).toBe("/forbidden");
    });

    // isAdmin explicitly false should be denied.
    it("treats isAdmin=false as non-admin", async () => {
      mockGetToken.mockResolvedValue({
        userId: "user-1",
        orcid: "0000-0001-2345-6789",
        isAdmin: false,
      });

      const response = await middleware(createRequest("/api/admin/users"));
      expect(response.status).toBe(403);
    });

    // Regular routes should be unaffected by the admin check even for
    // pre-migration tokens without isAdmin.
    it("allows pre-migration tokens to access regular routes", async () => {
      mockGetToken.mockResolvedValue({
        userId: "user-1",
        orcid: "0000-0001-2345-6789",
        // isAdmin not set
      });

      const response = await middleware(createRequest("/"));
      expect(response.status).toBe(200);
    });

    // Ensures callbackUrl preserves the full path for deep links.
    it("preserves full path in callbackUrl for unauthenticated requests", async () => {
      mockGetToken.mockResolvedValue(null);

      const response = await middleware(
        createRequest("/admin/proposals/abc-123"),
      );
      const location = response.headers.get("location")!;
      const url = new URL(location);
      expect(url.searchParams.get("callbackUrl")).toBe(
        "http://localhost:3000/admin/proposals/abc-123",
      );
    });
  });
});
