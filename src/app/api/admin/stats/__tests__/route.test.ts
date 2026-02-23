/**
 * Tests for GET /api/admin/stats.
 *
 * Validates: admin authorization, summary statistics computation,
 * funnel data aggregation, matching results with researcher info,
 * generation rate calculation, and outcome filter support.
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
    user: {
      count: jest.fn(),
    },
    collaborationProposal: {
      count: jest.fn(),
    },
    match: {
      count: jest.fn(),
    },
    matchingResult: {
      findMany: jest.fn(),
    },
    swipe: {
      count: jest.fn(),
    },
  },
}));

import { getServerSession } from "next-auth";
import { prisma } from "@/lib/prisma";

const mockGetServerSession = jest.mocked(getServerSession);
const mockUserCount = jest.mocked(prisma.user.count);
const mockProposalCount = jest.mocked(prisma.collaborationProposal.count);
const mockMatchCount = jest.mocked(prisma.match.count);
const mockMatchingResultFindMany = jest.mocked(prisma.matchingResult.findMany);
const mockSwipeCount = jest.mocked(prisma.swipe.count);

const { GET } = require("../route");

function makeRequest(params: Record<string, string> = {}): {
  nextUrl: { searchParams: URLSearchParams };
} {
  return { nextUrl: { searchParams: new URLSearchParams(params) } };
}

/** Sets up all count/findMany mocks with reasonable defaults. */
function setupMocks(overrides: {
  totalUsers?: number;
  claimedUsers?: number;
  totalProposals?: number;
  totalMatches?: number;
  interestedSwipes?: number;
  proposalsWithInterestedSwipe?: number;
  matchingResults?: Array<Record<string, unknown>>;
} = {}) {
  // prisma.user.count is called twice with different where clauses
  mockUserCount
    .mockResolvedValueOnce(overrides.totalUsers ?? 10) // total users
    .mockResolvedValueOnce(overrides.claimedUsers ?? 7); // claimed users

  mockProposalCount
    .mockResolvedValueOnce(overrides.totalProposals ?? 25) // total proposals
    .mockResolvedValueOnce(overrides.proposalsWithInterestedSwipe ?? 15); // proposals with interested swipe

  mockMatchCount.mockResolvedValue(overrides.totalMatches ?? 5);

  mockMatchingResultFindMany.mockResolvedValue(
    (overrides.matchingResults ?? [
      {
        id: "mr-1",
        outcome: "proposals_generated",
        profileVersionA: 1,
        profileVersionB: 1,
        evaluatedAt: new Date("2026-01-20"),
        researcherA: { id: "user-1", name: "Dr. Alice", institution: "MIT" },
        researcherB: { id: "user-2", name: "Dr. Bob", institution: "Stanford" },
      },
      {
        id: "mr-2",
        outcome: "no_proposal",
        profileVersionA: 1,
        profileVersionB: 2,
        evaluatedAt: new Date("2026-01-21"),
        researcherA: { id: "user-1", name: "Dr. Alice", institution: "MIT" },
        researcherB: { id: "user-3", name: "Dr. Carol", institution: "Harvard" },
      },
    ]) as never,
  );

  mockSwipeCount.mockResolvedValue(overrides.interestedSwipes ?? 30);
}

describe("GET /api/admin/stats", () => {
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

  it("returns summary statistics for admin", async () => {
    /** Summary cards include total users, claimed/seeded breakdown, proposals, and matches. */
    mockGetServerSession.mockResolvedValue({
      user: { id: "admin-1", isAdmin: true },
    });
    setupMocks({ totalUsers: 10, claimedUsers: 7, totalProposals: 25, totalMatches: 5 });

    const res = await GET(makeRequest());
    expect(res.status).toBe(200);
    const data = await res.json();

    expect(data.summary).toMatchObject({
      totalUsers: 10,
      claimedUsers: 7,
      seededUsers: 3,
      totalProposals: 25,
      totalMatches: 5,
    });
  });

  it("computes generation rate from matching results", async () => {
    /** generationRate = pairs with proposals / total pairs evaluated. */
    mockGetServerSession.mockResolvedValue({
      user: { id: "admin-1", isAdmin: true },
    });
    setupMocks(); // 2 matching results: 1 proposals_generated, 1 no_proposal

    const res = await GET(makeRequest());
    const data = await res.json();

    // 1 out of 2 = 0.5
    expect(data.summary.generationRate).toBe(0.5);
  });

  it("handles zero pairs evaluated without division by zero", async () => {
    /** When no pairs have been evaluated, generationRate is 0 (not NaN). */
    mockGetServerSession.mockResolvedValue({
      user: { id: "admin-1", isAdmin: true },
    });
    setupMocks({ matchingResults: [] });

    const res = await GET(makeRequest());
    const data = await res.json();
    expect(data.summary.generationRate).toBe(0);
  });

  it("returns funnel data with correct metrics", async () => {
    /** Funnel tracks conversion: evaluated → proposals → interested → matches. */
    mockGetServerSession.mockResolvedValue({
      user: { id: "admin-1", isAdmin: true },
    });
    setupMocks({
      totalProposals: 25,
      totalMatches: 5,
      interestedSwipes: 30,
      proposalsWithInterestedSwipe: 15,
    });

    const res = await GET(makeRequest());
    const data = await res.json();

    expect(data.funnel).toMatchObject({
      pairsEvaluated: 2, // from matchingResults length
      proposalsGenerated: 25,
      proposalsWithInterestedSwipe: 15,
      interestedSwipes: 30,
      mutualMatches: 5,
    });
  });

  it("returns matching results with researcher info", async () => {
    /** MatchingResult records include researcher names and evaluation details. */
    mockGetServerSession.mockResolvedValue({
      user: { id: "admin-1", isAdmin: true },
    });
    setupMocks();

    const res = await GET(makeRequest());
    const data = await res.json();

    expect(data.matchingResults).toHaveLength(2);
    expect(data.matchingResultsCount).toBe(2);
    expect(data.matchingResults[0]).toMatchObject({
      id: "mr-1",
      outcome: "proposals_generated",
      researcherA: { name: "Dr. Alice" },
      researcherB: { name: "Dr. Bob" },
    });
  });

  it("passes outcome filter to matching results query", async () => {
    /** Outcome filter restricts matching results to the specified outcome type. */
    mockGetServerSession.mockResolvedValue({
      user: { id: "admin-1", isAdmin: true },
    });
    setupMocks({
      matchingResults: [
        {
          id: "mr-1",
          outcome: "proposals_generated",
          profileVersionA: 1,
          profileVersionB: 1,
          evaluatedAt: new Date("2026-01-20"),
          researcherA: { id: "user-1", name: "Dr. Alice", institution: "MIT" },
          researcherB: { id: "user-2", name: "Dr. Bob", institution: "Stanford" },
        },
      ],
    });

    await GET(makeRequest({ outcome: "proposals_generated" }));

    expect(mockMatchingResultFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          outcome: "proposals_generated",
        }),
      }),
    );
  });

  it("excludes deleted users from total count", async () => {
    /** User counts filter out deleted users (deletedAt != null). */
    mockGetServerSession.mockResolvedValue({
      user: { id: "admin-1", isAdmin: true },
    });
    setupMocks();

    await GET(makeRequest());

    // First call: total users
    expect(mockUserCount).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ deletedAt: null }),
      }),
    );
    // Second call: claimed users
    expect(mockUserCount).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          deletedAt: null,
          claimedAt: { not: null },
        }),
      }),
    );
  });
});
