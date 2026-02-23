/**
 * Eligible pair computation for the matching engine.
 *
 * Determines which researcher pairs should have collaboration proposals
 * generated. Uses match pool entries and the allow_incoming_proposals setting
 * to decide eligibility and assign per-side visibility states.
 *
 * Enforces the per-user match pool cap (default 200) with priority ordering:
 * 1. Individually selected users (always included)
 * 2. Affiliation/all-users selections (randomly sampled with weekly rotation)
 *
 * See specs/matching-engine.md "Eligible Pair Computation" and
 * specs/auth-and-user-management.md "Match Pool Cap" for the full rules.
 */

import type { PrismaClient, MatchPoolSource, ProposalVisibility } from "@prisma/client";
import { orderUserIds } from "@/lib/utils";

// --- Public constants ---

/** Maximum number of users evaluated per matching cycle per user. */
export const MATCH_POOL_CAP = 200;

// --- Public types ---

/** An eligible pair with ordered IDs and visibility assignments. */
export interface EligiblePair {
  /** Lower UUID by string sort (convention: researcher A). */
  researcherAId: string;
  /** Higher UUID by string sort (convention: researcher B). */
  researcherBId: string;
  /** Visibility for researcher A's view of proposals. */
  visibilityA: ProposalVisibility;
  /** Visibility for researcher B's view of proposals. */
  visibilityB: ProposalVisibility;
  /** Current profile version for researcher A. */
  profileVersionA: number;
  /** Current profile version for researcher B. */
  profileVersionB: number;
}

/** A match pool entry with source information for cap prioritization. */
export interface PoolEntry {
  userId: string;
  targetUserId: string;
  source: MatchPoolSource;
}

/** Options for eligible pair computation. */
export interface EligiblePairOptions {
  /**
   * If provided, only compute pairs involving this user.
   * Used when a specific user's match pool changes or profile updates.
   */
  forUserId?: string;
  /** Disable match pool cap enforcement. Default: false. */
  disableCap?: boolean;
  /** Override the cap value. Default: MATCH_POOL_CAP (200). */
  cap?: number;
  /** Override the rotation seed for deterministic testing. */
  cycleSeed?: string;
}

// --- Service ---

/**
 * Computes all eligible researcher pairs for matching engine evaluation.
 *
 * A pair (A, B) is eligible if ANY of:
 *   1. A has B in match pool AND B has A (mutual selection)
 *   2. A has B in match pool AND B.allow_incoming_proposals = true
 *   3. B has A in match pool AND A.allow_incoming_proposals = true
 *
 * Pairs are skipped if a MatchingResult already exists for the same
 * profile versions (meaning they were already evaluated with identical
 * profile data).
 *
 * Both researchers must have a ResearcherProfile to be eligible.
 *
 * @param prisma - Prisma client instance (injected for testability).
 * @param options - Optional filters for scoping the computation.
 * @returns Array of eligible pairs with visibility assignments.
 */
