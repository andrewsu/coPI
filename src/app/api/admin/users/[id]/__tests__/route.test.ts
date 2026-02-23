/**
 * Tests for GET /api/admin/users/[id].
 *
 * Validates: admin authorization, 404 for missing user, full user detail
 * response including profile, publications, match pool (selections and
 * reverse), affiliation selections, and proposals with swipe/match status.
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
      findUnique: jest.fn(),
    },
    collaborationProposal: {
      findMany: jest.fn(),
    },
  },
}));

import { getServerSession } from "next-auth";
import { prisma } from "@/lib/prisma";

const mockGetServerSession = jest.mocked(getServerSession);
const mockFindUnique = jest.mocked(prisma.user.findUnique);
const mockProposalFindMany = jest.mocked(prisma.collaborationProposal.findMany);

const { GET } = require("../route");

/** Helper to create a params promise (Next.js 15 convention). */
function makeParams(id: string) {
  return { params: Promise.resolve({ id }) };
}

/** Full mock user object with all included relations. */
function mockFullUser() {
  return {
    id: "user-1",
    name: "Dr. Alice",
    email: "alice@mit.edu",
    institution: "MIT",
    department: "Biology",
    orcid: "0000-0001-2345-6789",
    isAdmin: false,
    createdAt: new Date("2026-01-15"),
    claimedAt: new Date("2026-01-15"),
    deletedAt: null,
    profile: {
      id: "profile-1",
      researchSummary: "Alice studies gene regulation...",
      techniques: ["CRISPR", "RNA-seq"],
      experimentalModels: ["mouse"],
      diseaseAreas: ["cancer"],
      keyTargets: ["TP53"],
      keywords: ["epigenetics"],
      grantTitles: ["NIH R01 - Gene Regulation"],
      profileVersion: 2,
      profileGeneratedAt: new Date("2026-01-16"),
      pendingProfile: null,
      pendingProfileCreatedAt: null,
    },
    publications: [
      {
        id: "pub-1",
        pmid: "12345678",
        pmcid: "PMC1234567",
        doi: "10.1234/test",
        title: "Gene Regulation Paper",
        journal: "Nature",
        year: 2025,
        authorPosition: "last",
        methodsText: "We used CRISPR...",
        createdAt: new Date("2026-01-16"),
      },
    ],
    matchPoolSelections: [
      {
        id: "mpe-1",
        source: "individual_select",
        targetUser: { id: "user-2", name: "Dr. Bob", institution: "Stanford" },
        createdAt: new Date("2026-01-20"),
      },
    ],
    matchPoolTargets: [
      {
        id: "mpe-2",
        source: "affiliation_select",
        user: { id: "user-3", name: "Dr. Carol", institution: "MIT" },
        createdAt: new Date("2026-01-21"),
      },
    ],
    affiliationSelections: [
      {
        id: "aff-1",
        institution: "Stanford",
        department: null,
        selectAll: false,
        createdAt: new Date("2026-01-20"),
      },
    ],
  };
}

/** Mock proposals involving the user. */
function mockProposals() {
  return [
    {
      id: "prop-1",
      researcherAId: "user-1",
      researcherBId: "user-2",
      title: "CRISPR Collab",
      confidenceTier: "high",
      collaborationType: "complementary_expertise",
      visibilityA: "visible",
      visibilityB: "visible",
      createdAt: new Date("2026-01-25"),
      researcherA: { id: "user-1", name: "Dr. Alice", institution: "MIT" },
      researcherB: { id: "user-2", name: "Dr. Bob", institution: "Stanford" },
      swipes: [
        { userId: "user-1", direction: "interested", createdAt: new Date("2026-01-26") },
      ],
      matches: [{ id: "match-1", matchedAt: new Date("2026-01-27") }],
    },
  ];
}

