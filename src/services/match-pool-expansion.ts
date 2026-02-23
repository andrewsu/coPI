/**
 * Match pool auto-expansion service — adds a new user to existing
 * affiliation/all-users selections from other users.
 *
 * When a new user joins the platform, this service checks all
 * AffiliationSelection records from other users:
 *   - selectAll=true → creates MatchPoolEntry with source=all_users
 *   - institution match (case-insensitive, optionally + department)
 *     → creates MatchPoolEntry with source=affiliation_select
 *
 * After creating entries, downstream matching triggers can be fired
 * to generate proposals for the newly created pairs.
 *
 * Spec reference: auth-and-user-management.md, Match Pool Management section.
 */

import type { PrismaClient } from "@prisma/client";

/** Result of expanding match pools for a new user. */
export interface MatchPoolExpansionResult {
  /** The new user's ID. */
  userId: string;
  /** Number of MatchPoolEntry rows created. */
  entriesCreated: number;
  /** IDs of users whose match pools were expanded (for matching triggers). */
  affectedUserIds: string[];
}

/**
 * Expands existing users' match pools to include a newly joined user.
 *
 * For each AffiliationSelection from other users:
 *   - selectAll=true → entry created with source=all_users
 *   - institution match → entry created with source=affiliation_select
 *
 * Uses createMany with skipDuplicates to handle users who may have
 * already individually selected this user before they joined.
 *
 * @param prisma - Injected PrismaClient for testability.
 * @param newUserId - The ID of the newly joined user.
 * @returns Expansion result with counts and affected user IDs.
 */
export async function expandMatchPoolsForNewUser(
  prisma: PrismaClient,
  newUserId: string,
): Promise<MatchPoolExpansionResult> {
  // Fetch the new user's institution and department for affiliation matching.
  const newUser = await prisma.user.findUnique({
    where: { id: newUserId },
    select: { id: true, institution: true, department: true },
  });

  if (!newUser) {
    console.warn(
      `[MatchPoolExpansion] User ${newUserId} not found. Skipping expansion.`,
    );
    return { userId: newUserId, entriesCreated: 0, affectedUserIds: [] };
  }

  // Find all AffiliationSelection records from OTHER users.
  const allSelections = await prisma.affiliationSelection.findMany({
    where: {
      userId: { not: newUserId },
    },
    select: {
      id: true,
      userId: true,
      institution: true,
      department: true,
      selectAll: true,
    },
  });

  if (allSelections.length === 0) {
    return { userId: newUserId, entriesCreated: 0, affectedUserIds: [] };
  }

  // Determine which selections match the new user.
  const matchingEntries: {
    userId: string;
    targetUserId: string;
    source: "affiliation_select" | "all_users";
  }[] = [];

  // Track unique user IDs to avoid duplicate entries per user
  // (a user might have multiple overlapping affiliation selections).
  const userEntryMap = new Map<string, "affiliation_select" | "all_users">();

  for (const selection of allSelections) {
    if (selection.selectAll) {
      // "All users" selection — always matches any new user.
      // all_users takes precedence if user also has affiliation_select.
      userEntryMap.set(selection.userId, "all_users");
    } else if (selection.institution) {
      // Affiliation-based selection — check institution match (case-insensitive).
      const institutionMatch =
        newUser.institution.toLowerCase() ===
        selection.institution.toLowerCase();

      if (!institutionMatch) continue;

      // If selection specifies a department, also check department match.
      if (selection.department) {
        const departmentMatch =
          newUser.department != null &&
          newUser.department.toLowerCase() ===
            selection.department.toLowerCase();
        if (!departmentMatch) continue;
      }

      // Only set if not already set to all_users (which has higher precedence
      // for source labeling when a user has both types of selections).
      if (!userEntryMap.has(selection.userId)) {
        userEntryMap.set(selection.userId, "affiliation_select");
      }
    }
  }

  // Build entries from the deduplicated map.
  for (const [userId, source] of userEntryMap) {
    matchingEntries.push({
      userId,
      targetUserId: newUserId,
      source,
    });
  }

  if (matchingEntries.length === 0) {
    return { userId: newUserId, entriesCreated: 0, affectedUserIds: [] };
  }

  // Create MatchPoolEntry rows. skipDuplicates handles the case where
  // a user already individually selected the new user before they joined.
  const result = await prisma.matchPoolEntry.createMany({
    data: matchingEntries,
    skipDuplicates: true,
  });

  const affectedUserIds = matchingEntries.map((e) => e.userId);

  console.log(
    `[MatchPoolExpansion] User ${newUserId}: ${result.count} entries created ` +
      `across ${affectedUserIds.length} users' match pools.`,
  );

  return {
    userId: newUserId,
    entriesCreated: result.count,
    affectedUserIds,
  };
}
