/**
 * DELETE /api/match-pool/[entryId] — Remove a single match pool entry.
 *
 * Validates that the entry belongs to the authenticated user before deleting.
 * Returns 204 on success, 404 if entry not found or doesn't belong to user.
 *
 * Spec reference: auth-and-user-management.md, Match Pool Management section.
 * "Removing someone hides pending proposals (not deleted) from the UI."
 * Proposal hiding is handled by the matching engine — this route only
 * removes the MatchPoolEntry record.
 */

import { getServerSession } from "next-auth";
import { NextRequest, NextResponse } from "next/server";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ entryId: string }> },
) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { entryId } = await params;

  // Find the entry and verify ownership
  const entry = await prisma.matchPoolEntry.findUnique({
    where: { id: entryId },
    select: { id: true, userId: true },
  });

  if (!entry || entry.userId !== session.user.id) {
    return NextResponse.json(
      { error: "Match pool entry not found" },
      { status: 404 },
    );
  }

  await prisma.matchPoolEntry.delete({
    where: { id: entryId },
  });

  return new NextResponse(null, { status: 204 });
}