describe("GET /api/admin/users/[id]", () => {
  beforeEach(() => jest.clearAllMocks());

  it("returns 403 when not authenticated", async () => {
    /** Unauthenticated requests must be rejected. */
    mockGetServerSession.mockResolvedValue(null);
    const res = await GET({}, makeParams("user-1"));
    expect(res.status).toBe(403);
  });

  it("returns 403 when user is not admin", async () => {
    /** Non-admin users must be rejected. */
    mockGetServerSession.mockResolvedValue({
      user: { id: "user-1", isAdmin: false },
    });
    const res = await GET({}, makeParams("user-1"));
    expect(res.status).toBe(403);
  });

  it("returns 404 when user does not exist", async () => {
    /** Missing user ID returns a 404 error. */
    mockGetServerSession.mockResolvedValue({
      user: { id: "admin-1", isAdmin: true },
    });
    mockFindUnique.mockResolvedValue(null);

    const res = await GET({}, makeParams("nonexistent"));
    expect(res.status).toBe(404);
  });

  it("returns full user detail for admin", async () => {
    /** Admin users receive the complete user detail with all sections. */
    mockGetServerSession.mockResolvedValue({
      user: { id: "admin-1", isAdmin: true },
    });
    mockFindUnique.mockResolvedValue(mockFullUser() as never);
    mockProposalFindMany.mockResolvedValue(mockProposals() as never);

    const res = await GET({}, makeParams("user-1"));
    expect(res.status).toBe(200);
    const data = await res.json();

    expect(data.id).toBe("user-1");
    expect(data.name).toBe("Dr. Alice");
    expect(data.orcid).toBe("0000-0001-2345-6789");
  });

  it("includes profile fields in response", async () => {
    /** Profile section includes all ResearcherProfile fields. */
    mockGetServerSession.mockResolvedValue({
      user: { id: "admin-1", isAdmin: true },
    });
    mockFindUnique.mockResolvedValue(mockFullUser() as never);
    mockProposalFindMany.mockResolvedValue([] as never);

    const res = await GET({}, makeParams("user-1"));
    const data = await res.json();

    expect(data.profile).toMatchObject({
      researchSummary: expect.any(String),
      techniques: ["CRISPR", "RNA-seq"],
      profileVersion: 2,
    });
  });

  it("returns null profile when user has no profile", async () => {
    /** Users without a ResearcherProfile get profile: null. */
    mockGetServerSession.mockResolvedValue({
      user: { id: "admin-1", isAdmin: true },
    });
    mockFindUnique.mockResolvedValue(
      mockFullUser() as never,
    );
    // Override to have no profile
    const user = mockFullUser();
    user.profile = null as never;
    mockFindUnique.mockResolvedValue(user as never);
    mockProposalFindMany.mockResolvedValue([] as never);

    const res = await GET({}, makeParams("user-1"));
    const data = await res.json();
    expect(data.profile).toBeNull();
  });

  it("includes publications with hasMethodsText flag", async () => {
    /** Publications expose a hasMethodsText boolean instead of the full text. */
    mockGetServerSession.mockResolvedValue({
      user: { id: "admin-1", isAdmin: true },
    });
    mockFindUnique.mockResolvedValue(mockFullUser() as never);
    mockProposalFindMany.mockResolvedValue([] as never);

    const res = await GET({}, makeParams("user-1"));
    const data = await res.json();

    expect(data.publications).toHaveLength(1);
    expect(data.publications[0]).toMatchObject({
      pmid: "12345678",
      title: "Gene Regulation Paper",
      hasMethodsText: true,
    });
  });

  it("includes match pool selections and reverse selections", async () => {
    /** Match pool section shows who the user selected and who selected them. */
    mockGetServerSession.mockResolvedValue({
      user: { id: "admin-1", isAdmin: true },
    });
    mockFindUnique.mockResolvedValue(mockFullUser() as never);
    mockProposalFindMany.mockResolvedValue([] as never);

    const res = await GET({}, makeParams("user-1"));
    const data = await res.json();

    expect(data.matchPool.selections).toHaveLength(1);
    expect(data.matchPool.selections[0].target.name).toBe("Dr. Bob");
    expect(data.matchPool.selectedByOthers).toHaveLength(1);
    expect(data.matchPool.selectedByOthers[0].selectedBy.name).toBe("Dr. Carol");
  });

  it("includes proposals with swipe and match status", async () => {
    /** Proposals section shows all proposals with swipe/match context. */
    mockGetServerSession.mockResolvedValue({
      user: { id: "admin-1", isAdmin: true },
    });
    mockFindUnique.mockResolvedValue(mockFullUser() as never);
    mockProposalFindMany.mockResolvedValue(mockProposals() as never);

    const res = await GET({}, makeParams("user-1"));
    const data = await res.json();

    expect(data.proposals).toHaveLength(1);
    expect(data.proposals[0]).toMatchObject({
      title: "CRISPR Collab",
      userSwipe: "interested",
      otherSwipe: null,
      matched: true,
      otherResearcher: { name: "Dr. Bob" },
    });
  });

  it("includes affiliation selections", async () => {
    /** Affiliation selections are returned with full detail. */
    mockGetServerSession.mockResolvedValue({
      user: { id: "admin-1", isAdmin: true },
    });
    mockFindUnique.mockResolvedValue(mockFullUser() as never);
    mockProposalFindMany.mockResolvedValue([] as never);

    const res = await GET({}, makeParams("user-1"));
    const data = await res.json();

    expect(data.affiliationSelections).toHaveLength(1);
    expect(data.affiliationSelections[0]).toMatchObject({
      institution: "Stanford",
      selectAll: false,
    });
  });
});
