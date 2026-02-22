/**
 * Tests for GET /api/proposals/[id] — Fetch full detail view for a proposal.
 *
 * Validates: authentication, authorization (user must be on proposal),
 * 404 for missing proposals, user-perspective field mapping (contributions,
 * benefits, one-line summary), collaborator profile inclusion (excluding
 * userSubmittedTexts and keywords per spec), anchoring publication resolution,
 * and handling of proposals with no anchoring publications.
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

/** Helper: create a full mock proposal with researchers, profiles, and publications. */
function makeDetailProposal(overrides: Record<string, unknown> = {}) {
  return {
    id: "proposal-1",
    researcherAId: "user-aaa",
    researcherBId: "user-zzz",
    title: "CRISPR + Proteomics",
    collaborationType: "Methodological Enhancement",
    scientificQuestion: "Can CRISPR screens identify novel drug targets?",
    oneLineSummaryA: "Summary tailored for researcher A",
    oneLineSummaryB: "Summary tailored for researcher B",
    detailedRationale:
      "Combining CRISPR and proteomics offers a powerful approach...",
    labAContributions: "Lab A contributes CRISPR screening expertise",
    labBContributions: "Lab B contributes mass spectrometry platform",
    labABenefits: "Lab A gains proteomics-validated targets",
    labBBenefits: "Lab B gains functional genomics insights",
    proposedFirstExperiment:
      "Pilot CRISPR screen on 100 kinase targets with proteomics readout",
    anchoringPublicationIds: ["pub-1", "pub-2"],
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
      profile: {
        researchSummary: "Alice studies CRISPR screens...",
        techniques: ["CRISPR", "flow cytometry"],
        experimentalModels: ["cell lines", "organoids"],
        diseaseAreas: ["breast cancer"],
        keyTargets: ["BRCA1", "TP53"],
        grantTitles: ["NIH R01 on CRISPR screening"],
      },
      publications: [
        {
          id: "alice-pub-1",
          pmid: "12345678",
          title: "CRISPR screen reveals kinase targets",
          journal: "Nature",
          year: 2024,
          authorPosition: "last",
        },
      ],
    },
    researcherB: {
      id: "user-zzz",
      name: "Zara Scientist",
      institution: "Stanford",
      department: "Chemistry",
      profile: {
        researchSummary: "Zara develops proteomics methods...",
        techniques: ["mass spectrometry", "phosphoproteomics"],
        experimentalModels: ["patient-derived xenografts"],
        diseaseAreas: ["lung cancer"],
        keyTargets: ["EGFR"],
        grantTitles: ["NSF grant on proteomics"],
      },
      publications: [
        {
          id: "zara-pub-1",
          pmid: "87654321",
          title: "Novel mass spec method for phosphoproteomics",
          journal: "Science",
          year: 2025,
          authorPosition: "first",
        },
      ],
    },
    ...overrides,
  };
}

/** Helper: build a Next.js-style request + params pair for the route handler. */
function makeRouteArgs(proposalId: string) {
  const request = new Request("http://localhost/api/proposals/" + proposalId);
  const params = Promise.resolve({ id: proposalId });
  return [request, { params }] as const;
}

