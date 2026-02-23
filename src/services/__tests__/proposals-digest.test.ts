/**
 * Tests for the weekly proposals digest service.
 *
 * Validates that weekly digest emails are correctly enqueued for users
 * who have new, unswiped, visible collaboration proposals. The service
 * must respect notification preferences (emailNotificationsEnabled +
 * notifyNewProposals), enforce the weekly frequency cap via
 * lastDigestSentAt, skip placeholder ORCID emails, and select the
 * highest-confidence proposal for the email preview.
 *
 * Spec reference: specs/notifications.md "New Proposals Available" section.
 */

jest.mock("@/lib/job-queue", () => ({
  getJobQueue: jest.fn(),
}));

import { getJobQueue } from "@/lib/job-queue";
import { runWeeklyDigest, DIGEST_INTERVAL_MS } from "../proposals-digest";

const mockEnqueue = jest.fn().mockResolvedValue("job-1");
(getJobQueue as jest.Mock).mockReturnValue({ enqueue: mockEnqueue });

// --- Test data factories ---

const NOW = new Date("2026-02-22T09:00:00Z");
const ONE_DAY_AGO = new Date(NOW.getTime() - 24 * 60 * 60 * 1000);
const EIGHT_DAYS_AGO = new Date(NOW.getTime() - 8 * 24 * 60 * 60 * 1000);
const THREE_DAYS_AGO = new Date(NOW.getTime() - 3 * 24 * 60 * 60 * 1000);

function makeUser(overrides: Record<string, unknown> = {}) {
  return {
    id: "user-aaa",
    name: "Alice Smith",
    email: "alice@example.com",
    lastDigestSentAt: null,
    ...overrides,
  };
}

function makeProposal(overrides: Record<string, unknown> = {}) {
  return {
    id: "proposal-1",
    researcherAId: "user-aaa",
    researcherBId: "user-zzz",
    title: "CRISPR-based organoid disease modeling",
    oneLineSummaryA: "Combine your CRISPR expertise with their organoid models",
    oneLineSummaryB: "Leverage your organoid models with their CRISPR screens",
    confidenceTier: "high",
    createdAt: ONE_DAY_AGO,
    ...overrides,
  };
}

/**
 * Creates a mock PrismaClient with configurable query behavior.
 *
 * @param users - Users returned by findMany (eligible users query)
 * @param proposals - Proposals returned by findMany (new proposals query)
 */
function makeMockPrisma(
  users: Record<string, unknown>[],
  proposals: Record<string, unknown>[] = [],
) {
  return {
    user: {
      findMany: jest.fn().mockResolvedValue(users),
      update: jest.fn().mockResolvedValue({}),
    },
    collaborationProposal: {
      findMany: jest.fn().mockResolvedValue(proposals),
    },
  } as never;
}

