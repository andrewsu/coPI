/**
 * Matching trigger service — enqueues run_matching jobs in response
 * to application events (match pool changes, profile updates, scheduled runs).
 *
 * Per specs/matching-engine.md "When Does It Run?" table:
 *   - User adds someone to match pool → pair only
 *   - User's profile is regenerated (version bump) → all pairs involving user
 *   - New user joins and gets added to others' pools → new pairs
 *   - Weekly scheduled run → all eligible pairs
 *
 * Trigger functions are fire-and-forget safe: they only enqueue jobs
 * on the in-memory queue (fast, non-blocking). The worker handles
 * eligibility checks, context assembly, and LLM calls.
 */

import type { PrismaClient } from "@prisma/client";
import { getJobQueue, JobPriority } from "@/lib/job-queue";
import { orderUserIds } from "@/lib/utils";
import { computeEligiblePairs } from "@/services/eligible-pairs";

/**
 * Enqueue a matching job for a single newly-added match pool pair.
 *
 * Called by POST /api/match-pool/add after creating an individual selection.
 * The worker handler checks eligibility before generating proposals.
 *
 * @returns The enqueued job ID, or null if enqueueing failed.
 */
export async function triggerMatchingForNewPair(
  userId: string,
  targetUserId: string,
): Promise<string | null> {
  const queue = getJobQueue();
  const ordered = orderUserIds(userId, targetUserId);
  const jobId = await queue.enqueue({
    type: "run_matching",
    researcherAId: ordered.researcherAId,
    researcherBId: ordered.researcherBId,
  });
  console.log(
    `[MatchingTrigger] Enqueued run_matching for pair ` +
      `${ordered.researcherAId}—${ordered.researcherBId} (job ${jobId})`,
  );
  return jobId;
}

/**
 * Enqueue matching jobs for multiple newly-added match pool pairs.
 *
 * Called by POST /api/match-pool/affiliation after creating affiliation
 * or all-users selection entries. Enqueues one job per target user.
 *
 * @returns Count of jobs enqueued.
 */
export async function triggerMatchingForNewPairs(
  userId: string,
  targetUserIds: string[],
): Promise<number> {
  if (targetUserIds.length === 0) return 0;

  const queue = getJobQueue();
  let enqueued = 0;

  for (const targetUserId of targetUserIds) {
    const ordered = orderUserIds(userId, targetUserId);
    await queue.enqueue({
      type: "run_matching",
      researcherAId: ordered.researcherAId,
      researcherBId: ordered.researcherBId,
    });
    enqueued++;
  }

  console.log(
    `[MatchingTrigger] Enqueued ${enqueued} run_matching jobs for ` +
      `user ${userId} (affiliation/all-users selection)`,
  );
  return enqueued;
}

/**
 * Enqueue matching jobs for all pairs involving a user after their profile
 * is updated or regenerated (version bump).
 *
 * Called by PUT /api/profile (direct editing) and after profile pipeline
 * completion (POST /api/profile/refresh). Finds all match pool entries
 * where the user is either selector or target, deduplicates pairs, and
 * enqueues a job for each.
 *
 * @returns Count of jobs enqueued.
 */
export async function triggerMatchingForProfileUpdate(
  prisma: PrismaClient,
  userId: string,
): Promise<number> {
  const entries = await prisma.matchPoolEntry.findMany({
    where: {
      OR: [{ userId }, { targetUserId: userId }],
    },
    select: { userId: true, targetUserId: true },
  });

  if (entries.length === 0) return 0;

  const queue = getJobQueue();
  const enqueuedPairs = new Set<string>();
  let enqueued = 0;

  for (const entry of entries) {
    const otherId =
      entry.userId === userId ? entry.targetUserId : entry.userId;
    const ordered = orderUserIds(userId, otherId);
    const pairKey = `${ordered.researcherAId}:${ordered.researcherBId}`;

    if (enqueuedPairs.has(pairKey)) continue;
    enqueuedPairs.add(pairKey);

    await queue.enqueue({
      type: "run_matching",
      researcherAId: ordered.researcherAId,
      researcherBId: ordered.researcherBId,
    });
    enqueued++;
  }

  console.log(
    `[MatchingTrigger] Enqueued ${enqueued} run_matching jobs for ` +
      `profile update of user ${userId}`,
  );
  return enqueued;
}

/**
 * Enqueue matching jobs for ALL eligible pairs (weekly scheduled scan).
 *
 * Uses computeEligiblePairs() with no user filter to find every pair
 * that hasn't been evaluated at current profile versions. This catches
 * any pairs missed by event-driven triggers.
 *
 * @returns Count of jobs enqueued.
 */
export async function triggerScheduledMatchingRun(
  prisma: PrismaClient,
): Promise<number> {
  const eligiblePairs = await computeEligiblePairs(prisma);

  if (eligiblePairs.length === 0) {
    console.log("[MatchingTrigger] Scheduled run: no eligible pairs found.");
    return 0;
  }

  const queue = getJobQueue();
  let enqueued = 0;

  for (const pair of eligiblePairs) {
    await queue.enqueue(
      {
        type: "run_matching",
        researcherAId: pair.researcherAId,
        researcherBId: pair.researcherBId,
      },
      { priority: JobPriority.BACKGROUND },
    );
    enqueued++;
  }

  console.log(
    `[MatchingTrigger] Scheduled run: enqueued ${enqueued} run_matching jobs.`,
  );
  return enqueued;
}
