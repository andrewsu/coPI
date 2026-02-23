/**
 * Tests for job handler dispatch and type-specific handler implementations.
 *
 * Validates that createJobProcessor correctly routes each job type to
 * the right service calls, and that the generate_profile and run_matching
 * handlers integrate properly with their respective service functions.
 *
 * All service dependencies are mocked to isolate handler logic.
 */

import type { PrismaClient } from "@prisma/client";
import type Anthropic from "@anthropic-ai/sdk";
import type { QueuedJob } from "@/lib/job-queue";
import { createJobProcessor, type WorkerDependencies } from "../handlers";

// Mock all service dependencies
jest.mock("@/services/eligible-pairs");
jest.mock("@/services/matching-context");
jest.mock("@/services/matching-engine");
jest.mock("@/services/profile-pipeline");
jest.mock("@/services/monthly-refresh");
jest.mock("@/services/match-pool-expansion");
jest.mock("@/services/matching-triggers");
jest.mock("@/lib/pipeline-status");

import { computeEligiblePairs } from "@/services/eligible-pairs";
import { assembleContextForPair } from "@/services/matching-context";
import {
  generateProposalsForPair,
  storeProposalsAndResult,
} from "@/services/matching-engine";
import { runProfilePipeline } from "@/services/profile-pipeline";
import { runMonthlyRefresh } from "@/services/monthly-refresh";
import { expandMatchPoolsForNewUser } from "@/services/match-pool-expansion";
import { triggerMatchingForNewPairs } from "@/services/matching-triggers";
import { setPipelineStage } from "@/lib/pipeline-status";

const mockComputeEligiblePairs = computeEligiblePairs as jest.MockedFunction<
  typeof computeEligiblePairs
>;
const mockAssembleContextForPair =
  assembleContextForPair as jest.MockedFunction<typeof assembleContextForPair>;
const mockGenerateProposalsForPair =
  generateProposalsForPair as jest.MockedFunction<
    typeof generateProposalsForPair
  >;
const mockStoreProposalsAndResult =
  storeProposalsAndResult as jest.MockedFunction<typeof storeProposalsAndResult>;
const mockRunProfilePipeline = runProfilePipeline as jest.MockedFunction<
  typeof runProfilePipeline
>;
const mockRunMonthlyRefresh = runMonthlyRefresh as jest.MockedFunction<
  typeof runMonthlyRefresh
>;
const mockExpandMatchPoolsForNewUser =
  expandMatchPoolsForNewUser as jest.MockedFunction<
    typeof expandMatchPoolsForNewUser
  >;
const mockTriggerMatchingForNewPairs =
  triggerMatchingForNewPairs as jest.MockedFunction<
    typeof triggerMatchingForNewPairs
  >;
const mockSetPipelineStage = setPipelineStage as jest.MockedFunction<
  typeof setPipelineStage
>;

// Shared test fixtures
const mockDeps: WorkerDependencies = {
  prisma: {} as PrismaClient,
  anthropic: {} as Anthropic,
};

