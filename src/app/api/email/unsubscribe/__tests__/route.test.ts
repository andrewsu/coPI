/**
 * Tests for GET /api/email/unsubscribe — token-based email unsubscribe handler.
 *
 * Validates that:
 *   - Valid tokens update user preferences and redirect to success page
 *   - Missing/invalid/expired tokens redirect to invalid page
 *   - Deleted users are handled gracefully (treated as invalid)
 *   - Each notification type maps to the correct preference update
 *   - Redirect URLs contain the correct status and type query params
 */

/* eslint-disable @typescript-eslint/no-require-imports */

process.env.NEXTAUTH_SECRET = "test-secret-for-unsubscribe-route";
process.env.NEXTAUTH_URL = "https://copi.sulab.org";

jest.mock("@/lib/prisma", () => ({
  prisma: {
    user: {
      findUnique: jest.fn(),
      update: jest.fn(),
    },
  },
}));

import { prisma } from "@/lib/prisma";
import { NextRequest } from "next/server";
import { generateUnsubscribeToken } from "@/lib/unsubscribe-token";

const mockFindUnique = jest.mocked(prisma.user.findUnique);
const mockUpdate = jest.mocked(prisma.user.update);

const { GET } = require("../route");

/** Creates a NextRequest with the given URL so nextUrl.searchParams works. */
function makeRequest(url: string): NextRequest {
  return new NextRequest(url);
}

describe("GET /api/email/unsubscribe", () => {
  beforeEach(() => jest.clearAllMocks());

  /** Missing token param should redirect to the invalid confirmation page. */
  it("redirects to invalid page when no token provided", async () => {
    const res = await GET(makeRequest("https://copi.sulab.org/api/email/unsubscribe"));
    expect(res.status).toBe(307);
    const location = res.headers.get("location");
    expect(location).toContain("/unsubscribe?status=invalid");
  });

  /** Invalid/garbage token should redirect to invalid page. */
  it("redirects to invalid page for garbage token", async () => {
    const res = await GET(
      makeRequest("https://copi.sulab.org/api/email/unsubscribe?token=garbage-token"),
    );
    expect(res.status).toBe(307);
    const location = res.headers.get("location");
    expect(location).toContain("/unsubscribe?status=invalid");
  });

  /** Valid token for nonexistent user should redirect to invalid page. */
  it("redirects to invalid page when user not found", async () => {
    const token = generateUnsubscribeToken("nonexistent-user", "matches");
    mockFindUnique.mockResolvedValue(null);

    const res = await GET(
      makeRequest(`https://copi.sulab.org/api/email/unsubscribe?token=${encodeURIComponent(token)}`),
    );
    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toContain("status=invalid");
  });

  /** Valid token for deleted user should redirect to invalid page. */
  it("redirects to invalid page for deleted user", async () => {
    const token = generateUnsubscribeToken("deleted-user", "matches");
    mockFindUnique.mockResolvedValue({
      id: "deleted-user",
      deletedAt: new Date(),
    } as never);

    const res = await GET(
      makeRequest(`https://copi.sulab.org/api/email/unsubscribe?token=${encodeURIComponent(token)}`),
    );
    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toContain("status=invalid");
  });

  /** Valid token should update user preferences and redirect to success page. */
  it("unsubscribes from matches and redirects to success", async () => {
    const token = generateUnsubscribeToken("user-1", "matches");
    mockFindUnique.mockResolvedValue({ id: "user-1", deletedAt: null } as never);
    mockUpdate.mockResolvedValue({} as never);

    const res = await GET(
      makeRequest(`https://copi.sulab.org/api/email/unsubscribe?token=${encodeURIComponent(token)}`),
    );

    expect(res.status).toBe(307);
    const location = res.headers.get("location")!;
    expect(location).toContain("status=success");
    expect(location).toContain("type=matches");

    // Verify the correct preference was updated
    expect(mockUpdate).toHaveBeenCalledWith({
      where: { id: "user-1" },
      data: { notifyMatches: false },
    });
  });

  /** Unsubscribe from all emails disables the master switch. */
  it("disables master switch for type=all", async () => {
    const token = generateUnsubscribeToken("user-2", "all");
    mockFindUnique.mockResolvedValue({ id: "user-2", deletedAt: null } as never);
    mockUpdate.mockResolvedValue({} as never);

    const res = await GET(
      makeRequest(`https://copi.sulab.org/api/email/unsubscribe?token=${encodeURIComponent(token)}`),
    );

    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toContain("type=all");
    expect(mockUpdate).toHaveBeenCalledWith({
      where: { id: "user-2" },
      data: { emailNotificationsEnabled: false },
    });
  });

  /** Unsubscribe from new_proposals disables the digest toggle. */
  it("disables new proposals digest for type=new_proposals", async () => {
    const token = generateUnsubscribeToken("user-3", "new_proposals");
    mockFindUnique.mockResolvedValue({ id: "user-3", deletedAt: null } as never);
    mockUpdate.mockResolvedValue({} as never);

    const res = await GET(
      makeRequest(`https://copi.sulab.org/api/email/unsubscribe?token=${encodeURIComponent(token)}`),
    );

    expect(mockUpdate).toHaveBeenCalledWith({
      where: { id: "user-3" },
      data: { notifyNewProposals: false },
    });
  });

  /** Unsubscribe from profile_refresh disables the refresh toggle. */
  it("disables profile refresh for type=profile_refresh", async () => {
    const token = generateUnsubscribeToken("user-4", "profile_refresh");
    mockFindUnique.mockResolvedValue({ id: "user-4", deletedAt: null } as never);
    mockUpdate.mockResolvedValue({} as never);

    const res = await GET(
      makeRequest(`https://copi.sulab.org/api/email/unsubscribe?token=${encodeURIComponent(token)}`),
    );

    expect(mockUpdate).toHaveBeenCalledWith({
      where: { id: "user-4" },
      data: { notifyProfileRefresh: false },
    });
  });

  /** URL-encoded tokens should be handled correctly. */
  it("handles URL-encoded tokens", async () => {
    const token = generateUnsubscribeToken("user-5", "matches");
    const encoded = encodeURIComponent(token);
    mockFindUnique.mockResolvedValue({ id: "user-5", deletedAt: null } as never);
    mockUpdate.mockResolvedValue({} as never);

    const res = await GET(
      makeRequest(`https://copi.sulab.org/api/email/unsubscribe?token=${encoded}`),
    );

    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toContain("status=success");
  });
});
