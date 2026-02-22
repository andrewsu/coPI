/**
 * Tests for profile pipeline orchestration service.
 *
 * Validates that the pipeline correctly coordinates all component services
 * (ORCID, PubMed, PMC, ID Converter, LLM synthesis) and stores results
 * in the database. Each external dependency is mocked; the tests verify
 * data flow, edge case handling, and correct database operations.
 */

import type { PrismaClient } from "@prisma/client";
import type Anthropic from "@anthropic-ai/sdk";
import { createHash } from "crypto";
import {
  runProfilePipeline,
  extractLastName,
  computeAbstractsHash,
  parseUserSubmittedTexts,
  getNcbiDelayMs,
} from "../profile-pipeline";
import * as orcidLib from "@/lib/orcid";
import * as pubmedLib from "@/lib/pubmed";
import * as pmcLib from "@/lib/pmc";
import * as idConverterLib from "@/lib/ncbi-id-converter";
import * as synthesisService from "../profile-synthesis";

// --- Mock all external dependencies ---

jest.mock("@/lib/orcid");
jest.mock("@/lib/pubmed");
jest.mock("@/lib/pmc");
jest.mock("@/lib/ncbi-id-converter");
jest.mock("../profile-synthesis");

const mockOrcid = jest.mocked(orcidLib);
const mockPubmed = jest.mocked(pubmedLib);
const mockPmc = jest.mocked(pmcLib);
const mockIdConverter = jest.mocked(idConverterLib);
const mockSynthesis = jest.mocked(synthesisService);

// --- Mock PrismaClient ---

function createMockDb() {
  return {
    publication: {
      deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
      createMany: jest.fn().mockResolvedValue({ count: 0 }),
    },
    researcherProfile: {
      findUnique: jest.fn().mockResolvedValue(null),
      create: jest.fn().mockImplementation(({ data }) =>
        Promise.resolve({
          id: "profile-uuid-1",
          userId: data.userId,
          profileVersion: data.profileVersion ?? 1,
          ...data,
        }),
      ),
      update: jest.fn().mockImplementation(({ data }) =>
        Promise.resolve({
          id: "profile-uuid-1",
          profileVersion: data.profileVersion ?? 2,
          ...data,
        }),
      ),
    },
  } as unknown as PrismaClient;
}

const mockLlm = {} as Anthropic;

// --- Sample data ---

const SAMPLE_PROFILE: orcidLib.OrcidProfile = {
  orcid: "0000-0001-2345-6789",
  name: "Jane Smith",
  email: "jane@example.com",
  institution: "MIT",
  department: "Biology",
  labWebsiteUrl: "https://smith-lab.mit.edu",
};

const SAMPLE_WORKS: orcidLib.OrcidWork[] = [
  {
    title: "CRISPR screens in pancreatic cancer",
    pmid: "11111",
    pmcid: null,
    doi: "10.1038/paper1",
    type: "journal-article",
    year: 2024,
    journal: "Nature",
  },
  {
    title: "Single-cell RNA-seq of tumor microenvironment",
    pmid: "22222",
    pmcid: "PMC100",
    doi: "10.1126/paper2",
    type: "journal-article",
    year: 2023,
    journal: "Science",
  },
  {
    title: "Organoid models of KRAS-mutant PDAC",
    pmid: null,
    pmcid: null,
    doi: "10.1016/paper3",
    type: "journal-article",
    year: 2022,
    journal: "Cell",
  },
  {
    title: "HRI kinase in the integrated stress response",
    pmid: "44444",
    pmcid: null,
    doi: null,
    type: "journal-article",
    year: 2021,
    journal: "Molecular Cell",
  },
  {
    title: "Mass spectrometry of KRAS interactome",
    pmid: "55555",
    pmcid: null,
    doi: null,
    type: "journal-article",
    year: 2020,
    journal: "Cell Reports",
  },
];

function makePubMedArticle(overrides: Partial<pubmedLib.PubMedArticle> = {}): pubmedLib.PubMedArticle {
  return {
    pmid: "11111",
    pmcid: null,
    doi: "10.1038/paper1",
    title: "CRISPR screens in pancreatic cancer",
    abstract: "We performed genome-wide CRISPR screens...",
    journal: "Nature",
    year: 2024,
    articleType: "research-article",
    authors: [
      { lastName: "Doe", foreName: "John", initials: "J" },
      { lastName: "Smith", foreName: "Jane", initials: "J" },
    ],
    ...overrides,
  };
}

