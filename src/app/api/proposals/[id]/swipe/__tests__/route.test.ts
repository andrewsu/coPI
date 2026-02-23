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
      count: jest.fn(),
    },
    match: {
      create: jest.fn(),
    },
    user: {
      findUnique: jest.fn(),
    },
  },
}));
jest.mock("@/services/match-notifications", () => ({
  sendMatchNotificationEmails: jest.fn().mockResolvedValue(undefined),
}));
jest.mock("@/services/recruitment-email", () => ({
  sendRecruitmentEmailIfUnclaimed: jest.fn().mockResolvedValue({ sent: false }),
}));

import { getServerSession } from "next-auth";
import { prisma } from "@/lib/prisma";
import { sendMatchNotificationEmails } from "@/services/match-notifications";
import { sendRecruitmentEmailIfUnclaimed } from "@/services/recruitment-email";

const mockGetServerSession = jest.mocked(getServerSession);
const mockFindUnique = jest.mocked(prisma.collaborationProposal.findUnique);
const mockProposalUpdate = jest.mocked(prisma.collaborationProposal.update);
const mockSwipeCreate = jest.mocked(prisma.swipe.create);
const mockSwipeCount = jest.mocked(prisma.swipe.count);
const mockMatchCreate = jest.mocked(prisma.match.create);
const mockUserFindUnique = jest.mocked(prisma.user.findUnique);
const mockSendMatchNotifications = jest.mocked(sendMatchNotificationEmails);
const mockSendRecruitmentEmail = jest.mocked(sendRecruitmentEmailIfUnclaimed);

const { POST } = require("../route");