describe("runWeeklyDigest", () => {
  beforeEach(() => jest.clearAllMocks());

  it("enqueues a digest email for a user with new proposals", async () => {
    /** User has notification preferences enabled and new unswiped proposals.
     *  Should receive one digest email with the correct template data. */
    const user = makeUser();
    const proposal = makeProposal();
    const prisma = makeMockPrisma([user], [proposal]);

    const result = await runWeeklyDigest(prisma, { minIntervalMs: 0 });

    expect(result.emailsSent).toBe(1);
    expect(result.usersSkipped).toBe(0);
    expect(mockEnqueue).toHaveBeenCalledTimes(1);
    expect(mockEnqueue).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "send_email",
        templateId: "new_proposals_digest",
        to: "alice@example.com",
        data: expect.objectContaining({
          recipientName: "Alice Smith",
          proposalCount: 1,
          topProposalTitle: "CRISPR-based organoid disease modeling",
          topProposalSummary:
            "Combine your CRISPR expertise with their organoid models",
        }),
      }),
    );
  });

  it("uses the correct one-line summary based on user side (researcher B)", async () => {
    /** When the user is researcher B on the proposal, the digest should
     *  use oneLineSummaryB, not oneLineSummaryA. */
    const user = makeUser({ id: "user-zzz", name: "Bob Jones", email: "bob@example.com" });
    const proposal = makeProposal();
    const prisma = makeMockPrisma([user], [proposal]);

    const result = await runWeeklyDigest(prisma, { minIntervalMs: 0 });

    expect(result.emailsSent).toBe(1);
    expect(mockEnqueue).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          topProposalSummary:
            "Leverage your organoid models with their CRISPR screens",
        }),
      }),
    );
  });

  it("updates lastDigestSentAt after sending a digest", async () => {
    /** The user's lastDigestSentAt should be updated to track when the
     *  last digest was sent, enabling the weekly frequency cap. */
    const user = makeUser();
    const prisma = makeMockPrisma([user], [makeProposal()]);

    await runWeeklyDigest(prisma, { minIntervalMs: 0 });

    expect(prisma.user.update).toHaveBeenCalledWith({
      where: { id: "user-aaa" },
      data: { lastDigestSentAt: expect.any(Date) },
    });
  });

  it("skips users with no new proposals", async () => {
    /** User has no new unswiped proposals — no email should be sent,
     *  and lastDigestSentAt should not be updated. */
    const user = makeUser();
    const prisma = makeMockPrisma([user], []); // No proposals

    const result = await runWeeklyDigest(prisma, { minIntervalMs: 0 });

    expect(result.emailsSent).toBe(0);
    expect(result.usersSkipped).toBe(1);
    expect(mockEnqueue).not.toHaveBeenCalled();
    expect(prisma.user.update).not.toHaveBeenCalled();
  });

  it("processes multiple users independently", async () => {
    /** Each user should be processed independently. Users with proposals
     *  get emails; users without proposals are skipped. */
    const userA = makeUser();
    const userB = makeUser({
      id: "user-bbb",
      name: "Bob Jones",
      email: "bob@example.com",
    });
    const proposal = makeProposal();

    // First user has proposals, second user has none
    const prisma = makeMockPrisma([userA, userB], []);
    // Override: first call returns proposals, second returns empty
    const proposalFindMany = prisma.collaborationProposal.findMany as jest.Mock;
    proposalFindMany
      .mockResolvedValueOnce([proposal])
      .mockResolvedValueOnce([]);

    const result = await runWeeklyDigest(prisma, { minIntervalMs: 0 });

    expect(result.emailsSent).toBe(1);
    expect(result.usersSkipped).toBe(1);
    expect(mockEnqueue).toHaveBeenCalledTimes(1);
    expect(mockEnqueue).toHaveBeenCalledWith(
      expect.objectContaining({ to: "alice@example.com" }),
    );
  });

  it("selects the highest-confidence proposal as the top proposal", async () => {
    /** When multiple proposals exist, the highest-confidence one should
     *  be used for the preview in the digest email. */
    const user = makeUser();
    const speculativeProposal = makeProposal({
      id: "proposal-speculative",
      title: "Speculative idea",
      oneLineSummaryA: "A speculative collaboration",
      confidenceTier: "speculative",
      createdAt: ONE_DAY_AGO,
    });
    const highProposal = makeProposal({
      id: "proposal-high",
      title: "High-confidence collaboration",
      oneLineSummaryA: "A high-confidence collaboration",
      confidenceTier: "high",
      createdAt: THREE_DAYS_AGO,
    });
    const moderateProposal = makeProposal({
      id: "proposal-moderate",
      title: "Moderate idea",
      oneLineSummaryA: "A moderate collaboration",
      confidenceTier: "moderate",
      createdAt: ONE_DAY_AGO,
    });
    const prisma = makeMockPrisma(
      [user],
      [speculativeProposal, moderateProposal, highProposal],
    );

    await runWeeklyDigest(prisma, { minIntervalMs: 0 });

    expect(mockEnqueue).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          proposalCount: 3,
          topProposalTitle: "High-confidence collaboration",
          topProposalSummary: "A high-confidence collaboration",
        }),
      }),
    );
  });

  it("breaks confidence ties by most recent proposal", async () => {
    /** When two proposals share the same confidence tier, the more
     *  recently created one should be selected for the preview. */
    const user = makeUser();
    const olderHigh = makeProposal({
      id: "proposal-older",
      title: "Older high-confidence",
      oneLineSummaryA: "Older idea",
      confidenceTier: "high",
      createdAt: THREE_DAYS_AGO,
    });
    const newerHigh = makeProposal({
      id: "proposal-newer",
      title: "Newer high-confidence",
      oneLineSummaryA: "Newer idea",
      confidenceTier: "high",
      createdAt: ONE_DAY_AGO,
    });
    const prisma = makeMockPrisma([user], [olderHigh, newerHigh]);

    await runWeeklyDigest(prisma, { minIntervalMs: 0 });

    expect(mockEnqueue).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          topProposalTitle: "Newer high-confidence",
          topProposalSummary: "Newer idea",
        }),
      }),
    );
  });

  it("queries for proposals created after lastDigestSentAt", async () => {
    /** The proposal query should only include proposals created after
     *  the user's last digest timestamp, not all-time proposals. */
    const user = makeUser({ lastDigestSentAt: EIGHT_DAYS_AGO });
    const prisma = makeMockPrisma([user], []);

    await runWeeklyDigest(prisma, { minIntervalMs: 0 });

    const findManyCall = (
      prisma.collaborationProposal.findMany as jest.Mock
    ).mock.calls[0][0];

    // The query should filter by createdAt > lastDigestSentAt
    expect(findManyCall.where.createdAt).toEqual({ gt: EIGHT_DAYS_AGO });
  });

  it("queries for all-time proposals when lastDigestSentAt is null", async () => {
    /** First-time digest: lastDigestSentAt is null, so all proposals
     *  since epoch should be included. */
    const user = makeUser({ lastDigestSentAt: null });
    const prisma = makeMockPrisma([user], []);

    await runWeeklyDigest(prisma, { minIntervalMs: 0 });

    const findManyCall = (
      prisma.collaborationProposal.findMany as jest.Mock
    ).mock.calls[0][0];

    // When lastDigestSentAt is null, query from epoch (Date(0))
    expect(findManyCall.where.createdAt).toEqual({ gt: new Date(0) });
  });

  it("filters eligible users by notification preferences in the database query", async () => {
    /** The initial user query should filter by emailNotificationsEnabled=true
     *  and notifyNewProposals=true to avoid fetching ineligible users. */
    const prisma = makeMockPrisma([], []);

    await runWeeklyDigest(prisma, { minIntervalMs: 0 });

    const findManyCall = (prisma.user.findMany as jest.Mock).mock.calls[0][0];
    expect(findManyCall.where.emailNotificationsEnabled).toBe(true);
    expect(findManyCall.where.notifyNewProposals).toBe(true);
  });

  it("excludes users with placeholder ORCID emails from the query", async () => {
    /** Placeholder ORCID emails should be excluded at the query level
     *  to avoid unnecessary proposal lookups. */
    const prisma = makeMockPrisma([], []);

    await runWeeklyDigest(prisma, { minIntervalMs: 0 });

    const findManyCall = (prisma.user.findMany as jest.Mock).mock.calls[0][0];
    expect(findManyCall.where.NOT).toEqual({
      email: { endsWith: "@orcid.placeholder" },
    });
  });

  it("reports errors per user without stopping processing of other users", async () => {
    /** If processing one user throws an error, other users should still
     *  be processed. The error should be captured in the result. */
    const userA = makeUser();
    const userB = makeUser({
      id: "user-bbb",
      name: "Bob",
      email: "bob@example.com",
    });
    const prisma = makeMockPrisma([userA, userB], []);
    const proposalFindMany = prisma.collaborationProposal.findMany as jest.Mock;
    proposalFindMany
      .mockRejectedValueOnce(new Error("DB connection failed"))
      .mockResolvedValueOnce([makeProposal({ researcherAId: "user-bbb" })]);

    const result = await runWeeklyDigest(prisma, { minIntervalMs: 0 });

    expect(result.errors["user-aaa"]).toBe("DB connection failed");
    expect(result.emailsSent).toBe(1);
  });

  it("returns correct result when no users are eligible", async () => {
    /** When no users have notification preferences enabled, the result
     *  should show zero emails and zero errors. */
    const prisma = makeMockPrisma([], []);

    const result = await runWeeklyDigest(prisma, { minIntervalMs: 0 });

    expect(result.emailsSent).toBe(0);
    expect(result.usersSkipped).toBe(0);
    expect(result.errors).toEqual({});
  });

  it("enforces digest interval via user query filter", async () => {
    /** Users who received a digest less than minIntervalMs ago should
     *  be excluded from the initial query. The query uses OR logic:
     *  lastDigestSentAt is null OR lastDigestSentAt < cutoff. */
    const prisma = makeMockPrisma([], []);

    await runWeeklyDigest(prisma);

    const findManyCall = (prisma.user.findMany as jest.Mock).mock.calls[0][0];
    // Should have OR clause for null or before cutoff
    expect(findManyCall.where.OR).toEqual([
      { lastDigestSentAt: null },
      { lastDigestSentAt: { lt: expect.any(Date) } },
    ]);
  });

  it("queries proposals with correct visibility and swipe exclusion filters", async () => {
    /** The proposal query must check that the user's visibility is 'visible'
     *  on their side, and exclude proposals they've already swiped on. */
    const user = makeUser();
    const prisma = makeMockPrisma([user], []);

    await runWeeklyDigest(prisma, { minIntervalMs: 0 });

    const findManyCall = (
      prisma.collaborationProposal.findMany as jest.Mock
    ).mock.calls[0][0];

    // Should check visibility for both researcher A and B positions
    expect(findManyCall.where.OR).toEqual([
      { researcherAId: "user-aaa", visibilityA: "visible" },
      { researcherBId: "user-aaa", visibilityB: "visible" },
    ]);

    // Should exclude proposals already swiped on
    expect(findManyCall.where.NOT).toEqual({
      swipes: { some: { userId: "user-aaa" } },
    });
  });

  it("exports DIGEST_INTERVAL_MS as 7 days", () => {
    /** The default interval should be exactly 7 days in milliseconds. */
    expect(DIGEST_INTERVAL_MS).toBe(7 * 24 * 60 * 60 * 1000);
  });
});
