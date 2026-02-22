/**
 * Given a user ID and a CollaborationProposal, returns which side
 * ("a" or "b") the user is on.
 *
 * Convention: researcher_a_id < researcher_b_id by UUID sort order.
 */
export function getUserSide(
  userId: string,
  proposal: { researcherAId: string; researcherBId: string }
): "a" | "b" {
  if (userId === proposal.researcherAId) return "a";
  if (userId === proposal.researcherBId) return "b";
  throw new Error(
    `User ${userId} is not part of proposal with researchers ${proposal.researcherAId} and ${proposal.researcherBId}`
  );
}

/**
 * Orders two user IDs so that a < b by UUID string sort.
 * Used when creating CollaborationProposals.
 */
export function orderUserIds(
  id1: string,
  id2: string
): { researcherAId: string; researcherBId: string } {
  if (id1 < id2) {
    return { researcherAId: id1, researcherBId: id2 };
  }
  return { researcherAId: id2, researcherBId: id1 };
}
