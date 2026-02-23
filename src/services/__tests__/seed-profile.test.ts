/**
 * Tests for the seeded profile pipeline service.
 *
 * Validates that researchers can be seeded from ORCID IDs without OAuth:
 * - ORCID ID format validation (must match XXXX-XXXX-XXXX-XXXX pattern)
 * - Duplicate detection (skip if user with same ORCID already exists)
 * - User creation with correct fields (claimedAt=null, allowIncomingProposals=true)
 * - Full profile pipeline execution (publications, synthesis)
 * - Match pool expansion enqueuing for the new seeded user
 * - Batch seeding with individual error isolation
 * - Visibility transition on claim (pending_other_interest → visible)
 *
 * Spec reference: specs/auth-and-user-management.md "Admin Functions > Seed Profiles"
 */

jest.mock("@/lib/orcid", () => ({
  fetchOrcidProfile: jest.fn(),
}));

jest.mock("../profile-pipeline", () => ({
  runProfilePipeline: jest.fn(),
}));

jest.mock("@/lib/job-queue", () => ({
  getJobQueue: jest.fn(),
}));

import { fetchOrcidProfile } from "@/lib/orcid";
import { runProfilePipeline } from "../profile-pipeline";
import { getJobQueue } from "@/lib/job-queue";
import {
  seedProfile,
  seedProfiles,
  flipPendingProposalsOnClaim,
  ORCID_REGEX,
} from "../seed-profile";

// Set up job queue mock
const mockEnqueue = jest.fn().mockResolvedValue("job-1");
(getJobQueue as jest.Mock).mockReturnValue({ enqueue: mockEnqueue });

/** Creates a mock PrismaClient with configurable behavior. */
function makeMockPrisma(overrides?: {
  userFindUnique?: unknown;
  userCreate?: unknown;
}) {
  return {
    user: {
      findUnique: jest.fn().mockResolvedValue(overrides?.userFindUnique ?? null),
      create: jest.fn().mockResolvedValue(
        overrides?.userCreate ?? {
          id: "seeded-user-uuid",
          orcid: "0000-0002-1234-5678",
          name: "Jane Researcher",
        },
      ),
    },
    collaborationProposal: {
      updateMany: jest.fn().mockResolvedValue({ count: 0 }),
    },
  } as never;
}

/** Default ORCID profile returned by the mock. */
function makeOrcidProfile(overrides: Record<string, unknown> = {}) {
  return {
    orcid: "0000-0002-1234-5678",
    name: "Jane Researcher",
    email: "jane@university.edu",
    institution: "MIT",
    department: "Biology",
    labWebsiteUrl: "https://janelab.mit.edu",
    ...overrides,
  };
}

/** Default pipeline result returned by the mock. */
function makePipelineResult(overrides: Record<string, unknown> = {}) {
  return {
    userId: "seeded-user-uuid",
    profileCreated: true,
    publicationsStored: 25,
    synthesis: { output: { research_summary: "Test summary" }, attempts: 1 },
    warnings: [],
    profileVersion: 1,
    ...overrides,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  (fetchOrcidProfile as jest.Mock).mockResolvedValue(makeOrcidProfile());
  (runProfilePipeline as jest.Mock).mockResolvedValue(makePipelineResult());
  (getJobQueue as jest.Mock).mockReturnValue({ enqueue: mockEnqueue });
});

