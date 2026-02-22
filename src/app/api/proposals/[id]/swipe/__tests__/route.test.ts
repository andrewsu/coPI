/**
 * Tests for POST /api/proposals/[id]/swipe — Record swipe actions.
 *
 * Validates: authentication, authorization (user must be on proposal),
 * request body validation, duplicate swipe prevention (409), interested
 * swipe with match detection, archive swipe, visibility state transitions
 * (pending_other_interest → visible on interested swipe), and analytics
 * tracking (viewedDetail, timeSpentMs).
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
      create: jest.fn(),
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
const mockSwipeCreate = jest.mocked(prisma.swipe.create);
const mockMatchCreate = jest.mocked(prisma.match.create);

const { POST } = require("../route");

/** Helper: create a mock proposal with swipes array for the swipe route. */
function makeProposal(overrides: Record<string, unknown> = {}) {
  return {
    id: "proposal-1",
    researcherAId: "user-aaa",
    researcherBId: "user-zzz",
    visibilityA: "visible",
    visibilityB: "visible",
    swipes: [],
    ...overrides,
  };
}

/** Helper: build a Next.js-style request + params pair for the route handler. */
function makeRouteArgs(
  proposalId: string,
  body: Record<string, unknown>
) {
  const request = new Request(
    `http://localhost/api/proposals/${proposalId}/swipe`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }
  );
  const params = Promise.resolve({ id: proposalId });
  return [request, { params }] as const;
}

