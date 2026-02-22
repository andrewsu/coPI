/**
 * Tests for GET /api/proposals/matches — Fetch the user's mutual matches.
 *
 * Validates: authentication, empty matches state, correct user-side perspective
 * mapping, email_visibility contact info rules (public_profile, mutual_matches,
 * never), deleted account handling, full proposal detail inclusion, both
 * researcher profiles, anchoring publication resolution, and ordering by
 * most recent match first.
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
    match: {
      findMany: jest.fn(),
    },
    publication: {
      findMany: jest.fn(),
    },
  },
}));

import { getServerSession } from "next-auth";
import { prisma } from "@/lib/prisma";

const mockGetServerSession = jest.mocked(getServerSession);
const mockMatchFindMany = jest.mocked(prisma.match.findMany);
const mockPublicationFindMany = jest.mocked(prisma.publication.findMany);

const { GET } = require("../route");

/** Helper: create a mock match with embedded proposal and researcher data. */
function makeMatch(overrides: Record<string, unknown> = {}) {
  return {
    id: "match-1",
    proposalId: "proposal-1",
    notificationSentA: false,
    notificationSentB: false,
    matchedAt: new Date("2025-09-01"),
    proposal: {
      id: "proposal-1",
      researcherAId: "user-aaa",
      researcherBId: "user-zzz",
      title: "CRISPR + Proteomics",
      collaborationType: "Methodological Enhancement",
      scientificQuestion: "Can CRISPR screens reveal proteomic targets?",
      oneLineSummaryA: "Summary for A",
      oneLineSummaryB: "Summary for B",
      detailedRationale: "Detailed rationale text",
      labAContributions: "Lab A brings CRISPR",
      labBContributions: "Lab B brings proteomics",
      labABenefits: "Lab A gains proteomic insights",
      labBBenefits: "Lab B gains genetic tools",
      proposedFirstExperiment: "Run a pilot screen on 100 genes",
      anchoringPublicationIds: [],
      confidenceTier: "high",
      llmReasoning: "Good synergy",
      llmModel: "claude-opus-4-20250514",
      visibilityA: "visible",
      visibilityB: "visible",
      profileVersionA: 1,
      profileVersionB: 1,
      isUpdated: false,
      createdAt: new Date("2025-08-01"),
      researcherA: {
        id: "user-aaa",
        name: "Alice Researcher",
        email: "alice@mit.edu",
        institution: "MIT",
        department: "Biology",
        emailVisibility: "mutual_matches",
        profile: {
          researchSummary: "Alice studies CRISPR systems.",
          techniques: ["CRISPR", "Gene editing"],
          experimentalModels: ["Cell lines"],
          diseaseAreas: ["Cancer"],
          keyTargets: ["TP53"],
          grantTitles: ["NIH R01"],
        },
        publications: [
          {
            id: "pub-a1",
            pmid: "12345",
            title: "CRISPR screens in cancer",
            journal: "Nature",
            year: 2024,
            authorPosition: "last",
          },
        ],
      },
      researcherB: {
        id: "user-zzz",
        name: "Zara Scientist",
        email: "zara@stanford.edu",
        institution: "Stanford",
        department: "Chemistry",
        emailVisibility: "mutual_matches",
        profile: {
          researchSummary: "Zara develops mass spec methods.",
          techniques: ["Mass spectrometry", "Proteomics"],
          experimentalModels: ["Mouse models"],
          diseaseAreas: ["Neurodegeneration"],
          keyTargets: ["Tau"],
          grantTitles: ["NSF CAREER"],
        },
        publications: [
          {
            id: "pub-z1",
            pmid: "67890",
            title: "Novel proteomics methods",
            journal: "Cell",
            year: 2024,
            authorPosition: "first",
          },
        ],
      },
    },
    ...overrides,
  };
}

