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
 * - Match pool cap (200 per user) with priority: individual_select always
 *   included, affiliation/all_users sampled with weekly rotation
 *
 * The Prisma client is fully mocked — no real database calls are made.
 */

import type { PrismaClient, MatchPoolSource } from "@prisma/client";
import {
  computeEligiblePairs,
  capEntriesForUser,
  seededSample,
  MATCH_POOL_CAP,
  type PoolEntry,
} from "../eligible-pairs";

// --- Mock Prisma ---

/**
 * Creates a mock PrismaClient with configurable data for match pool entries,
 * users (with profiles and settings), and matching results.
 * Entries default source to "individual_select" if not specified.
 */
function createMockDb(config: {
  entries?: Array<{ userId: string; targetUserId: string; source?: MatchPoolSource }>;
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
  const entries = (config.entries ?? []).map((e) => ({
    ...e,
    source: e.source ?? ("individual_select" as MatchPoolSource),
  }));
  return {
    matchPoolEntry: {
      findMany: jest.fn().mockResolvedValue(entries),
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
      expect(pairs[0]!.visibilityA).toBe("visible");
      expect(pairs[0]!.visibilityB).toBe("visible");
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
      expect(pairs[0]!.researcherAId).toBe(USER_A);
      expect(pairs[0]!.visibilityA).toBe("pending_other_interest");
      expect(pairs[0]!.visibilityB).toBe("visible");
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
      expect(pairs[0]!.profileVersionA).toBe(3);
      expect(pairs[0]!.profileVersionB).toBe(7);
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
      expect(pairs[0]!.researcherAId).toBe(USER_A);
      expect(pairs[0]!.researcherBId).toBe(USER_C);
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
      expect(pairs[0]!.researcherAId).toBe(USER_A);
      expect(pairs[0]!.researcherBId).toBe(USER_B);
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
      expect(pairs[0]!.visibilityA).toBe("visible");
      expect(pairs[0]!.visibilityB).toBe("pending_other_interest");
    });
  });

  describe("match pool cap", () => {
    it("does not cap when entries are under the limit", async () => {
      // With only 3 entries, well below the 200 cap, all should pass through.
      const db = createMockDb({
        entries: [
          { userId: USER_A, targetUserId: USER_B, source: "individual_select" },
          { userId: USER_A, targetUserId: USER_C, source: "affiliation_select" },
          { userId: USER_B, targetUserId: USER_A, source: "individual_select" },
        ],
        users: [makeUser(USER_A), makeUser(USER_B), makeUser(USER_C, { allowIncoming: true })],
      });

      const pairs = await computeEligiblePairs(db);
      expect(pairs).toHaveLength(2); // A↔B mutual, A→C one-sided
    });

    it("caps affiliation entries when user exceeds pool limit", async () => {
      // User A has 3 individual_select entries and 10 affiliation entries.
      // With cap=5, only 2 affiliation entries should survive (5 - 3 = 2 slots).
      const individualTargets = [USER_B, USER_C, USER_D];
      const affiliationTargets = Array.from({ length: 10 }, (_, i) =>
        `10000000-0000-0000-0000-${String(i + 10).padStart(12, "0")}`
      );

      const entries = [
        ...individualTargets.map((t) => ({
          userId: USER_A,
          targetUserId: t,
          source: "individual_select" as MatchPoolSource,
        })),
        ...affiliationTargets.map((t) => ({
          userId: USER_A,
          targetUserId: t,
          source: "affiliation_select" as MatchPoolSource,
        })),
        // Reverse entries for mutual selection
        ...individualTargets.map((t) => ({
          userId: t,
          targetUserId: USER_A,
          source: "individual_select" as MatchPoolSource,
        })),
      ];

      const users = [
        makeUser(USER_A),
        ...individualTargets.map((id) => makeUser(id)),
        ...affiliationTargets.map((id) => makeUser(id, { allowIncoming: true })),
      ];

      const db = createMockDb({ entries, users });

      const pairs = await computeEligiblePairs(db, { cap: 5, cycleSeed: "test-seed" });

      // A should have 3 individual + 2 affiliation = 5 targets max
      // All 3 individual targets produce pairs (mutual)
      // Only 2 of 10 affiliation targets survive the cap
      expect(pairs.length).toBe(5);
    });

    it("always includes individual_select entries even when they exceed cap", async () => {
      // User A has 4 individual entries with cap=3. Individual selections
      // are "always included" per spec, so all 4 should survive.
      const targets = [USER_B, USER_C, USER_D, "10000000-0000-0000-0000-000000000005"];

      const entries = [
        ...targets.map((t) => ({
          userId: USER_A,
          targetUserId: t,
          source: "individual_select" as MatchPoolSource,
        })),
        ...targets.map((t) => ({
          userId: t,
          targetUserId: USER_A,
          source: "individual_select" as MatchPoolSource,
        })),
      ];

      const users = [
        makeUser(USER_A),
        ...targets.map((id) => makeUser(id)),
      ];

      const db = createMockDb({ entries, users });

      const pairs = await computeEligiblePairs(db, { cap: 3, cycleSeed: "test" });

      // All 4 individual selections survive despite cap=3
      expect(pairs).toHaveLength(4);
    });

    it("disableCap option bypasses cap enforcement", async () => {
      // With disableCap=true, all entries pass through regardless of count.
      const affiliationTargets = Array.from({ length: 5 }, (_, i) =>
        `10000000-0000-0000-0000-${String(i + 10).padStart(12, "0")}`
      );

      const entries = affiliationTargets.map((t) => ({
        userId: USER_A,
        targetUserId: t,
        source: "affiliation_select" as MatchPoolSource,
      }));

      const users = [
        makeUser(USER_A),
        ...affiliationTargets.map((id) => makeUser(id, { allowIncoming: true })),
      ];

      const db = createMockDb({ entries, users });

      // With cap=2, normally only 2 would survive
      const cappedPairs = await computeEligiblePairs(db, { cap: 2, cycleSeed: "test" });
      expect(cappedPairs.length).toBe(2);

      // With disableCap, all 5 survive
      const uncappedPairs = await computeEligiblePairs(db, { disableCap: true });
      expect(uncappedPairs.length).toBe(5);
    });

    it("deterministic sampling with same seed produces same results", async () => {
      // Verifies that the seeded random sampling is deterministic:
      // same seed always produces the same subset of entries.
      const affiliationTargets = Array.from({ length: 20 }, (_, i) =>
        `10000000-0000-0000-0000-${String(i + 10).padStart(12, "0")}`
      );

      const entries = affiliationTargets.map((t) => ({
        userId: USER_A,
        targetUserId: t,
        source: "all_users" as MatchPoolSource,
      }));

      const users = [
        makeUser(USER_A),
        ...affiliationTargets.map((id) => makeUser(id, { allowIncoming: true })),
      ];

      const db1 = createMockDb({ entries, users });
      const db2 = createMockDb({ entries, users });

      const pairs1 = await computeEligiblePairs(db1, { cap: 5, cycleSeed: "week-42" });
      const pairs2 = await computeEligiblePairs(db2, { cap: 5, cycleSeed: "week-42" });

      expect(pairs1).toHaveLength(5);
      const ids1 = pairs1.map((p) => p.researcherBId).sort();
      const ids2 = pairs2.map((p) => p.researcherBId).sort();
      expect(ids1).toEqual(ids2);
    });

    it("different seeds produce different samples (rotation)", async () => {
      // Verifies that different cycle seeds produce different entry subsets,
      // implementing the "rotation across cycles" requirement from the spec.
      const affiliationTargets = Array.from({ length: 50 }, (_, i) =>
        `10000000-0000-0000-0000-${String(i + 10).padStart(12, "0")}`
      );

      const entries = affiliationTargets.map((t) => ({
        userId: USER_A,
        targetUserId: t,
        source: "affiliation_select" as MatchPoolSource,
      }));

      const users = [
        makeUser(USER_A),
        ...affiliationTargets.map((id) => makeUser(id, { allowIncoming: true })),
      ];

      const db1 = createMockDb({ entries, users });
      const db2 = createMockDb({ entries, users });

      const pairs1 = await computeEligiblePairs(db1, { cap: 10, cycleSeed: "2026-W01" });
      const pairs2 = await computeEligiblePairs(db2, { cap: 10, cycleSeed: "2026-W02" });

      const ids1 = new Set(pairs1.map((p) => p.researcherBId));
      const ids2 = new Set(pairs2.map((p) => p.researcherBId));

      // With 50 items sampled down to 10, different seeds should yield
      // different subsets (statistically near-certain)
      const overlap = [...ids1].filter((id) => ids2.has(id)).length;
      expect(overlap).toBeLessThan(10); // Not all the same
    });

    it("caps each user independently", async () => {
      // Two users (A and B) each have their own entries. A's cap should not
      // affect B's entries. Tests per-user independence of cap logic.
      const aTargets = Array.from({ length: 5 }, (_, i) =>
        `10000000-0000-0000-0000-${String(i + 10).padStart(12, "0")}`
      );
      const bTargets = Array.from({ length: 5 }, (_, i) =>
        `20000000-0000-0000-0000-${String(i + 10).padStart(12, "0")}`
      );

      const entries = [
        ...aTargets.map((t) => ({
          userId: USER_A,
          targetUserId: t,
          source: "affiliation_select" as MatchPoolSource,
        })),
        ...bTargets.map((t) => ({
          userId: USER_B,
          targetUserId: t,
          source: "affiliation_select" as MatchPoolSource,
        })),
      ];

      const users = [
        makeUser(USER_A),
        makeUser(USER_B),
        ...aTargets.map((id) => makeUser(id, { allowIncoming: true })),
        ...bTargets.map((id) => makeUser(id, { allowIncoming: true })),
      ];

      const db = createMockDb({ entries, users });

      // Cap at 3 per user: A gets 3, B gets 3 = 6 total pairs
      const pairs = await computeEligiblePairs(db, { cap: 3, cycleSeed: "test" });
      expect(pairs).toHaveLength(6);
    });
  });
});

