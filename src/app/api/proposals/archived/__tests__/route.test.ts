/**
 * Tests for GET /api/proposals/archived — Fetch the user's archived proposals.
 *
 * Validates: authentication, empty archive, correct ordering (most recently
 * archived first), user-side perspective mapping (one-line summary, collaborator),
 * and inclusion of archivedAt timestamp.
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
    swipe: {
      findMany: jest.fn(),
    },
  },
}));

import { getServerSession } from "next-auth";
import { prisma } from "@/lib/prisma";

const mockGetServerSession = jest.mocked(getServerSession);
const mockSwipeFindMany = jest.mocked(prisma.swipe.findMany);

const { GET } = require("../route");

/** Helper: create a mock swipe with embedded proposal. */
function makeArchivedSwipe(overrides: Record<string, unknown> = {}) {
  return {
    id: "swipe-1",
    userId: "user-aaa",
    proposalId: "proposal-1",
    direction: "archive",
    viewedDetail: false,
    timeSpentMs: 2000,
    createdAt: new Date("2025-08-01"),
    proposal: {
      id: "proposal-1",
      researcherAId: "user-aaa",
      researcherBId: "user-zzz",
      title: "CRISPR + Proteomics",
      collaborationType: "Methodological Enhancement",
      oneLineSummaryA: "Summary for A",
      oneLineSummaryB: "Summary for B",
      confidenceTier: "high",
      isUpdated: false,
      createdAt: new Date("2025-07-01"),
      researcherA: {
        id: "user-aaa",
        name: "Alice Researcher",
        institution: "MIT",
        department: "Biology",
      },
      researcherB: {
        id: "user-zzz",
        name: "Zara Scientist",
        institution: "Stanford",
        department: "Chemistry",
      },
    },
    ...overrides,
  };
}

describe("GET /api/proposals/archived", () => {
  beforeEach(() => jest.clearAllMocks());

  it("returns 401 when not authenticated", async () => {
    /** Unauthenticated requests must be rejected. */
    mockGetServerSession.mockResolvedValue(null);
    const res = await GET();
    expect(res.status).toBe(401);
  });

  it("returns empty array when no archived proposals exist", async () => {
    /** Users with no archived proposals see an empty list. */
    mockGetServerSession.mockResolvedValue({ user: { id: "user-aaa" } });
    mockSwipeFindMany.mockResolvedValue([]);

    const res = await GET();
    expect(res.status).toBe(200);
    const data = await res.json();

    expect(data.proposals).toEqual([]);
    expect(data.totalCount).toBe(0);
  });

  it("returns archived proposals tailored to user side A", async () => {
    /** When user is researcher A, they see oneLineSummaryA and
     *  researcher B as the collaborator. */
    mockGetServerSession.mockResolvedValue({ user: { id: "user-aaa" } });
    mockSwipeFindMany.mockResolvedValue([makeArchivedSwipe()] as never);

    const res = await GET();
    const data = await res.json();

    expect(data.proposals).toHaveLength(1);
    const proposal = data.proposals[0];
    expect(proposal.oneLineSummary).toBe("Summary for A");
    expect(proposal.collaborator.name).toBe("Zara Scientist");
    expect(proposal.collaborator.institution).toBe("Stanford");
    expect(proposal.collaborator.department).toBe("Chemistry");
  });

  it("returns archived proposals tailored to user side B", async () => {
    /** When user is researcher B, they see oneLineSummaryB and
     *  researcher A as the collaborator. */
    mockGetServerSession.mockResolvedValue({ user: { id: "user-zzz" } });
    mockSwipeFindMany.mockResolvedValue([
      makeArchivedSwipe({
        userId: "user-zzz",
      }),
    ] as never);

    const res = await GET();
    const data = await res.json();

    const proposal = data.proposals[0];
    expect(proposal.oneLineSummary).toBe("Summary for B");
    expect(proposal.collaborator.name).toBe("Alice Researcher");
    expect(proposal.collaborator.institution).toBe("MIT");
  });

  it("includes archivedAt timestamp from the swipe record", async () => {
    /** The archivedAt field reflects when the user made the archive swipe. */
    mockGetServerSession.mockResolvedValue({ user: { id: "user-aaa" } });
    const archivedAt = new Date("2025-08-15T10:30:00Z");
    mockSwipeFindMany.mockResolvedValue([
      makeArchivedSwipe({ createdAt: archivedAt }),
    ] as never);

    const res = await GET();
    const data = await res.json();

    expect(data.proposals[0].archivedAt).toBe(archivedAt.toISOString());
  });

  it("includes all summary card fields", async () => {
    /** All fields needed by the summary card are present in the response. */
    mockGetServerSession.mockResolvedValue({ user: { id: "user-aaa" } });
    mockSwipeFindMany.mockResolvedValue([makeArchivedSwipe()] as never);

    const res = await GET();
    const data = await res.json();
    const proposal = data.proposals[0];

    expect(proposal.id).toBe("proposal-1");
    expect(proposal.title).toBe("CRISPR + Proteomics");
    expect(proposal.collaborationType).toBe("Methodological Enhancement");
    expect(proposal.confidenceTier).toBe("high");
    expect(proposal.isUpdated).toBe(false);
  });

  it("queries Prisma with correct filters and ordering", async () => {
    /** Ensures the query filters for archive swipes from this user,
     *  sorted by most recently archived first. */
    mockGetServerSession.mockResolvedValue({ user: { id: "user-aaa" } });
    mockSwipeFindMany.mockResolvedValue([]);

    await GET();

    expect(mockSwipeFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          userId: "user-aaa",
          direction: "archive",
        },
        orderBy: { createdAt: "desc" },
      })
    );
  });

  it("returns multiple proposals in correct order", async () => {
    /** Archived proposals are returned most-recently-archived first. */
    mockGetServerSession.mockResolvedValue({ user: { id: "user-aaa" } });
    mockSwipeFindMany.mockResolvedValue([
      makeArchivedSwipe({
        id: "swipe-2",
        createdAt: new Date("2025-08-10"),
        proposal: {
          ...makeArchivedSwipe().proposal,
          id: "proposal-2",
          title: "Most recent archive",
        },
      }),
      makeArchivedSwipe({
        id: "swipe-1",
        createdAt: new Date("2025-08-01"),
        proposal: {
          ...makeArchivedSwipe().proposal,
          id: "proposal-1",
          title: "Older archive",
        },
      }),
    ] as never);

    const res = await GET();
    const data = await res.json();

    expect(data.proposals).toHaveLength(2);
    expect(data.proposals[0].title).toBe("Most recent archive");
    expect(data.proposals[1].title).toBe("Older archive");
    expect(data.totalCount).toBe(2);
  });

  it("handles null department in collaborator info", async () => {
    /** Collaborators without a department should have null in the response. */
    mockGetServerSession.mockResolvedValue({ user: { id: "user-aaa" } });
    mockSwipeFindMany.mockResolvedValue([
      makeArchivedSwipe({
        proposal: {
          ...makeArchivedSwipe().proposal,
          researcherB: {
            id: "user-zzz",
            name: "Zara Scientist",
            institution: "Stanford",
            department: null,
          },
        },
      }),
    ] as never);

    const res = await GET();
    const data = await res.json();

    expect(data.proposals[0].collaborator.department).toBeNull();
  });
});
