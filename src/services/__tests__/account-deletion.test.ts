/**
 * Tests for account deletion service.
 *
 * Validates the full account deletion flow per spec (data-model.md §Account Deletion):
 * - Soft-deletes the User record (anonymizes email/orcid, sets deletedAt)
 * - Deletes profile, publications, swipes, match pool entries, affiliation
 *   selections, survey responses, and matching results
 * - Preserves proposals where the other party swiped "interested"
 * - Deletes proposals where the other party did NOT swipe interested
 * - Sets the deleted user's visibility to "hidden" on preserved proposals
 */

import { deleteAccount } from "../account-deletion";

// --- Mock Prisma transaction ---

interface MockTx {
  user: {
    findUnique: jest.Mock;
    update: jest.Mock;
  };
  collaborationProposal: {
    findMany: jest.Mock;
    deleteMany: jest.Mock;
    updateMany: jest.Mock;
  };
  swipe: {
    deleteMany: jest.Mock;
  };
  match: {
    deleteMany: jest.Mock;
  };
  researcherProfile: {
    deleteMany: jest.Mock;
  };
  publication: {
    deleteMany: jest.Mock;
  };
  matchPoolEntry: {
    deleteMany: jest.Mock;
  };
  affiliationSelection: {
    deleteMany: jest.Mock;
  };
  surveyResponse: {
    deleteMany: jest.Mock;
  };
  matchingResult: {
    deleteMany: jest.Mock;
  };
}

function makeMockTx(): MockTx {
  return {
    user: {
      findUnique: jest.fn(),
      update: jest.fn().mockResolvedValue({}),
    },
    collaborationProposal: {
      findMany: jest.fn().mockResolvedValue([]),
      deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
      updateMany: jest.fn().mockResolvedValue({ count: 0 }),
    },
    swipe: {
      deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
    },
    match: {
      deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
    },
    researcherProfile: {
      deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
    },
    publication: {
      deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
    },
    matchPoolEntry: {
      deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
    },
    affiliationSelection: {
      deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
    },
    surveyResponse: {
      deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
    },
    matchingResult: {
      deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
    },
  };
}

function makeMockPrisma(tx: MockTx) {
  return {
    $transaction: jest.fn((fn: (tx: MockTx) => Promise<unknown>) => fn(tx)),
  } as never;
}

const USER_ID = "aaaa-1111";
const OTHER_USER_ID = "bbbb-2222";

function makeProposal(overrides: Record<string, unknown> = {}) {
  return {
    id: "proposal-1",
    researcherAId: USER_ID,
    researcherBId: OTHER_USER_ID,
    swipes: [],
    ...overrides,
  };
}

