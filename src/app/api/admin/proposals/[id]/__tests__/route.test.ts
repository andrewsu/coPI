/**
 * Tests for GET /api/admin/proposals/[id].
 *
 * Validates: admin authorization, 404 for missing proposal, full proposal
 * detail response with all fields, resolved anchoring publications,
 * swipe records, and match record.
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
    },
    publication: {
      findMany: jest.fn(),
    },
  },
}));

import { getServerSession } from "next-auth";
import { prisma } from "@/lib/prisma";

const mockGetServerSession = jest.mocked(getServerSession);
const mockFindUnique = jest.mocked(prisma.collaborationProposal.findUnique);
const mockPublicationFindMany = jest.mocked(prisma.publication.findMany);

const { GET } = require("../route");

function makeParams(id: string) {
  return { params: Promise.resolve({ id }) };
}

/** Full mock proposal with all relations. */
function mockFullProposal(overrides: Record<string, unknown> = {}) {
  return {
    id: "prop-1",
    researcherAId: "user-1",
    researcherBId: "user-2",
    title: "CRISPR Collaboration",
    collaborationType: "complementary_expertise",
    scientificQuestion: "Can CRISPR improve cancer diagnostics?",
    oneLineSummaryA: "Summary for Alice",
    oneLineSummaryB: "Summary for Bob",
    detailedRationale: "Both labs bring unique techniques...",
    labAContributions: "Alice provides CRISPR expertise",
    labBContributions: "Bob provides imaging capabilities",
    labABenefits: "Access to imaging data",
    labBBenefits: "Access to CRISPR tools",
    proposedFirstExperiment: "CRISPR screen on cell lines...",
    anchoringPublicationIds: ["pub-1", "pub-2"],
    confidenceTier: "high",
    llmReasoning: "Both researchers work on cancer...",
    llmModel: "claude-opus-4-20250514",
    visibilityA: "visible",
    visibilityB: "pending_other_interest",
    profileVersionA: 2,
    profileVersionB: 1,
    isUpdated: false,
    createdAt: new Date("2026-01-25"),
    researcherA: {
      id: "user-1",
      name: "Dr. Alice",
      institution: "MIT",
      department: "Biology",
    },
    researcherB: {
      id: "user-2",
      name: "Dr. Bob",
      institution: "Stanford",
      department: "Chemistry",
    },
    swipes: [
      {
        id: "swipe-1",
        user: { id: "user-1", name: "Dr. Alice" },
        direction: "interested",
        viewedDetail: true,
        timeSpentMs: 15000,
        createdAt: new Date("2026-01-26"),
      },
    ],
    matches: [],
    ...overrides,
  };
}