// --- Unit tests for cap helper functions ---

describe("capEntriesForUser", () => {
  // Helper to create pool entries for a given user
  function makeEntry(
    targetId: string,
    source: MatchPoolSource = "individual_select",
  ): PoolEntry {
    return { userId: USER_A, targetUserId: targetId, source };
  }

  it("returns all entries when under cap", () => {
    // 3 entries with cap=200 — all should pass through unchanged.
    const entries = [
      makeEntry(USER_B),
      makeEntry(USER_C, "affiliation_select"),
      makeEntry(USER_D, "all_users"),
    ];
    const result = capEntriesForUser(entries, 200, USER_A);
    expect(result).toHaveLength(3);
  });

  it("keeps all individual entries and samples bulk when over cap", () => {
    // 3 individual + 10 affiliation with cap=5 → 3 individual + 2 sampled.
    const entries = [
      makeEntry("ind-1"),
      makeEntry("ind-2"),
      makeEntry("ind-3"),
      ...Array.from({ length: 10 }, (_, i) =>
        makeEntry(`aff-${i}`, "affiliation_select"),
      ),
    ];

    const result = capEntriesForUser(entries, 5, USER_A, "test-seed");

    // All 3 individual entries are present
    const individualResults = result.filter((e) => e.source === "individual_select");
    expect(individualResults).toHaveLength(3);

    // Exactly 2 affiliation entries sampled (5 - 3 = 2)
    const bulkResults = result.filter((e) => e.source === "affiliation_select");
    expect(bulkResults).toHaveLength(2);

    expect(result).toHaveLength(5);
  });

  it("returns all individual entries when they alone exceed cap", () => {
    // 5 individual entries with cap=3 — all 5 should be included per spec
    // ("individually selected users always included").
    const entries = Array.from({ length: 5 }, (_, i) => makeEntry(`ind-${i}`));

    const result = capEntriesForUser(entries, 3, USER_A);

    expect(result).toHaveLength(5);
    expect(result.every((e) => e.source === "individual_select")).toBe(true);
  });

  it("excludes all bulk entries when individual fills cap", () => {
    // 5 individual + 3 affiliation with cap=5 → no room for affiliation.
    const entries = [
      ...Array.from({ length: 5 }, (_, i) => makeEntry(`ind-${i}`)),
      ...Array.from({ length: 3 }, (_, i) =>
        makeEntry(`aff-${i}`, "affiliation_select"),
      ),
    ];

    const result = capEntriesForUser(entries, 5, USER_A, "test");

    expect(result).toHaveLength(5);
    expect(result.every((e) => e.source === "individual_select")).toBe(true);
  });

  it("mixes affiliation_select and all_users in bulk tier", () => {
    // Both affiliation_select and all_users sources are treated as "bulk"
    // and sampled together when over cap.
    const entries = [
      makeEntry("ind-1"),
      ...Array.from({ length: 5 }, (_, i) =>
        makeEntry(`aff-${i}`, "affiliation_select"),
      ),
      ...Array.from({ length: 5 }, (_, i) =>
        makeEntry(`all-${i}`, "all_users"),
      ),
    ];

    const result = capEntriesForUser(entries, 4, USER_A, "test");

    expect(result).toHaveLength(4);
    const individualResults = result.filter((e) => e.source === "individual_select");
    expect(individualResults).toHaveLength(1);
    // 3 bulk entries sampled from the combined 10
    const bulkResults = result.filter((e) => e.source !== "individual_select");
    expect(bulkResults).toHaveLength(3);
  });
});

