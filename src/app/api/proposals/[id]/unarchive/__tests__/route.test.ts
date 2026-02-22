/**
 * Tests for POST /api/proposals/[id]/unarchive — Move archived proposal to interested.
 *
 * Validates: authentication, authorization (user must be on proposal),
 * proposal not found (404), no archive swipe found (400), successful unarchive
 * (swipe direction updated), match detection when other user already interested,
 * visibility flip from pending_other_interest → visible, and perspective
 * correctness from both researcher A and B sides.
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
      findUnique: jest.fn(),
      update: jest.fn(),
    },
    swipe: {
      update: jest.fn(),
    },
    match: {
      create: jest.fn(),
    },
  },
}));

import { getServerSession } from "next-auth";
import { prisma } from "@/lib/prisma";

const mockGetServerSession = jest.mocked(getServerSession);
const mockFindUnique = jest.mocked(prisma.collaborationProposal.findUnique);
const mockProposalUpdate = jest.mocked(prisma.collaborationProposal.update);
const mockSwipeUpdate = jest.mocked(prisma.swipe.update);
const mockMatchCreate = jest.mocked(prisma.match.create);

const { POST } = require("../route");

/** Helper: create a mock proposal with swipes for the unarchive route. */
function makeProposal(overrides: Record<string, unknown> = {}) {
  return {
    id: "proposal-1",
    researcherAId: "user-aaa",
    researcherBId: "user-zzz",
    visibilityA: "visible",
    visibilityB: "visible",
    swipes: [
      { id: "swipe-1", userId: "user-aaa", direction: "archive" },
    ],
    ...overrides,
  };
}

/** Helper: build a Next.js-style request + params pair for the route handler. */
function makeRouteArgs(proposalId: string) {
  const request = new Request(
    `http://localhost/api/proposals/${proposalId}/unarchive`,
    { method: "POST" }
  );
  const params = Promise.resolve({ id: proposalId });
  return [request, { params }] as const;
}