const SAMPLE_PUBMED_ARTICLES: pubmedLib.PubMedArticle[] = [
  makePubMedArticle({
    pmid: "11111",
    doi: "10.1038/paper1",
    title: "CRISPR screens in pancreatic cancer",
    abstract: "We performed genome-wide CRISPR screens...",
    year: 2024,
    journal: "Nature",
  }),
  makePubMedArticle({
    pmid: "22222",
    pmcid: "PMC100",
    doi: "10.1126/paper2",
    title: "Single-cell RNA-seq of tumor microenvironment",
    abstract: "Single-cell RNA sequencing reveals...",
    year: 2023,
    journal: "Science",
  }),
  makePubMedArticle({
    pmid: "33333",
    doi: "10.1016/paper3",
    title: "Organoid models of KRAS-mutant PDAC",
    abstract: "Patient-derived organoids recapitulate...",
    year: 2022,
    journal: "Cell",
  }),
  makePubMedArticle({
    pmid: "44444",
    doi: null,
    title: "HRI kinase in the integrated stress response",
    abstract: "HRI phosphorylates eIF2alpha...",
    year: 2021,
    journal: "Molecular Cell",
  }),
  makePubMedArticle({
    pmid: "55555",
    doi: null,
    title: "Mass spectrometry of KRAS interactome",
    abstract: "Quantitative proteomics identifies...",
    year: 2020,
    journal: "Cell Reports",
  }),
];

const SAMPLE_SYNTHESIS_RESULT: synthesisService.ProfileSynthesisResult = {
  output: {
    research_summary:
      Array(150).fill("word").join(" "),
    techniques: ["CRISPR-Cas9 screening", "single-cell RNA-seq", "mass spectrometry"],
    experimental_models: ["pancreatic organoids", "K562 cells"],
    disease_areas: ["pancreatic ductal adenocarcinoma"],
    key_targets: ["KRAS-G12D", "HRI kinase"],
    keywords: ["integrated stress response"],
  },
  valid: true,
  validation: {
    valid: true,
    errors: [],
    summaryWordCount: 150,
    techniquesCount: 3,
    diseaseAreasCount: 1,
    keyTargetsCount: 2,
  },
  attempts: 1,
  model: "claude-opus-4-20250514",
  retried: false,
};

// --- Test helpers ---

/**
 * Runs the pipeline with fake timers so rate-limiting delays don't slow tests.
 * jest.advanceTimersByTimeAsync resolves pending timers AND microtasks between
 * them, correctly handling the interleaved async flow of delay → API call → delay.
 */
async function runPipelineWithTimers(
  ...args: Parameters<typeof runProfilePipeline>
) {
  const promise = runProfilePipeline(...args);
  // Advance fake timers enough to cover all possible delays in the pipeline
  // (up to ~6 NCBI calls × 350ms each = ~2100ms, use 10s for safety margin)
  await jest.advanceTimersByTimeAsync(10000);
  return promise;
}

// --- Test setup ---

