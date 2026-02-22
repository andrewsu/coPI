/**
 * Eligible pair computation for the matching engine.
 *
 * Determines which researcher pairs should have collaboration proposals
 * generated. Uses match pool entries and the allow_incoming_proposals setting
 * to decide eligibility and assign per-side visibility states.
 *
 * See specs/matching-engine.md "Eligible Pair Computation" for the full rules.
 */

import type { PrismaClient, ProposalVisibility } from "@prisma/client";
import { orderUserIds } from "@/lib/utils";

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

/** Options for eligible pair computation. */
export interface EligiblePairOptions {
  /**
   * If provided, only compute pairs involving this user.
   * Used when a specific user's match pool changes or profile updates.
   */
  forUserId?: string;
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
  const { forUserId } = options;

  // Step 1: Fetch all match pool entries (scoped if forUserId given).
  // Each entry represents a directed selection: userId selected targetUserId.
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
    },
  });

  if (entries.length === 0) {
    return [];
  }

  // Step 2: Build a set of directed edges for O(1) lookup.
  // Key: "userId->targetUserId"
  const directedEdges = new Set<string>();
  const involvedUserIds = new Set<string>();

  for (const entry of entries) {
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

  for (const entry of entries) {
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
  userId: string,
  targetUserId: string,
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