describe("POST /api/proposals/[id]/unarchive", () => {
  beforeEach(() => jest.clearAllMocks());

  // --- Authentication & Authorization ---

  it("returns 401 when not authenticated", async () => {
    /** Unauthenticated requests must be rejected. */
    mockGetServerSession.mockResolvedValue(null);
    const res = await POST(...makeRouteArgs("proposal-1"));
    expect(res.status).toBe(401);
  });

  it("returns 404 when proposal does not exist", async () => {
    /** Unarchiving a non-existent proposal returns 404. */
    mockGetServerSession.mockResolvedValue({ user: { id: "user-aaa" } });
    mockFindUnique.mockResolvedValue(null);

    const res = await POST(...makeRouteArgs("nonexistent"));
    expect(res.status).toBe(404);
  });

  it("returns 403 when user is not part of the proposal", async () => {
    /** Users not involved in the proposal cannot unarchive it. */
    mockGetServerSession.mockResolvedValue({ user: { id: "user-stranger" } });
    mockFindUnique.mockResolvedValue(makeProposal() as never);

    const res = await POST(...makeRouteArgs("proposal-1"));
    expect(res.status).toBe(403);
  });

  // --- Precondition: Must have archive swipe ---

  it("returns 400 when user has no swipe on this proposal", async () => {
    /** User cannot unarchive if they haven't swiped at all. */
    mockGetServerSession.mockResolvedValue({ user: { id: "user-aaa" } });
    mockFindUnique.mockResolvedValue(
      makeProposal({ swipes: [] }) as never
    );

    const res = await POST(...makeRouteArgs("proposal-1"));
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toContain("No archived swipe");
  });

  it("returns 400 when user already swiped interested (not archive)", async () => {
    /** User cannot unarchive a proposal they already marked interested. */
    mockGetServerSession.mockResolvedValue({ user: { id: "user-aaa" } });
    mockFindUnique.mockResolvedValue(
      makeProposal({
        swipes: [
          { id: "swipe-1", userId: "user-aaa", direction: "interested" },
        ],
      }) as never
    );

    const res = await POST(...makeRouteArgs("proposal-1"));
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toContain("No archived swipe");
  });

  // --- Successful Unarchive (No Match) ---

  it("updates swipe direction from archive to interested", async () => {
    /** Basic unarchive: swipe direction changes to interested, no match. */
    mockGetServerSession.mockResolvedValue({ user: { id: "user-aaa" } });
    mockFindUnique.mockResolvedValue(makeProposal() as never);
    mockSwipeUpdate.mockResolvedValue({
      id: "swipe-1",
      direction: "interested",
      viewedDetail: false,
      timeSpentMs: 2000,
    } as never);

    const res = await POST(...makeRouteArgs("proposal-1"));
    expect(res.status).toBe(200);
    const data = await res.json();

    expect(data.swipe.direction).toBe("interested");
    expect(data.matched).toBe(false);
    expect(data.matchId).toBeUndefined();

    // Swipe was updated correctly
    expect(mockSwipeUpdate).toHaveBeenCalledWith({
      where: { id: "swipe-1" },
      data: { direction: "interested" },
    });

    // No match created
    expect(mockMatchCreate).not.toHaveBeenCalled();
  });

  // --- Unarchive with Match ---

  it("creates match when other user already swiped interested", async () => {
    /** When unarchiving and the other user already swiped interested,
     *  a Match record is created — same logic as initial interested swipe. */
    mockGetServerSession.mockResolvedValue({ user: { id: "user-aaa" } });
    mockFindUnique.mockResolvedValue(
      makeProposal({
        swipes: [
          { id: "swipe-1", userId: "user-aaa", direction: "archive" },
          { id: "swipe-2", userId: "user-zzz", direction: "interested" },
        ],
      }) as never
    );
    mockSwipeUpdate.mockResolvedValue({
      id: "swipe-1",
      direction: "interested",
      viewedDetail: false,
      timeSpentMs: null,
    } as never);
    mockMatchCreate.mockResolvedValue({
      id: "match-1",
      proposalId: "proposal-1",
    } as never);

    const res = await POST(...makeRouteArgs("proposal-1"));
    const data = await res.json();

    expect(data.matched).toBe(true);
    expect(data.matchId).toBe("match-1");
    expect(mockMatchCreate).toHaveBeenCalledWith({
      data: { proposalId: "proposal-1" },
    });
  });

  it("does not create match when other user archived", async () => {
    /** If the other user also archived, no match is created. */
    mockGetServerSession.mockResolvedValue({ user: { id: "user-aaa" } });
    mockFindUnique.mockResolvedValue(
      makeProposal({
        swipes: [
          { id: "swipe-1", userId: "user-aaa", direction: "archive" },
          { id: "swipe-2", userId: "user-zzz", direction: "archive" },
        ],
      }) as never
    );
    mockSwipeUpdate.mockResolvedValue({
      id: "swipe-1",
      direction: "interested",
      viewedDetail: false,
      timeSpentMs: null,
    } as never);

    const res = await POST(...makeRouteArgs("proposal-1"));
    const data = await res.json();

    expect(data.matched).toBe(false);
    expect(mockMatchCreate).not.toHaveBeenCalled();
  });

  // --- Visibility Transitions ---

  it("flips other user visibility from pending_other_interest to visible", async () => {
    /** When unarchiving and B's visibility is pending_other_interest,
     *  it should be flipped to visible. */
    mockGetServerSession.mockResolvedValue({ user: { id: "user-aaa" } });
    mockFindUnique.mockResolvedValue(
      makeProposal({
        visibilityB: "pending_other_interest",
      }) as never
    );
    mockSwipeUpdate.mockResolvedValue({
      id: "swipe-1",
      direction: "interested",
      viewedDetail: false,
      timeSpentMs: null,
    } as never);

    await POST(...makeRouteArgs("proposal-1"));

    expect(mockProposalUpdate).toHaveBeenCalledWith({
      where: { id: "proposal-1" },
      data: { visibilityB: "visible" },
    });
  });

  it("does not change visibility when other user is already visible", async () => {
    /** No update needed when visibility is already "visible". */
    mockGetServerSession.mockResolvedValue({ user: { id: "user-aaa" } });
    mockFindUnique.mockResolvedValue(
      makeProposal({ visibilityB: "visible" }) as never
    );
    mockSwipeUpdate.mockResolvedValue({
      id: "swipe-1",
      direction: "interested",
      viewedDetail: false,
      timeSpentMs: null,
    } as never);

    await POST(...makeRouteArgs("proposal-1"));

    expect(mockProposalUpdate).not.toHaveBeenCalled();
  });

  // --- Researcher B perspective ---

  it("works correctly from researcher B perspective", async () => {
    /** User B unarchives: match detection checks A's swipe,
     *  visibility check uses A's visibility field. */
    mockGetServerSession.mockResolvedValue({ user: { id: "user-zzz" } });
    mockFindUnique.mockResolvedValue(
      makeProposal({
        visibilityA: "pending_other_interest",
        swipes: [
          { id: "swipe-b", userId: "user-zzz", direction: "archive" },
          { id: "swipe-a", userId: "user-aaa", direction: "interested" },
        ],
      }) as never
    );
    mockSwipeUpdate.mockResolvedValue({
      id: "swipe-b",
      direction: "interested",
      viewedDetail: true,
      timeSpentMs: 5000,
    } as never);
    mockMatchCreate.mockResolvedValue({
      id: "match-2",
      proposalId: "proposal-1",
    } as never);

    const res = await POST(...makeRouteArgs("proposal-1"));
    const data = await res.json();

    // Match created since A already swiped interested
    expect(data.matched).toBe(true);
    expect(data.matchId).toBe("match-2");

    // Visibility A flipped from pending_other_interest to visible
    expect(mockProposalUpdate).toHaveBeenCalledWith({
      where: { id: "proposal-1" },
      data: { visibilityA: "visible" },
    });
  });

  // --- Unarchive + Match + Visibility flip combined ---

  it("creates match AND flips visibility in a single unarchive", async () => {
    /** Edge case: other user swiped interested AND their visibility was
     *  pending_other_interest. Both operations happen. */
    mockGetServerSession.mockResolvedValue({ user: { id: "user-aaa" } });
    mockFindUnique.mockResolvedValue(
      makeProposal({
        visibilityB: "pending_other_interest",
        swipes: [
          { id: "swipe-1", userId: "user-aaa", direction: "archive" },
          { id: "swipe-2", userId: "user-zzz", direction: "interested" },
        ],
      }) as never
    );
    mockSwipeUpdate.mockResolvedValue({
      id: "swipe-1",
      direction: "interested",
      viewedDetail: false,
      timeSpentMs: null,
    } as never);
    mockMatchCreate.mockResolvedValue({
      id: "match-3",
      proposalId: "proposal-1",
    } as never);

    const res = await POST(...makeRouteArgs("proposal-1"));
    const data = await res.json();

    expect(data.matched).toBe(true);
    expect(data.matchId).toBe("match-3");
    expect(mockMatchCreate).toHaveBeenCalled();
    expect(mockProposalUpdate).toHaveBeenCalledWith({
      where: { id: "proposal-1" },
      data: { visibilityB: "visible" },
    });
  });
});