describe("profile-pipeline", () => {
  let mockDb: ReturnType<typeof createMockDb>;

  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();
    mockDb = createMockDb();

    // Default mocks for all external services
    mockOrcid.fetchOrcidProfile.mockResolvedValue(SAMPLE_PROFILE);
    mockOrcid.fetchOrcidGrantTitles.mockResolvedValue([
      "NIH R01 - KRAS signaling in PDAC",
      "NCI U54 - Tumor microenvironment atlas",
    ]);
    mockOrcid.fetchOrcidWorks.mockResolvedValue(SAMPLE_WORKS);

    mockPubmed.fetchPubMedAbstracts.mockResolvedValue(SAMPLE_PUBMED_ARTICLES);
    // Use the real determineAuthorPosition function (pure function, no I/O)
    mockPubmed.determineAuthorPosition.mockImplementation(
      jest.requireActual<typeof pubmedLib>("@/lib/pubmed").determineAuthorPosition,
    );

    // DOI→PMID conversion for the one DOI-only work (10.1016/paper3)
    mockIdConverter.convertDoisToPmids.mockResolvedValue([
      { pmid: "33333", pmcid: null, doi: "10.1016/paper3", errmsg: null },
    ]);

    // PMID→PMCID conversion (for deep mining)
    mockIdConverter.convertPmidsToPmcids.mockResolvedValue([
      { pmid: "11111", pmcid: "PMC200", doi: "10.1038/paper1", errmsg: null },
      { pmid: "33333", pmcid: null, doi: "10.1016/paper3", errmsg: "not open access" },
      { pmid: "44444", pmcid: "PMC300", doi: null, errmsg: null },
      { pmid: "55555", pmcid: null, doi: null, errmsg: "not open access" },
    ]);

    // PMC methods sections
    mockPmc.fetchMethodsSections.mockResolvedValue([
      { pmcid: "PMC100", methodsText: "Methods from PMC100: we cultured cells..." },
      { pmcid: "PMC200", methodsText: "Methods from PMC200: CRISPR library was..." },
      { pmcid: "PMC300", methodsText: null },
    ]);

    mockSynthesis.synthesizeProfile.mockResolvedValue(SAMPLE_SYNTHESIS_RESULT);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  // --- Happy path ---

  it("runs the full pipeline: ORCID → PubMed → PMC → synthesis → store", async () => {
    /** Verifies the complete pipeline orchestration with all steps succeeding. */
    const result = await runPipelineWithTimers(
      mockDb as unknown as PrismaClient,
      mockLlm,
      "user-1",
      "0000-0001-2345-6789",
    );

    // ORCID calls made with correct ORCID ID
    expect(mockOrcid.fetchOrcidProfile).toHaveBeenCalledWith(
      "0000-0001-2345-6789",
      undefined,
    );
    expect(mockOrcid.fetchOrcidGrantTitles).toHaveBeenCalledWith(
      "0000-0001-2345-6789",
      undefined,
    );
    expect(mockOrcid.fetchOrcidWorks).toHaveBeenCalledWith(
      "0000-0001-2345-6789",
      undefined,
    );

    // DOI→PMID conversion for the DOI-only work
    expect(mockIdConverter.convertDoisToPmids).toHaveBeenCalledWith([
      "10.1016/paper3",
    ]);

    // PubMed called with all PMIDs (direct + resolved from DOI)
    expect(mockPubmed.fetchPubMedAbstracts).toHaveBeenCalledWith(
      expect.arrayContaining(["11111", "22222", "44444", "55555", "33333"]),
    );

    // PMID→PMCID conversion for articles without PMCIDs
    expect(mockIdConverter.convertPmidsToPmcids).toHaveBeenCalled();

    // PMC methods sections fetched
    expect(mockPmc.fetchMethodsSections).toHaveBeenCalled();

    // Synthesis called with assembled input
    expect(mockSynthesis.synthesizeProfile).toHaveBeenCalledWith(
      mockLlm,
      expect.objectContaining({
        name: "Jane Smith",
        affiliation: "MIT, Biology",
        labWebsite: "https://smith-lab.mit.edu",
        grantTitles: [
          "NIH R01 - KRAS signaling in PDAC",
          "NCI U54 - Tumor microenvironment atlas",
        ],
      }),
    );

    // Publications stored
    expect(mockDb.publication.deleteMany).toHaveBeenCalledWith({
      where: { userId: "user-1" },
    });
    expect(mockDb.publication.createMany).toHaveBeenCalledWith({
      data: expect.arrayContaining([
        expect.objectContaining({ userId: "user-1", pmid: "11111" }),
        expect.objectContaining({ userId: "user-1", pmid: "22222" }),
      ]),
    });

    // Profile created (no existing profile)
    expect(mockDb.researcherProfile.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        userId: "user-1",
        researchSummary: expect.any(String),
        techniques: ["CRISPR-Cas9 screening", "single-cell RNA-seq", "mass spectrometry"],
        grantTitles: [
          "NIH R01 - KRAS signaling in PDAC",
          "NCI U54 - Tumor microenvironment atlas",
        ],
        profileVersion: 1,
        rawAbstractsHash: expect.any(String),
        profileGeneratedAt: expect.any(Date),
      }),
    });

    // Result shape
    expect(result.userId).toBe("user-1");
    expect(result.profileCreated).toBe(true);
    expect(result.publicationsStored).toBe(5); // 5 from PubMed, 0 unresolved DOI
    expect(result.synthesis).toBe(SAMPLE_SYNTHESIS_RESULT);
    expect(result.warnings).toEqual([]);
    expect(result.profileVersion).toBe(1);
  });

  it("passes ORCID access token when provided", async () => {
    /** Verifies that the access token is forwarded to all ORCID API calls. */
    await runPipelineWithTimers(
      mockDb as unknown as PrismaClient,
      mockLlm,
      "user-1",
      "0000-0001-2345-6789",
      { accessToken: "my-oauth-token" },
    );

    expect(mockOrcid.fetchOrcidProfile).toHaveBeenCalledWith(
      "0000-0001-2345-6789",
      "my-oauth-token",
    );
    expect(mockOrcid.fetchOrcidGrantTitles).toHaveBeenCalledWith(
      "0000-0001-2345-6789",
      "my-oauth-token",
    );
    expect(mockOrcid.fetchOrcidWorks).toHaveBeenCalledWith(
      "0000-0001-2345-6789",
      "my-oauth-token",
    );
  });

  // --- Existing profile (update path) ---

  it("updates existing profile and increments profileVersion", async () => {
    /** Verifies that running the pipeline on a user with an existing profile
     *  bumps the version number and uses update instead of create. */
    const existingProfile = {
      id: "profile-uuid-1",
      userId: "user-1",
      profileVersion: 3,
      userSubmittedTexts: [
        { label: "Current focus", content: "I am studying KRAS signaling." },
      ],
    };
    (mockDb.researcherProfile.findUnique as jest.Mock).mockResolvedValue(
      existingProfile,
    );
    (mockDb.researcherProfile.update as jest.Mock).mockResolvedValue({
      ...existingProfile,
      profileVersion: 4,
    });

    const result = await runPipelineWithTimers(
      mockDb as unknown as PrismaClient,
      mockLlm,
      "user-1",
      "0000-0001-2345-6789",
    );

    expect(result.profileCreated).toBe(false);
    expect(result.profileVersion).toBe(4);
    expect(mockDb.researcherProfile.update).toHaveBeenCalledWith({
      where: { userId: "user-1" },
      data: expect.objectContaining({
        profileVersion: 4,
      }),
    });
    expect(mockDb.researcherProfile.create).not.toHaveBeenCalled();
  });

  it("passes existing user-submitted texts to synthesis", async () => {
    /** Verifies that user-submitted texts from an existing profile are included
     *  in the synthesis input (spec: user priorities inform synthesis). */
    const existingProfile = {
      id: "profile-uuid-1",
      userId: "user-1",
      profileVersion: 1,
      userSubmittedTexts: [
        { label: "Research direction", content: "Studying KRAS synthetic lethality." },
        { label: "Methods expertise", content: "Expert in organoid culture." },
      ],
    };
    (mockDb.researcherProfile.findUnique as jest.Mock).mockResolvedValue(
      existingProfile,
    );
    (mockDb.researcherProfile.update as jest.Mock).mockResolvedValue({
      ...existingProfile,
      profileVersion: 2,
    });

    await runPipelineWithTimers(
      mockDb as unknown as PrismaClient,
      mockLlm,
      "user-1",
      "0000-0001-2345-6789",
    );

    const synthesisCall = mockSynthesis.synthesizeProfile.mock.calls[0]!;
    const input = synthesisCall[1] as { userSubmittedTexts: { label: string; content: string }[] };
    expect(input.userSubmittedTexts).toEqual([
      { label: "Research direction", content: "Studying KRAS synthetic lethality." },
      { label: "Methods expertise", content: "Expert in organoid culture." },
    ]);
  });

  // --- Sparse ORCID ---

  it("warns when ORCID has fewer than 5 works", async () => {
    /** Spec: "If fewer than 5 entries, nudge the user to update their ORCID profile." */
    mockOrcid.fetchOrcidWorks.mockResolvedValue([
      SAMPLE_WORKS[0]!,
      SAMPLE_WORKS[1]!,
    ]);
    mockPubmed.fetchPubMedAbstracts.mockResolvedValue([
      SAMPLE_PUBMED_ARTICLES[0]!,
      SAMPLE_PUBMED_ARTICLES[1]!,
    ]);

    const result = await runPipelineWithTimers(
      mockDb as unknown as PrismaClient,
      mockLlm,
      "user-1",
      "0000-0001-2345-6789",
    );

    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toMatch(/2 publications/);
    expect(result.warnings[0]).toMatch(/orcid.org/);
  });

  // --- Zero publications ---

  it("handles researchers with zero publications", async () => {
    /** Spec: "Profile can still be generated from grants + user-submitted text." */
    mockOrcid.fetchOrcidWorks.mockResolvedValue([]);

    const result = await runPipelineWithTimers(
      mockDb as unknown as PrismaClient,
      mockLlm,
      "user-1",
      "0000-0001-2345-6789",
    );

    // No PubMed/PMC/ID converter calls
    expect(mockPubmed.fetchPubMedAbstracts).not.toHaveBeenCalled();
    expect(mockIdConverter.convertDoisToPmids).not.toHaveBeenCalled();
    expect(mockIdConverter.convertPmidsToPmcids).not.toHaveBeenCalled();
    expect(mockPmc.fetchMethodsSections).not.toHaveBeenCalled();

    // No publications stored
    expect(mockDb.publication.createMany).not.toHaveBeenCalled();

    // Synthesis still called with grants and name
    expect(mockSynthesis.synthesizeProfile).toHaveBeenCalledWith(
      mockLlm,
      expect.objectContaining({
        name: "Jane Smith",
        publications: [],
        grantTitles: [
          "NIH R01 - KRAS signaling in PDAC",
          "NCI U54 - Tumor microenvironment atlas",
        ],
      }),
    );

    expect(result.publicationsStored).toBe(0);
    expect(result.warnings).toHaveLength(1); // sparse ORCID warning
  });

  // --- DOI-only works ---

  it("resolves DOI-only works to PMIDs and fetches their abstracts", async () => {
    /** Spec: "Use NCBI ID converter to resolve to PMIDs where possible." */
    // All works have DOIs only — no PMIDs
    mockOrcid.fetchOrcidWorks.mockResolvedValue([
      { title: "Paper A", pmid: null, pmcid: null, doi: "10.1/a", type: "journal-article", year: 2024, journal: "Nature" },
      { title: "Paper B", pmid: null, pmcid: null, doi: "10.1/b", type: "journal-article", year: 2023, journal: "Science" },
    ]);
    mockIdConverter.convertDoisToPmids.mockResolvedValue([
      { pmid: "99001", pmcid: null, doi: "10.1/a", errmsg: null },
      { pmid: null, pmcid: null, doi: "10.1/b", errmsg: "not found" },
    ]);
    mockPubmed.fetchPubMedAbstracts.mockResolvedValue([
      makePubMedArticle({ pmid: "99001", doi: "10.1/a", title: "Paper A" }),
    ]);
    mockIdConverter.convertPmidsToPmcids.mockResolvedValue([]);

    const result = await runPipelineWithTimers(
      mockDb as unknown as PrismaClient,
      mockLlm,
      "user-1",
      "0000-0001-2345-6789",
    );

    // DOI conversion called for both DOI-only works
    expect(mockIdConverter.convertDoisToPmids).toHaveBeenCalledWith([
      "10.1/a",
      "10.1/b",
    ]);

    // PubMed called with the resolved PMID
    expect(mockPubmed.fetchPubMedAbstracts).toHaveBeenCalledWith(["99001"]);

    // 1 from PubMed + 1 unresolved DOI-only record
    expect(result.publicationsStored).toBe(2);

    // Verify unresolved DOI work stored as minimal record
    const createManyData = (mockDb.publication.createMany as jest.Mock).mock
      .calls[0]![0].data;
    const unresolvedRecord = createManyData.find(
      (r: { doi: string | null }) => r.doi === "10.1/b",
    );
    expect(unresolvedRecord).toMatchObject({
      pmid: null,
      doi: "10.1/b",
      abstract: "",
      authorPosition: "middle",
    });
  });

  // --- Deep mining disabled ---

  it("skips PMC methods fetching when deepMining is false", async () => {
    /** Verifies that deep mining can be disabled, skipping all PMC and
     *  PMID→PMCID conversion calls. */
    await runPipelineWithTimers(
      mockDb as unknown as PrismaClient,
      mockLlm,
      "user-1",
      "0000-0001-2345-6789",
      { deepMining: false },
    );

    expect(mockIdConverter.convertPmidsToPmcids).not.toHaveBeenCalled();
    expect(mockPmc.fetchMethodsSections).not.toHaveBeenCalled();

    // Synthesis input should have no methods text
    const synthesisCall = mockSynthesis.synthesizeProfile.mock.calls[0]!;
    const input = synthesisCall[1] as { publications: { methodsText?: string }[] };
    for (const pub of input.publications) {
      expect(pub.methodsText).toBeUndefined();
    }
  });

  // --- Methods data flows into synthesis and publication storage ---

  it("attaches methods text to publications and synthesis input", async () => {
    /** Verifies that methods sections fetched from PMC are both stored on
     *  Publication records and passed through to the synthesis input. */
    await runPipelineWithTimers(
      mockDb as unknown as PrismaClient,
      mockLlm,
      "user-1",
      "0000-0001-2345-6789",
    );

    // Check publication records include methods text
    const createManyData = (mockDb.publication.createMany as jest.Mock).mock
      .calls[0]![0].data;
    const articleWithMethods = createManyData.find(
      (r: { pmid: string | null }) => r.pmid === "22222",
    );
    expect(articleWithMethods?.methodsText).toBe(
      "Methods from PMC100: we cultured cells...",
    );

    // Article with PMCID from conversion (PMC200 for PMID 11111) also gets methods
    const convertedArticle = createManyData.find(
      (r: { pmid: string | null }) => r.pmid === "11111",
    );
    expect(convertedArticle?.methodsText).toBe(
      "Methods from PMC200: CRISPR library was...",
    );

    // Synthesis input includes methods text
    const synthesisCall = mockSynthesis.synthesizeProfile.mock.calls[0]!;
    const input = synthesisCall[1] as { publications: { title: string; methodsText?: string }[] };
    const synthPubWithMethods = input.publications.find(
      (p) => p.title === "Single-cell RNA-seq of tumor microenvironment",
    );
    expect(synthPubWithMethods?.methodsText).toBe(
      "Methods from PMC100: we cultured cells...",
    );
  });

  // --- Synthesis failure ---

  it("stores minimal profile when synthesis produces no output", async () => {
    /** Spec: "If it fails again, save what we have and flag for review."
     *  Verifies that a completely failed synthesis still creates a profile
     *  record with empty fields and grant titles. */
    mockSynthesis.synthesizeProfile.mockResolvedValue({
      output: null,
      valid: false,
      validation: null,
      attempts: 2,
      model: "claude-opus-4-20250514",
      retried: true,
    });

    const result = await runPipelineWithTimers(
      mockDb as unknown as PrismaClient,
      mockLlm,
      "user-1",
      "0000-0001-2345-6789",
    );

    expect(result.synthesis.valid).toBe(false);
    expect(result.profileCreated).toBe(true);

    expect(mockDb.researcherProfile.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        researchSummary: "",
        techniques: [],
        experimentalModels: [],
        diseaseAreas: [],
        keyTargets: [],
        keywords: [],
        grantTitles: [
          "NIH R01 - KRAS signaling in PDAC",
          "NCI U54 - Tumor microenvironment atlas",
        ],
      }),
    });
  });

  // --- Affiliation formatting ---

  it("formats affiliation from institution and department", async () => {
    /** Verifies that institution + department are joined for synthesis input. */
    await runPipelineWithTimers(
      mockDb as unknown as PrismaClient,
      mockLlm,
      "user-1",
      "0000-0001-2345-6789",
    );

    const synthesisCall = mockSynthesis.synthesizeProfile.mock.calls[0]!;
    const input = synthesisCall[1] as { affiliation: string };
    expect(input.affiliation).toBe("MIT, Biology");
  });

  it("uses 'Unknown' when institution and department are both null", async () => {
    /** Edge case: ORCID profile with no employment data. */
    mockOrcid.fetchOrcidProfile.mockResolvedValue({
      ...SAMPLE_PROFILE,
      institution: null,
      department: null,
    });

    await runPipelineWithTimers(
      mockDb as unknown as PrismaClient,
      mockLlm,
      "user-1",
      "0000-0001-2345-6789",
    );

    const synthesisCall = mockSynthesis.synthesizeProfile.mock.calls[0]!;
    const input = synthesisCall[1] as { affiliation: string };
    expect(input.affiliation).toBe("Unknown");
  });

  it("uses institution only when department is null", async () => {
    mockOrcid.fetchOrcidProfile.mockResolvedValue({
      ...SAMPLE_PROFILE,
      department: null,
    });

    await runPipelineWithTimers(
      mockDb as unknown as PrismaClient,
      mockLlm,
      "user-1",
      "0000-0001-2345-6789",
    );

    const synthesisCall = mockSynthesis.synthesizeProfile.mock.calls[0]!;
    const input = synthesisCall[1] as { affiliation: string };
    expect(input.affiliation).toBe("MIT");
  });

  // --- Publications stored as full refresh ---

  it("deletes existing publications before storing new ones", async () => {
    /** Pipeline does a full refresh: delete all old publications, then insert new. */
    await runPipelineWithTimers(
      mockDb as unknown as PrismaClient,
      mockLlm,
      "user-1",
      "0000-0001-2345-6789",
    );

    const deleteCall = (mockDb.publication.deleteMany as jest.Mock).mock.calls[0]!;
    expect(deleteCall[0]).toEqual({ where: { userId: "user-1" } });

    // Delete happens before create
    const deleteOrder = (mockDb.publication.deleteMany as jest.Mock).mock.invocationCallOrder[0]!;
    const createOrder = (mockDb.publication.createMany as jest.Mock).mock.invocationCallOrder[0]!;
    expect(deleteOrder).toBeLessThan(createOrder);
  });

  // --- Abstracts hash ---

  it("computes a consistent abstracts hash for change detection", async () => {
    /** Verifies the raw_abstracts_hash is a SHA-256 hash of sorted abstracts. */
    await runPipelineWithTimers(
      mockDb as unknown as PrismaClient,
      mockLlm,
      "user-1",
      "0000-0001-2345-6789",
    );

    const createData = (mockDb.researcherProfile.create as jest.Mock).mock
      .calls[0]![0].data;
    expect(createData.rawAbstractsHash).toMatch(/^[a-f0-9]{64}$/);

    // Verify it matches expected hash
    const expectedHash = computeAbstractsHash(SAMPLE_PUBMED_ARTICLES);
    expect(createData.rawAbstractsHash).toBe(expectedHash);
  });

  // --- ORCID propagation errors ---

  it("propagates ORCID API errors", async () => {
    /** Verifies that pipeline doesn't silently swallow ORCID failures. */
    mockOrcid.fetchOrcidProfile.mockRejectedValue(
      new Error("ORCID person API error: 503 Service Unavailable"),
    );

    await expect(
      runProfilePipeline(
        mockDb as unknown as PrismaClient,
        mockLlm,
        "user-1",
        "0000-0001-2345-6789",
      ),
    ).rejects.toThrow("ORCID person API error");
  });

  // --- onProgress callback ---

  it("calls onProgress callback at each major stage in order", async () => {
    /** Verifies that the pipeline reports progress for the onboarding UI.
     *  The four stages correspond to spec messages:
     *  fetching_orcid → "Pulling your publications..."
     *  fetching_publications → "Pulling your publications..."
     *  mining_methods → "Analyzing your research..."
     *  synthesizing → "Building your profile..." */
    const onProgress = jest.fn();

    await runPipelineWithTimers(
      mockDb as unknown as PrismaClient,
      mockLlm,
      "user-1",
      "0000-0001-2345-6789",
      { onProgress },
    );

    expect(onProgress).toHaveBeenCalledWith("fetching_orcid");
    expect(onProgress).toHaveBeenCalledWith("fetching_publications");
    expect(onProgress).toHaveBeenCalledWith("mining_methods");
    expect(onProgress).toHaveBeenCalledWith("synthesizing");

    // Verify correct ordering
    const calls = onProgress.mock.calls.map((c: [string]) => c[0]);
    const orcidIdx = calls.indexOf("fetching_orcid");
    const pubIdx = calls.indexOf("fetching_publications");
    const miningIdx = calls.indexOf("mining_methods");
    const synthIdx = calls.indexOf("synthesizing");
    expect(orcidIdx).toBeLessThan(pubIdx);
    expect(pubIdx).toBeLessThan(miningIdx);
    expect(miningIdx).toBeLessThan(synthIdx);
  });

  it("does not throw when onProgress is not provided", async () => {
    /** Backward compatibility: pipeline works fine without progress callback. */
    await expect(
      runPipelineWithTimers(
        mockDb as unknown as PrismaClient,
        mockLlm,
        "user-1",
        "0000-0001-2345-6789",
      ),
    ).resolves.toBeDefined();
  });

  // --- Works with only PMIDs (no DOIs) ---

  it("skips DOI conversion when all works have PMIDs", async () => {
    /** No DOI-only works → no call to convertDoisToPmids. */
    mockOrcid.fetchOrcidWorks.mockResolvedValue([
      { ...SAMPLE_WORKS[0]!, pmid: "11111" },
      { ...SAMPLE_WORKS[1]!, pmid: "22222" },
      { ...SAMPLE_WORKS[3]!, pmid: "44444" },
      { ...SAMPLE_WORKS[4]!, pmid: "55555" },
      { title: "Extra paper", pmid: "66666", pmcid: null, doi: null, type: "journal-article", year: 2019, journal: "JBC" },
    ]);
    mockPubmed.fetchPubMedAbstracts.mockResolvedValue(
      SAMPLE_PUBMED_ARTICLES.slice(0, 5),
    );

    await runPipelineWithTimers(
      mockDb as unknown as PrismaClient,
      mockLlm,
      "user-1",
      "0000-0001-2345-6789",
    );

    expect(mockIdConverter.convertDoisToPmids).not.toHaveBeenCalled();
  });
});