describe("GET /api/admin/proposals/[id]", () => {
  beforeEach(() => jest.clearAllMocks());

  it("returns 403 when not authenticated", async () => {
    /** Unauthenticated requests must be rejected. */
    mockGetServerSession.mockResolvedValue(null);
    const res = await GET({}, makeParams("prop-1"));
    expect(res.status).toBe(403);
  });

  it("returns 403 when user is not admin", async () => {
    /** Non-admin users must be rejected. */
    mockGetServerSession.mockResolvedValue({
      user: { id: "user-1", isAdmin: false },
    });
    const res = await GET({}, makeParams("prop-1"));
    expect(res.status).toBe(403);
  });

  it("returns 404 when proposal does not exist", async () => {
    /** Missing proposal ID returns a 404 error. */
    mockGetServerSession.mockResolvedValue({
      user: { id: "admin-1", isAdmin: true },
    });
    mockFindUnique.mockResolvedValue(null);

    const res = await GET({}, makeParams("nonexistent"));
    expect(res.status).toBe(404);
  });

  it("returns full proposal detail for admin", async () => {
    /** Admin users receive the complete proposal detail with all fields. */
    mockGetServerSession.mockResolvedValue({
      user: { id: "admin-1", isAdmin: true },
    });
    mockFindUnique.mockResolvedValue(mockFullProposal() as never);
    mockPublicationFindMany.mockResolvedValue([
      {
        id: "pub-1",
        pmid: "12345678",
        doi: "10.1234/test",
        title: "Gene Paper",
        journal: "Nature",
        year: 2025,
        authorPosition: "last",
      },
    ] as never);

    const res = await GET({}, makeParams("prop-1"));
    expect(res.status).toBe(200);
    const data = await res.json();

    expect(data.title).toBe("CRISPR Collaboration");
    expect(data.scientificQuestion).toBe("Can CRISPR improve cancer diagnostics?");
    expect(data.llmReasoning).toBe("Both researchers work on cancer...");
    expect(data.llmModel).toBe("claude-opus-4-20250514");
    expect(data.visibilityA).toBe("visible");
    expect(data.visibilityB).toBe("pending_other_interest");
    expect(data.profileVersionA).toBe(2);
    expect(data.profileVersionB).toBe(1);
  });

  it("resolves anchoring publication IDs to records", async () => {
    /** Anchoring publications are resolved from UUIDs to full records. */
    mockGetServerSession.mockResolvedValue({
      user: { id: "admin-1", isAdmin: true },
    });
    mockFindUnique.mockResolvedValue(mockFullProposal() as never);
    mockPublicationFindMany.mockResolvedValue([
      {
        id: "pub-1",
        pmid: "12345678",
        doi: null,
        title: "Gene Paper",
        journal: "Nature",
        year: 2025,
        authorPosition: "last",
      },
      {
        id: "pub-2",
        pmid: "87654321",
        doi: "10.5678/test2",
        title: "Imaging Paper",
        journal: "Science",
        year: 2024,
        authorPosition: "first",
      },
    ] as never);

    const res = await GET({}, makeParams("prop-1"));
    const data = await res.json();

    expect(data.anchoringPublications).toHaveLength(2);
    expect(data.anchoringPublications[0]).toMatchObject({
      pmid: "12345678",
      title: "Gene Paper",
    });
  });

  it("returns empty anchoring publications when none exist", async () => {
    /** Proposals without anchoring publication IDs return an empty array. */
    mockGetServerSession.mockResolvedValue({
      user: { id: "admin-1", isAdmin: true },
    });
    mockFindUnique.mockResolvedValue(
      mockFullProposal({ anchoringPublicationIds: [] }) as never,
    );

    const res = await GET({}, makeParams("prop-1"));
    const data = await res.json();
    expect(data.anchoringPublications).toEqual([]);
    // Should not call publication.findMany when there are no IDs
    expect(mockPublicationFindMany).not.toHaveBeenCalled();
  });

  it("includes swipe records with user info and analytics", async () => {
    /** Swipe records include user identity, direction, and analytics fields. */
    mockGetServerSession.mockResolvedValue({
      user: { id: "admin-1", isAdmin: true },
    });
    mockFindUnique.mockResolvedValue(mockFullProposal() as never);
    mockPublicationFindMany.mockResolvedValue([] as never);

    const res = await GET({}, makeParams("prop-1"));
    const data = await res.json();

    expect(data.swipes).toHaveLength(1);
    expect(data.swipes[0]).toMatchObject({
      user: { id: "user-1", name: "Dr. Alice" },
      direction: "interested",
      viewedDetail: true,
      timeSpentMs: 15000,
    });
  });

  it("returns null match when no match exists", async () => {
    /** Proposals without a Match record return match: null. */
    mockGetServerSession.mockResolvedValue({
      user: { id: "admin-1", isAdmin: true },
    });
    mockFindUnique.mockResolvedValue(mockFullProposal() as never);
    mockPublicationFindMany.mockResolvedValue([] as never);

    const res = await GET({}, makeParams("prop-1"));
    const data = await res.json();
    expect(data.match).toBeNull();
  });

  it("returns match details when a match exists", async () => {
    /** Matched proposals include the Match record with notification status. */
    mockGetServerSession.mockResolvedValue({
      user: { id: "admin-1", isAdmin: true },
    });
    mockFindUnique.mockResolvedValue(
      mockFullProposal({
        matches: [
          {
            id: "match-1",
            matchedAt: new Date("2026-01-27"),
            notificationSentA: true,
            notificationSentB: false,
          },
        ],
      }) as never,
    );
    mockPublicationFindMany.mockResolvedValue([] as never);

    const res = await GET({}, makeParams("prop-1"));
    const data = await res.json();

    expect(data.match).toMatchObject({
      id: "match-1",
      notificationSentA: true,
      notificationSentB: false,
    });
  });

  it("includes all text fields in response", async () => {
    /** All text-heavy fields (rationale, contributions, benefits, experiment) are returned. */
    mockGetServerSession.mockResolvedValue({
      user: { id: "admin-1", isAdmin: true },
    });
    mockFindUnique.mockResolvedValue(mockFullProposal() as never);
    mockPublicationFindMany.mockResolvedValue([] as never);

    const res = await GET({}, makeParams("prop-1"));
    const data = await res.json();

    expect(data.detailedRationale).toBe("Both labs bring unique techniques...");
    expect(data.labAContributions).toBe("Alice provides CRISPR expertise");
    expect(data.labBContributions).toBe("Bob provides imaging capabilities");
    expect(data.labABenefits).toBe("Access to imaging data");
    expect(data.labBBenefits).toBe("Access to CRISPR tools");
    expect(data.proposedFirstExperiment).toBe("CRISPR screen on cell lines...");
  });
});
