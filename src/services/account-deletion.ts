/**
 * Account deletion service — handles the full account deletion flow with
 * proposal preservation logic.
 *
 * Per spec (data-model.md §Account Deletion):
 * - Deleted: profile, publications, user-submitted texts, swipe history,
 *   match pool entries, affiliation selections, survey responses
 * - Preserved: CollaborationProposals where the other party swiped "interested".
 *   Name and institution retained on the (soft-deleted) User record.
 *   Profile details and contact info removed.
 *
 * Uses soft-delete: the User record is kept (name + institution intact) but
 * email/orcid are anonymized, all personal data is deleted, and deletedAt is set.
 * This preserves FK integrity on CollaborationProposal records.
 */

import { PrismaClient } from "@prisma/client";
import { randomUUID } from "crypto";

export interface AccountDeletionResult {
  preservedProposalCount: number;
  deletedProposalCount: number;
}

/**
 * Delete a user's account with proposal preservation.
 *
 * Runs in a single database transaction. After this call:
 * - The User record still exists but is marked deleted (anonymized email/orcid,
 *   deletedAt set). Name and institution are preserved for display on
 *   retained proposals.
 * - All personal data (profile, publications, swipes, match pool entries,
 *   affiliation selections, survey responses, matching results) is deleted.
 * - Proposals where the other party swiped "interested" are preserved;
 *   the deleted user's visibility is set to "hidden".
 * - Proposals where the other party did NOT swipe interested are deleted
 *   (their swipes and matches cascade-delete).
 */
export async function deleteAccount(
  prisma: PrismaClient,
  userId: string,
): Promise<AccountDeletionResult> {
  return prisma.$transaction(async (tx) => {
    // Verify user exists and is not already deleted
    const user = await tx.user.findUnique({
      where: { id: userId },
      select: { id: true, deletedAt: true },
    });

    if (!user) {
      throw new Error("User not found");
    }
    if (user.deletedAt) {
      throw new Error("Account is already deleted");
    }

    // 1. Find all proposals where this user is involved, with swipe data
    const proposals = await tx.collaborationProposal.findMany({
      where: {
        OR: [{ researcherAId: userId }, { researcherBId: userId }],
      },
      select: {
        id: true,
        researcherAId: true,
        researcherBId: true,
        swipes: {
          select: {
            userId: true,
            direction: true,
          },
        },
      },
    });

    // 2. Partition into preserved (other party swiped interested) and deletable
    const preservedIds: string[] = [];
    const deletedIds: string[] = [];

    for (const proposal of proposals) {
      const otherUserId =
        proposal.researcherAId === userId
          ? proposal.researcherBId
          : proposal.researcherAId;

      const otherSwipe = proposal.swipes.find(
        (s) => s.userId === otherUserId,
      );

      if (otherSwipe?.direction === "interested") {
        preservedIds.push(proposal.id);
      } else {
        deletedIds.push(proposal.id);
      }
    }

    // 3. Delete ALL of this user's swipe records (spec: "swipe history" deleted)
    await tx.swipe.deleteMany({
      where: { userId },
    });

    // 4. Delete non-preserved proposals (cascades their swipes + matches)
    if (deletedIds.length > 0) {
      // Matches cascade-delete from proposal, but Prisma deleteMany doesn't
      // trigger cascades — use raw delete or delete matches first
      await tx.match.deleteMany({
        where: { proposalId: { in: deletedIds } },
      });
      // Delete remaining swipes from other users on these proposals
      await tx.swipe.deleteMany({
        where: { proposalId: { in: deletedIds } },
      });
      await tx.collaborationProposal.deleteMany({
        where: { id: { in: deletedIds } },
      });
    }

    // 5. For preserved proposals, set the deleted user's visibility to "hidden"
    if (preservedIds.length > 0) {
      const asAIds = proposals
        .filter(
          (p) =>
            p.researcherAId === userId && preservedIds.includes(p.id),
        )
        .map((p) => p.id);
      const asBIds = proposals
        .filter(
          (p) =>
            p.researcherBId === userId && preservedIds.includes(p.id),
        )
        .map((p) => p.id);

      if (asAIds.length > 0) {
        await tx.collaborationProposal.updateMany({
          where: { id: { in: asAIds } },
          data: { visibilityA: "hidden" },
        });
      }
      if (asBIds.length > 0) {
        await tx.collaborationProposal.updateMany({
          where: { id: { in: asBIds } },
          data: { visibilityB: "hidden" },
        });
      }
    }

    // 6. Delete ResearcherProfile (includes user-submitted texts)
    await tx.researcherProfile.deleteMany({
      where: { userId },
    });

    // 7. Delete Publications
    await tx.publication.deleteMany({
      where: { userId },
    });

    // 8. Delete MatchPoolEntries (both as selector and as target)
    await tx.matchPoolEntry.deleteMany({
      where: {
        OR: [{ userId }, { targetUserId: userId }],
      },
    });

    // 9. Delete AffiliationSelections
    await tx.affiliationSelection.deleteMany({
      where: { userId },
    });

    // 10. Delete SurveyResponses
    await tx.surveyResponse.deleteMany({
      where: { userId },
    });

    // 11. Delete MatchingResults (both as A and B)
    await tx.matchingResult.deleteMany({
      where: {
        OR: [{ researcherAId: userId }, { researcherBId: userId }],
      },
    });

    // 12. Anonymize user record — soft delete preserving name + institution
    const anonSuffix = randomUUID();
    await tx.user.update({
      where: { id: userId },
      data: {
        email: `deleted-${anonSuffix}@deleted.copi.science`,
        orcid: `deleted-${anonSuffix}`,
        department: null,
        allowIncomingProposals: false,
        emailNotificationsEnabled: false,
        notifyMatches: false,
        notifyNewProposals: false,
        notifyProfileRefresh: false,
        deletedAt: new Date(),
      },
    });

    return {
      preservedProposalCount: preservedIds.length,
      deletedProposalCount: deletedIds.length,
    };
  });
}