// --- Unit tests for helper functions ---

describe("extractLastName", () => {
  it("extracts last token from full name", () => {
    expect(extractLastName("Jane Smith")).toBe("Smith");
  });

  it("handles single-word names", () => {
    expect(extractLastName("Madonna")).toBe("Madonna");
  });

  it("handles multi-part names", () => {
    expect(extractLastName("Jean-Pierre van der Berg")).toBe("Berg");
  });

  it("handles empty string", () => {
    expect(extractLastName("")).toBe("");
  });
});

describe("computeAbstractsHash", () => {
  it("produces a 64-character hex SHA-256 hash", () => {
    const hash = computeAbstractsHash([
      makePubMedArticle({ abstract: "hello" }),
    ]);
    expect(hash).toMatch(/^[a-f0-9]{64}$/);
  });

  it("produces the same hash regardless of input order", () => {
    /** Hashing is order-independent: articles sorted before hashing. */
    const articles = [
      makePubMedArticle({ pmid: "1", abstract: "beta" }),
      makePubMedArticle({ pmid: "2", abstract: "alpha" }),
    ];
    const hash1 = computeAbstractsHash(articles);
    const hash2 = computeAbstractsHash([articles[1]!, articles[0]!]);
    expect(hash1).toBe(hash2);
  });

  it("produces empty-string hash for no articles", () => {
    const hash = computeAbstractsHash([]);
    const expected = createHash("sha256").update("").digest("hex");
    expect(hash).toBe(expected);
  });
});