describe("GET /api/proposals/[id]", () => {
  beforeEach(() => jest.clearAllMocks());

  it("returns 401 when not authenticated", async () => {
    /** Unauthenticated requests must be rejected. */
    mockGetServerSession.mockResolvedValue(null);
    const res = await GET(...makeRouteArgs("proposal-1"));
    expect(res.status).toBe(401);
  });

  it("returns 404 when proposal does not exist", async () => {
    /** Missing proposals return 404. */
    mockGetServerSession.mockResolvedValue({ user: { id: "user-aaa" } });
    mockFindUnique.mockResolvedValue(null);

    const res = await GET(...makeRouteArgs("nonexistent"));
    expect(res.status).toBe(404);
  });

  it("returns 403 when user is not part of the proposal", async () => {
    /** Users who are neither researcher A nor B are forbidden from viewing. */
    mockGetServerSession.mockResolvedValue({ user: { id: "user-stranger" } });
    mockFindUnique.mockResolvedValue(makeDetailProposal() as never);

    const res = await GET(...makeRouteArgs("proposal-1"));
    expect(res.status).toBe(403);
  });

  it("returns full detail fields for researcher A perspective", async () => {
    /** When the user is researcher A, contributions and benefits are mapped:
     *  labAContributions → yourContributions, labBContributions → theirContributions. */
    mockGetServerSession.mockResolvedValue({ user: { id: "user-aaa" } });
    mockFindUnique.mockResolvedValue(makeDetailProposal() as never);
    mockPublicationFindMany.mockResolvedValue([
      {
        id: "pub-1",
        pmid: "11111111",
        title: "Anchoring paper 1",
        journal: "Cell",
        year: 2024,
        authorPosition: "first",
      },
    ] as never);

    const res = await GET(...makeRouteArgs("proposal-1"));
    expect(res.status).toBe(200);
    const data = await res.json();

    // Summary fields
    expect(data.title).toBe("CRISPR + Proteomics");
    expect(data.oneLineSummary).toBe("Summary tailored for researcher A");

    // Detail fields
    expect(data.scientificQuestion).toBe(
      "Can CRISPR screens identify novel drug targets?"
    );
    expect(data.detailedRationale).toContain("CRISPR and proteomics");
    expect(data.yourContributions).toBe(
      "Lab A contributes CRISPR screening expertise"
    );
    expect(data.theirContributions).toBe(
      "Lab B contributes mass spectrometry platform"
    );
    expect(data.yourBenefits).toBe("Lab A gains proteomics-validated targets");
    expect(data.theirBenefits).toBe("Lab B gains functional genomics insights");
    expect(data.proposedFirstExperiment).toContain("Pilot CRISPR screen");
  });

  it("returns full detail fields for researcher B perspective", async () => {
    /** When the user is researcher B, contributions and benefits are flipped:
     *  labBContributions → yourContributions, labAContributions → theirContributions. */
    mockGetServerSession.mockResolvedValue({ user: { id: "user-zzz" } });
    mockFindUnique.mockResolvedValue(makeDetailProposal() as never);
    mockPublicationFindMany.mockResolvedValue([]);

    const res = await GET(...makeRouteArgs("proposal-1"));
    const data = await res.json();

    expect(data.oneLineSummary).toBe("Summary tailored for researcher B");
    expect(data.yourContributions).toBe(
      "Lab B contributes mass spectrometry platform"
    );
    expect(data.theirContributions).toBe(
      "Lab A contributes CRISPR screening expertise"
    );
    expect(data.yourBenefits).toBe("Lab B gains functional genomics insights");
    expect(data.theirBenefits).toBe("Lab A gains proteomics-validated targets");
  });

  it("includes collaborator profile for researcher A (sees B's profile)", async () => {
    /** Researcher A should see researcher B's public profile including
     *  researchSummary, techniques, experimentalModels, diseaseAreas,
     *  keyTargets, grantTitles, and publications — but NOT userSubmittedTexts or keywords. */
    mockGetServerSession.mockResolvedValue({ user: { id: "user-aaa" } });
    mockFindUnique.mockResolvedValue(makeDetailProposal() as never);
    mockPublicationFindMany.mockResolvedValue([]);

    const res = await GET(...makeRouteArgs("proposal-1"));
    const data = await res.json();

    expect(data.collaborator.name).toBe("Zara Scientist");
    expect(data.collaborator.institution).toBe("Stanford");
    expect(data.collaborator.department).toBe("Chemistry");

    // Public profile fields
    expect(data.collaborator.profile.researchSummary).toBe(
      "Zara develops proteomics methods..."
    );
    expect(data.collaborator.profile.techniques).toEqual([
      "mass spectrometry",
      "phosphoproteomics",
    ]);
    expect(data.collaborator.profile.experimentalModels).toEqual([
      "patient-derived xenografts",
    ]);
    expect(data.collaborator.profile.diseaseAreas).toEqual(["lung cancer"]);
    expect(data.collaborator.profile.keyTargets).toEqual(["EGFR"]);
    expect(data.collaborator.profile.grantTitles).toEqual([
      "NSF grant on proteomics",
    ]);

    // Privacy: userSubmittedTexts and keywords must NOT be in the response
    expect(data.collaborator.profile.userSubmittedTexts).toBeUndefined();
    expect(data.collaborator.profile.keywords).toBeUndefined();

    // Publications
    expect(data.collaborator.publications).toHaveLength(1);
    expect(data.collaborator.publications[0].title).toBe(
      "Novel mass spec method for phosphoproteomics"
    );
    expect(data.collaborator.publications[0].pmid).toBe("87654321");
    // Abstracts must NOT be included
    expect(data.collaborator.publications[0].abstract).toBeUndefined();
  });

  it("resolves anchoring publications to actual records", async () => {
    /** AnchoringPublicationIds are UUIDs that should be resolved to
     *  publication records with pmid, title, journal, year, authorPosition. */
    mockGetServerSession.mockResolvedValue({ user: { id: "user-aaa" } });
    mockFindUnique.mockResolvedValue(makeDetailProposal() as never);
    mockPublicationFindMany.mockResolvedValue([
      {
        id: "pub-1",
        pmid: "11111111",
        title: "Anchoring paper 1",
        journal: "Cell",
        year: 2024,
        authorPosition: "first",
      },
      {
        id: "pub-2",
        pmid: "22222222",
        title: "Anchoring paper 2",
        journal: "Nature",
        year: 2023,
        authorPosition: "last",
      },
    ] as never);

    const res = await GET(...makeRouteArgs("proposal-1"));
    const data = await res.json();

    expect(data.anchoringPublications).toHaveLength(2);
    expect(data.anchoringPublications[0].pmid).toBe("11111111");
    expect(data.anchoringPublications[1].title).toBe("Anchoring paper 2");

    // Verify the Prisma query used the correct IDs
    expect(mockPublicationFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: { in: ["pub-1", "pub-2"] } },
      })
    );
  });

  it("returns empty array for proposals with no anchoring publications", async () => {
    /** Proposals may have no anchoring publications; the array should be empty. */
    mockGetServerSession.mockResolvedValue({ user: { id: "user-aaa" } });
    mockFindUnique.mockResolvedValue(
      makeDetailProposal({ anchoringPublicationIds: [] }) as never
    );

    const res = await GET(...makeRouteArgs("proposal-1"));
    const data = await res.json();

    expect(data.anchoringPublications).toEqual([]);
    // Should NOT query publications when array is empty
    expect(mockPublicationFindMany).not.toHaveBeenCalled();
  });

  it("handles collaborator with null department", async () => {
    /** Some collaborators have no department set. */
    mockGetServerSession.mockResolvedValue({ user: { id: "user-aaa" } });
    mockFindUnique.mockResolvedValue(
      makeDetailProposal({
        researcherB: {
          id: "user-zzz",
          name: "Zara Scientist",
          institution: "Stanford",
          department: null,
          profile: {
            researchSummary: "Zara develops proteomics methods...",
            techniques: ["mass spectrometry"],
            experimentalModels: [],
            diseaseAreas: ["lung cancer"],
            keyTargets: ["EGFR"],
            grantTitles: [],
          },
          publications: [],
        },
      }) as never
    );
    mockPublicationFindMany.mockResolvedValue([]);

    const res = await GET(...makeRouteArgs("proposal-1"));
    const data = await res.json();

    expect(data.collaborator.department).toBeNull();
  });

  it("handles collaborator with no profile (deleted account or data issue)", async () => {
    /** If the collaborator's profile was deleted, profile should be null. */
    mockGetServerSession.mockResolvedValue({ user: { id: "user-aaa" } });
    mockFindUnique.mockResolvedValue(
      makeDetailProposal({
        researcherB: {
          id: "user-zzz",
          name: "Zara Scientist",
          institution: "Stanford",
          department: null,
          profile: null,
          publications: [],
        },
      }) as never
    );
    mockPublicationFindMany.mockResolvedValue([]);

    const res = await GET(...makeRouteArgs("proposal-1"));
    const data = await res.json();

    expect(data.collaborator.profile).toBeNull();
    expect(data.collaborator.publications).toEqual([]);
  });

  it("includes all metadata fields in the response", async () => {
    /** The response should include id, confidenceTier, isUpdated, and createdAt. */
    mockGetServerSession.mockResolvedValue({ user: { id: "user-aaa" } });
    mockFindUnique.mockResolvedValue(makeDetailProposal() as never);
    mockPublicationFindMany.mockResolvedValue([]);

    const res = await GET(...makeRouteArgs("proposal-1"));
    const data = await res.json();

    expect(data.id).toBe("proposal-1");
    expect(data.confidenceTier).toBe("high");
    expect(data.isUpdated).toBe(false);
    expect(data.collaborationType).toBe("Methodological Enhancement");
  });
});
