/**
 * Tests for eligible pair computation service.
 *
 * Validates the core matching engine logic that determines which researcher
 * pairs should receive collaboration proposals, based on:
 * - Mutual match pool selection → both visible
 * - One-sided selection with allow_incoming_proposals → selector visible,
 *   other pending_other_interest
 * - Neither condition met → not eligible
 * - Already-evaluated pairs at same profile versions → filtered out
 * - Both researchers must have profiles → profileless users excluded
 * - Scoped computation (forUserId) → only pairs involving that user
 *
 * The Prisma client is fully mocked — no real database calls are made.
 */

import type { PrismaClient } from "@prisma/client";
import { computeEligiblePairs, type EligiblePair } from "../eligible-pairs";

// --- Mock Prisma ---

/**
 * Creates a mock PrismaClient with configurable data for match pool entries,
 * users (with profiles and settings), and matching results.
 */
function createMockDb(config: {
  entries?: Array<{ userId: string; targetUserId: string }>;
  users?: Array<{
    id: string;
    allowIncomingProposals: boolean;
    profile: { profileVersion: number } | null;
  }>;
  matchingResults?: Array<{
    researcherAId: string;
    researcherBId: string;
    profileVersionA: number;
    profileVersionB: number;
  }>;
}) {
  return {
    matchPoolEntry: {
      findMany: jest.fn().mockResolvedValue(config.entries ?? []),
    },
    user: {
      findMany: jest.fn().mockResolvedValue(config.users ?? []),
    },
    matchingResult: {
      findMany: jest.fn().mockResolvedValue(config.matchingResults ?? []),
    },
  } as unknown as PrismaClient;
}

// --- Test data ---

// UUIDs sorted: USER_A < USER_B < USER_C < USER_D by string comparison
const USER_A = "00000000-0000-0000-0000-000000000001";
const USER_B = "00000000-0000-0000-0000-000000000002";
const USER_C = "00000000-0000-0000-0000-000000000003";
const USER_D = "00000000-0000-0000-0000-000000000004";

function makeUser(
  id: string,
  overrides: {
    allowIncoming?: boolean;
    profileVersion?: number;
    hasProfile?: boolean;
  } = {},
) {
  const {
    allowIncoming = false,
    profileVersion = 1,
    hasProfile = true,
  } = overrides;
  return {
    id,
    allowIncomingProposals: allowIncoming,
    profile: hasProfile ? { profileVersion } : null,
  };
}

// --- Tests ---

