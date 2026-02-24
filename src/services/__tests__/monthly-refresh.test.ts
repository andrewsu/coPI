/**
 * Tests for monthly profile refresh service.
 *
 * WHY these tests exist:
 * This workflow has high branching complexity (new publication detection,
 * candidate diffing, and notification gating), so regressions here can
 * either spam users or silently skip important updates.
 */

// Required by buildUnsubscribeUrl which is now called when enqueuing refresh emails
process.env.NEXTAUTH_SECRET = "test-secret-for-monthly-refresh";

import type { PrismaClient } from "@prisma/client";
import type Anthropic from "@anthropic-ai/sdk";

import { runMonthlyRefresh } from "../monthly-refresh";
import * as orcidLib from "@/lib/orcid";
import * as pubmedLib from "@/lib/pubmed";
import * as pmcLib from "@/lib/pmc";
import * as idConverterLib from "@/lib/ncbi-id-converter";
import * as synthesisService from "../profile-synthesis";
import * as jobQueueLib from "@/lib/job-queue";

jest.mock("@/lib/orcid");
jest.mock("@/lib/pubmed");
jest.mock("@/lib/pmc");
jest.mock("@/lib/ncbi-id-converter");
jest.mock("../profile-synthesis");
jest.mock("@/lib/job-queue");

const mockOrcid = jest.mocked(orcidLib);
const mockPubmed = jest.mocked(pubmedLib);
const mockPmc = jest.mocked(pmcLib);
const mockIdConverter = jest.mocked(idConverterLib);
const mockSynthesis = jest.mocked(synthesisService);
const mockJobQueue = jest.mocked(jobQueueLib);

function createMockDb() {
  return {
    user: {
      findUnique: jest.fn(),
    },
    researcherProfile: {
      findUnique: jest.fn(),
      update: jest.fn().mockResolvedValue({}),
    },
    publication: {
      findMany: jest.fn(),
      createMany: jest.fn().mockResolvedValue({ count: 0 }),
    },
  } as unknown as PrismaClient;
}

const mockLlm = {} as Anthropic;