describe("seedProfile", () => {
  it("seeds a researcher profile from a valid ORCID iD", async () => {
    /** Happy path: valid ORCID, no existing user, pipeline succeeds. */
    const prisma = makeMockPrisma();
    const llm = {} as never;

    const result = await seedProfile(prisma, llm, "0000-0002-1234-5678");

    expect(result.success).toBe(true);
    expect(result.orcid).toBe("0000-0002-1234-5678");
    expect(result.userId).toBe("seeded-user-uuid");
    expect(result.pipeline).toBeDefined();
    expect(result.pipeline!.publicationsStored).toBe(25);
  });

  it("creates user with claimedAt=null and allowIncomingProposals=true", async () => {
    /** Seeded users must be unclaimed and allow incoming proposals so other
     *  users can generate collaboration proposals involving them. */
    const prisma = makeMockPrisma();
    const llm = {} as never;

    await seedProfile(prisma, llm, "0000-0002-1234-5678");

    const createCall = (prisma as unknown as { user: { create: jest.Mock } }).user.create;
    expect(createCall).toHaveBeenCalledWith({
      data: expect.objectContaining({
        claimedAt: null,
        allowIncomingProposals: true,
        orcid: "0000-0002-1234-5678",
        name: "Jane Researcher",
        institution: "MIT",
        department: "Biology",
        email: "jane@university.edu",
      }),
    });
  });

  it("uses placeholder email when ORCID provides none", async () => {
    /** Researchers without public ORCID emails get placeholder addresses. */
    (fetchOrcidProfile as jest.Mock).mockResolvedValue(
      makeOrcidProfile({ email: null }),
    );
    const prisma = makeMockPrisma();
    const llm = {} as never;

    await seedProfile(prisma, llm, "0000-0002-1234-5678");

    const createCall = (prisma as unknown as { user: { create: jest.Mock } }).user.create;
    expect(createCall).toHaveBeenCalledWith({
      data: expect.objectContaining({
        email: "0000-0002-1234-5678@orcid.placeholder",
      }),
    });
  });

  it("uses 'Unknown' when ORCID has no institution", async () => {
    /** Researchers without employment records on ORCID get placeholder institution. */
    (fetchOrcidProfile as jest.Mock).mockResolvedValue(
      makeOrcidProfile({ institution: null, department: null }),
    );
    const prisma = makeMockPrisma();
    const llm = {} as never;

    await seedProfile(prisma, llm, "0000-0002-1234-5678");

    const createCall = (prisma as unknown as { user: { create: jest.Mock } }).user.create;
    expect(createCall).toHaveBeenCalledWith({
      data: expect.objectContaining({
        institution: "Unknown",
        department: null,
      }),
    });
  });

  it("rejects invalid ORCID format", async () => {
    /** ORCID IDs must be XXXX-XXXX-XXXX-XXXX format. */
    const prisma = makeMockPrisma();
    const llm = {} as never;

    const result = await seedProfile(prisma, llm, "invalid-orcid");

    expect(result.success).toBe(false);
    expect(result.reason).toBe("invalid_orcid_format");
    expect((prisma as unknown as { user: { findUnique: jest.Mock } }).user.findUnique).not.toHaveBeenCalled();
  });

  it("rejects ORCID with wrong digit groups", async () => {
    /** 3-digit groups or missing dashes should be rejected. */
    const prisma = makeMockPrisma();
    const llm = {} as never;

    const result = await seedProfile(prisma, llm, "0000-002-1234-5678");

    expect(result.success).toBe(false);
    expect(result.reason).toBe("invalid_orcid_format");
  });

  it("accepts ORCID ending with X (valid checksum digit)", async () => {
    /** The last character of an ORCID can be X (checksum). */
    const prisma = makeMockPrisma();
    const llm = {} as never;

    const result = await seedProfile(prisma, llm, "0000-0002-1234-567X");

    expect(result.success).toBe(true);
  });

  it("skips if user already exists with this ORCID", async () => {
    /** Duplicate ORCID IDs should not create a second user record. */
    const prisma = makeMockPrisma({
      userFindUnique: { id: "existing-user-uuid" },
    });
    const llm = {} as never;

    const result = await seedProfile(prisma, llm, "0000-0002-1234-5678");

    expect(result.success).toBe(false);
    expect(result.reason).toBe("already_exists");
    expect(result.userId).toBe("existing-user-uuid");
    expect(runProfilePipeline).not.toHaveBeenCalled();
  });

  it("runs the full profile pipeline for the seeded user", async () => {
    /** The pipeline fetches publications, runs LLM synthesis, stores profile. */
    const prisma = makeMockPrisma();
    const llm = {} as never;

    await seedProfile(prisma, llm, "0000-0002-1234-5678");

    expect(runProfilePipeline).toHaveBeenCalledWith(
      prisma,
      llm,
      "seeded-user-uuid",
      "0000-0002-1234-5678",
      { deepMining: true },
    );
  });

  it("respects skipDeepMining option", async () => {
    /** Allows disabling PMC methods extraction for faster seeding. */
    const prisma = makeMockPrisma();
    const llm = {} as never;

    await seedProfile(prisma, llm, "0000-0002-1234-5678", {
      skipDeepMining: true,
    });

    expect(runProfilePipeline).toHaveBeenCalledWith(
      prisma,
      llm,
      "seeded-user-uuid",
      "0000-0002-1234-5678",
      { deepMining: false },
    );
  });

  it("enqueues match pool expansion for the seeded user", async () => {
    /** Seeded users should be auto-added to existing users' match pools
     *  that have affiliation or all-users selections matching them. */
    const prisma = makeMockPrisma();
    const llm = {} as never;

    await seedProfile(prisma, llm, "0000-0002-1234-5678");

    expect(mockEnqueue).toHaveBeenCalledWith({
      type: "expand_match_pool",
      userId: "seeded-user-uuid",
    });
  });

  it("calls onProgress callback at each stage", async () => {
    /** Progress tracking for batch operations and admin UI. */
    const prisma = makeMockPrisma();
    const llm = {} as never;
    const onProgress = jest.fn();

    await seedProfile(prisma, llm, "0000-0002-1234-5678", { onProgress });

    expect(onProgress).toHaveBeenCalledWith("0000-0002-1234-5678", "fetching_orcid");
    expect(onProgress).toHaveBeenCalledWith("0000-0002-1234-5678", "running_pipeline");
    expect(onProgress).toHaveBeenCalledWith("0000-0002-1234-5678", "expanding_match_pools");
  });

  it("does not block on match pool expansion failure", async () => {
    /** Expansion failures should be logged but not prevent seeding. */
    mockEnqueue.mockRejectedValueOnce(new Error("queue error"));
    const prisma = makeMockPrisma();
    const llm = {} as never;

    const result = await seedProfile(prisma, llm, "0000-0002-1234-5678");

    // Should still succeed despite enqueue failure
    expect(result.success).toBe(true);
  });
});