describe("POST /api/proposals/[id]/swipe", () => {
  beforeEach(() => jest.clearAllMocks());

  // --- Authentication & Authorization ---

  it("returns 401 when not authenticated", async () => {
    /** Unauthenticated requests must be rejected. */
    mockGetServerSession.mockResolvedValue(null);
    const res = await POST(
      ...makeRouteArgs("proposal-1", {
        direction: "interested",
        viewedDetail: true,
      })
    );
    expect(res.status).toBe(401);
  });

  it("returns 404 when proposal does not exist", async () => {
    /** Swiping on a non-existent proposal returns 404. */
    mockGetServerSession.mockResolvedValue({ user: { id: "user-aaa" } });
    mockFindUnique.mockResolvedValue(null);

    const res = await POST(
      ...makeRouteArgs("nonexistent", {
        direction: "interested",
        viewedDetail: false,
      })
    );
    expect(res.status).toBe(404);
  });

  it("returns 403 when user is not part of the proposal", async () => {
    /** Users who are neither researcher A nor B cannot swipe. */
    mockGetServerSession.mockResolvedValue({ user: { id: "user-stranger" } });
    mockFindUnique.mockResolvedValue(makeProposal() as never);

    const res = await POST(
      ...makeRouteArgs("proposal-1", {
        direction: "archive",
        viewedDetail: false,
      })
    );
    expect(res.status).toBe(403);
  });

  // --- Request Validation ---

  it("returns 400 for missing direction", async () => {
    /** direction is a required field. */
    mockGetServerSession.mockResolvedValue({ user: { id: "user-aaa" } });

    const res = await POST(
      ...makeRouteArgs("proposal-1", { viewedDetail: true })
    );
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toContain("direction");
  });

  it("returns 400 for invalid direction value", async () => {
    /** direction must be 'interested' or 'archive'. */
    mockGetServerSession.mockResolvedValue({ user: { id: "user-aaa" } });

    const res = await POST(
      ...makeRouteArgs("proposal-1", {
        direction: "maybe",
        viewedDetail: true,
      })
    );
    expect(res.status).toBe(400);
  });

  it("returns 400 for missing viewedDetail", async () => {
    /** viewedDetail is a required boolean field. */
    mockGetServerSession.mockResolvedValue({ user: { id: "user-aaa" } });

    const res = await POST(
      ...makeRouteArgs("proposal-1", { direction: "interested" })
    );
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toContain("viewedDetail");
  });

  it("returns 400 for invalid request body (non-JSON)", async () => {
    /** Non-JSON body should return 400. */
    mockGetServerSession.mockResolvedValue({ user: { id: "user-aaa" } });

    const request = new Request(
      "http://localhost/api/proposals/proposal-1/swipe",
      {
        method: "POST",
        headers: { "Content-Type": "text/plain" },
        body: "not json",
      }
    );
    const params = Promise.resolve({ id: "proposal-1" });
    const res = await POST(request, { params });
    expect(res.status).toBe(400);
  });

  it("returns 400 for negative timeSpentMs", async () => {
    /** timeSpentMs must be non-negative. */
    mockGetServerSession.mockResolvedValue({ user: { id: "user-aaa" } });

    const res = await POST(
      ...makeRouteArgs("proposal-1", {
        direction: "interested",
        viewedDetail: true,
        timeSpentMs: -100,
      })
    );
    expect(res.status).toBe(400);
  });

  // --- Duplicate Swipe Prevention ---

  it("returns 409 when user has already swiped on this proposal", async () => {
    /** Unique constraint on (userId, proposalId) — only one swipe allowed. */
    mockGetServerSession.mockResolvedValue({ user: { id: "user-aaa" } });
    mockFindUnique.mockResolvedValue(
      makeProposal({
        swipes: [{ userId: "user-aaa", direction: "archive" }],
      }) as never
    );

    const res = await POST(
      ...makeRouteArgs("proposal-1", {
        direction: "interested",
        viewedDetail: false,
      })
    );
    expect(res.status).toBe(409);
    const data = await res.json();
    expect(data.error).toContain("Already swiped");
  });

  // --- Interested Swipe (No Match) ---

  it("creates an interested swipe when no prior swipe from other user", async () => {
    /** Basic interested swipe: creates Swipe record, no match created. */
    mockGetServerSession.mockResolvedValue({ user: { id: "user-aaa" } });
    mockFindUnique.mockResolvedValue(makeProposal() as never);
    mockSwipeCreate.mockResolvedValue({
      id: "swipe-1",
      direction: "interested",
      viewedDetail: true,
      timeSpentMs: 5000,
    } as never);

    const res = await POST(
      ...makeRouteArgs("proposal-1", {
        direction: "interested",
        viewedDetail: true,
        timeSpentMs: 5000,
      })
    );
    expect(res.status).toBe(200);
    const data = await res.json();

    expect(data.swipe.direction).toBe("interested");
    expect(data.swipe.viewedDetail).toBe(true);
    expect(data.swipe.timeSpentMs).toBe(5000);
    expect(data.matched).toBe(false);
    expect(data.matchId).toBeUndefined();

    // Swipe was created with correct data
    expect(mockSwipeCreate).toHaveBeenCalledWith({
      data: {
        userId: "user-aaa",
        proposalId: "proposal-1",
        direction: "interested",
        viewedDetail: true,
        timeSpentMs: 5000,
      },
    });

    // No match created
    expect(mockMatchCreate).not.toHaveBeenCalled();
  });

  // --- Interested Swipe (Match Created) ---

  it("creates a match when both users swipe interested", async () => {
    /** When the other user already swiped interested, a Match record is
     *  created and matched=true is returned. */
    mockGetServerSession.mockResolvedValue({ user: { id: "user-aaa" } });
    mockFindUnique.mockResolvedValue(
      makeProposal({
        swipes: [{ userId: "user-zzz", direction: "interested" }],
      }) as never
    );
    mockSwipeCreate.mockResolvedValue({
      id: "swipe-2",
      direction: "interested",
      viewedDetail: false,
      timeSpentMs: null,
    } as never);
    mockMatchCreate.mockResolvedValue({
      id: "match-1",
      proposalId: "proposal-1",
    } as never);

    const res = await POST(
      ...makeRouteArgs("proposal-1", {
        direction: "interested",
        viewedDetail: false,
      })
    );
    const data = await res.json();

    expect(data.matched).toBe(true);
    expect(data.matchId).toBe("match-1");
    expect(mockMatchCreate).toHaveBeenCalledWith({
      data: { proposalId: "proposal-1" },
    });
  });

  it("does not create match when other user archived", async () => {
    /** Even if the other user has swiped, if their direction was "archive"
     *  no match is created. */
    mockGetServerSession.mockResolvedValue({ user: { id: "user-aaa" } });
    mockFindUnique.mockResolvedValue(
      makeProposal({
        swipes: [{ userId: "user-zzz", direction: "archive" }],
      }) as never
    );
    mockSwipeCreate.mockResolvedValue({
      id: "swipe-3",
      direction: "interested",
      viewedDetail: true,
      timeSpentMs: 3000,
    } as never);

    const res = await POST(
      ...makeRouteArgs("proposal-1", {
        direction: "interested",
        viewedDetail: true,
        timeSpentMs: 3000,
      })
    );
    const data = await res.json();

    expect(data.matched).toBe(false);
    expect(mockMatchCreate).not.toHaveBeenCalled();
  });

  // --- Visibility Transitions ---

  it("flips other user visibility from pending_other_interest to visible on interested swipe", async () => {
    /** When user A swipes interested and B's visibility is pending_other_interest,
     *  B's visibility should be flipped to "visible" so the proposal appears
     *  in B's swipe queue. */
    mockGetServerSession.mockResolvedValue({ user: { id: "user-aaa" } });
    mockFindUnique.mockResolvedValue(
      makeProposal({
        visibilityB: "pending_other_interest",
      }) as never
    );
    mockSwipeCreate.mockResolvedValue({
      id: "swipe-4",
      direction: "interested",
      viewedDetail: false,
      timeSpentMs: null,
    } as never);

    await POST(
      ...makeRouteArgs("proposal-1", {
        direction: "interested",
        viewedDetail: false,
      })
    );

    expect(mockProposalUpdate).toHaveBeenCalledWith({
      where: { id: "proposal-1" },
      data: { visibilityB: "visible" },
    });
  });

  it("flips researcher A visibility when user B swipes interested", async () => {
    /** When user B swipes interested and A's visibility is pending_other_interest,
     *  A's visibility should be flipped to "visible". */
    mockGetServerSession.mockResolvedValue({ user: { id: "user-zzz" } });
    mockFindUnique.mockResolvedValue(
      makeProposal({
        visibilityA: "pending_other_interest",
      }) as never
    );
    mockSwipeCreate.mockResolvedValue({
      id: "swipe-5",
      direction: "interested",
      viewedDetail: true,
      timeSpentMs: 8000,
    } as never);

    await POST(
      ...makeRouteArgs("proposal-1", {
        direction: "interested",
        viewedDetail: true,
        timeSpentMs: 8000,
      })
    );

    expect(mockProposalUpdate).toHaveBeenCalledWith({
      where: { id: "proposal-1" },
      data: { visibilityA: "visible" },
    });
  });

  it("does not change visibility when other user is already visible", async () => {
    /** No update needed when the other user's visibility is already "visible". */
    mockGetServerSession.mockResolvedValue({ user: { id: "user-aaa" } });
    mockFindUnique.mockResolvedValue(
      makeProposal({ visibilityB: "visible" }) as never
    );
    mockSwipeCreate.mockResolvedValue({
      id: "swipe-6",
      direction: "interested",
      viewedDetail: false,
      timeSpentMs: null,
    } as never);

    await POST(
      ...makeRouteArgs("proposal-1", {
        direction: "interested",
        viewedDetail: false,
      })
    );

    expect(mockProposalUpdate).not.toHaveBeenCalled();
  });

  // --- Archive Swipe ---

  it("creates an archive swipe without visibility changes", async () => {
    /** Archive swipe: creates Swipe record, no match check, no visibility changes.
     *  Per spec, if other user's visibility is pending_other_interest, it stays. */
    mockGetServerSession.mockResolvedValue({ user: { id: "user-aaa" } });
    mockFindUnique.mockResolvedValue(
      makeProposal({
        visibilityB: "pending_other_interest",
      }) as never
    );
    mockSwipeCreate.mockResolvedValue({
      id: "swipe-7",
      direction: "archive",
      viewedDetail: false,
      timeSpentMs: 2000,
    } as never);

    const res = await POST(
      ...makeRouteArgs("proposal-1", {
        direction: "archive",
        viewedDetail: false,
        timeSpentMs: 2000,
      })
    );
    const data = await res.json();

    expect(data.swipe.direction).toBe("archive");
    expect(data.matched).toBe(false);
    // No visibility change for archive — pending_other_interest stays
    expect(mockProposalUpdate).not.toHaveBeenCalled();
    // No match check for archive
    expect(mockMatchCreate).not.toHaveBeenCalled();
  });

  // --- Analytics ---

  it("records timeSpentMs as null when not provided", async () => {
    /** timeSpentMs is optional — should be stored as null when omitted. */
    mockGetServerSession.mockResolvedValue({ user: { id: "user-aaa" } });
    mockFindUnique.mockResolvedValue(makeProposal() as never);
    mockSwipeCreate.mockResolvedValue({
      id: "swipe-8",
      direction: "archive",
      viewedDetail: false,
      timeSpentMs: null,
    } as never);

    await POST(
      ...makeRouteArgs("proposal-1", {
        direction: "archive",
        viewedDetail: false,
      })
    );

    expect(mockSwipeCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({ timeSpentMs: null }),
    });
  });

  // --- Interested swipe + visibility flip + match in one operation ---

  it("creates match AND flips visibility in a single interested swipe", async () => {
    /** Edge case: other user swiped interested AND their visibility was
     *  pending_other_interest. Both match creation and visibility flip happen. */
    mockGetServerSession.mockResolvedValue({ user: { id: "user-aaa" } });
    mockFindUnique.mockResolvedValue(
      makeProposal({
        visibilityB: "pending_other_interest",
        swipes: [{ userId: "user-zzz", direction: "interested" }],
      }) as never
    );
    mockSwipeCreate.mockResolvedValue({
      id: "swipe-9",
      direction: "interested",
      viewedDetail: true,
      timeSpentMs: 10000,
    } as never);
    mockMatchCreate.mockResolvedValue({
      id: "match-2",
      proposalId: "proposal-1",
    } as never);

    const res = await POST(
      ...makeRouteArgs("proposal-1", {
        direction: "interested",
        viewedDetail: true,
        timeSpentMs: 10000,
      })
    );
    const data = await res.json();

    expect(data.matched).toBe(true);
    expect(data.matchId).toBe("match-2");
    expect(mockMatchCreate).toHaveBeenCalled();
    expect(mockProposalUpdate).toHaveBeenCalledWith({
      where: { id: "proposal-1" },
      data: { visibilityB: "visible" },
    });
  });

  // --- Researcher B perspective ---

  it("works correctly from researcher B perspective", async () => {
    /** User B swipes interested, match detection checks A's swipe,
     *  visibility check uses A's visibility field. */
    mockGetServerSession.mockResolvedValue({ user: { id: "user-zzz" } });
    mockFindUnique.mockResolvedValue(
      makeProposal({
        swipes: [{ userId: "user-aaa", direction: "interested" }],
        visibilityA: "visible",
      }) as never
    );
    mockSwipeCreate.mockResolvedValue({
      id: "swipe-10",
      direction: "interested",
      viewedDetail: true,
      timeSpentMs: 7000,
    } as never);
    mockMatchCreate.mockResolvedValue({
      id: "match-3",
      proposalId: "proposal-1",
    } as never);

    const res = await POST(
      ...makeRouteArgs("proposal-1", {
        direction: "interested",
        viewedDetail: true,
        timeSpentMs: 7000,
      })
    );
    const data = await res.json();

    expect(data.matched).toBe(true);
    expect(data.matchId).toBe("match-3");
    // No visibility update needed since A is already visible
    expect(mockProposalUpdate).not.toHaveBeenCalled();
  });
});
