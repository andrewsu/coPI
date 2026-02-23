/**
 * Tests for the recruitment email service.
 *
 * Validates that recruitment emails are correctly enqueued for seeded-but-unclaimed
 * researchers when another user swipes interested on a proposal involving them.
 * Tests cover: unclaimed detection (via claimedAt), rate limiting (max 3 total,
 * max 1 per week), placeholder email skipping, notification preference respect,
 * proposal data extraction, and tracking field updates.
 *
 * Spec reference: specs/notifications.md "Unclaimed Profile Recruitment" section.
 */

// Required by buildUnsubscribeUrl which is called when enqueuing emails
process.env.NEXTAUTH_SECRET = "test-secret-for-recruitment-email";
process.env.NEXTAUTH_URL = "https://copi.science";

jest.mock("@/lib/job-queue", () => ({
  getJobQueue: jest.fn(),
}));

import { getJobQueue } from "@/lib/job-queue";
import {
  sendRecruitmentEmailIfUnclaimed,
  MAX_RECRUITMENT_EMAILS,
  RECRUITMENT_INTERVAL_MS,
} from "../recruitment-email";

const mockEnqueue = jest.fn().mockResolvedValue("job-1");
(getJobQueue as jest.Mock).mockReturnValue({ enqueue: mockEnqueue });

/** Creates a mock PrismaClient with configurable user and proposal data. */
function makeMockPrisma(
  user: Record<string, unknown> | null,
  proposal: Record<string, unknown> | null = makeProposal(),
) {
  return {
    user: {
      findUnique: jest.fn().mockResolvedValue(user),
      update: jest.fn().mockResolvedValue({}),
    },
    collaborationProposal: {
      findUnique: jest.fn().mockResolvedValue(proposal),
    },
  } as never;
}

/** Default unclaimed user data (seeded, never logged in). */
function makeUnclaimedUser(overrides: Record<string, unknown> = {}) {
  return {
    id: "unclaimed-user-1",
    name: "Jane Doe",
    email: "jane.doe@university.edu",
    claimedAt: null, // Unclaimed — never logged in via ORCID
    emailNotificationsEnabled: true,
    recruitmentEmailCount: 0,
    lastRecruitmentEmailSentAt: null,
    ...overrides,
  };
}

/** Default proposal data. */
function makeProposal(overrides: Record<string, unknown> = {}) {
  return {
    title: "CRISPR-based gene editing in cardiac organoids",
    scientificQuestion:
      "Can CRISPR-Cas9 be combined with patient-derived cardiac organoids to model inherited cardiomyopathies?",
    ...overrides,
  };
}