describe("deleteAccount", () => {
  let tx: MockTx;

  beforeEach(() => {
    jest.clearAllMocks();
    tx = makeMockTx();
    tx.user.findUnique.mockResolvedValue({ id: USER_ID, deletedAt: null });
  });

  it("throws if user is not found", async () => {
    tx.user.findUnique.mockResolvedValue(null);
    const prisma = makeMockPrisma(tx);

    await expect(deleteAccount(prisma, USER_ID)).rejects.toThrow(
      "User not found",
    );
  });

  it("throws if user is already deleted", async () => {
    tx.user.findUnique.mockResolvedValue({
      id: USER_ID,
      deletedAt: new Date(),
    });
    const prisma = makeMockPrisma(tx);

    await expect(deleteAccount(prisma, USER_ID)).rejects.toThrow(
      "Account is already deleted",
    );
  });

  it("deletes a user with no proposals", async () => {
    /** Verifies the simplest deletion path: no proposals to preserve or delete. */
    tx.collaborationProposal.findMany.mockResolvedValue([]);
    const prisma = makeMockPrisma(tx);

    const result = await deleteAccount(prisma, USER_ID);

    expect(result).toEqual({
      preservedProposalCount: 0,
      deletedProposalCount: 0,
    });

    // Profile, publications, swipes, match pool, affiliation, survey, matching results all deleted
    expect(tx.researcherProfile.deleteMany).toHaveBeenCalledWith({
      where: { userId: USER_ID },
    });
    expect(tx.publication.deleteMany).toHaveBeenCalledWith({
      where: { userId: USER_ID },
    });
    expect(tx.swipe.deleteMany).toHaveBeenCalledWith({
      where: { userId: USER_ID },
    });
    expect(tx.matchPoolEntry.deleteMany).toHaveBeenCalledWith({
      where: { OR: [{ userId: USER_ID }, { targetUserId: USER_ID }] },
    });
    expect(tx.affiliationSelection.deleteMany).toHaveBeenCalledWith({
      where: { userId: USER_ID },
    });
    expect(tx.surveyResponse.deleteMany).toHaveBeenCalledWith({
      where: { userId: USER_ID },
    });
    expect(tx.matchingResult.deleteMany).toHaveBeenCalledWith({
      where: {
        OR: [{ researcherAId: USER_ID }, { researcherBId: USER_ID }],
      },
    });

    // User soft-deleted with anonymized fields
    expect(tx.user.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: USER_ID },
        data: expect.objectContaining({
          department: null,
          allowIncomingProposals: false,
          emailNotificationsEnabled: false,
          notifyMatches: false,
          notifyNewProposals: false,
          notifyProfileRefresh: false,
          deletedAt: expect.any(Date),
        }),
      }),
    );

    // Email and orcid are anonymized (contain 'deleted-' prefix)
    const updateData = tx.user.update.mock.calls[0][0].data;
    expect(updateData.email).toMatch(/^deleted-.*@deleted\.copi\.science$/);
    expect(updateData.orcid).toMatch(/^deleted-/);
  });

  it("preserves proposals where the other party swiped interested", async () => {
    /** When the other user swiped interested, the proposal stays but
     * the deleted user's visibility is set to hidden. */
    const proposal = makeProposal({
      swipes: [{ userId: OTHER_USER_ID, direction: "interested" }],
    });
    tx.collaborationProposal.findMany.mockResolvedValue([proposal]);
    const prisma = makeMockPrisma(tx);

    const result = await deleteAccount(prisma, USER_ID);

    expect(result.preservedProposalCount).toBe(1);
    expect(result.deletedProposalCount).toBe(0);

    // Proposal NOT deleted
    expect(tx.collaborationProposal.deleteMany).not.toHaveBeenCalled();

    // Visibility set to hidden for deleted user's side (side A in this case)
    expect(tx.collaborationProposal.updateMany).toHaveBeenCalledWith({
      where: { id: { in: ["proposal-1"] } },
      data: { visibilityA: "hidden" },
    });
  });

  it("deletes proposals where the other party did not swipe interested", async () => {
    /** Proposals where the other party archived or didn't swipe at all
     * should be deleted entirely. */
    const proposal = makeProposal({
      swipes: [{ userId: OTHER_USER_ID, direction: "archive" }],
    });
    tx.collaborationProposal.findMany.mockResolvedValue([proposal]);
    const prisma = makeMockPrisma(tx);

    const result = await deleteAccount(prisma, USER_ID);

    expect(result.preservedProposalCount).toBe(0);
    expect(result.deletedProposalCount).toBe(1);

    // Matches and swipes on the proposal deleted, then proposal deleted
    expect(tx.match.deleteMany).toHaveBeenCalledWith({
      where: { proposalId: { in: ["proposal-1"] } },
    });
    expect(tx.collaborationProposal.deleteMany).toHaveBeenCalledWith({
      where: { id: { in: ["proposal-1"] } },
    });
  });

  it("deletes proposals where the other party has no swipe at all", async () => {
    /** No swipe from other party means no interest — delete the proposal. */
    const proposal = makeProposal({ swipes: [] });
    tx.collaborationProposal.findMany.mockResolvedValue([proposal]);
    const prisma = makeMockPrisma(tx);

    const result = await deleteAccount(prisma, USER_ID);

    expect(result.preservedProposalCount).toBe(0);
    expect(result.deletedProposalCount).toBe(1);
  });

  it("handles mixed proposals — some preserved, some deleted", async () => {
    /** Real scenario: user has multiple proposals, some the other party
     * is interested in, some not. */
    const preserved = makeProposal({
      id: "proposal-preserved",
      swipes: [{ userId: OTHER_USER_ID, direction: "interested" }],
    });
    const deleted = makeProposal({
      id: "proposal-deleted",
      researcherAId: OTHER_USER_ID,
      researcherBId: USER_ID,
      swipes: [{ userId: OTHER_USER_ID, direction: "archive" }],
    });
    const noSwipe = makeProposal({
      id: "proposal-no-swipe",
      researcherAId: OTHER_USER_ID,
      researcherBId: USER_ID,
      swipes: [],
    });
    tx.collaborationProposal.findMany.mockResolvedValue([
      preserved,
      deleted,
      noSwipe,
    ]);
    const prisma = makeMockPrisma(tx);

    const result = await deleteAccount(prisma, USER_ID);

    expect(result.preservedProposalCount).toBe(1);
    expect(result.deletedProposalCount).toBe(2);

    // Preserved proposal: visibility set to hidden for deleted user (side A)
    expect(tx.collaborationProposal.updateMany).toHaveBeenCalledWith({
      where: { id: { in: ["proposal-preserved"] } },
      data: { visibilityA: "hidden" },
    });

    // Deleted proposals removed
    expect(tx.collaborationProposal.deleteMany).toHaveBeenCalledWith({
      where: { id: { in: ["proposal-deleted", "proposal-no-swipe"] } },
    });
  });

  it("sets visibility to hidden on the correct side (B) when user is researcher B", async () => {
    /** When the deleted user is researcher B, visibilityB should be set to hidden. */
    const proposal = makeProposal({
      researcherAId: OTHER_USER_ID,
      researcherBId: USER_ID,
      swipes: [{ userId: OTHER_USER_ID, direction: "interested" }],
    });
    tx.collaborationProposal.findMany.mockResolvedValue([proposal]);
    const prisma = makeMockPrisma(tx);

    await deleteAccount(prisma, USER_ID);

    // Side B visibility updated
    expect(tx.collaborationProposal.updateMany).toHaveBeenCalledWith({
      where: { id: { in: ["proposal-1"] } },
      data: { visibilityB: "hidden" },
    });
  });

  it("deletes user's own swipes even on preserved proposals", async () => {
    /** Per spec, ALL swipe history is deleted — including swipes on
     * proposals that are preserved for the other user. */
    const proposal = makeProposal({
      swipes: [
        { userId: USER_ID, direction: "interested" },
        { userId: OTHER_USER_ID, direction: "interested" },
      ],
    });
    tx.collaborationProposal.findMany.mockResolvedValue([proposal]);
    const prisma = makeMockPrisma(tx);

    await deleteAccount(prisma, USER_ID);

    // All of the user's swipes are deleted (this call deletes across ALL proposals)
    expect(tx.swipe.deleteMany).toHaveBeenCalledWith({
      where: { userId: USER_ID },
    });
  });

  it("deletes match pool entries in both directions", async () => {
    /** Match pool entries are deleted both where this user selected others
     * (userId) and where others selected this user (targetUserId). */
    const prisma = makeMockPrisma(tx);

    await deleteAccount(prisma, USER_ID);

    expect(tx.matchPoolEntry.deleteMany).toHaveBeenCalledWith({
      where: {
        OR: [{ userId: USER_ID }, { targetUserId: USER_ID }],
      },
    });
  });

  it("generates unique anonymous values on each deletion", async () => {
    /** Email and orcid must be unique in the database, so each deletion
     * generates a unique suffix to avoid conflicts. */
    const prisma = makeMockPrisma(tx);

    await deleteAccount(prisma, USER_ID);

    const firstData = tx.user.update.mock.calls[0][0].data;

    // Reset and delete a different user
    jest.clearAllMocks();
    tx.user.findUnique.mockResolvedValue({
      id: "cccc-3333",
      deletedAt: null,
    });
    tx.collaborationProposal.findMany.mockResolvedValue([]);

    await deleteAccount(prisma, "cccc-3333");

    const secondData = tx.user.update.mock.calls[0][0].data;

    // Anonymized values should differ
    expect(firstData.email).not.toBe(secondData.email);
    expect(firstData.orcid).not.toBe(secondData.orcid);
  });

  it("disables all notification preferences on deletion", async () => {
    /** A deleted user should not receive any notifications. */
    const prisma = makeMockPrisma(tx);

    await deleteAccount(prisma, USER_ID);

    const updateData = tx.user.update.mock.calls[0][0].data;
    expect(updateData.allowIncomingProposals).toBe(false);
    expect(updateData.emailNotificationsEnabled).toBe(false);
    expect(updateData.notifyMatches).toBe(false);
    expect(updateData.notifyNewProposals).toBe(false);
    expect(updateData.notifyProfileRefresh).toBe(false);
  });
});