export async function computeEligiblePairs(
  prisma: PrismaClient,
  options: EligiblePairOptions = {},
): Promise<EligiblePair[]> {
  const { forUserId, disableCap = false, cap = MATCH_POOL_CAP, cycleSeed } = options;

  // Step 1: Fetch all match pool entries with source (scoped if forUserId given).
  // Each entry represents a directed selection: userId selected targetUserId.
  // Source is needed for cap priority ordering.
  const whereClause = forUserId
    ? {
        OR: [{ userId: forUserId }, { targetUserId: forUserId }],
      }
    : {};

  const entries = await prisma.matchPoolEntry.findMany({
    where: whereClause,
    select: {
      userId: true,
      targetUserId: true,
      source: true,
    },
  });

  if (entries.length === 0) {
    return [];
  }

  // Step 1.5: Apply per-user match pool cap.
  // Filters each user's entries to at most `cap` targets, prioritizing
  // individual_select entries over affiliation_select/all_users entries.
  const cappedEntries = disableCap
    ? entries
    : capAllEntries(entries, cap, cycleSeed);

  // Step 2: Build a set of directed edges for O(1) lookup.
  // Key: "userId->targetUserId"
  const directedEdges = new Set<string>();
  const involvedUserIds = new Set<string>();

  for (const entry of cappedEntries) {
    directedEdges.add(`${entry.userId}->${entry.targetUserId}`);
    involvedUserIds.add(entry.userId);
    involvedUserIds.add(entry.targetUserId);
  }

  // Step 3: Fetch allow_incoming_proposals and profile versions for all
  // involved users in one query. Only users with profiles can be matched.
  const users = await prisma.user.findMany({
    where: {
      id: { in: Array.from(involvedUserIds) },
      profile: { isNot: null },
    },
    select: {
      id: true,
      allowIncomingProposals: true,
      profile: {
        select: {
          profileVersion: true,
        },
      },
    },
  });

  // Build lookup maps — defensively skip users with null profiles even though
  // the query filters for them (guards against mock/edge case mismatch).
  const userMap = new Map<
    string,
    { allowIncoming: boolean; profileVersion: number }
  >();
  for (const u of users) {
    if (!u.profile) continue;
    userMap.set(u.id, {
      allowIncoming: u.allowIncomingProposals,
      profileVersion: u.profile.profileVersion,
    });
  }

  // Step 4: Enumerate unique pairs and determine eligibility + visibility.
  // We process each directed edge and track pairs we've already considered
  // to avoid duplicates.
  const candidatePairs = new Map<string, EligiblePair>();

  for (const entry of cappedEntries) {
    const { userId, targetUserId } = entry;

    // Both users must have profiles
    const userA = userMap.get(userId);
    const userB = userMap.get(targetUserId);
    if (!userA || !userB) continue;

    // Order the IDs consistently (A < B by UUID sort)
    const ordered = orderUserIds(userId, targetUserId);
    const pairKey = `${ordered.researcherAId}:${ordered.researcherBId}`;

    // Skip if already processed
    if (candidatePairs.has(pairKey)) continue;

    // Check directed selections
    const aSelectedB = directedEdges.has(`${userId}->${targetUserId}`);
    const bSelectedA = directedEdges.has(`${targetUserId}->${userId}`);

    // Determine eligibility and visibility
    const result = computeVisibility(
      userId,
      targetUserId,
      aSelectedB,
      bSelectedA,
      userMap.get(userId)!.allowIncoming,
      userMap.get(targetUserId)!.allowIncoming,
    );

    if (!result) continue;

    // Map visibility to ordered pair convention (A < B)
    const isUserIdA = ordered.researcherAId === userId;
    const visibilityA = isUserIdA ? result.selectorVisibility : result.targetVisibility;
    const visibilityB = isUserIdA ? result.targetVisibility : result.selectorVisibility;
    const profileVersionA = isUserIdA ? userA.profileVersion : userB.profileVersion;
    const profileVersionB = isUserIdA ? userB.profileVersion : userA.profileVersion;

    candidatePairs.set(pairKey, {
      researcherAId: ordered.researcherAId,
      researcherBId: ordered.researcherBId,
      visibilityA,
      visibilityB,
      profileVersionA,
      profileVersionB,
    });
  }

  if (candidatePairs.size === 0) {
    return [];
  }

  // Step 5: Filter out pairs already evaluated at current profile versions.
  const pairs = Array.from(candidatePairs.values());
  const filteredPairs = await filterAlreadyEvaluated(prisma, pairs);

  return filteredPairs;
}

// --- Internal helpers ---

/** Result of visibility computation for a single directed edge. */
interface VisibilityResult {
  /** Visibility for the userId (the "selector" in the entry). */
  selectorVisibility: ProposalVisibility;
  /** Visibility for the targetUserId. */
  targetVisibility: ProposalVisibility;
}

/**
 * Determines eligibility and visibility for a pair based on directed
 * selections and allow_incoming_proposals settings.
 *
 * Returns null if the pair is not eligible.
 *
 * Per specs/matching-engine.md:
 * - Mutual selection → both visible
 * - One-sided with incoming allowed → selector visible, other pending_other_interest
 * - Neither → not eligible
 */
function computeVisibility(
  _userId: string,
  _targetUserId: string,
  userSelectedTarget: boolean,
  targetSelectedUser: boolean,
  userAllowIncoming: boolean,
  targetAllowIncoming: boolean,
): VisibilityResult | null {
  const isMutual = userSelectedTarget && targetSelectedUser;

  if (isMutual) {
    return {
      selectorVisibility: "visible",
      targetVisibility: "visible",
    };
  }

  // One-sided: userId selected targetUserId, target allows incoming
  if (userSelectedTarget && targetAllowIncoming) {
    return {
      selectorVisibility: "visible",
      targetVisibility: "pending_other_interest",
    };
  }

  // One-sided: targetUserId selected userId, user allows incoming
  if (targetSelectedUser && userAllowIncoming) {
    return {
      selectorVisibility: "pending_other_interest",
      targetVisibility: "visible",
    };
  }

  // Not eligible
  return null;
}

/**
 * Filters out pairs that have already been evaluated at the same profile
 * versions. A pair is "already evaluated" if a MatchingResult exists where
 * both profile versions match the current versions.
 *
 * Per spec: "The engine does NOT re-run for pairs that already have active
 * proposals unless a profile has been regenerated since the last proposal
 * was created (detected via profile_version comparison against MatchingResult
 * records)."
 */