describe("parseUserSubmittedTexts", () => {
  it("parses valid JSONB array", () => {
    const result = parseUserSubmittedTexts([
      { label: "Focus", content: "Studying KRAS" },
      { label: "Methods", content: "Expert in organoids" },
    ]);
    expect(result).toEqual([
      { label: "Focus", content: "Studying KRAS" },
      { label: "Methods", content: "Expert in organoids" },
    ]);
  });

  it("returns empty array for null input", () => {
    expect(parseUserSubmittedTexts(null)).toEqual([]);
  });

  it("returns empty array for non-array input", () => {
    expect(parseUserSubmittedTexts("not an array")).toEqual([]);
    expect(parseUserSubmittedTexts(42)).toEqual([]);
    expect(parseUserSubmittedTexts({})).toEqual([]);
  });

  it("filters out entries missing label or content", () => {
    const result = parseUserSubmittedTexts([
      { label: "Good", content: "Valid entry" },
      { label: "Missing content" },
      { content: "Missing label" },
      { other: "irrelevant" },
    ]);
    expect(result).toEqual([{ label: "Good", content: "Valid entry" }]);
  });
});

describe("getNcbiDelayMs", () => {
  const originalEnv = process.env.NCBI_API_KEY;

  afterEach(() => {
    if (originalEnv !== undefined) {
      process.env.NCBI_API_KEY = originalEnv;
    } else {
      delete process.env.NCBI_API_KEY;
    }
  });

  it("returns shorter delay when NCBI_API_KEY is set", () => {
    process.env.NCBI_API_KEY = "test-key";
    expect(getNcbiDelayMs()).toBe(110);
  });

  it("returns longer delay when NCBI_API_KEY is not set", () => {
    delete process.env.NCBI_API_KEY;
    expect(getNcbiDelayMs()).toBe(350);
  });
});