describe("sendRecruitmentEmailIfUnclaimed", () => {
  beforeEach(() => jest.clearAllMocks());

  it("sends recruitment email to unclaimed user on first trigger", async () => {
    /** A seeded user with no prior recruitment emails should receive one
     *  when another user swipes interested on a shared proposal. */
    const prisma = makeMockPrisma(makeUnclaimedUser());

    const result = await sendRecruitmentEmailIfUnclaimed(
      prisma,
      "unclaimed-user-1",
      "proposal-1",
    );

    expect(result.sent).toBe(true);
    expect(mockEnqueue).toHaveBeenCalledTimes(1);
    expect(mockEnqueue).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "send_email",
        templateId: "unclaimed_profile_recruitment",
        to: "jane.doe@university.edu",
        data: expect.objectContaining({
          recipientName: "Jane Doe",
          topicArea: "CRISPR-based gene editing in cardiac organoids",
          claimUrl: "https://copi.science/login",
        }),
      }),
    );
  });

  it("includes unsubscribe URL in email data", async () => {
    /** Every email must include an unsubscribe link per spec. The recruitment
     *  email uses the "all" unsubscribe type since unclaimed users don't have
     *  per-type notification preferences. */
    const prisma = makeMockPrisma(makeUnclaimedUser());

    await sendRecruitmentEmailIfUnclaimed(
      prisma,
      "unclaimed-user-1",
      "proposal-1",
    );

    const callData = (mockEnqueue.mock.calls[0][0] as Record<string, unknown>)
      .data as Record<string, unknown>;
    expect(callData.unsubscribeUrl).toBeDefined();
    expect(callData.unsubscribeUrl).toContain("/api/email/unsubscribe?token=");
  });

  it("updates tracking fields after sending", async () => {
    /** After enqueueing the email, lastRecruitmentEmailSentAt and
     *  recruitmentEmailCount should be updated on the User record. */
    const prisma = makeMockPrisma(makeUnclaimedUser());

    await sendRecruitmentEmailIfUnclaimed(
      prisma,
      "unclaimed-user-1",
      "proposal-1",
    );

    expect(prisma.user.update).toHaveBeenCalledWith({
      where: { id: "unclaimed-user-1" },
      data: {
        lastRecruitmentEmailSentAt: expect.any(Date),
        recruitmentEmailCount: { increment: 1 },
      },
    });
  });

  it("skips user who has already claimed their profile", async () => {
    /** A user who has logged in via ORCID OAuth is no longer unclaimed.
     *  They have claimedAt set and should not receive recruitment emails. */
    const prisma = makeMockPrisma(
      makeUnclaimedUser({ claimedAt: new Date("2024-01-15") }),
    );

    const result = await sendRecruitmentEmailIfUnclaimed(
      prisma,
      "unclaimed-user-1",
      "proposal-1",
    );

    expect(result.sent).toBe(false);
    expect(result.reason).toBe("already_claimed");
    expect(mockEnqueue).not.toHaveBeenCalled();
    expect(prisma.user.update).not.toHaveBeenCalled();
  });

  it("skips user with emailNotificationsEnabled=false (unsubscribed)", async () => {
    /** The "all" unsubscribe type disables emailNotificationsEnabled.
     *  This must be respected for recruitment emails too. */
    const prisma = makeMockPrisma(
      makeUnclaimedUser({ emailNotificationsEnabled: false }),
    );

    const result = await sendRecruitmentEmailIfUnclaimed(
      prisma,
      "unclaimed-user-1",
      "proposal-1",
    );

    expect(result.sent).toBe(false);
    expect(result.reason).toBe("notifications_disabled");
    expect(mockEnqueue).not.toHaveBeenCalled();
  });

  it("skips user with placeholder ORCID email", async () => {
    /** Users with @orcid.placeholder emails cannot receive real emails.
     *  These are created when ORCID doesn't provide a real email. */
    const prisma = makeMockPrisma(
      makeUnclaimedUser({ email: "0000-0001-2345-6789@orcid.placeholder" }),
    );

    const result = await sendRecruitmentEmailIfUnclaimed(
      prisma,
      "unclaimed-user-1",
      "proposal-1",
    );

    expect(result.sent).toBe(false);
    expect(result.reason).toBe("no_real_email");
    expect(mockEnqueue).not.toHaveBeenCalled();
  });

  it("skips user with null email", async () => {
    /** Edge case: user exists but has no email at all. */
    const prisma = makeMockPrisma(
      makeUnclaimedUser({ email: null }),
    );

    const result = await sendRecruitmentEmailIfUnclaimed(
      prisma,
      "unclaimed-user-1",
      "proposal-1",
    );

    expect(result.sent).toBe(false);
    expect(result.reason).toBe("no_real_email");
    expect(mockEnqueue).not.toHaveBeenCalled();
  });

  it("stops after MAX_RECRUITMENT_EMAILS (3) total emails", async () => {
    /** Per spec: "After 3 emails with no action, stop emailing that user entirely." */
    const prisma = makeMockPrisma(
      makeUnclaimedUser({ recruitmentEmailCount: MAX_RECRUITMENT_EMAILS }),
    );

    const result = await sendRecruitmentEmailIfUnclaimed(
      prisma,
      "unclaimed-user-1",
      "proposal-1",
    );

    expect(result.sent).toBe(false);
    expect(result.reason).toBe("max_emails_reached");
    expect(mockEnqueue).not.toHaveBeenCalled();
  });

  it("enforces weekly rate limit (max 1 per week)", async () => {
    /** Per spec: "Max one system email per unclaimed user per week." Multiple
     *  swipes from different users within the same week don't trigger extras. */
    const threeDaysAgo = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000);
    const prisma = makeMockPrisma(
      makeUnclaimedUser({
        recruitmentEmailCount: 1,
        lastRecruitmentEmailSentAt: threeDaysAgo,
      }),
    );

    const result = await sendRecruitmentEmailIfUnclaimed(
      prisma,
      "unclaimed-user-1",
      "proposal-1",
    );

    expect(result.sent).toBe(false);
    expect(result.reason).toBe("too_soon");
    expect(mockEnqueue).not.toHaveBeenCalled();
  });

  it("allows sending after the weekly interval has passed", async () => {
    /** After 7+ days since the last email, another one can be sent. */
    const eightDaysAgo = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000);
    const prisma = makeMockPrisma(
      makeUnclaimedUser({
        recruitmentEmailCount: 1,
        lastRecruitmentEmailSentAt: eightDaysAgo,
      }),
    );

    const result = await sendRecruitmentEmailIfUnclaimed(
      prisma,
      "unclaimed-user-1",
      "proposal-1",
    );

    expect(result.sent).toBe(true);
    expect(mockEnqueue).toHaveBeenCalledTimes(1);
  });

  it("allows sending the second email when count is 1 and interval passed", async () => {
    /** Verifies that the count check (< 3) and interval check work together. */
    const twoWeeksAgo = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000);
    const prisma = makeMockPrisma(
      makeUnclaimedUser({
        recruitmentEmailCount: 2,
        lastRecruitmentEmailSentAt: twoWeeksAgo,
      }),
    );

    const result = await sendRecruitmentEmailIfUnclaimed(
      prisma,
      "unclaimed-user-1",
      "proposal-1",
    );

    expect(result.sent).toBe(true);
    expect(mockEnqueue).toHaveBeenCalledTimes(1);
  });

  it("returns user_not_found when user does not exist", async () => {
    /** Guard against deleted or nonexistent users. */
    const prisma = makeMockPrisma(null);

    const result = await sendRecruitmentEmailIfUnclaimed(
      prisma,
      "nonexistent-user",
      "proposal-1",
    );

    expect(result.sent).toBe(false);
    expect(result.reason).toBe("user_not_found");
    expect(mockEnqueue).not.toHaveBeenCalled();
  });

  it("returns proposal_not_found when proposal does not exist", async () => {
    /** Guard against deleted proposals between trigger and processing. */
    const prisma = makeMockPrisma(makeUnclaimedUser(), null);

    const result = await sendRecruitmentEmailIfUnclaimed(
      prisma,
      "unclaimed-user-1",
      "proposal-gone",
    );

    expect(result.sent).toBe(false);
    expect(result.reason).toBe("proposal_not_found");
    expect(mockEnqueue).not.toHaveBeenCalled();
  });

  it("uses proposal title as topic area in the email", async () => {
    /** The email subject should include the topic area from the proposal title. */
    const prisma = makeMockPrisma(
      makeUnclaimedUser(),
      makeProposal({ title: "Single-cell RNA-seq in neurodegeneration" }),
    );

    await sendRecruitmentEmailIfUnclaimed(
      prisma,
      "unclaimed-user-1",
      "proposal-1",
    );

    const callData = (mockEnqueue.mock.calls[0][0] as Record<string, unknown>)
      .data as Record<string, unknown>;
    expect(callData.topicArea).toBe(
      "Single-cell RNA-seq in neurodegeneration",
    );
  });

  it("supports minIntervalMs option override for testing", async () => {
    /** The minIntervalMs option allows tests to override the 7-day interval. */
    const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000);
    const prisma = makeMockPrisma(
      makeUnclaimedUser({
        recruitmentEmailCount: 1,
        lastRecruitmentEmailSentAt: twoHoursAgo,
      }),
    );

    // With default interval (7 days), this would be "too_soon"
    const result1 = await sendRecruitmentEmailIfUnclaimed(
      prisma,
      "unclaimed-user-1",
      "proposal-1",
    );
    expect(result1.sent).toBe(false);
    expect(result1.reason).toBe("too_soon");

    jest.clearAllMocks();
    const prisma2 = makeMockPrisma(
      makeUnclaimedUser({
        recruitmentEmailCount: 1,
        lastRecruitmentEmailSentAt: twoHoursAgo,
      }),
    );

    // With 1-hour interval, it should send
    const result2 = await sendRecruitmentEmailIfUnclaimed(
      prisma2,
      "unclaimed-user-1",
      "proposal-1",
      { minIntervalMs: 60 * 60 * 1000 },
    );
    expect(result2.sent).toBe(true);
  });

  it("exports MAX_RECRUITMENT_EMAILS as 3", () => {
    /** The spec requires a maximum of 3 recruitment emails per unclaimed user. */
    expect(MAX_RECRUITMENT_EMAILS).toBe(3);
  });

  it("exports RECRUITMENT_INTERVAL_MS as 7 days", () => {
    /** The spec requires at most 1 recruitment email per week. */
    expect(RECRUITMENT_INTERVAL_MS).toBe(7 * 24 * 60 * 60 * 1000);
  });
});