function makeQueuedJob(
  payload: QueuedJob["payload"],
  overrides?: Partial<QueuedJob>,
): QueuedJob {
  return {
    id: "test-job-1",
    payload,
    enqueuedAt: new Date(),
    attempts: 1,
    maxAttempts: 3,
    ...overrides,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  mockExpandMatchPoolsForNewUser.mockResolvedValue({
    userId: "user-1",
    entriesCreated: 0,
    affectedUserIds: [],
  });
  mockTriggerMatchingForNewPairs.mockResolvedValue(0);
  jest.spyOn(console, "log").mockImplementation(() => {});
  jest.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("createJobProcessor", () => {
  it("returns a function", () => {
    const processor = createJobProcessor(mockDeps);
    expect(typeof processor).toBe("function");
  });
});

describe("generate_profile handler", () => {
  it("calls runProfilePipeline with correct arguments", async () => {
    mockRunProfilePipeline.mockResolvedValueOnce({
      userId: "user-1",
      profileCreated: true,
      publicationsStored: 15,
      synthesis: {
        output: {
          research_summary: "test",
          techniques: ["CRISPR"],
          experimental_models: ["mice"],
          disease_areas: ["cancer"],
          key_targets: ["TP53"],
          keywords: ["genomics"],
        },
        valid: true,
        validation: null,
        attempts: 1,
        model: "claude-opus-4-20250514",
        retried: false,
      },
      warnings: [],
      profileVersion: 1,
    });

    const processor = createJobProcessor(mockDeps);
    const job = makeQueuedJob({
      type: "generate_profile",
      userId: "user-1",
      orcid: "0000-0001-2345-6789",
      accessToken: "token-abc",
    });

    await processor(job);

    expect(mockRunProfilePipeline).toHaveBeenCalledTimes(1);
    expect(mockRunProfilePipeline).toHaveBeenCalledWith(
      mockDeps.prisma,
      mockDeps.anthropic,
      "user-1",
      "0000-0001-2345-6789",
      expect.objectContaining({
        accessToken: "token-abc",
        onProgress: expect.any(Function),
      }),
    );
  });

  it("sets pipeline status to starting before calling pipeline", async () => {
    const callOrder: string[] = [];

    mockSetPipelineStage.mockImplementation(() => {
      callOrder.push("setPipelineStage");
    });
    mockRunProfilePipeline.mockImplementation(async () => {
      callOrder.push("runProfilePipeline");
      return {
        userId: "user-1",
        profileCreated: true,
        publicationsStored: 0,
        synthesis: {
          output: null,
          valid: false,
          validation: null,
          attempts: 1,
          model: "claude-opus-4-20250514",
          retried: false,
        },
        warnings: [],
        profileVersion: 1,
      };
    });

    const processor = createJobProcessor(mockDeps);
    await processor(
      makeQueuedJob({
        type: "generate_profile",
        userId: "user-1",
        orcid: "0000-0001-0000-0000",
      }),
    );

    // "starting" stage should be set before the pipeline runs
    expect(callOrder[0]).toBe("setPipelineStage");
    expect(mockSetPipelineStage).toHaveBeenCalledWith("user-1", "starting");
  });

  it("sets pipeline status to complete on success", async () => {
    mockRunProfilePipeline.mockResolvedValueOnce({
      userId: "user-1",
      profileCreated: false,
      publicationsStored: 10,
      synthesis: {
        output: null,
        valid: false,
        validation: null,
        attempts: 1,
        model: "claude-opus-4-20250514",
        retried: false,
      },
      warnings: ["low pub count"],
      profileVersion: 2,
    });

    const processor = createJobProcessor(mockDeps);
    await processor(
      makeQueuedJob({
        type: "generate_profile",
        userId: "user-1",
        orcid: "0000-0001-0000-0000",
      }),
    );

    expect(mockSetPipelineStage).toHaveBeenCalledWith("user-1", "complete", {
      warnings: ["low pub count"],
      result: {
        publicationsFound: 10,
        profileCreated: false,
      },
    });
  });

  it("sets pipeline status to error and re-throws on failure", async () => {
    mockRunProfilePipeline.mockRejectedValueOnce(
      new Error("ORCID API timeout"),
    );

    const processor = createJobProcessor(mockDeps);
    const job = makeQueuedJob({
      type: "generate_profile",
      userId: "user-1",
      orcid: "0000-0001-0000-0000",
    });

    await expect(processor(job)).rejects.toThrow("ORCID API timeout");

    expect(mockSetPipelineStage).toHaveBeenCalledWith("user-1", "error", {
      error: "ORCID API timeout",
    });
  });
});

describe("run_matching handler", () => {
  const eligiblePair = {
    researcherAId: "aaa-111",
    researcherBId: "bbb-222",
    visibilityA: "visible" as const,
    visibilityB: "visible" as const,
    profileVersionA: 1,
    profileVersionB: 2,
  };

  const matchingInput = {
    researcherA: {
      name: "Dr. A",
      institution: "MIT",
      researchSummary: "Studies cancer",
      techniques: ["CRISPR"],
      experimentalModels: ["mice"],
      diseaseAreas: ["cancer"],
      keyTargets: ["TP53"],
      keywords: ["genomics"],
      grantTitles: [],
      userSubmittedTexts: [],
      publications: [],
    },
    researcherB: {
      name: "Dr. B",
      institution: "Stanford",
      researchSummary: "Studies genomics",
      techniques: ["RNA-seq"],
      experimentalModels: ["cell lines"],
      diseaseAreas: ["cancer"],
      keyTargets: ["BRCA1"],
      keywords: ["transcriptomics"],
      grantTitles: [],
      userSubmittedTexts: [],
      publications: [],
    },
    existingProposals: [],
  };

  it("generates and stores proposals for an eligible pair", async () => {
    mockComputeEligiblePairs.mockResolvedValueOnce([eligiblePair]);
    mockAssembleContextForPair.mockResolvedValueOnce(matchingInput);
    mockGenerateProposalsForPair.mockResolvedValueOnce({
      proposals: [
        {
          title: "CRISPR meets RNA-seq",
          collaboration_type: "Method transfer",
          scientific_question: "Can we combine?",
          one_line_summary_a: "Summary for A",
          one_line_summary_b: "Summary for B",
          detailed_rationale: "Good synergy",
          lab_a_contributions: "CRISPR expertise",
          lab_b_contributions: "RNA-seq data",
          lab_a_benefits: "New data",
          lab_b_benefits: "New tools",
          proposed_first_experiment: "Run pilot",
          anchoring_publication_pmids: ["12345"],
          confidence_tier: "high",
          reasoning: "Strong match",
        },
      ],
      discarded: 0,
      deduplicated: 0,
      attempts: 1,
      retried: false,
      model: "claude-opus-4-20250514",
      rawCount: 1,
    });
    mockStoreProposalsAndResult.mockResolvedValueOnce({
      stored: 1,
      unresolvedPmids: 0,
    });

    const processor = createJobProcessor(mockDeps);
    await processor(
      makeQueuedJob({
        type: "run_matching",
        researcherAId: "aaa-111",
        researcherBId: "bbb-222",
      }),
    );

    expect(mockComputeEligiblePairs).toHaveBeenCalledWith(mockDeps.prisma, {
      forUserId: "aaa-111",
    });
    expect(mockAssembleContextForPair).toHaveBeenCalledWith(
      mockDeps.prisma,
      "aaa-111",
      "bbb-222",
    );
    expect(mockGenerateProposalsForPair).toHaveBeenCalledWith(
      mockDeps.anthropic,
      expect.objectContaining({
        pair: eligiblePair,
        input: matchingInput,
      }),
    );
    expect(mockStoreProposalsAndResult).toHaveBeenCalledTimes(1);
  });

  it("orders researcher IDs before processing", async () => {
    // Pass IDs in reverse order — handler should order them (aaa < bbb)
    mockComputeEligiblePairs.mockResolvedValueOnce([eligiblePair]);
    mockAssembleContextForPair.mockResolvedValueOnce(matchingInput);
    mockGenerateProposalsForPair.mockResolvedValueOnce({
      proposals: [],
      discarded: 0,
      deduplicated: 0,
      attempts: 1,
      retried: false,
      model: "claude-opus-4-20250514",
      rawCount: 0,
    });
    mockStoreProposalsAndResult.mockResolvedValueOnce({
      stored: 0,
      unresolvedPmids: 0,
    });

    const processor = createJobProcessor(mockDeps);
    await processor(
      makeQueuedJob({
        type: "run_matching",
        researcherAId: "bbb-222", // Reversed
        researcherBId: "aaa-111", // Reversed
      }),
    );

    // Should use ordered IDs for the eligibility check
    expect(mockComputeEligiblePairs).toHaveBeenCalledWith(mockDeps.prisma, {
      forUserId: "aaa-111", // Lower ID used
    });
  });

  it("skips pair that is not eligible", async () => {
    mockComputeEligiblePairs.mockResolvedValueOnce([]); // No eligible pairs

    const processor = createJobProcessor(mockDeps);
    await processor(
      makeQueuedJob({
        type: "run_matching",
        researcherAId: "aaa-111",
        researcherBId: "bbb-222",
      }),
    );

    expect(mockAssembleContextForPair).not.toHaveBeenCalled();
    expect(mockGenerateProposalsForPair).not.toHaveBeenCalled();
    expect(mockStoreProposalsAndResult).not.toHaveBeenCalled();
  });

  it("skips pair when context assembly returns null", async () => {
    mockComputeEligiblePairs.mockResolvedValueOnce([eligiblePair]);
    mockAssembleContextForPair.mockResolvedValueOnce(null);

    const processor = createJobProcessor(mockDeps);
    await processor(
      makeQueuedJob({
        type: "run_matching",
        researcherAId: "aaa-111",
        researcherBId: "bbb-222",
      }),
    );

    expect(mockGenerateProposalsForPair).not.toHaveBeenCalled();
    expect(mockStoreProposalsAndResult).not.toHaveBeenCalled();
  });

  /**
   * Errors from early service calls (eligibility check, context assembly)
   * should propagate to trigger queue retry with exponential backoff.
   */
  it("propagates eligibility check errors for queue retry", async () => {
    mockComputeEligiblePairs.mockRejectedValueOnce(
      new Error("Database connection lost"),
    );

    const processor = createJobProcessor(mockDeps);
    const job = makeQueuedJob({
      type: "run_matching",
      researcherAId: "aaa-111",
      researcherBId: "bbb-222",
    });

    await expect(processor(job)).rejects.toThrow("Database connection lost");
  });

  /**
   * LLM call errors (after service-level retries are exhausted) should be
   * caught by the handler, logged with pair context, and re-thrown for
   * queue-level retry with exponential backoff.
   */
  it("catches LLM errors, logs pair context, and re-throws for queue retry", async () => {
    const consoleSpy = jest.spyOn(console, "error").mockImplementation(() => {});

    mockComputeEligiblePairs.mockResolvedValueOnce([eligiblePair]);
    mockAssembleContextForPair.mockResolvedValueOnce(matchingInput);
    mockGenerateProposalsForPair.mockRejectedValueOnce(
      new Error("Rate limit exceeded after retries"),
    );

    const processor = createJobProcessor(mockDeps);
    const job = makeQueuedJob({
      type: "run_matching",
      researcherAId: "aaa-111",
      researcherBId: "bbb-222",
    });

    await expect(processor(job)).rejects.toThrow("Rate limit exceeded after retries");

    // Error should be logged with pair context for debugging
    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining("matching failed"),
    );
    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining("Rate limit exceeded after retries"),
    );
  });

  /**
   * Database storage errors during storeProposalsAndResult should be
   * caught, logged, and re-thrown for queue retry.
   */
  it("catches storage errors, logs them, and re-throws for queue retry", async () => {
    const consoleSpy = jest.spyOn(console, "error").mockImplementation(() => {});

    mockComputeEligiblePairs.mockResolvedValueOnce([eligiblePair]);
    mockAssembleContextForPair.mockResolvedValueOnce(matchingInput);
    mockGenerateProposalsForPair.mockResolvedValueOnce({
      proposals: [
        {
          title: "Test proposal",
          collaboration_type: "Method transfer",
          scientific_question: "Can we combine?",
          one_line_summary_a: "Summary for A",
          one_line_summary_b: "Summary for B",
          detailed_rationale: "Good synergy",
          lab_a_contributions: "CRISPR expertise",
          lab_b_contributions: "RNA-seq data",
          lab_a_benefits: "New data",
          lab_b_benefits: "New tools",
          proposed_first_experiment: "Run pilot",
          anchoring_publication_pmids: [],
          confidence_tier: "high",
          reasoning: "Strong match",
        },
      ],
      discarded: 0,
      deduplicated: 0,
      attempts: 1,
      retried: false,
      model: "claude-opus-4-20250514",
      rawCount: 1,
    });
    mockStoreProposalsAndResult.mockRejectedValueOnce(
      new Error("Transaction deadlock detected"),
    );

    const processor = createJobProcessor(mockDeps);
    const job = makeQueuedJob({
      type: "run_matching",
      researcherAId: "aaa-111",
      researcherBId: "bbb-222",
    });

    await expect(processor(job)).rejects.toThrow("Transaction deadlock detected");

    // Error should be logged with pair context
    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining("Transaction deadlock detected"),
    );
  });
});