async function filterAlreadyEvaluated(
  prisma: PrismaClient,
  pairs: EligiblePair[],
): Promise<EligiblePair[]> {
  if (pairs.length === 0) return [];

  // Fetch all matching results for the candidate pairs in one query.
  // We use OR conditions for each pair's ordered IDs.
  const pairConditions = pairs.map((p) => ({
    researcherAId: p.researcherAId,
    researcherBId: p.researcherBId,
  }));

  const existingResults = await prisma.matchingResult.findMany({
    where: {
      OR: pairConditions,
    },
    select: {
      researcherAId: true,
      researcherBId: true,
      profileVersionA: true,
      profileVersionB: true,
    },
  });

  // Build a set of already-evaluated pair+version combos for O(1) lookup.
  // Key: "aId:bId:versionA:versionB"
  const evaluatedSet = new Set<string>();
  for (const result of existingResults) {
    evaluatedSet.add(
      `${result.researcherAId}:${result.researcherBId}:${result.profileVersionA}:${result.profileVersionB}`,
    );
  }

  return pairs.filter((p) => {
    const key = `${p.researcherAId}:${p.researcherBId}:${p.profileVersionA}:${p.profileVersionB}`;
    return !evaluatedSet.has(key);
  });
}

// --- Match pool cap ---

/**
 * Applies per-user match pool cap to all entries in the system.
 *
 * For each user who has match pool entries, caps their outgoing entries at
 * `cap` targets using priority ordering:
 *   1. individual_select entries — always included
 *   2. affiliation_select / all_users entries — randomly sampled with
 *      rotation to fill remaining slots up to the cap
 *
 * Entries from other users targeting a given user (incoming) are NOT subject
 * to that user's cap — they are subject to the originating user's cap.
 */
function capAllEntries(
  entries: PoolEntry[],
  cap: number,
  cycleSeed?: string,
): PoolEntry[] {
  // Group entries by their owner (userId)
  const byUser = new Map<string, PoolEntry[]>();
  for (const entry of entries) {
    let list = byUser.get(entry.userId);
    if (!list) {
      list = [];
      byUser.set(entry.userId, list);
    }
    list.push(entry);
  }

  const result: PoolEntry[] = [];
  for (const [userId, userEntries] of byUser) {
    const capped = capEntriesForUser(userEntries, cap, userId, cycleSeed);
    result.push(...capped);
  }
  return result;
}

/**
 * Caps a single user's match pool entries at `cap` targets.
 *
 * Priority per spec (auth-and-user-management.md):
 *   1. individual_select entries — always included
 *   2. affiliation_select / all_users entries — randomly sampled with
 *      weekly rotation when over cap
 *
 * If individual_select entries alone exceed the cap, ALL individual entries
 * are still included (the cap only limits bulk affiliation entries).
 */
export function capEntriesForUser(
  entries: PoolEntry[],
  cap: number = MATCH_POOL_CAP,
  userId: string = "",
  cycleSeed?: string,
): PoolEntry[] {
  const individual: PoolEntry[] = [];
  const bulk: PoolEntry[] = [];

  for (const entry of entries) {
    if (entry.source === "individual_select") {
      individual.push(entry);
    } else {
      bulk.push(entry);
    }
  }

  // Individual selections always included
  if (individual.length >= cap) {
    // No room for bulk entries — return all individual entries
    return individual;
  }

  const remainingSlots = cap - individual.length;
  if (bulk.length <= remainingSlots) {
    // Everything fits — no sampling needed
    return entries;
  }

  // Sample from bulk entries to fill remaining slots
  const seed = cycleSeed ?? getWeekSeed();
  const sampled = seededSample(bulk, remainingSlots, `${userId}:${seed}`);
  return [...individual, ...sampled];
}

/**
 * Returns a weekly cycle seed string (YYYY-WNN) for rotation.
 * Different weeks produce different seeds so tier-3 sampling rotates.
 */
export function getWeekSeed(): string {
  const now = new Date();
  const year = now.getFullYear();
  const jan1 = new Date(year, 0, 1);
  const dayOfYear = Math.floor(
    (now.getTime() - jan1.getTime()) / 86400000,
  );
  const week = Math.ceil((dayOfYear + jan1.getDay() + 1) / 7);
  return `${year}-W${String(week).padStart(2, "0")}`;
}

/**
 * Deterministic seeded sample using Fisher-Yates partial shuffle.
 * Given the same seed, always returns the same subset.
 * Used for weekly rotation of affiliation/all-users pool entries.
 */
export function seededSample<T>(
  items: T[],
  count: number,
  seed: string,
): T[] {
  if (count >= items.length) return [...items];
  if (count <= 0) return [];

  const arr = [...items];
  let hash = hashString(seed);

  for (let i = 0; i < count; i++) {
    hash = xorshift32(hash);
    const j = i + (Math.abs(hash) % (arr.length - i));
    const temp = arr[i]!;
    arr[i] = arr[j]!;
    arr[j] = temp;
  }

  return arr.slice(0, count);
}

/** djb2 string hash. */
function hashString(str: string): number {
  let hash = 5381;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) + hash + str.charCodeAt(i)) | 0;
  }
  return hash;
}

/** xorshift32 PRNG step. */
function xorshift32(x: number): number {
  x ^= x << 13;
  x ^= x >> 17;
  x ^= x << 5;
  return x;
}
