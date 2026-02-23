/**
 * Recruitment email service — sends recruitment emails to seeded-but-unclaimed
 * researchers when another user swipes "interested" on a proposal involving them.
 *
 * Per specs/notifications.md "Unclaimed Profile Recruitment":
 *   - Trigger: User swipes "interested" on a proposal involving an unclaimed researcher
 *   - Timing: Within a day (enqueued via job queue)
 *   - Subject: "A collaboration opportunity in [topic area]"
 *   - Does NOT reveal who the interested researcher is
 *   - Rate limiting: max 1 per week per unclaimed user, max 3 total, stop after 3
 *   - Multiple swipes from different users within the same week don't trigger extras
 *
 * Called as fire-and-forget from swipe and unarchive endpoints. Failures are
 * logged but never block the swipe response.
 */

import type { PrismaClient } from "@prisma/client";
import { getJobQueue } from "@/lib/job-queue";
import { buildUnsubscribeUrl } from "@/lib/unsubscribe-token";
import type { UnclaimedProfileRecruitmentData } from "@/services/email-service";

/** Maximum number of recruitment emails before we stop contacting the user entirely. */
export const MAX_RECRUITMENT_EMAILS = 3;

/** Minimum interval between recruitment emails (7 days in ms). */
export const RECRUITMENT_INTERVAL_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Checks whether the other researcher on a proposal is unclaimed, and if so
 * sends them a recruitment email (subject to rate limiting).
 *
 * @param prisma - Injected PrismaClient for testability
 * @param unclaimedUserId - ID of the unclaimed user to potentially email
 * @param proposalId - ID of the proposal that triggered the recruitment
 * @param options - Optional overrides for testing
 */
export async function sendRecruitmentEmailIfUnclaimed(
  prisma: PrismaClient,
  unclaimedUserId: string,
  proposalId: string,
  options?: { minIntervalMs?: number },
): Promise<{ sent: boolean; reason?: string }> {
  const minInterval = options?.minIntervalMs ?? RECRUITMENT_INTERVAL_MS;

  // Fetch the unclaimed user's data for rate-limiting checks
  const user = await prisma.user.findUnique({
    where: { id: unclaimedUserId },
    select: {
      id: true,
      name: true,
      email: true,
      claimedAt: true,
      emailNotificationsEnabled: true,
      recruitmentEmailCount: true,
      lastRecruitmentEmailSentAt: true,
    },
  });

  if (!user) {
    return { sent: false, reason: "user_not_found" };
  }

  // Only send to unclaimed (seeded) profiles
  if (user.claimedAt !== null) {
    return { sent: false, reason: "already_claimed" };
  }

  // Master notification switch (also set to false by "all" unsubscribe)
  if (!user.emailNotificationsEnabled) {
    return { sent: false, reason: "notifications_disabled" };
  }

  // Can't send to placeholder emails
  if (!user.email || user.email.endsWith("@orcid.placeholder")) {
    return { sent: false, reason: "no_real_email" };
  }

  // Rate limit: max 3 total recruitment emails
  if (user.recruitmentEmailCount >= MAX_RECRUITMENT_EMAILS) {
    return { sent: false, reason: "max_emails_reached" };
  }

  // Rate limit: max 1 per week
  if (user.lastRecruitmentEmailSentAt) {
    const elapsed =
      Date.now() - user.lastRecruitmentEmailSentAt.getTime();
    if (elapsed < minInterval) {
      return { sent: false, reason: "too_soon" };
    }
  }

  // Fetch the proposal to extract the topic area
  const proposal = await prisma.collaborationProposal.findUnique({
    where: { id: proposalId },
    select: {
      title: true,
      scientificQuestion: true,
    },
  });

  if (!proposal) {
    return { sent: false, reason: "proposal_not_found" };
  }

  // Use the proposal title as the topic area (more concise than scientificQuestion)
  const topicArea = proposal.title;

  // Build claim URL — directs to the login page
  const appUrl = process.env.NEXTAUTH_URL ?? "http://localhost:3000";
  const claimUrl = `${appUrl}/login`;

  // Build unsubscribe URL using the "all" type to disable all emails
  const unsubscribeUrl = buildUnsubscribeUrl(user.id, "all");

  const data: UnclaimedProfileRecruitmentData = {
    recipientName: user.name,
    topicArea,
    claimUrl,
    unsubscribeUrl,
  };

  // Enqueue the email job
  const queue = getJobQueue();
  await queue.enqueue({
    type: "send_email",
    templateId: "unclaimed_profile_recruitment",
    to: user.email,
    data: data as unknown as Record<string, unknown>,
  });

  // Update rate-limiting fields
  await prisma.user.update({
    where: { id: user.id },
    data: {
      lastRecruitmentEmailSentAt: new Date(),
      recruitmentEmailCount: { increment: 1 },
    },
  });

  console.log(
    `[RecruitmentEmail] Enqueued recruitment email for ${user.email} ` +
      `(count: ${user.recruitmentEmailCount + 1}/${MAX_RECRUITMENT_EMAILS}, ` +
      `topic: "${topicArea}")`,
  );

  return { sent: true };
}
