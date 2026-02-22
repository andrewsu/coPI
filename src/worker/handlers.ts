/**
 * Job handler implementations for the worker process.
 *
 * Each job type has a dedicated handler that calls the appropriate
 * service functions. Handlers take injected dependencies for testability.
 *
 * Fully implemented handlers:
 *   - generate_profile: calls runProfilePipeline
 *   - run_matching: calls eligible pair computation + context assembly +
 *     proposal generation + storage
 *
 * Future handlers (services not yet built):
 *   - send_email, monthly_refresh, expand_match_pool
 */

import type { PrismaClient } from "@prisma/client";
import type Anthropic from "@anthropic-ai/sdk";
import type {
  QueuedJob,
  GenerateProfileJob,
  RunMatchingJob,
} from "@/lib/job-queue";
import { orderUserIds } from "@/lib/utils";
import { computeEligiblePairs } from "@/services/eligible-pairs";
import { assembleContextForPair } from "@/services/matching-context";
import type { PairContext } from "@/services/matching-context";
import {
  generateProposalsForPair,
  storeProposalsAndResult,
} from "@/services/matching-engine";
import { runProfilePipeline } from "@/services/profile-pipeline";
import { setPipelineStage } from "@/lib/pipeline-status";

// --- Public types ---

/** Dependencies injected into job handlers. */
export interface WorkerDependencies {
  prisma: PrismaClient;
  anthropic: Anthropic;
}

// --- Factory ---

/**
 * Creates a job processing function with bound dependencies.
 *
 * The returned function dispatches each job to its type-specific handler.
 * This factory pattern allows injecting test doubles for Prisma and Anthropic.
 *
 * @param deps - Prisma and Anthropic client instances.
 * @returns A function compatible with JobQueue.start().
 */
export function createJobProcessor(
  deps: WorkerDependencies,
): (job: QueuedJob) => Promise<void> {
  return async (job: QueuedJob) => {
    const { payload } = job;

    switch (payload.type) {
      case "generate_profile":
        await handleGenerateProfile(payload, deps);
        break;

      case "run_matching":
        await handleRunMatching(payload, deps);
        break;

      case "send_email":
        console.log(
          `[Worker] send_email job ${job.id}: handler not yet implemented. ` +
            `Template: ${payload.templateId}, To: ${payload.to}`,
        );
        break;

      case "monthly_refresh":
        console.log(
          `[Worker] monthly_refresh job ${job.id}: handler not yet implemented. ` +
            `User: ${payload.userId}`,
        );
        break;

      case "expand_match_pool":
        console.log(
          `[Worker] expand_match_pool job ${job.id}: handler not yet implemented. ` +
            `User: ${payload.userId}`,
        );
        break;

      default: {
        // Exhaustive check — compiler error if a new job type is added
        // without a corresponding handler case.
        const exhaustiveCheck: never = payload;
        throw new Error(
          `Unhandled job type: ${(exhaustiveCheck as { type: string }).type}`,
        );
      }
    }
  };
}

// --- Handler implementations ---

/**
 * Runs the full profile ingestion pipeline for a user.
 *
 * Updates in-memory pipeline status for progress polling by the UI.
 * Re-throws errors to trigger queue retry.
 */
async function handleGenerateProfile(
  payload: GenerateProfileJob,
  deps: WorkerDependencies,
): Promise<void> {
  const { userId, orcid, accessToken } = payload;
  setPipelineStage(userId, "starting");

  try {
    const result = await runProfilePipeline(
      deps.prisma,
      deps.anthropic,
      userId,
      orcid,
      {
        accessToken,
        onProgress: (stage) => setPipelineStage(userId, stage),
      },
    );

    setPipelineStage(userId, "complete", {
      warnings: result.warnings,
      result: {
        publicationsFound: result.publicationsStored,
        profileCreated: result.profileCreated,
      },
    });

    console.log(
      `[Worker] Profile generated for user ${userId}: ` +
        `${result.publicationsStored} publications, v${result.profileVersion}`,
    );
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    setPipelineStage(userId, "error", { error: errorMessage });
    throw err;
  }
}

/**
 * Generates collaboration proposals for a specific researcher pair.
 *
 * Flow:
 * 1. Order researcher IDs consistently (A < B by UUID sort).
 * 2. Check pair eligibility via computeEligiblePairs (handles pool
 *    membership, incoming settings, and version-based dedup).
 * 3. Assemble context (profiles, publications, existing proposals).
 * 4. Call Claude to generate proposals.
 * 5. Store proposals and matching result in the database.
 *
 * Returns silently (no error, no retry) if the pair is not eligible
 * or if context assembly fails due to missing profile data.
 * Re-throws errors from LLM calls or database storage to trigger
 * queue retry with exponential backoff.
 */
async function handleRunMatching(
  payload: RunMatchingJob,
  deps: WorkerDependencies,
): Promise<void> {
  const ordered = orderUserIds(payload.researcherAId, payload.researcherBId);
  const pairLabel = `${ordered.researcherAId}—${ordered.researcherBId}`;

  // Check eligibility — this reuses the full eligibility logic including
  // version-based dedup against MatchingResult records.
  const eligiblePairs = await computeEligiblePairs(deps.prisma, {
    forUserId: ordered.researcherAId,
  });

  const pair = eligiblePairs.find(
    (p) =>
      p.researcherAId === ordered.researcherAId &&
      p.researcherBId === ordered.researcherBId,
  );

  if (!pair) {
    console.log(
      `[Worker] Pair ${pairLabel} not eligible or already evaluated. Skipping.`,
    );
    return;
  }

  // Assemble context (profiles, publications, existing proposals)
  const input = await assembleContextForPair(
    deps.prisma,
    pair.researcherAId,
    pair.researcherBId,
  );

  if (!input) {
    console.warn(
      `[Worker] Failed to assemble context for pair ${pairLabel}. ` +
        `Missing profile data.`,
    );
    return;
  }

  const pairContext: PairContext = { pair, input };

  // Generate proposals and store results.
  // Errors from LLM calls (after service-level retries with backoff are
  // exhausted) or database storage are caught, logged, and re-thrown to
  // trigger queue-level retry with exponential backoff.
  try {
    const result = await generateProposalsForPair(deps.anthropic, pairContext);

    const summary = await storeProposalsAndResult(
      deps.prisma,
      pairContext,
      result,
    );

    console.log(
      `[Worker] Pair ${pairLabel}: ` +
        `${result.proposals.length} proposals generated, ${summary.stored} stored, ` +
        `${result.discarded} discarded, ${result.deduplicated} deduplicated`,
    );
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    console.error(
      `[Worker] Pair ${pairLabel} matching failed: ${errorMessage}`,
    );
    throw err;
  }
}