describe("auxiliary job type handlers", () => {
  it("handles send_email without throwing", async () => {
    const processor = createJobProcessor(mockDeps);
    await expect(
      processor(
        makeQueuedJob({
          type: "send_email",
          templateId: "match_notification",
          to: "user@example.com",
          data: { matchId: "m1" },
        }),
      ),
    ).resolves.toBeUndefined();
  });

  it("handles monthly_refresh by invoking the refresh service", async () => {
    /** Verifies the worker delegates monthly refresh jobs to the dedicated service. */
    mockRunMonthlyRefresh.mockResolvedValueOnce({
      userId: "user-1",
      status: "candidate_pending",
      newPublicationsStored: 2,
      changedFields: ["techniques"],
      notified: true,
    });

    const processor = createJobProcessor(mockDeps);
    await expect(
      processor(
        makeQueuedJob({
          type: "monthly_refresh",
          userId: "user-1",
        }),
      ),
    ).resolves.toBeUndefined();

    expect(mockRunMonthlyRefresh).toHaveBeenCalledWith(
      mockDeps.prisma,
      mockDeps.anthropic,
      "user-1",
    );
  });

  it("rethrows monthly_refresh failures to enable queue retry", async () => {
    /** Ensures transient refresh failures bubble up for queue-level retry behavior. */
    mockRunMonthlyRefresh.mockRejectedValueOnce(
      new Error("ORCID works fetch failed"),
    );

    const processor = createJobProcessor(mockDeps);
    await expect(
      processor(
        makeQueuedJob({
          type: "monthly_refresh",
          userId: "user-1",
        }),
      ),
    ).rejects.toThrow("ORCID works fetch failed");
  });

  it("handles expand_match_pool by calling expansion service and triggering matching", async () => {
    /** Verifies the full expand_match_pool flow: expansion + matching triggers for affected users. */
    mockExpandMatchPoolsForNewUser.mockResolvedValueOnce({
      userId: "new-user-1",
      entriesCreated: 2,
      affectedUserIds: ["user-a", "user-b"],
    });

    const processor = createJobProcessor(mockDeps);
    await expect(
      processor(
        makeQueuedJob({
          type: "expand_match_pool",
          userId: "new-user-1",
        }),
      ),
    ).resolves.toBeUndefined();

    expect(mockExpandMatchPoolsForNewUser).toHaveBeenCalledWith(
      mockDeps.prisma,
      "new-user-1",
    );
    // Should trigger matching for each affected user paired with the new user
    expect(mockTriggerMatchingForNewPairs).toHaveBeenCalledTimes(2);
    expect(mockTriggerMatchingForNewPairs).toHaveBeenCalledWith("user-a", ["new-user-1"]);
    expect(mockTriggerMatchingForNewPairs).toHaveBeenCalledWith("user-b", ["new-user-1"]);
  });

  it("skips matching triggers when expansion creates no entries", async () => {
    /** No-op expansion (no matching selections) should not enqueue any matching jobs. */
    mockExpandMatchPoolsForNewUser.mockResolvedValueOnce({
      userId: "new-user-1",
      entriesCreated: 0,
      affectedUserIds: [],
    });

    const processor = createJobProcessor(mockDeps);
    await processor(
      makeQueuedJob({
        type: "expand_match_pool",
        userId: "new-user-1",
      }),
    );

    expect(mockTriggerMatchingForNewPairs).not.toHaveBeenCalled();
  });

  it("rethrows expand_match_pool failures to enable queue retry", async () => {
    /** Database errors during expansion should bubble up for queue-level retry. */
    mockExpandMatchPoolsForNewUser.mockRejectedValueOnce(
      new Error("Connection refused"),
    );

    const consoleSpy = jest.spyOn(console, "error").mockImplementation(() => {});

    const processor = createJobProcessor(mockDeps);
    await expect(
      processor(
        makeQueuedJob({
          type: "expand_match_pool",
          userId: "new-user-1",
        }),
      ),
    ).rejects.toThrow("Connection refused");

    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining("expand_match_pool"),
    );
  });
});