describe("seedProfiles", () => {
  it("seeds multiple profiles sequentially", async () => {
    /** Batch seeding processes ORCID IDs one at a time to respect rate limits. */
    const prisma = makeMockPrisma();
    const llm = {} as never;

    // Make create return different user IDs for each call
    let callCount = 0;
    (prisma as unknown as { user: { create: jest.Mock } }).user.create
      .mockImplementation(() => {
        callCount++;
        return Promise.resolve({
          id: `user-${callCount}`,
          orcid: `0000-0002-1234-567${callCount}`,
        });
      });

    const results = await seedProfiles(prisma, llm, [
      "0000-0002-1234-5671",
      "0000-0002-1234-5672",
    ]);

    expect(results).toHaveLength(2);
    expect(results[0]!.success).toBe(true);
    expect(results[1]!.success).toBe(true);
    expect(runProfilePipeline).toHaveBeenCalledTimes(2);
  });

  it("continues on individual failures and reports them", async () => {
    /** A pipeline failure for one ORCID should not stop processing others. */
    (runProfilePipeline as jest.Mock)
      .mockRejectedValueOnce(new Error("ORCID API timeout"))
      .mockResolvedValueOnce(makePipelineResult());

    const prisma = makeMockPrisma();
    const llm = {} as never;

    const results = await seedProfiles(prisma, llm, [
      "0000-0002-1234-5671",
      "0000-0002-1234-5672",
    ]);

    expect(results).toHaveLength(2);
    expect(results[0]!.success).toBe(false);
    expect(results[0]!.reason).toBe("pipeline_error");
    expect(results[0]!.error).toBe("ORCID API timeout");
    expect(results[1]!.success).toBe(true);
  });

  it("handles mix of valid, invalid, and duplicate ORCIDs", async () => {
    /** Batch should correctly categorize each ORCID's outcome. */
    const prisma = makeMockPrisma();
    const llm = {} as never;
    const findUniqueMock = (prisma as unknown as { user: { findUnique: jest.Mock } }).user.findUnique;
    findUniqueMock
      .mockResolvedValueOnce(null) // First: no existing user
      .mockResolvedValueOnce({ id: "existing-uuid" }) // Second: already exists
      .mockResolvedValueOnce(null); // Third: no existing user (but won't reach — invalid format skips DB)

    const results = await seedProfiles(prisma, llm, [
      "0000-0002-1234-5671", // valid, new
      "0000-0002-1234-5672", // valid, already exists
      "invalid-format",       // invalid format
    ]);

    expect(results).toHaveLength(3);
    expect(results[0]!.success).toBe(true);
    expect(results[1]!.reason).toBe("already_exists");
    expect(results[2]!.reason).toBe("invalid_orcid_format");
  });
});

describe("flipPendingProposalsOnClaim", () => {
  it("flips pending_other_interest proposals to visible for the user", async () => {
    /** When a seeded user claims their account, proposals that were generated
     *  while they were unclaimed should become visible in their swipe queue. */
    const prisma = makeMockPrisma();
    const updateMany = (prisma as unknown as {
      collaborationProposal: { updateMany: jest.Mock };
    }).collaborationProposal.updateMany;
    updateMany
      .mockResolvedValueOnce({ count: 2 }) // researcherA matches
      .mockResolvedValueOnce({ count: 1 }); // researcherB matches

    const flipped = await flipPendingProposalsOnClaim(prisma, "user-123");

    expect(flipped).toBe(3);
    expect(updateMany).toHaveBeenCalledTimes(2);
    expect(updateMany).toHaveBeenCalledWith({
      where: {
        researcherAId: "user-123",
        visibilityA: "pending_other_interest",
      },
      data: { visibilityA: "visible" },
    });
    expect(updateMany).toHaveBeenCalledWith({
      where: {
        researcherBId: "user-123",
        visibilityB: "pending_other_interest",
      },
      data: { visibilityB: "visible" },
    });
  });

  it("returns 0 when no pending proposals exist", async () => {
    /** Users who were seeded but never had proposals should see 0 flipped. */
    const prisma = makeMockPrisma();

    const flipped = await flipPendingProposalsOnClaim(prisma, "user-123");

    expect(flipped).toBe(0);
  });
});

describe("ORCID_REGEX", () => {
  it.each([
    ["0000-0002-1234-5678", true],
    ["0000-0001-0000-0001", true],
    ["0000-0002-1234-567X", true], // X checksum digit
    ["0000-0002-1234-567x", false], // lowercase x not valid
    ["1234567890123456", false], // no dashes
    ["0000-002-1234-5678", false], // wrong group length
    ["0000-0002-1234", false], // too short
    ["0000-0002-1234-56789", false], // too long
    ["abcd-efgh-ijkl-mnop", false], // letters
    ["", false],
  ])("validates '%s' as %s", (input, expected) => {
    expect(ORCID_REGEX.test(input)).toBe(expected);
  });
});