describe("GET /api/proposals/matches", () => {
  beforeEach(() => jest.clearAllMocks());

  it("returns 401 when not authenticated", async () => {
    /** Unauthenticated requests must be rejected. */
    mockGetServerSession.mockResolvedValue(null);
    const res = await GET();
    expect(res.status).toBe(401);
  });

  it("returns empty array when no matches exist", async () => {
    /** Users with no mutual matches see an empty list. */
    mockGetServerSession.mockResolvedValue({ user: { id: "user-aaa" } });
    mockMatchFindMany.mockResolvedValue([]);

    const res = await GET();
    expect(res.status).toBe(200);
    const data = await res.json();

    expect(data.matches).toEqual([]);
    expect(data.totalCount).toBe(0);
  });

  it("returns matches with proposal detail tailored to user side A", async () => {
    /** When user is researcher A, they see oneLineSummaryA, their
     *  contributions as labAContributions, and researcher B as collaborator. */
    mockGetServerSession.mockResolvedValue({ user: { id: "user-aaa" } });
    mockMatchFindMany.mockResolvedValue([makeMatch()] as never);

    const res = await GET();
    const data = await res.json();

    expect(data.matches).toHaveLength(1);
    const match = data.matches[0];

    // Proposal mapped to side A's perspective
    expect(match.proposal.oneLineSummary).toBe("Summary for A");
    expect(match.proposal.yourContributions).toBe("Lab A brings CRISPR");
    expect(match.proposal.theirContributions).toBe("Lab B brings proteomics");
    expect(match.proposal.yourBenefits).toBe("Lab A gains proteomic insights");
    expect(match.proposal.theirBenefits).toBe("Lab B gains genetic tools");

    // Collaborator is researcher B
    expect(match.collaborator.name).toBe("Zara Scientist");
    expect(match.collaborator.institution).toBe("Stanford");
    expect(match.collaborator.department).toBe("Chemistry");

    // User's own profile is researcher A
    expect(match.yourProfile.name).toBe("Alice Researcher");
  });

  it("returns matches with proposal detail tailored to user side B", async () => {
    /** When user is researcher B, perspective is flipped: they see
     *  oneLineSummaryB and researcher A as the collaborator. */
    mockGetServerSession.mockResolvedValue({ user: { id: "user-zzz" } });
    mockMatchFindMany.mockResolvedValue([makeMatch()] as never);

    const res = await GET();
    const data = await res.json();

    const match = data.matches[0];
    expect(match.proposal.oneLineSummary).toBe("Summary for B");
    expect(match.proposal.yourContributions).toBe("Lab B brings proteomics");
    expect(match.proposal.theirContributions).toBe("Lab A brings CRISPR");
    expect(match.collaborator.name).toBe("Alice Researcher");
    expect(match.yourProfile.name).toBe("Zara Scientist");
  });

  it("shows email when collaborator emailVisibility is mutual_matches", async () => {
    /** Default email_visibility is mutual_matches — email is shown on match. */
    mockGetServerSession.mockResolvedValue({ user: { id: "user-aaa" } });
    mockMatchFindMany.mockResolvedValue([makeMatch()] as never);

    const res = await GET();
    const data = await res.json();

    expect(data.matches[0].collaborator.email).toBe("zara@stanford.edu");
    expect(data.matches[0].collaborator.contactMessage).toBeNull();
  });

  it("shows email when collaborator emailVisibility is public_profile", async () => {
    /** public_profile setting means email is visible to everyone. */
    mockGetServerSession.mockResolvedValue({ user: { id: "user-aaa" } });
    const m = makeMatch();
    (m.proposal.researcherB as Record<string, unknown>).emailVisibility =
      "public_profile";
    mockMatchFindMany.mockResolvedValue([m] as never);

    const res = await GET();
    const data = await res.json();

    expect(data.matches[0].collaborator.email).toBe("zara@stanford.edu");
    expect(data.matches[0].collaborator.contactMessage).toBeNull();
  });

  it("hides email when collaborator emailVisibility is never", async () => {
    /** When email_visibility is 'never', show a placeholder message
     *  instead of the email address per spec. */
    mockGetServerSession.mockResolvedValue({ user: { id: "user-aaa" } });
    const m = makeMatch();
    (m.proposal.researcherB as Record<string, unknown>).emailVisibility =
      "never";
    mockMatchFindMany.mockResolvedValue([m] as never);

    const res = await GET();
    const data = await res.json();

    expect(data.matches[0].collaborator.email).toBeNull();
    expect(data.matches[0].collaborator.contactMessage).toBe(
      "This researcher prefers not to share their email. You may reach them through their institutional directory."
    );
  });

  it("includes full proposal detail fields", async () => {
    /** All proposal detail fields must be present for the matches tab
     *  to render the complete collaboration proposal per spec. */
    mockGetServerSession.mockResolvedValue({ user: { id: "user-aaa" } });
    mockMatchFindMany.mockResolvedValue([makeMatch()] as never);

    const res = await GET();
    const data = await res.json();
    const { proposal } = data.matches[0];

    expect(proposal.id).toBe("proposal-1");
    expect(proposal.title).toBe("CRISPR + Proteomics");
    expect(proposal.collaborationType).toBe("Methodological Enhancement");
    expect(proposal.scientificQuestion).toBe(
      "Can CRISPR screens reveal proteomic targets?"
    );
    expect(proposal.detailedRationale).toBe("Detailed rationale text");
    expect(proposal.proposedFirstExperiment).toBe(
      "Run a pilot screen on 100 genes"
    );
    expect(proposal.confidenceTier).toBe("high");
    expect(proposal.isUpdated).toBe(false);
  });

  it("includes both researchers' public profiles excluding user-submitted texts", async () => {
    /** Both profiles are shown but must NOT include userSubmittedTexts
     *  or keywords per spec. */
    mockGetServerSession.mockResolvedValue({ user: { id: "user-aaa" } });
    mockMatchFindMany.mockResolvedValue([makeMatch()] as never);

    const res = await GET();
    const data = await res.json();
    const match = data.matches[0];

    // Collaborator profile (B)
    expect(match.collaborator.profile.researchSummary).toBe(
      "Zara develops mass spec methods."
    );
    expect(match.collaborator.profile.techniques).toEqual([
      "Mass spectrometry",
      "Proteomics",
    ]);
    expect(match.collaborator.publications).toHaveLength(1);
    expect(match.collaborator.publications[0].title).toBe(
      "Novel proteomics methods"
    );

    // User's own profile (A)
    expect(match.yourProfile.profile.researchSummary).toBe(
      "Alice studies CRISPR systems."
    );
    expect(match.yourProfile.publications).toHaveLength(1);

    // userSubmittedTexts and keywords must NOT be in the response
    expect(match.collaborator.profile.userSubmittedTexts).toBeUndefined();
    expect(match.collaborator.profile.keywords).toBeUndefined();
    expect(match.yourProfile.profile.userSubmittedTexts).toBeUndefined();
    expect(match.yourProfile.profile.keywords).toBeUndefined();
  });

  it("handles deleted account (null profile)", async () => {
    /** When collaborator has deleted their account, profile is null.
     *  Name and institution are preserved per spec. */
    mockGetServerSession.mockResolvedValue({ user: { id: "user-aaa" } });
    const m = makeMatch();
    (m.proposal.researcherB as Record<string, unknown>).profile = null;
    (m.proposal.researcherB as Record<string, unknown>).publications = [];
    mockMatchFindMany.mockResolvedValue([m] as never);

    const res = await GET();
    const data = await res.json();
    const match = data.matches[0];

    // Name and institution preserved
    expect(match.collaborator.name).toBe("Zara Scientist");
    expect(match.collaborator.institution).toBe("Stanford");

    // Profile is null
    expect(match.collaborator.profile).toBeNull();
    expect(match.collaborator.publications).toEqual([]);
  });

  it("resolves anchoring publication IDs", async () => {
    /** When a proposal has anchoringPublicationIds, they are resolved
     *  to actual publication records via a database lookup. */
    mockGetServerSession.mockResolvedValue({ user: { id: "user-aaa" } });
    const m = makeMatch();
    (m.proposal as Record<string, unknown>).anchoringPublicationIds = [
      "pub-anchor-1",
    ];
    mockMatchFindMany.mockResolvedValue([m] as never);
    mockPublicationFindMany.mockResolvedValue([
      {
        id: "pub-anchor-1",
        pmid: "99999",
        title: "Anchoring paper",
        journal: "Science",
        year: 2023,
        authorPosition: "first",
      },
    ] as never);

    const res = await GET();
    const data = await res.json();

    expect(data.matches[0].proposal.anchoringPublications).toHaveLength(1);
    expect(data.matches[0].proposal.anchoringPublications[0].title).toBe(
      "Anchoring paper"
    );
    expect(mockPublicationFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: { in: ["pub-anchor-1"] } },
      })
    );
  });

  it("includes matchedAt timestamp", async () => {
    /** The matchedAt field records when the mutual match was created. */
    mockGetServerSession.mockResolvedValue({ user: { id: "user-aaa" } });
    const matchedAt = new Date("2025-09-15T14:00:00Z");
    mockMatchFindMany.mockResolvedValue([
      makeMatch({ matchedAt }),
    ] as never);

    const res = await GET();
    const data = await res.json();

    expect(data.matches[0].matchedAt).toBe(matchedAt.toISOString());
  });

  it("returns multiple matches sorted by most recent first", async () => {
    /** Matches are ordered by matchedAt descending (most recent first). */
    mockGetServerSession.mockResolvedValue({ user: { id: "user-aaa" } });
    mockMatchFindMany.mockResolvedValue([
      makeMatch({
        id: "match-2",
        matchedAt: new Date("2025-10-01"),
        proposal: {
          ...makeMatch().proposal,
          id: "proposal-2",
          title: "Most recent match",
        },
      }),
      makeMatch({
        id: "match-1",
        matchedAt: new Date("2025-09-01"),
        proposal: {
          ...makeMatch().proposal,
          id: "proposal-1",
          title: "Older match",
        },
      }),
    ] as never);

    const res = await GET();
    const data = await res.json();

    expect(data.matches).toHaveLength(2);
    expect(data.matches[0].proposal.title).toBe("Most recent match");
    expect(data.matches[1].proposal.title).toBe("Older match");
    expect(data.totalCount).toBe(2);
  });

  it("queries Prisma with correct filters and ordering", async () => {
    /** Ensures the query finds matches for proposals where this user
     *  is researcher A or B, sorted by most recent match first. */
    mockGetServerSession.mockResolvedValue({ user: { id: "user-aaa" } });
    mockMatchFindMany.mockResolvedValue([]);

    await GET();

    expect(mockMatchFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          proposal: {
            OR: [
              { researcherAId: "user-aaa" },
              { researcherBId: "user-aaa" },
            ],
          },
        },
        orderBy: { matchedAt: "desc" },
      })
    );
  });

  it("handles null department in collaborator and self info", async () => {
    /** Researchers without a department should have null in the response. */
    mockGetServerSession.mockResolvedValue({ user: { id: "user-aaa" } });
    const m = makeMatch();
    (m.proposal.researcherA as Record<string, unknown>).department = null;
    (m.proposal.researcherB as Record<string, unknown>).department = null;
    mockMatchFindMany.mockResolvedValue([m] as never);

    const res = await GET();
    const data = await res.json();

    expect(data.matches[0].collaborator.department).toBeNull();
    expect(data.matches[0].yourProfile.department).toBeNull();
  });

  it("skips publication resolution when no anchoring IDs", async () => {
    /** When anchoringPublicationIds is empty, no publication query is made. */
    mockGetServerSession.mockResolvedValue({ user: { id: "user-aaa" } });
    mockMatchFindMany.mockResolvedValue([makeMatch()] as never);

    const res = await GET();
    const data = await res.json();

    expect(data.matches[0].proposal.anchoringPublications).toEqual([]);
    expect(mockPublicationFindMany).not.toHaveBeenCalled();
  });

  it("includes matchId in each match response", async () => {
    /** The matchId field allows the UI to uniquely identify each match
     *  for expansion toggling and rendering. */
    mockGetServerSession.mockResolvedValue({ user: { id: "user-aaa" } });
    mockMatchFindMany.mockResolvedValue([makeMatch()] as never);

    const res = await GET();
    const data = await res.json();

    expect(data.matches[0].matchId).toBe("match-1");
  });
});
