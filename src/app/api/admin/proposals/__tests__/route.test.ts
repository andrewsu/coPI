/**
 * Tests for GET /api/admin/proposals.
 *
 * Validates: admin authorization, full proposal list with swipe/match status,
 * and query param filters (confidenceTier, matchStatus, swipeStatus, visibility).
 */

/* eslint-disable @typescript-eslint/no-require-imports */

jest.mock("next-auth", () => ({
  getServerSession: jest.fn(),
}));
jest.mock("@/lib/auth", () => ({
  authOptions: {},
}));
jest.mock("@/lib/prisma", () => ({
  prisma: {
    collaborationProposal: {
      findMany: jest.fn(),
    },
  },
}));

import { getServerSession } from "next-auth";
import { prisma } from "@/lib/prisma";

const mockGetServerSession = jest.mocked(getServerSession);
const mockFindMany = jest.mocked(prisma.collaborationProposal.findMany);

const { GET } = require("../route");

function makeRequest(params: Record<string, string> = {}): {
  nextUrl: { searchParams: URLSearchParams };
} {
  return { nextUrl: { searchParams: new URLSearchParams(params) } };
}

/** Factory for a mock proposal row with relations. */
function mockProposal(overrides: Record<string, unknown> = {}) {
  return {
    id: "prop-1",
    researcherAId: "user-1",
    researcherBId: "user-2",
    title: "CRISPR Collaboration",
    collaborationType: "complementary_expertise",
    confidenceTier: "high",
    visibilityA: "visible",
    visibilityB: "visible",
    createdAt: new Date("2026-01-25"),
    researcherA: { id: "user-1", name: "Dr. Alice", institution: "MIT" },
    researcherB: { id: "user-2", name: "Dr. Bob", institution: "Stanford" },
    swipes: [],
    matches: [],
    ...overrides,
  };
}

