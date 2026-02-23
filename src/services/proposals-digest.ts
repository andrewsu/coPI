/**
 * Weekly proposals digest service — sends batched email notifications
 * to users about new, unswiped collaboration proposals.
 *
 * Per specs/notifications.md "New Proposals Available":
 *   - Trigger: Matching engine generates new proposals where user's
 *     visibility is `visible`
 *   - Timing: Batched, at most one email per week, sent on configurable
 *     day (default: Monday morning)
 *   - Subject: "You have [N] new collaboration suggestions"
 *   - Body: Count, preview of highest-confidence proposal (title +
 *     one-line summary), link to swipe queue
 *   - Respects: emailNotificationsEnabled (master switch) +
 *     notifyNewProposals (per-type toggle)
 *
 * Proposals unlocked via pending_other_interest → visible transitions
 * are included in the digest with no special treatment (per spec).
 */

import type { PrismaClient, CollaborationProposal } from "@prisma/client";
import { getJobQueue } from "@/lib/job-queue";
import { getUserSide } from "@/lib/utils";
import { buildUnsubscribeUrl } from "@/lib/unsubscribe-token";
import type { NewProposalsDigestData } from "@/services/email-service";

/** Result of running the weekly digest for all users. */
export interface WeeklyDigestResult {
  /** Number of users who received a digest email. */
  emailsSent: number;
  /** Number of users skipped (no new proposals, preferences off, etc.). */
  usersSkipped: number;
  /** Errors encountered per user (userId → error message). */
  errors: Record<string, string>;
}

/** Confidence tier ordering for selecting the "top" proposal. */
const CONFIDENCE_ORDER: Record<string, number> = {
  high: 0,
  moderate: 1,
  speculative: 2,
};

/**
 * Minimum interval between digest emails per user (7 days in milliseconds).
 * Exported for testing.
 */
export const DIGEST_INTERVAL_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Runs the weekly proposals digest for all eligible users.
 *
 * For each user who has notification preferences enabled:
 *   1. Finds visible proposals with no swipe since the last digest
 *   2. Selects the highest-confidence proposal for the preview
 *   3. Enqueues a send_email job with the new_proposals_digest template
 *   4. Updates the user's lastDigestSentAt timestamp
 *
 * @param prisma - Injected PrismaClient for testability
 * @param options - Optional configuration overrides
 * @returns Summary of emails sent, users skipped, and errors
 */
export async function runWeeklyDigest(
  prisma: PrismaClient,
  options?: {
    /** Override the minimum interval between digests (default: 7 days). */
    minIntervalMs?: number;
  },
): Promise<WeeklyDigestResult> {
  const minInterval = options?.minIntervalMs ?? DIGEST_INTERVAL_MS;
  const now = new Date();
  const cutoff = new Date(now.getTime() - minInterval);

  const result: WeeklyDigestResult = {
    emailsSent: 0,
    usersSkipped: 0,
    errors: {},
  };

  // Find all users with notifications enabled who haven't received
  // a digest within the minimum interval.
  const eligibleUsers = await prisma.user.findMany({
    where: {
      emailNotificationsEnabled: true,
      notifyNewProposals: true,
      // Skip placeholder ORCID emails
      NOT: {
        email: { endsWith: "@orcid.placeholder" },
      },
      // Only users who haven't received a digest recently
      OR: [
        { lastDigestSentAt: null },
        { lastDigestSentAt: { lt: cutoff } },
      ],
    },
    select: {
      id: true,
      name: true,
      email: true,
      lastDigestSentAt: true,
    },
  });

  for (const user of eligibleUsers) {
    try {
      const sent = await sendDigestForUser(prisma, user, now);
      if (sent) {
        result.emailsSent++;
      } else {
        result.usersSkipped++;
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      result.errors[user.id] = msg;
      console.error(
        `[ProposalsDigest] Error processing user ${user.id}: ${msg}`,
      );
    }
  }

  console.log(
    `[ProposalsDigest] Weekly digest complete: ` +
      `${result.emailsSent} emails sent, ${result.usersSkipped} skipped, ` +
      `${Object.keys(result.errors).length} errors`,
  );

  return result;
}

/**
 * Sends a digest email for a single user if they have new proposals.
 *
 * @returns true if an email was enqueued, false if skipped (no new proposals)
 */
async function sendDigestForUser(
  prisma: PrismaClient,
  user: { id: string; name: string; email: string; lastDigestSentAt: Date | null },
  now: Date,
): Promise<boolean> {
  // Find proposals that are visible to this user and haven't been swiped,
  // created after the last digest was sent (or all time if no prior digest).
  const sinceDate = user.lastDigestSentAt ?? new Date(0);

  // Query proposals where this user is researcher A or B,
  // their visibility is 'visible', created after sinceDate,
  // and they haven't swiped on them yet.
  const newProposals = await prisma.collaborationProposal.findMany({
    where: {
      createdAt: { gt: sinceDate },
      OR: [
        {
          researcherAId: user.id,
          visibilityA: "visible",
        },
        {
          researcherBId: user.id,
          visibilityB: "visible",
        },
      ],
      // Exclude proposals the user has already swiped on
      NOT: {
        swipes: {
          some: {
            userId: user.id,
          },
        },
      },
    },
    orderBy: [
      { confidenceTier: "asc" }, // high < moderate < speculative in enum order
      { createdAt: "desc" },
    ],
  });

  if (newProposals.length === 0) {
    return false;
  }

  // Select the highest-confidence, most recent proposal for the preview.
  // Proposals are already sorted by confidence tier (asc) then recency (desc).
  // But Prisma's enum ordering may not match our desired order, so we
  // re-sort explicitly.
  const topProposal = selectTopProposal(newProposals);
  const side = getUserSide(user.id, topProposal);
  const oneLineSummary =
    side === "a" ? topProposal.oneLineSummaryA : topProposal.oneLineSummaryB;

  const data: NewProposalsDigestData = {
    recipientName: user.name,
    proposalCount: newProposals.length,
    topProposalTitle: topProposal.title,
    topProposalSummary: oneLineSummary,
    unsubscribeUrl: buildUnsubscribeUrl(user.id, "new_proposals"),
  };

  const queue = getJobQueue();
  await queue.enqueue({
    type: "send_email",
    templateId: "new_proposals_digest",
    to: user.email,
    data: data as unknown as Record<string, unknown>,
  });

  // Update the user's lastDigestSentAt timestamp
  await prisma.user.update({
    where: { id: user.id },
    data: { lastDigestSentAt: now },
  });

  console.log(
    `[ProposalsDigest] Enqueued digest for ${user.email}: ` +
      `${newProposals.length} new proposals`,
  );

  return true;
}

/**
 * Selects the "top" proposal from a list for the email preview.
 * Priority: highest confidence tier, then most recent.
 */
function selectTopProposal(
  proposals: CollaborationProposal[],
): CollaborationProposal {
  return [...proposals].sort((a, b) => {
    const confA = CONFIDENCE_ORDER[a.confidenceTier] ?? 99;
    const confB = CONFIDENCE_ORDER[b.confidenceTier] ?? 99;
    if (confA !== confB) return confA - confB;
    // More recent first
    return b.createdAt.getTime() - a.createdAt.getTime();
  })[0];
}