describe("seededSample", () => {
  const items = ["a", "b", "c", "d", "e", "f", "g", "h", "i", "j"];

  it("returns all items when count >= items.length", () => {
    // Requesting more items than available should return all items.
    const result = seededSample(items, 15, "seed");
    expect(result).toHaveLength(10);
    expect(new Set(result)).toEqual(new Set(items));
  });

  it("returns empty array when count <= 0", () => {
    expect(seededSample(items, 0, "seed")).toHaveLength(0);
    expect(seededSample(items, -1, "seed")).toHaveLength(0);
  });

  it("returns exactly count items", () => {
    const result = seededSample(items, 5, "seed");
    expect(result).toHaveLength(5);
    // All items should be from the original set
    expect(result.every((item) => items.includes(item))).toBe(true);
    // No duplicates
    expect(new Set(result).size).toBe(5);
  });

  it("is deterministic with the same seed", () => {
    // Same seed must always produce the same selection.
    const result1 = seededSample(items, 5, "my-seed");
    const result2 = seededSample(items, 5, "my-seed");
    expect(result1).toEqual(result2);
  });

  it("produces different results with different seeds", () => {
    // Different seeds should (with high probability) select different subsets.
    const result1 = seededSample(items, 5, "seed-alpha");
    const result2 = seededSample(items, 5, "seed-beta");
    // Not guaranteed to differ, but with 10 items choosing 5,
    // probability of identical selection is very low
    expect(result1).not.toEqual(result2);
  });

  it("does not mutate the original array", () => {
    const original = [...items];
    seededSample(items, 5, "seed");
    expect(items).toEqual(original);
  });
});

describe("MATCH_POOL_CAP", () => {
  it("is set to 200 per spec", () => {
    // Spec (auth-and-user-management.md): "Effective match pool is capped
    // at 200 users per matching cycle."
    expect(MATCH_POOL_CAP).toBe(200);
  });
});