describe("GET /api/admin/proposals", () => {
  beforeEach(() => jest.clearAllMocks());

  it("returns 403 when not authenticated", async () => {
    /** Unauthenticated requests must be rejected. */
    mockGetServerSession.mockResolvedValue(null);
    const res = await GET(makeRequest());
    expect(res.status).toBe(403);
  });

  it("returns 403 when user is not admin", async () => {
    /** Non-admin users must be rejected. */
    mockGetServerSession.mockResolvedValue({
      user: { id: "user-1", isAdmin: false },
    });
    const res = await GET(makeRequest());
    expect(res.status).toBe(403);
  });

  it("returns all proposals with computed swipe and match status", async () => {
    /** Admin users receive proposal list with swipe/match data. */
    mockGetServerSession.mockResolvedValue({
      user: { id: "admin-1", isAdmin: true },
    });
    mockFindMany.mockResolvedValue([
      mockProposal({
        swipes: [
          { userId: "user-1", direction: "interested" },
          { userId: "user-2", direction: "archive" },
        ],
        matches: [{ id: "match-1" }],
      }),
    ] as never);

    const res = await GET(makeRequest());
    expect(res.status).toBe(200);
    const data = await res.json();

    expect(data.totalCount).toBe(1);
    expect(data.proposals[0]).toMatchObject({
      id: "prop-1",
      title: "CRISPR Collaboration",
      swipeA: "interested",
      swipeB: "archive",
      matched: true,
      researcherA: { name: "Dr. Alice" },
      researcherB: { name: "Dr. Bob" },
    });
  });

  it("returns null for swipes when no swipe exists", async () => {
    /** Proposals without swipes show null for both swipeA and swipeB. */
    mockGetServerSession.mockResolvedValue({
      user: { id: "admin-1", isAdmin: true },
    });
    mockFindMany.mockResolvedValue([mockProposal()] as never);

    const res = await GET(makeRequest());
    const data = await res.json();
    expect(data.proposals[0].swipeA).toBeNull();
    expect(data.proposals[0].swipeB).toBeNull();
    expect(data.proposals[0].matched).toBe(false);
  });

  it("passes confidenceTier filter to Prisma query", async () => {
    /** confidenceTier filter is applied at the database level. */
    mockGetServerSession.mockResolvedValue({
      user: { id: "admin-1", isAdmin: true },
    });
    mockFindMany.mockResolvedValue([] as never);

    await GET(makeRequest({ confidenceTier: "high" }));

    expect(mockFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          confidenceTier: "high",
        }),
      }),
    );
  });

  it("filters by matchStatus=matched (only matched proposals)", async () => {
    /** matchStatus=matched filters to proposals with at least one Match record. */
    mockGetServerSession.mockResolvedValue({
      user: { id: "admin-1", isAdmin: true },
    });
    mockFindMany.mockResolvedValue([
      mockProposal({ id: "prop-1", matches: [{ id: "match-1" }] }),
      mockProposal({ id: "prop-2", matches: [] }),
    ] as never);

    const res = await GET(makeRequest({ matchStatus: "matched" }));
    const data = await res.json();
    expect(data.totalCount).toBe(1);
    expect(data.proposals[0].id).toBe("prop-1");
  });

  it("filters by matchStatus=unmatched (only unmatched proposals)", async () => {
    /** matchStatus=unmatched excludes proposals with Match records. */
    mockGetServerSession.mockResolvedValue({
      user: { id: "admin-1", isAdmin: true },
    });
    mockFindMany.mockResolvedValue([
      mockProposal({ id: "prop-1", matches: [{ id: "match-1" }] }),
      mockProposal({ id: "prop-2", matches: [] }),
    ] as never);

    const res = await GET(makeRequest({ matchStatus: "unmatched" }));
    const data = await res.json();
    expect(data.totalCount).toBe(1);
    expect(data.proposals[0].id).toBe("prop-2");
  });

  it("filters by swipeStatus=both_swiped", async () => {
    /** both_swiped requires both researchers to have swiped. */
    mockGetServerSession.mockResolvedValue({
      user: { id: "admin-1", isAdmin: true },
    });
    mockFindMany.mockResolvedValue([
      mockProposal({
        id: "prop-1",
        swipes: [
          { userId: "user-1", direction: "interested" },
          { userId: "user-2", direction: "interested" },
        ],
      }),
      mockProposal({
        id: "prop-2",
        swipes: [{ userId: "user-1", direction: "interested" }],
      }),
    ] as never);

    const res = await GET(makeRequest({ swipeStatus: "both_swiped" }));
    const data = await res.json();
    expect(data.totalCount).toBe(1);
    expect(data.proposals[0].id).toBe("prop-1");
  });

  it("filters by swipeStatus=one_swiped", async () => {
    /** one_swiped requires exactly one researcher to have swiped. */
    mockGetServerSession.mockResolvedValue({
      user: { id: "admin-1", isAdmin: true },
    });
    mockFindMany.mockResolvedValue([
      mockProposal({
        id: "prop-1",
        swipes: [
          { userId: "user-1", direction: "interested" },
          { userId: "user-2", direction: "archive" },
        ],
      }),
      mockProposal({
        id: "prop-2",
        swipes: [{ userId: "user-1", direction: "interested" }],
      }),
      mockProposal({ id: "prop-3", swipes: [] }),
    ] as never);

    const res = await GET(makeRequest({ swipeStatus: "one_swiped" }));
    const data = await res.json();
    expect(data.totalCount).toBe(1);
    expect(data.proposals[0].id).toBe("prop-2");
  });

  it("filters by swipeStatus=neither_swiped", async () => {
    /** neither_swiped requires zero swipes on the proposal. */
    mockGetServerSession.mockResolvedValue({
      user: { id: "admin-1", isAdmin: true },
    });
    mockFindMany.mockResolvedValue([
      mockProposal({
        id: "prop-1",
        swipes: [{ userId: "user-1", direction: "interested" }],
      }),
      mockProposal({ id: "prop-2", swipes: [] }),
    ] as never);

    const res = await GET(makeRequest({ swipeStatus: "neither_swiped" }));
    const data = await res.json();
    expect(data.totalCount).toBe(1);
    expect(data.proposals[0].id).toBe("prop-2");
  });

  it("passes visibility filter to Prisma query as OR condition", async () => {
    /** visibility filter matches proposals where either side has that visibility. */
    mockGetServerSession.mockResolvedValue({
      user: { id: "admin-1", isAdmin: true },
    });
    mockFindMany.mockResolvedValue([] as never);

    await GET(makeRequest({ visibility: "pending_other_interest" }));

    expect(mockFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          OR: [
            { visibilityA: "pending_other_interest" },
            { visibilityB: "pending_other_interest" },
          ],
        }),
      }),
    );
  });
});