describe("computeEligiblePairs", () => {
  describe("mutual selection", () => {
    it("returns both visible when A selected B and B selected A", async () => {
      // Mutual selection is the simplest eligibility case: both users chose
      // each other, so both should see proposals immediately.
      const db = createMockDb({
        entries: [
          { userId: USER_A, targetUserId: USER_B },
          { userId: USER_B, targetUserId: USER_A },
        ],
        users: [makeUser(USER_A), makeUser(USER_B)],
      });

      const pairs = await computeEligiblePairs(db);

      expect(pairs).toHaveLength(1);
      expect(pairs[0]).toEqual({
        researcherAId: USER_A,
        researcherBId: USER_B,
        visibilityA: "visible",
        visibilityB: "visible",
        profileVersionA: 1,
        profileVersionB: 1,
      });
    });

    it("mutual selection takes precedence over allow_incoming_proposals", async () => {
      // When both users selected each other, the result should be mutual
      // visibility regardless of allow_incoming_proposals settings.
      const db = createMockDb({
        entries: [
          { userId: USER_A, targetUserId: USER_B },
          { userId: USER_B, targetUserId: USER_A },
        ],
        users: [
          makeUser(USER_A, { allowIncoming: true }),
          makeUser(USER_B, { allowIncoming: true }),
        ],
      });

      const pairs = await computeEligiblePairs(db);

      expect(pairs).toHaveLength(1);
      expect(pairs[0].visibilityA).toBe("visible");
      expect(pairs[0].visibilityB).toBe("visible");
    });
  });

  describe("one-sided selection with allow_incoming_proposals", () => {
    it("A selected B, B allows incoming → A visible, B pending", async () => {
      // A chose B and B has allow_incoming_proposals=true but didn't choose A.
      // A sees the proposal (visible), B gets it as pending_other_interest.
      const db = createMockDb({
        entries: [{ userId: USER_A, targetUserId: USER_B }],
        users: [
          makeUser(USER_A),
          makeUser(USER_B, { allowIncoming: true }),
        ],
      });

      const pairs = await computeEligiblePairs(db);

      expect(pairs).toHaveLength(1);
      expect(pairs[0]).toEqual({
        researcherAId: USER_A,
        researcherBId: USER_B,
        visibilityA: "visible",
        visibilityB: "pending_other_interest",
        profileVersionA: 1,
        profileVersionB: 1,
      });
    });

    it("B selected A, A allows incoming → A pending, B visible", async () => {
      // B chose A and A has allow_incoming_proposals=true but didn't choose B.
      // B sees the proposal (visible), A gets it as pending_other_interest.
      // After UUID ordering: A is researcherA, B is researcherB.
      const db = createMockDb({
        entries: [{ userId: USER_B, targetUserId: USER_A }],
        users: [
          makeUser(USER_A, { allowIncoming: true }),
          makeUser(USER_B),
        ],
      });

      const pairs = await computeEligiblePairs(db);

      expect(pairs).toHaveLength(1);
      expect(pairs[0]).toEqual({
        researcherAId: USER_A,
        researcherBId: USER_B,
        visibilityA: "pending_other_interest",
        visibilityB: "visible",
        profileVersionA: 1,
        profileVersionB: 1,
      });
    });

    it("higher UUID selected lower UUID, lower allows incoming → correct visibility mapping", async () => {
      // Tests that UUID ordering doesn't break visibility assignment when
      // the selector has a higher UUID than the target.
      const db = createMockDb({
        entries: [{ userId: USER_B, targetUserId: USER_A }],
        users: [
          makeUser(USER_A, { allowIncoming: true }),
          makeUser(USER_B),
        ],
      });

      const pairs = await computeEligiblePairs(db);

      // USER_A (lower UUID) = researcherA. B selected A, so B is the
      // selector and is "visible". A allows incoming so gets "pending".
      expect(pairs[0].researcherAId).toBe(USER_A);
      expect(pairs[0].visibilityA).toBe("pending_other_interest");
      expect(pairs[0].visibilityB).toBe("visible");
    });
  });

  describe("ineligible pairs", () => {
    it("one-sided selection without allow_incoming → not eligible", async () => {
      // A selected B but B has allow_incoming=false and B didn't select A.
      // No eligibility condition is met.
      const db = createMockDb({
        entries: [{ userId: USER_A, targetUserId: USER_B }],
        users: [
          makeUser(USER_A),
          makeUser(USER_B, { allowIncoming: false }),
        ],
      });

      const pairs = await computeEligiblePairs(db);
      expect(pairs).toHaveLength(0);
    });

    it("no match pool entries → empty result", async () => {
      const db = createMockDb({ entries: [] });
      const pairs = await computeEligiblePairs(db);
      expect(pairs).toHaveLength(0);
    });

    it("user without profile is excluded from pairs", async () => {
      // A selected B, B selected A (mutual), but B has no profile.
      // B shouldn't be eligible since there's nothing to match on.
      const db = createMockDb({
        entries: [
          { userId: USER_A, targetUserId: USER_B },
          { userId: USER_B, targetUserId: USER_A },
        ],
        users: [makeUser(USER_A), makeUser(USER_B, { hasProfile: false })],
      });

      const pairs = await computeEligiblePairs(db);
      expect(pairs).toHaveLength(0);
    });

    it("selector without profile is excluded", async () => {
      // A selected B but A has no profile — can't generate proposals.
      const db = createMockDb({
        entries: [{ userId: USER_A, targetUserId: USER_B }],
        users: [
          makeUser(USER_A, { hasProfile: false }),
          makeUser(USER_B, { allowIncoming: true }),
        ],
      });

      const pairs = await computeEligiblePairs(db);
      expect(pairs).toHaveLength(0);
    });
  });

  describe("profile version tracking", () => {
    it("includes profile versions from both researchers", async () => {
      // Verifies that the returned pair carries the correct profile version
      // for each researcher, which is used for MatchingResult tracking.
      const db = createMockDb({
        entries: [
          { userId: USER_A, targetUserId: USER_B },
          { userId: USER_B, targetUserId: USER_A },
        ],
        users: [
          makeUser(USER_A, { profileVersion: 3 }),
          makeUser(USER_B, { profileVersion: 7 }),
        ],
      });

      const pairs = await computeEligiblePairs(db);

      expect(pairs).toHaveLength(1);
      expect(pairs[0].profileVersionA).toBe(3);
      expect(pairs[0].profileVersionB).toBe(7);
    });
  });

  describe("already-evaluated pair filtering", () => {
    it("filters out pairs already evaluated at same profile versions", async () => {
      // If a MatchingResult exists for the pair at the same profile versions,
      // the pair has already been processed and shouldn't be re-evaluated.
      const db = createMockDb({
        entries: [
          { userId: USER_A, targetUserId: USER_B },
          { userId: USER_B, targetUserId: USER_A },
        ],
        users: [
          makeUser(USER_A, { profileVersion: 2 }),
          makeUser(USER_B, { profileVersion: 3 }),
        ],
        matchingResults: [
          {
            researcherAId: USER_A,
            researcherBId: USER_B,
            profileVersionA: 2,
            profileVersionB: 3,
          },
        ],
      });

      const pairs = await computeEligiblePairs(db);
      expect(pairs).toHaveLength(0);
    });

    it("includes pairs with updated profile versions (re-evaluation needed)", async () => {
      // A profile version bump means the profile content changed; the pair
      // needs to be re-evaluated even if a previous result exists.
      const db = createMockDb({
        entries: [
          { userId: USER_A, targetUserId: USER_B },
          { userId: USER_B, targetUserId: USER_A },
        ],
        users: [
          makeUser(USER_A, { profileVersion: 3 }),
          makeUser(USER_B, { profileVersion: 3 }),
        ],
        matchingResults: [
          {
            researcherAId: USER_A,
            researcherBId: USER_B,
            profileVersionA: 2,  // Old version — A's profile was updated
            profileVersionB: 3,
          },
        ],
      });

      const pairs = await computeEligiblePairs(db);
      expect(pairs).toHaveLength(1);
    });

    it("includes pairs with no prior matching results", async () => {
      // Brand new pair — no matching result exists, so it should be returned.
      const db = createMockDb({
        entries: [
          { userId: USER_A, targetUserId: USER_B },
          { userId: USER_B, targetUserId: USER_A },
        ],
        users: [makeUser(USER_A), makeUser(USER_B)],
        matchingResults: [],
      });

      const pairs = await computeEligiblePairs(db);
      expect(pairs).toHaveLength(1);
    });

    it("keeps pairs where only one side's version changed", async () => {
      // Even if just one researcher's profile changed, the pair should be
      // re-evaluated since the LLM may produce different proposals.
      const db = createMockDb({
        entries: [
          { userId: USER_A, targetUserId: USER_B },
          { userId: USER_B, targetUserId: USER_A },
        ],
        users: [
          makeUser(USER_A, { profileVersion: 1 }),
          makeUser(USER_B, { profileVersion: 5 }),
        ],
        matchingResults: [
          {
            researcherAId: USER_A,
            researcherBId: USER_B,
            profileVersionA: 1,
            profileVersionB: 4,  // B's profile was updated (4 → 5)
          },
        ],
      });

      const pairs = await computeEligiblePairs(db);
      expect(pairs).toHaveLength(1);
    });
  });

  describe("multiple pairs", () => {
    it("handles multiple eligible pairs correctly", async () => {
      // Tests that the service correctly processes multiple independent pairs
      // in a single call, each with its own eligibility and visibility logic.
      const db = createMockDb({
        entries: [
          // Mutual: A ↔ B
          { userId: USER_A, targetUserId: USER_B },
          { userId: USER_B, targetUserId: USER_A },
          // One-sided with incoming: A → C (C allows incoming)
          { userId: USER_A, targetUserId: USER_C },
          // One-sided without incoming: A → D (D doesn't allow)
          { userId: USER_A, targetUserId: USER_D },
        ],
        users: [
          makeUser(USER_A),
          makeUser(USER_B),
          makeUser(USER_C, { allowIncoming: true }),
          makeUser(USER_D, { allowIncoming: false }),
        ],
      });

      const pairs = await computeEligiblePairs(db);

      expect(pairs).toHaveLength(2);

      const abPair = pairs.find(
        (p) => p.researcherAId === USER_A && p.researcherBId === USER_B,
      );
      const acPair = pairs.find(
        (p) => p.researcherAId === USER_A && p.researcherBId === USER_C,
      );

      // A ↔ B: mutual → both visible
      expect(abPair).toBeDefined();
      expect(abPair!.visibilityA).toBe("visible");
      expect(abPair!.visibilityB).toBe("visible");

      // A → C: one-sided with C allowing incoming → A visible, C pending
      expect(acPair).toBeDefined();
      expect(acPair!.visibilityA).toBe("visible");
      expect(acPair!.visibilityB).toBe("pending_other_interest");
    });

    it("partial filtering: keeps new pairs, removes already evaluated", async () => {
      // Of three eligible pairs, one was already evaluated at current versions.
      // Only the unevaluated pairs should be returned.
      const db = createMockDb({
        entries: [
          { userId: USER_A, targetUserId: USER_B },
          { userId: USER_B, targetUserId: USER_A },
          { userId: USER_A, targetUserId: USER_C },
          { userId: USER_C, targetUserId: USER_A },
        ],
        users: [
          makeUser(USER_A, { profileVersion: 1 }),
          makeUser(USER_B, { profileVersion: 1 }),
          makeUser(USER_C, { profileVersion: 1 }),
        ],
        matchingResults: [
          // A-B already evaluated at current versions
          {
            researcherAId: USER_A,
            researcherBId: USER_B,
            profileVersionA: 1,
            profileVersionB: 1,
          },
        ],
      });

      const pairs = await computeEligiblePairs(db);

      // Only A-C should remain
      expect(pairs).toHaveLength(1);
      expect(pairs[0].researcherAId).toBe(USER_A);
      expect(pairs[0].researcherBId).toBe(USER_C);
    });
  });

  describe("forUserId scoping", () => {
    it("scopes match pool query to entries involving the specified user", async () => {
      // When forUserId is provided, only pairs involving that user are returned.
      // This is used for event-driven triggers (e.g., user changes match pool).
      const db = createMockDb({
        entries: [
          { userId: USER_A, targetUserId: USER_B },
          { userId: USER_B, targetUserId: USER_A },
        ],
        users: [makeUser(USER_A), makeUser(USER_B)],
      });

      const pairs = await computeEligiblePairs(db, { forUserId: USER_A });

      expect(pairs).toHaveLength(1);

      // Verify the query was scoped via the where clause
      const findManyCall = (db.matchPoolEntry.findMany as jest.Mock).mock
        .calls[0][0];
      expect(findManyCall.where).toEqual({
        OR: [{ userId: USER_A }, { targetUserId: USER_A }],
      });
    });

    it("unscoped query has no where filter on match pool entries", async () => {
      const db = createMockDb({
        entries: [],
      });

      await computeEligiblePairs(db);

      const findManyCall = (db.matchPoolEntry.findMany as jest.Mock).mock
        .calls[0][0];
      expect(findManyCall.where).toEqual({});
    });
  });

  describe("deduplication", () => {
    it("does not produce duplicate pairs from bidirectional entries", async () => {
      // When both A→B and B→A entries exist, only one pair should be returned.
      // The pair deduplication uses ordered IDs as keys.
      const db = createMockDb({
        entries: [
          { userId: USER_A, targetUserId: USER_B },
          { userId: USER_B, targetUserId: USER_A },
        ],
        users: [makeUser(USER_A), makeUser(USER_B)],
      });

      const pairs = await computeEligiblePairs(db);
      expect(pairs).toHaveLength(1);
    });
  });

  describe("UUID ordering convention", () => {
    it("always assigns lower UUID as researcherAId", async () => {
      // The convention from orderUserIds(): a_id < b_id by string sort.
      // This ensures consistent pair identification across the system.
      const db = createMockDb({
        entries: [
          // Entry with higher UUID as selector
          { userId: USER_B, targetUserId: USER_A },
        ],
        users: [
          makeUser(USER_A, { allowIncoming: true }),
          makeUser(USER_B),
        ],
      });

      const pairs = await computeEligiblePairs(db);

      expect(pairs).toHaveLength(1);
      expect(pairs[0].researcherAId).toBe(USER_A);
      expect(pairs[0].researcherBId).toBe(USER_B);
    });
  });

  describe("edge cases", () => {
    it("handles user who selected many others with mixed eligibility", async () => {
      // A selected B, C, D. Only B and C are eligible (B: mutual, C: incoming).
      // D is not eligible. Tests that mixed results from one selector work.
      const db = createMockDb({
        entries: [
          { userId: USER_A, targetUserId: USER_B },
          { userId: USER_B, targetUserId: USER_A },
          { userId: USER_A, targetUserId: USER_C },
          { userId: USER_A, targetUserId: USER_D },
        ],
        users: [
          makeUser(USER_A),
          makeUser(USER_B),
          makeUser(USER_C, { allowIncoming: true }),
          makeUser(USER_D),
        ],
      });

      const pairs = await computeEligiblePairs(db);

      expect(pairs).toHaveLength(2);
      const pairIds = pairs.map(
        (p) => `${p.researcherAId}:${p.researcherBId}`,
      );
      expect(pairIds).toContain(`${USER_A}:${USER_B}`);
      expect(pairIds).toContain(`${USER_A}:${USER_C}`);
    });

    it("both users allow incoming but only one side selected → still only one pair", async () => {
      // A selected B, both allow incoming. This should produce one eligible
      // pair, not duplicate entries from both incoming paths.
      const db = createMockDb({
        entries: [{ userId: USER_A, targetUserId: USER_B }],
        users: [
          makeUser(USER_A, { allowIncoming: true }),
          makeUser(USER_B, { allowIncoming: true }),
        ],
      });

      const pairs = await computeEligiblePairs(db);

      expect(pairs).toHaveLength(1);
      // A is selector, B allows incoming → A visible, B pending
      expect(pairs[0].visibilityA).toBe("visible");
      expect(pairs[0].visibilityB).toBe("pending_other_interest");
    });
  });
});
