/**
 * Match notification service — sends email notifications when a mutual match
 * is created (both parties swiped interested on the same proposal).
 *
 * Per specs/notifications.md "Match Notification":
 *   - Trigger: Both parties swipe interested on the same proposal
 *   - Timing: Immediate (within minutes of the second swipe)
 *   - Subject: "Mutual interest with Dr. [Name] on a collaboration idea"
 *   - Respects: emailNotificationsEnabled (master switch) + notifyMatches per-user
 *   - Contact info governed by the OTHER user's emailVisibility setting
 *
 * Called as fire-and-forget from swipe and unarchive endpoints. Notification
 * failures are logged but never block the swipe response.
 */

import type { PrismaClient } from "@prisma/client";
import { getJobQueue } from "@/lib/job-queue";
import type { MatchNotificationData } from "@/services/email-service";

/** Fields needed from each user to build the notification email. */
interface MatchUser {
  id: string;
  name: string;
  email: string;
  institution: string;
  department: string | null;
  emailVisibility: "public_profile" | "mutual_matches" | "never";
  emailNotificationsEnabled: boolean;
  notifyMatches: boolean;
}

/**
 * Sends match notification emails to both users after a mutual match is created.
 *
 * For each user:
 *   1. Checks notification preferences (master switch + match-specific toggle)
 *   2. Skips placeholder emails (ORCID OAuth creates them when no real email is available)
 *   3. Enqueues a send_email job with the match_notification template
 *   4. Updates the Match record's notificationSentA/notificationSentB flag
 *
 * @param prisma - Injected PrismaClient for testability
 * @param matchId - ID of the newly created Match record
 * @param proposalId - ID of the proposal that was matched on
 */
export async function sendMatchNotificationEmails(
  prisma: PrismaClient,
  matchId: string,
  proposalId: string,
): Promise<void> {
  // Fetch proposal with both researchers' data in one query
  const proposal = await prisma.collaborationProposal.findUnique({
    where: { id: proposalId },
    select: {
      id: true,
      oneLineSummaryA: true,
      oneLineSummaryB: true,
      researcherA: {
        select: {
          id: true,
          name: true,
          email: true,
          institution: true,
          department: true,
          emailVisibility: true,
          emailNotificationsEnabled: true,
          notifyMatches: true,
        },
      },
      researcherB: {
        select: {
          id: true,
          name: true,
          email: true,
          institution: true,
          department: true,
          emailVisibility: true,
          emailNotificationsEnabled: true,
          notifyMatches: true,
        },
      },
    },
  });

  if (!proposal) {
    console.error(
      `[MatchNotification] Proposal ${proposalId} not found for match ${matchId}`,
    );
    return;
  }

  const userA = proposal.researcherA as MatchUser;
  const userB = proposal.researcherB as MatchUser;
  const queue = getJobQueue();

  // Notify user A about matching with user B
  const sentA = await enqueueMatchEmail(
    queue,
    userA,
    userB,
    proposal.oneLineSummaryA,
    proposal.id,
  );

  // Notify user B about matching with user A
  const sentB = await enqueueMatchEmail(
    queue,
    userB,
    userA,
    proposal.oneLineSummaryB,
    proposal.id,
  );

  // Update the Match record to track which notifications were sent
  if (sentA || sentB) {
    await prisma.match.update({
      where: { id: matchId },
      data: {
        ...(sentA ? { notificationSentA: true } : {}),
        ...(sentB ? { notificationSentB: true } : {}),
      },
    });
  }
}

/**
 * Enqueues a match notification email for one user.
 *
 * @returns true if a job was enqueued, false if skipped due to preferences or missing email
 */
async function enqueueMatchEmail(
  queue: ReturnType<typeof getJobQueue>,
  recipient: MatchUser,
  matchedUser: MatchUser,
  oneLineSummary: string,
  proposalId: string,
): Promise<boolean> {
  // Check notification preferences
  if (!recipient.emailNotificationsEnabled || !recipient.notifyMatches) {
    return false;
  }

  // Skip placeholder emails from ORCID OAuth
  if (!recipient.email || recipient.email.endsWith("@orcid.placeholder")) {
    return false;
  }

  // Determine whether to share the matched user's email based on their visibility setting.
  // For mutual matches, both public_profile and mutual_matches allow email sharing.
  const shouldShareEmail =
    matchedUser.emailVisibility !== "never" &&
    matchedUser.email &&
    !matchedUser.email.endsWith("@orcid.placeholder");

  const data: MatchNotificationData = {
    recipientName: recipient.name,
    matchedResearcherName: matchedUser.name,
    matchedResearcherInstitution: matchedUser.institution,
    ...(matchedUser.department
      ? { matchedResearcherDepartment: matchedUser.department }
      : {}),
    oneLineSummary,
    ...(shouldShareEmail ? { contactEmail: matchedUser.email } : {}),
    emailVisibility: matchedUser.emailVisibility,
    proposalId,
  };

  await queue.enqueue({
    type: "send_email",
    templateId: "match_notification",
    to: recipient.email,
    data: data as unknown as Record<string, unknown>,
  });

  console.log(
    `[MatchNotification] Enqueued match notification for ${recipient.email} ` +
      `(matched with ${matchedUser.name})`,
  );

  return true;
}
