/**
 * DELETE /api/match-pool/affiliation/[affiliationId] — Remove an affiliation selection.
 *
 * Deletes the AffiliationSelection record and all MatchPoolEntry rows that were
 * auto-created from it (source=affiliation_select or source=all_users, depending
 * on the selection type). Only entries NOT individually selected are removed.
 *
 * Spec reference: auth-and-user-management.md, Removing from Match Pool:
 * "Remove affiliation selections (removes all auto-added entries from that selection)"
 *
 * Returns 204 on success, 404 if selection not found or doesn't belong to user.
 */

import { getServerSession } from "next-auth";
import { NextRequest, NextResponse } from "next/server";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ affiliationId: string }> },
) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { affiliationId } = await params;

  // Find the affiliation selection and verify ownership
  const selection = await prisma.affiliationSelection.findUnique({
    where: { id: affiliationId },
    select: { id: true, userId: true, selectAll: true, institution: true, department: true },
  });

  if (!selection || selection.userId !== session.user.id) {
    return NextResponse.json(
      { error: "Affiliation selection not found" },
      { status: 404 },
    );
  }

  // Determine which source type to delete entries for
  const source = selection.selectAll ? "all_users" : "affiliation_select";

  // Delete all MatchPoolEntry rows with the matching source for this user.
  // For affiliation_select entries, we delete entries whose target users match
  // the affiliation criteria. For all_users, we delete all entries with that source.
  //
  // Note: We delete ALL entries with the given source for this user, because
  // the entries were created by this affiliation selection. If the user has
  // multiple affiliation selections, entries from other selections are preserved
  // because they have different target users (or if overlapping, they'll be
  // re-evaluated when the other selection is applied).
  await prisma.matchPoolEntry.deleteMany({
    where: {
      userId: session.user.id,
      source,
    },
  });

  // Delete the AffiliationSelection record itself
  await prisma.affiliationSelection.delete({
    where: { id: affiliationId },
  });

  // If there are remaining affiliation selections of the same type, re-create
  // entries for them. This handles the edge case where two affiliation selections
  // overlap — deleting one shouldn't remove entries that the other would provide.
  const remainingSelections = await prisma.affiliationSelection.findMany({
    where: {
      userId: session.user.id,
      selectAll: selection.selectAll,
      ...(selection.selectAll ? {} : { selectAll: false }),
    },
  });

  for (const remaining of remainingSelections) {
    const whereClause: Record<string, unknown> = {
      id: { not: session.user.id },
    };

    if (!remaining.selectAll) {
      whereClause.institution = {
        equals: remaining.institution,
        mode: "insensitive",
      };
      if (remaining.department) {
        whereClause.department = {
          equals: remaining.department,
          mode: "insensitive",
        };
      }
    }

    const matchingUsers = await prisma.user.findMany({
      where: whereClause,
      select: { id: true },
    });

    if (matchingUsers.length > 0) {
      await prisma.matchPoolEntry.createMany({
        data: matchingUsers.map((u) => ({
          userId: session.user.id,
          targetUserId: u.id,
          source: remaining.selectAll ? "all_users" as const : "affiliation_select" as const,
        })),
        skipDuplicates: true,
      });
    }
  }

  return new NextResponse(null, { status: 204 });
}