/** Helper: create a mock proposal with swipes array for the swipe route. */
function makeProposal(overrides: Record<string, unknown> = {}) {
  return {
    id: "proposal-1",
    researcherAId: "user-aaa",
    researcherBId: "user-zzz",
    visibilityA: "visible",
    visibilityB: "visible",
    title: "Cross-lab CRISPR screens for neurodegeneration targets",
    oneLineSummaryA: "Combine your CRISPR expertise with their neuronal models",
    oneLineSummaryB: "Combine your neuronal models with their CRISPR expertise",
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
  beforeEach(() => {
    jest.clearAllMocks();
    // Default: archive count is 1 (not a survey trigger at interval=5)
    mockSwipeCount.mockResolvedValue(1);
    // Default: users are claimed (not seeded) — invite data not returned
    mockUserFindUnique.mockResolvedValue({
      claimedAt: new Date("2025-01-01"),
      name: "Dr. Test User",
    } as never);
  });

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

  // --- Periodic Survey Trigger ---

  it("returns showSurvey=true when archive count is a multiple of SURVEY_INTERVAL", async () => {
    /** After every 5th archive action, the UI should show a quality survey.
     *  The swipe endpoint counts all archive swipes for the user and returns
     *  showSurvey=true when the count is divisible by SURVEY_INTERVAL (5). */
    mockGetServerSession.mockResolvedValue({ user: { id: "user-aaa" } });
    mockFindUnique.mockResolvedValue(makeProposal() as never);
    mockSwipeCreate.mockResolvedValue({
      id: "swipe-11",
      direction: "archive",
      viewedDetail: false,
      timeSpentMs: null,
    } as never);
    // This is the user's 5th archive swipe (multiple of SURVEY_INTERVAL)
    mockSwipeCount.mockResolvedValue(5);

    const res = await POST(
      ...makeRouteArgs("proposal-1", {
        direction: "archive",
        viewedDetail: false,
      })
    );
    const data = await res.json();

    expect(data.showSurvey).toBe(true);
    expect(mockSwipeCount).toHaveBeenCalledWith({
      where: { userId: "user-aaa", direction: "archive" },
    });
  });

  it("returns showSurvey=false when archive count is not a multiple of SURVEY_INTERVAL", async () => {
    /** Archive swipes that are not on the Nth boundary should not trigger a survey. */
    mockGetServerSession.mockResolvedValue({ user: { id: "user-aaa" } });
    mockFindUnique.mockResolvedValue(makeProposal() as never);
    mockSwipeCreate.mockResolvedValue({
      id: "swipe-12",
      direction: "archive",
      viewedDetail: false,
      timeSpentMs: null,
    } as never);
    // 3rd archive — not a multiple of 5
    mockSwipeCount.mockResolvedValue(3);

    const res = await POST(
      ...makeRouteArgs("proposal-1", {
        direction: "archive",
        viewedDetail: false,
      })
    );
    const data = await res.json();

    expect(data.showSurvey).toBe(false);
  });

  it("returns showSurvey=true on 10th archive (second survey trigger)", async () => {
    /** The survey should trigger at every multiple: 5, 10, 15, etc. */
    mockGetServerSession.mockResolvedValue({ user: { id: "user-aaa" } });
    mockFindUnique.mockResolvedValue(makeProposal() as never);
    mockSwipeCreate.mockResolvedValue({
      id: "swipe-13",
      direction: "archive",
      viewedDetail: false,
      timeSpentMs: null,
    } as never);
    mockSwipeCount.mockResolvedValue(10);

    const res = await POST(
      ...makeRouteArgs("proposal-1", {
        direction: "archive",
        viewedDetail: false,
      })
    );
    const data = await res.json();

    expect(data.showSurvey).toBe(true);
  });

  it("does not return showSurvey for interested swipes", async () => {
    /** The periodic survey only triggers on archive actions, not interested. */
    mockGetServerSession.mockResolvedValue({ user: { id: "user-aaa" } });
    mockFindUnique.mockResolvedValue(makeProposal() as never);
    mockSwipeCreate.mockResolvedValue({
      id: "swipe-14",
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
    const data = await res.json();

    // showSurvey should be false (default) — count is not called for interested
    expect(data.showSurvey).toBe(false);
    expect(mockSwipeCount).not.toHaveBeenCalled();
  });

  // --- Match Notification Emails ---

  it("triggers match notification emails when a match is created", async () => {
    /** When both users swipe interested, sendMatchNotificationEmails should
     *  be called with the prisma client, match ID, and proposal ID. */
    mockGetServerSession.mockResolvedValue({ user: { id: "user-aaa" } });
    mockFindUnique.mockResolvedValue(
      makeProposal({
        swipes: [{ userId: "user-zzz", direction: "interested" }],
      }) as never
    );
    mockSwipeCreate.mockResolvedValue({
      id: "swipe-notif",
      direction: "interested",
      viewedDetail: false,
      timeSpentMs: null,
    } as never);
    mockMatchCreate.mockResolvedValue({
      id: "match-notif",
      proposalId: "proposal-1",
    } as never);

    await POST(
      ...makeRouteArgs("proposal-1", {
        direction: "interested",
        viewedDetail: false,
      })
    );

    expect(mockSendMatchNotifications).toHaveBeenCalledWith(
      prisma,
      "match-notif",
      "proposal-1"
    );
  });

  it("does not trigger match notifications when no match is created", async () => {
    /** When only one user has swiped, no match is created and no notification
     *  should be triggered. */
    mockGetServerSession.mockResolvedValue({ user: { id: "user-aaa" } });
    mockFindUnique.mockResolvedValue(makeProposal() as never);
    mockSwipeCreate.mockResolvedValue({
      id: "swipe-no-match",
      direction: "interested",
      viewedDetail: true,
      timeSpentMs: 1000,
    } as never);

    await POST(
      ...makeRouteArgs("proposal-1", {
        direction: "interested",
        viewedDetail: true,
        timeSpentMs: 1000,
      })
    );

    expect(mockSendMatchNotifications).not.toHaveBeenCalled();
  });

  it("does not trigger match notifications for archive swipes", async () => {
    /** Archive swipes never create matches, so notifications should not fire. */
    mockGetServerSession.mockResolvedValue({ user: { id: "user-aaa" } });
    mockFindUnique.mockResolvedValue(makeProposal() as never);
    mockSwipeCreate.mockResolvedValue({
      id: "swipe-archive-notif",
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

    expect(mockSendMatchNotifications).not.toHaveBeenCalled();
  });

  // --- Recruitment Email Triggers ---

  it("triggers recruitment email for the other user on interested swipe", async () => {
    /** When user A swipes interested, the recruitment email service should be
     *  called with the other user's ID so it can check if they are unclaimed. */
    mockGetServerSession.mockResolvedValue({ user: { id: "user-aaa" } });
    mockFindUnique.mockResolvedValue(makeProposal() as never);
    mockSwipeCreate.mockResolvedValue({
      id: "swipe-recruit-1",
      direction: "interested",
      viewedDetail: true,
      timeSpentMs: 3000,
    } as never);

    await POST(
      ...makeRouteArgs("proposal-1", {
        direction: "interested",
        viewedDetail: true,
        timeSpentMs: 3000,
      })
    );

    expect(mockSendRecruitmentEmail).toHaveBeenCalledWith(
      prisma,
      "user-zzz",
      "proposal-1",
    );
  });

  it("triggers recruitment email with correct other user from B perspective", async () => {
    /** When user B swipes interested, recruitment email targets user A. */
    mockGetServerSession.mockResolvedValue({ user: { id: "user-zzz" } });
    mockFindUnique.mockResolvedValue(makeProposal() as never);
    mockSwipeCreate.mockResolvedValue({
      id: "swipe-recruit-2",
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

    expect(mockSendRecruitmentEmail).toHaveBeenCalledWith(
      prisma,
      "user-aaa",
      "proposal-1",
    );
  });

  it("does not trigger recruitment email for archive swipes", async () => {
    /** Recruitment emails are only sent on "interested" swipes, not archives.
     *  Per spec: trigger is "A user swipes interested on a proposal involving
     *  a seeded-but-unclaimed researcher." */
    mockGetServerSession.mockResolvedValue({ user: { id: "user-aaa" } });
    mockFindUnique.mockResolvedValue(makeProposal() as never);
    mockSwipeCreate.mockResolvedValue({
      id: "swipe-recruit-archive",
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

    expect(mockSendRecruitmentEmail).not.toHaveBeenCalled();
  });

  // --- User-Facing Invite Template for Unclaimed Profiles ---

  it("returns invite data when other user is unclaimed on interested swipe", async () => {
    /** Per spec: "Show user A: 'Dr. [B] hasn't joined yet. Want to invite them?'
     *  with a pre-filled email template they can copy/send." When the other user
     *  has claimedAt=null (seeded profile), the response includes invite data. */
    mockGetServerSession.mockResolvedValue({ user: { id: "user-aaa" } });
    mockFindUnique.mockResolvedValue(makeProposal() as never);
    mockSwipeCreate.mockResolvedValue({
      id: "swipe-invite-1",
      direction: "interested",
      viewedDetail: true,
      timeSpentMs: 5000,
    } as never);
    // Other user (user-zzz) is unclaimed; current user (user-aaa) has a name
    mockUserFindUnique.mockImplementation(((args: { where: { id: string } }) => {
      if (args.where.id === "user-zzz") {
        return Promise.resolve({ claimedAt: null, name: "Dr. Jane Smith" });
      }
      return Promise.resolve({ claimedAt: new Date(), name: "Dr. John Doe" });
    }) as never);

    const res = await POST(
      ...makeRouteArgs("proposal-1", {
        direction: "interested",
        viewedDetail: true,
        timeSpentMs: 5000,
      })
    );
    const data = await res.json();

    expect(data.invite).toBeDefined();
    expect(data.invite.collaboratorName).toBe("Dr. Jane Smith");
    expect(data.invite.inviterName).toBe("Dr. John Doe");
    expect(data.invite.proposalTitle).toBe(
      "Cross-lab CRISPR screens for neurodegeneration targets"
    );
    expect(data.invite.oneLineSummary).toBe(
      "Combine your CRISPR expertise with their neuronal models"
    );
    expect(data.invite.claimUrl).toContain("/login");
  });

  it("does not return invite data when other user is claimed", async () => {
    /** When the other user has already claimed their profile (claimedAt is set),
     *  no invite data should be returned — the user is already on the platform. */
    mockGetServerSession.mockResolvedValue({ user: { id: "user-aaa" } });
    mockFindUnique.mockResolvedValue(makeProposal() as never);
    mockSwipeCreate.mockResolvedValue({
      id: "swipe-invite-2",
      direction: "interested",
      viewedDetail: false,
      timeSpentMs: null,
    } as never);
    // Both users are claimed (default mock)

    const res = await POST(
      ...makeRouteArgs("proposal-1", {
        direction: "interested",
        viewedDetail: false,
      })
    );
    const data = await res.json();

    expect(data.invite).toBeUndefined();
  });

  it("does not return invite data for archive swipes", async () => {
    /** Invite templates are only shown for interested swipes, not archives.
     *  The user hasn't expressed interest, so there's nothing to invite about. */
    mockGetServerSession.mockResolvedValue({ user: { id: "user-aaa" } });
    mockFindUnique.mockResolvedValue(makeProposal() as never);
    mockSwipeCreate.mockResolvedValue({
      id: "swipe-invite-3",
      direction: "archive",
      viewedDetail: false,
      timeSpentMs: null,
    } as never);
    // Other user is unclaimed, but direction is archive
    mockUserFindUnique.mockResolvedValue({
      claimedAt: null,
      name: "Dr. Jane Smith",
    } as never);

    const res = await POST(
      ...makeRouteArgs("proposal-1", {
        direction: "archive",
        viewedDetail: false,
      })
    );
    const data = await res.json();

    expect(data.invite).toBeUndefined();
  });

  it("returns correct invite data from researcher B perspective", async () => {
    /** When user B swipes interested on an unclaimed user A, the invite data
     *  should use B's one-line summary and A's name. */
    mockGetServerSession.mockResolvedValue({ user: { id: "user-zzz" } });
    mockFindUnique.mockResolvedValue(makeProposal() as never);
    mockSwipeCreate.mockResolvedValue({
      id: "swipe-invite-4",
      direction: "interested",
      viewedDetail: true,
      timeSpentMs: 2000,
    } as never);
    mockUserFindUnique.mockImplementation(((args: { where: { id: string } }) => {
      if (args.where.id === "user-aaa") {
        return Promise.resolve({ claimedAt: null, name: "Dr. Unclaimed A" });
      }
      return Promise.resolve({ claimedAt: new Date(), name: "Dr. Inviter B" });
    }) as never);

    const res = await POST(
      ...makeRouteArgs("proposal-1", {
        direction: "interested",
        viewedDetail: true,
        timeSpentMs: 2000,
      })
    );
    const data = await res.json();

    expect(data.invite).toBeDefined();
    expect(data.invite.collaboratorName).toBe("Dr. Unclaimed A");
    expect(data.invite.inviterName).toBe("Dr. Inviter B");
    // User B sees oneLineSummaryB
    expect(data.invite.oneLineSummary).toBe(
      "Combine your neuronal models with their CRISPR expertise"
    );
  });
});
