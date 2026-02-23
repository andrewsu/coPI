/**
 * Tests for the match notification service.
 *
 * Validates that match notification emails are correctly enqueued when a
 * mutual match is created, respecting each user's notification preferences
 * (emailNotificationsEnabled + notifyMatches), email visibility settings,
 * and placeholder email detection. Both users should receive personalized
 * emails with the correct one-line summary for their perspective.
 *
 * Spec reference: specs/notifications.md "Match Notification" section.
 */

jest.mock("@/lib/job-queue", () => ({
  getJobQueue: jest.fn(),
}));

import { getJobQueue } from "@/lib/job-queue";
import { sendMatchNotificationEmails } from "../match-notifications";

const mockEnqueue = jest.fn().mockResolvedValue("job-1");
(getJobQueue as jest.Mock).mockReturnValue({ enqueue: mockEnqueue });

/** Creates a mock PrismaClient with configurable proposal data. */
function makeMockPrisma(proposal: Record<string, unknown> | null) {
  return {
    collaborationProposal: {
      findUnique: jest.fn().mockResolvedValue(proposal),
    },
    match: {
      update: jest.fn().mockResolvedValue({}),
    },
  } as never;
}

/** Default user A data with notifications enabled. */
function makeUserA(overrides: Record<string, unknown> = {}) {
  return {
    id: "user-aaa",
    name: "Alice Smith",
    email: "alice@example.com",
    institution: "MIT",
    department: "Biology",
    emailVisibility: "mutual_matches",
    emailNotificationsEnabled: true,
    notifyMatches: true,
    ...overrides,
  };
}

/** Default user B data with notifications enabled. */
function makeUserB(overrides: Record<string, unknown> = {}) {
  return {
    id: "user-zzz",
    name: "Bob Jones",
    email: "bob@example.com",
    institution: "Stanford",
    department: null,
    emailVisibility: "public_profile",
    emailNotificationsEnabled: true,
    notifyMatches: true,
    ...overrides,
  };
}

/** Default proposal data with both users. */
function makeProposal(overrides: Record<string, unknown> = {}) {
  return {
    id: "proposal-1",
    oneLineSummaryA: "Combine your CRISPR expertise with their organoid models",
    oneLineSummaryB: "Leverage your organoid models with their CRISPR screens",
    researcherA: makeUserA(),
    researcherB: makeUserB(),
    ...overrides,
  };
}

