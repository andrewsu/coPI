/**
 * Tests for GET /api/proposals — Fetch the user's swipe queue.
 *
 * Validates: authentication, empty queue handling, confidence tier ordering,
 * user-side perspective mapping (one-line summary, collaborator), exclusion
 * of already-swiped proposals, and the "is_updated" badge field.
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

/** Helper: create a mock proposal with both researcher sides. */
function makeProposal(overrides: Record<string, unknown> = {}) {
  return {
    id: "proposal-1",
    researcherAId: "user-aaa",
    researcherBId: "user-zzz",
    title: "CRISPR + Proteomics",
    collaborationType: "Methodological Enhancement",
    scientificQuestion: "Can CRISPR screens identify novel drug targets?",
    oneLineSummaryA: "Summary tailored for researcher A",
    oneLineSummaryB: "Summary tailored for researcher B",
    detailedRationale: "Detailed rationale...",
    labAContributions: "A contributes CRISPR",
    labBContributions: "B contributes proteomics",
    labABenefits: "A gains proteomics data",
    labBBenefits: "B gains validated targets",
    proposedFirstExperiment: "Pilot screen on 100 genes",
    anchoringPublicationIds: [],
    confidenceTier: "high",
    llmReasoning: "reasoning...",
    llmModel: "claude-opus-4-20250514",
    visibilityA: "visible",
    visibilityB: "visible",
    profileVersionA: 1,
    profileVersionB: 1,
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
    ...overrides,
  };
}

describe("GET /api/proposals", () => {
  beforeEach(() => jest.clearAllMocks());

  it("returns 401 when not authenticated", async () => {
    /** Unauthenticated requests must be rejected. */
    mockGetServerSession.mockResolvedValue(null);
    const res = await GET();
    expect(res.status).toBe(401);
  });

  it("returns empty queue when no proposals exist", async () => {
    /** Users with no visible proposals get an empty array. */
    mockGetServerSession.mockResolvedValue({ user: { id: "user-aaa" } });
    mockFindMany.mockResolvedValue([]);

    const res = await GET();
    expect(res.status).toBe(200);
    const data = await res.json();

    expect(data.proposals).toEqual([]);
    expect(data.totalCount).toBe(0);
  });

  it("returns proposals tailored to user side A", async () => {
    /** When the user is researcher A, they see oneLineSummaryA and
     *  researcher B as the collaborator. */
    mockGetServerSession.mockResolvedValue({ user: { id: "user-aaa" } });
    mockFindMany.mockResolvedValue([makeProposal()] as never);

    const res = await GET();
    const data = await res.json();

    expect(data.proposals).toHaveLength(1);
    const proposal = data.proposals[0];
    expect(proposal.oneLineSummary).toBe("Summary tailored for researcher A");
    expect(proposal.collaborator.name).toBe("Zara Scientist");
    expect(proposal.collaborator.institution).toBe("Stanford");
    expect(proposal.collaborator.department).toBe("Chemistry");
  });

  it("returns proposals tailored to user side B", async () => {
    /** When the user is researcher B, they see oneLineSummaryB and
     *  researcher A as the collaborator. */
    mockGetServerSession.mockResolvedValue({ user: { id: "user-zzz" } });
    mockFindMany.mockResolvedValue([makeProposal()] as never);

    const res = await GET();
    const data = await res.json();

    const proposal = data.proposals[0];
    expect(proposal.oneLineSummary).toBe("Summary tailored for researcher B");
    expect(proposal.collaborator.name).toBe("Alice Researcher");
    expect(proposal.collaborator.institution).toBe("MIT");
  });

  it("includes summary card fields: title, collaborationType, confidenceTier, isUpdated", async () => {
    /** All fields needed by the summary card are present in the response. */
    mockGetServerSession.mockResolvedValue({ user: { id: "user-aaa" } });
    mockFindMany.mockResolvedValue([makeProposal()] as never);

    const res = await GET();
    const data = await res.json();
    const proposal = data.proposals[0];

    expect(proposal.title).toBe("CRISPR + Proteomics");
    expect(proposal.collaborationType).toBe("Methodological Enhancement");
    expect(proposal.confidenceTier).toBe("high");
    expect(proposal.isUpdated).toBe(false);
    expect(proposal.id).toBe("proposal-1");
  });

  it("sorts by confidence tier (high first) then by recency", async () => {
    /** High confidence proposals appear before moderate, which appear before
     *  speculative. Within a tier, newer proposals come first. */
    mockGetServerSession.mockResolvedValue({ user: { id: "user-aaa" } });
    mockFindMany.mockResolvedValue([
      makeProposal({
        id: "p-spec-old",
        confidenceTier: "speculative",
        createdAt: new Date("2025-06-01"),
      }),
      makeProposal({
        id: "p-high-old",
        confidenceTier: "high",
        createdAt: new Date("2025-06-15"),
      }),
      makeProposal({
        id: "p-mod",
        confidenceTier: "moderate",
        createdAt: new Date("2025-07-01"),
      }),
      makeProposal({
        id: "p-high-new",
        confidenceTier: "high",
        createdAt: new Date("2025-07-10"),
      }),
    ] as never);

    const res = await GET();
    const data = await res.json();
    const ids = data.proposals.map((p: { id: string }) => p.id);

    // high (newest first), then moderate, then speculative
    expect(ids).toEqual(["p-high-new", "p-high-old", "p-mod", "p-spec-old"]);
  });

  it("marks updated proposals with isUpdated flag", async () => {
    /** Proposals regenerated for previously archived pairs carry the
     *  is_updated badge so the UI can show "Updated proposal". */
    mockGetServerSession.mockResolvedValue({ user: { id: "user-aaa" } });
    mockFindMany.mockResolvedValue([
      makeProposal({ id: "p-updated", isUpdated: true }),
    ] as never);

    const res = await GET();
    const data = await res.json();

    expect(data.proposals[0].isUpdated).toBe(true);
  });

  it("queries Prisma with correct visibility and swipe filters", async () => {
    /** Ensures the query filters for visible proposals the user hasn't swiped on. */
    mockGetServerSession.mockResolvedValue({ user: { id: "user-aaa" } });
    mockFindMany.mockResolvedValue([]);

    await GET();

    expect(mockFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          OR: [
            { researcherAId: "user-aaa", visibilityA: "visible" },
            { researcherBId: "user-aaa", visibilityB: "visible" },
          ],
          NOT: {
            swipes: {
              some: { userId: "user-aaa" },
            },
          },
        },
      }),
    );
  });

  it("handles null department in collaborator info", async () => {
    /** Collaborators without a department should have null in the response. */
    mockGetServerSession.mockResolvedValue({ user: { id: "user-aaa" } });
    mockFindMany.mockResolvedValue([
      makeProposal({
        researcherB: {
          id: "user-zzz",
          name: "Zara Scientist",
          institution: "Stanford",
          department: null,
        },
      }),
    ] as never);

    const res = await GET();
    const data = await res.json();

    expect(data.proposals[0].collaborator.department).toBeNull();
  });
});