describe("runMonthlyRefresh", () => {
  let db: ReturnType<typeof createMockDb>;
  const enqueue = jest.fn().mockResolvedValue("email-job-1");

  async function runWithTimers(userId: string) {
    const promise = runMonthlyRefresh(db, mockLlm, userId);
    await jest.advanceTimersByTimeAsync(10000);
    return promise;
  }

  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();
    db = createMockDb();
    mockJobQueue.getJobQueue.mockReturnValue({
      enqueue,
    } as unknown as ReturnType<typeof jobQueueLib.getJobQueue>);

    (db.user.findUnique as jest.Mock).mockResolvedValue({
      id: "user-1",
      orcid: "0000-0001-2345-6789",
      name: "Jane Smith",
      institution: "MIT",
      department: "Biology",
      email: "jane@example.com",
      emailNotificationsEnabled: true,
      notifyProfileRefresh: true,
    });

    (db.researcherProfile.findUnique as jest.Mock).mockResolvedValue({
      userSubmittedTexts: [{ label: "Current priorities", content: "Focus on KRAS" }],
      techniques: ["crispr-cas9 screening"],
      experimentalModels: ["organoids"],
      diseaseAreas: ["pancreatic ductal adenocarcinoma"],
      keyTargets: ["kras-g12d"],
      keywords: ["tumor microenvironment"],
      grantTitles: ["R01 base grant"],
    });

    (db.publication.findMany as jest.Mock)
      .mockResolvedValueOnce([
        {
          pmid: "11111",
          doi: "10.1000/existing",
          title: "Existing publication",
          year: 2023,
          journal: "Nature",
        },
      ])
      .mockResolvedValueOnce([
        {
          title: "Existing publication",
          journal: "Nature",
          year: 2023,
          authorPosition: "last",
          abstract: "existing abstract",
          methodsText: null,
        },
        {
          title: "New publication",
          journal: "Science",
          year: 2025,
          authorPosition: "first",
          abstract: "new abstract",
          methodsText: "new methods",
        },
      ]);

    mockOrcid.fetchOrcidGrantTitles.mockResolvedValue(["R01 base grant", "U54 new grant"]);
    mockOrcid.fetchOrcidWorks.mockResolvedValue([
      {
        title: "Existing publication",
        pmid: "11111",
        pmcid: null,
        doi: "10.1000/existing",
        type: "journal-article",
        year: 2023,
        journal: "Nature",
      },
      {
        title: "New publication",
        pmid: "22222",
        pmcid: null,
        doi: "10.1000/new",
        type: "journal-article",
        year: 2025,
        journal: "Science",
      },
    ]);

    mockPubmed.fetchPubMedAbstracts.mockResolvedValue([
      {
        pmid: "22222",
        pmcid: null,
        doi: "10.1000/new",
        title: "New publication",
        abstract: "new abstract",
        journal: "Science",
        year: 2025,
        articleType: "research-article",
        authors: [
          { lastName: "Smith", foreName: "Jane", initials: "J" },
          { lastName: "Doe", foreName: "John", initials: "J" },
        ],
      },
    ]);

    mockPubmed.determineAuthorPosition.mockReturnValue("first");
    mockIdConverter.convertDoisToPmids.mockResolvedValue([]);
    mockIdConverter.convertPmidsToPmcids.mockResolvedValue([
      { pmid: "22222", pmcid: "PMC22222", doi: "10.1000/new", errmsg: null },
    ]);
    mockPmc.fetchMethodsSections.mockResolvedValue([
      { pmcid: "PMC22222", methodsText: "new methods" },
    ]);

    mockSynthesis.synthesizeProfile.mockResolvedValue({
      output: {
        research_summary: "candidate summary",
        techniques: ["crispr-cas9 screening", "single-cell rna-seq", "proteomics"],
        experimental_models: ["organoids"],
        disease_areas: ["pancreatic ductal adenocarcinoma"],
        key_targets: ["kras-g12d"],
        keywords: ["tumor microenvironment"],
      },
      valid: true,
      validation: null,
      attempts: 1,
      model: "claude-opus-4-20250514",
      retried: false,
    });
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it("stores pending candidate and enqueues notification when candidate arrays changed", async () => {
    /** Validates the main cron path: new pubs + array changes -> pending profile + email job. */
    const result = await runWithTimers("user-1");

    expect(result.status).toBe("candidate_pending");
    expect(result.newPublicationsStored).toBe(1);
    expect(result.changedFields).toEqual(["techniques", "grantTitles"]);
    expect(result.notified).toBe(true);

    expect(db.researcherProfile.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { userId: "user-1" },
        data: expect.objectContaining({
          pendingProfile: expect.any(Object),
          pendingProfileCreatedAt: expect.any(Date),
        }),
      }),
    );
    expect(enqueue).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "send_email",
        templateId: "profile_refresh_candidate",
        to: "jane@example.com",
      }),
      { priority: -10 },
    );
  });

  it("stores new publications but does not create pending profile when arrays are unchanged", async () => {
    /** Guards against noisy refresh prompts when candidate arrays don't materially change. */
    mockOrcid.fetchOrcidGrantTitles.mockResolvedValue(["R01 base grant"]);
    mockSynthesis.synthesizeProfile.mockResolvedValue({
      output: {
        research_summary: "candidate summary",
        techniques: ["crispr-cas9 screening"],
        experimental_models: ["organoids"],
        disease_areas: ["pancreatic ductal adenocarcinoma"],
        key_targets: ["kras-g12d"],
        keywords: ["tumor microenvironment"],
      },
      valid: true,
      validation: null,
      attempts: 1,
      model: "claude-opus-4-20250514",
      retried: false,
    });

    const result = await runWithTimers("user-1");

    expect(result.status).toBe("no_array_changes");
    expect(result.newPublicationsStored).toBe(1);
    expect(result.changedFields).toEqual([]);
    expect(db.researcherProfile.update).not.toHaveBeenCalled();
    expect(enqueue).not.toHaveBeenCalled();
  });

  it("skips work when no new publications are detected", async () => {
    /** Ensures monthly runs are cheap no-ops when ORCID has no new works. */
    mockOrcid.fetchOrcidWorks.mockResolvedValue([
      {
        title: "Existing publication",
        pmid: "11111",
        pmcid: null,
        doi: "10.1000/existing",
        type: "journal-article",
        year: 2023,
        journal: "Nature",
      },
    ]);

    const result = await runWithTimers("user-1");

    expect(result.status).toBe("skipped_no_new_publications");
    expect(db.publication.createMany).not.toHaveBeenCalled();
    expect(mockSynthesis.synthesizeProfile).not.toHaveBeenCalled();
    expect(enqueue).not.toHaveBeenCalled();
  });

  it("respects profile refresh email settings", async () => {
    /** Prevents enqueueing emails when user-level notification settings disable this channel. */
    (db.user.findUnique as jest.Mock).mockResolvedValue({
      id: "user-1",
      orcid: "0000-0001-2345-6789",
      name: "Jane Smith",
      institution: "MIT",
      department: "Biology",
      email: "jane@example.com",
      emailNotificationsEnabled: false,
      notifyProfileRefresh: false,
    });

    const result = await runWithTimers("user-1");

    expect(result.status).toBe("candidate_pending");
    expect(result.notified).toBe(false);
    expect(db.researcherProfile.update).toHaveBeenCalledTimes(1);
    expect(enqueue).not.toHaveBeenCalled();
  });
});