describe("sendMatchNotificationEmails", () => {
  beforeEach(() => jest.clearAllMocks());

  it("enqueues emails for both users when both have notifications enabled", async () => {
    /** Both users have notifications enabled — two emails should be enqueued. */
    const prisma = makeMockPrisma(makeProposal());

    await sendMatchNotificationEmails(prisma, "match-1", "proposal-1");

    expect(mockEnqueue).toHaveBeenCalledTimes(2);

    // Email to user A about user B
    expect(mockEnqueue).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "send_email",
        templateId: "match_notification",
        to: "alice@example.com",
        data: expect.objectContaining({
          recipientName: "Alice Smith",
          matchedResearcherName: "Bob Jones",
          matchedResearcherInstitution: "Stanford",
          oneLineSummary:
            "Combine your CRISPR expertise with their organoid models",
          proposalId: "proposal-1",
        }),
      }),
    );

    // Email to user B about user A
    expect(mockEnqueue).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "send_email",
        templateId: "match_notification",
        to: "bob@example.com",
        data: expect.objectContaining({
          recipientName: "Bob Jones",
          matchedResearcherName: "Alice Smith",
          matchedResearcherInstitution: "MIT",
          oneLineSummary:
            "Leverage your organoid models with their CRISPR screens",
          proposalId: "proposal-1",
        }),
      }),
    );
  });

  it("updates Match record with notificationSentA and notificationSentB", async () => {
    /** Match record flags should be updated to track which notifications were sent. */
    const prisma = makeMockPrisma(makeProposal());

    await sendMatchNotificationEmails(prisma, "match-1", "proposal-1");

    expect(prisma.match.update).toHaveBeenCalledWith({
      where: { id: "match-1" },
      data: { notificationSentA: true, notificationSentB: true },
    });
  });

  it("skips user A when emailNotificationsEnabled is false", async () => {
    /** Master notification switch off → no email for that user. */
    const prisma = makeMockPrisma(
      makeProposal({
        researcherA: makeUserA({ emailNotificationsEnabled: false }),
      }),
    );

    await sendMatchNotificationEmails(prisma, "match-1", "proposal-1");

    // Only user B should get an email
    expect(mockEnqueue).toHaveBeenCalledTimes(1);
    expect(mockEnqueue).toHaveBeenCalledWith(
      expect.objectContaining({ to: "bob@example.com" }),
    );

    // Only notificationSentB should be set
    expect(prisma.match.update).toHaveBeenCalledWith({
      where: { id: "match-1" },
      data: { notificationSentB: true },
    });
  });

  it("skips user B when notifyMatches is false", async () => {
    /** Per-type match notification toggle off → no email for that user. */
    const prisma = makeMockPrisma(
      makeProposal({
        researcherB: makeUserB({ notifyMatches: false }),
      }),
    );

    await sendMatchNotificationEmails(prisma, "match-1", "proposal-1");

    // Only user A should get an email
    expect(mockEnqueue).toHaveBeenCalledTimes(1);
    expect(mockEnqueue).toHaveBeenCalledWith(
      expect.objectContaining({ to: "alice@example.com" }),
    );

    expect(prisma.match.update).toHaveBeenCalledWith({
      where: { id: "match-1" },
      data: { notificationSentA: true },
    });
  });

  it("skips both users when both have notifications disabled", async () => {
    /** When neither user wants notifications, no emails and no Match update. */
    const prisma = makeMockPrisma(
      makeProposal({
        researcherA: makeUserA({ emailNotificationsEnabled: false }),
        researcherB: makeUserB({ notifyMatches: false }),
      }),
    );

    await sendMatchNotificationEmails(prisma, "match-1", "proposal-1");

    expect(mockEnqueue).not.toHaveBeenCalled();
    expect(prisma.match.update).not.toHaveBeenCalled();
  });

  it("skips users with placeholder ORCID emails", async () => {
    /** ORCID OAuth creates placeholder emails when no real email is available.
     *  These should not receive notification emails. */
    const prisma = makeMockPrisma(
      makeProposal({
        researcherA: makeUserA({ email: "0000-0001-2345-6789@orcid.placeholder" }),
      }),
    );

    await sendMatchNotificationEmails(prisma, "match-1", "proposal-1");

    // Only user B should get an email
    expect(mockEnqueue).toHaveBeenCalledTimes(1);
    expect(mockEnqueue).toHaveBeenCalledWith(
      expect.objectContaining({ to: "bob@example.com" }),
    );
  });

  it("includes contact email when matched user emailVisibility is mutual_matches", async () => {
    /** For mutual matches, emailVisibility=mutual_matches means email should be shared. */
    const prisma = makeMockPrisma(
      makeProposal({
        researcherB: makeUserB({ emailVisibility: "mutual_matches" }),
      }),
    );

    await sendMatchNotificationEmails(prisma, "match-1", "proposal-1");

    // Email to user A should include user B's contact email
    const callToA = mockEnqueue.mock.calls.find(
      (call: unknown[]) =>
        (call[0] as Record<string, unknown>).to === "alice@example.com",
    );
    expect(callToA).toBeDefined();
    expect(
      (callToA![0] as Record<string, Record<string, unknown>>).data
        .contactEmail,
    ).toBe("bob@example.com");
  });

  it("includes contact email when matched user emailVisibility is public_profile", async () => {
    /** emailVisibility=public_profile also allows email sharing. */
    const prisma = makeMockPrisma(
      makeProposal({
        researcherA: makeUserA({ emailVisibility: "public_profile" }),
      }),
    );

    await sendMatchNotificationEmails(prisma, "match-1", "proposal-1");

    // Email to user B should include user A's contact email
    const callToB = mockEnqueue.mock.calls.find(
      (call: unknown[]) =>
        (call[0] as Record<string, unknown>).to === "bob@example.com",
    );
    expect(callToB).toBeDefined();
    expect(
      (callToB![0] as Record<string, Record<string, unknown>>).data
        .contactEmail,
    ).toBe("alice@example.com");
  });

  it("omits contact email when matched user emailVisibility is never", async () => {
    /** emailVisibility=never means the matched user does not want their email shared. */
    const prisma = makeMockPrisma(
      makeProposal({
        researcherB: makeUserB({ emailVisibility: "never" }),
      }),
    );

    await sendMatchNotificationEmails(prisma, "match-1", "proposal-1");

    // Email to user A should NOT include user B's contact email
    const callToA = mockEnqueue.mock.calls.find(
      (call: unknown[]) =>
        (call[0] as Record<string, unknown>).to === "alice@example.com",
    );
    expect(callToA).toBeDefined();
    expect(
      (callToA![0] as Record<string, Record<string, unknown>>).data
        .contactEmail,
    ).toBeUndefined();
    expect(
      (callToA![0] as Record<string, Record<string, unknown>>).data
        .emailVisibility,
    ).toBe("never");
  });

  it("omits contact email when matched user has placeholder email even with visible setting", async () => {
    /** Even with emailVisibility=mutual_matches, a placeholder email should not be shared. */
    const prisma = makeMockPrisma(
      makeProposal({
        researcherB: makeUserB({
          email: "0000-0002-3456-7890@orcid.placeholder",
          emailVisibility: "mutual_matches",
        }),
      }),
    );

    await sendMatchNotificationEmails(prisma, "match-1", "proposal-1");

    const callToA = mockEnqueue.mock.calls.find(
      (call: unknown[]) =>
        (call[0] as Record<string, unknown>).to === "alice@example.com",
    );
    expect(callToA).toBeDefined();
    expect(
      (callToA![0] as Record<string, Record<string, unknown>>).data
        .contactEmail,
    ).toBeUndefined();
  });

  it("includes department in email data when matched user has one", async () => {
    /** Department should be included in the notification when available. */
    const prisma = makeMockPrisma(makeProposal());

    await sendMatchNotificationEmails(prisma, "match-1", "proposal-1");

    // Email to user B about user A — user A has department "Biology"
    const callToB = mockEnqueue.mock.calls.find(
      (call: unknown[]) =>
        (call[0] as Record<string, unknown>).to === "bob@example.com",
    );
    expect(
      (callToB![0] as Record<string, Record<string, unknown>>).data
        .matchedResearcherDepartment,
    ).toBe("Biology");

    // Email to user A about user B — user B has no department (null)
    const callToA = mockEnqueue.mock.calls.find(
      (call: unknown[]) =>
        (call[0] as Record<string, unknown>).to === "alice@example.com",
    );
    expect(
      (callToA![0] as Record<string, Record<string, unknown>>).data
        .matchedResearcherDepartment,
    ).toBeUndefined();
  });

  it("does nothing when proposal is not found", async () => {
    /** If the proposal was deleted between match creation and notification,
     *  the service should silently return without errors. */
    const prisma = makeMockPrisma(null);

    await sendMatchNotificationEmails(prisma, "match-1", "proposal-1");

    expect(mockEnqueue).not.toHaveBeenCalled();
    expect(prisma.match.update).not.toHaveBeenCalled();
  });
});
