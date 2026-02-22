/**
 * POST /api/proposals/[id]/unarchive — Move an archived proposal back to "Interested".
 *
 * Updates the user's existing archive swipe to "interested" and runs the
 * same match-check and visibility-flip logic as an initial interested swipe:
 *   - If the other party already swiped interested → creates Match
 *   - If the other user's visibility is pending_other_interest → flips to visible
 *
 * Returns: { swipe, matched, matchId? }
 *
 * Spec reference: specs/swipe-interface.md, "Archive Tab" section:
 *   "User can move a proposal from archive back to 'Interested' — This triggers
 *    the same match-check logic as an initial interested swipe."
 */

import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getUserSide } from "@/lib/utils";

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id: proposalId } = await params;
  const userId = session.user.id;

  // Fetch the proposal with existing swipes
  const proposal = await prisma.collaborationProposal.findUnique({
    where: { id: proposalId },
    include: {
      swipes: {
        select: { id: true, userId: true, direction: true },
      },
    },
  });

  if (!proposal) {
    return NextResponse.json(
      { error: "Proposal not found" },
      { status: 404 }
    );
  }

  // Authorization: user must be researcher A or B
  if (
    proposal.researcherAId !== userId &&
    proposal.researcherBId !== userId
  ) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  // User must have an existing archive swipe on this proposal
  const existingSwipe = proposal.swipes.find((s) => s.userId === userId);
  if (!existingSwipe || existingSwipe.direction !== "archive") {
    return NextResponse.json(
      { error: "No archived swipe found for this proposal" },
      { status: 400 }
    );
  }

  const side = getUserSide(userId, proposal);
  const otherUserId =
    side === "a" ? proposal.researcherBId : proposal.researcherAId;

  // Update the swipe direction from archive to interested
  const updatedSwipe = await prisma.swipe.update({
    where: { id: existingSwipe.id },
    data: { direction: "interested" },
  });

  let matched = false;
  let matchId: string | undefined;

  // Match-check: has the other party already swiped interested?
  const otherSwipe = proposal.swipes.find(
    (s) => s.userId === otherUserId && s.direction === "interested"
  );

  if (otherSwipe) {
    // Both users interested → create Match
    const match = await prisma.match.create({
      data: { proposalId },
    });
    matched = true;
    matchId = match.id;
  }

  // Visibility flip: if other user's visibility is pending_other_interest → visible
  const otherVisibilityField =
    side === "a" ? "visibilityB" : "visibilityA";
  const currentOtherVisibility =
    side === "a" ? proposal.visibilityB : proposal.visibilityA;

  if (currentOtherVisibility === "pending_other_interest") {
    await prisma.collaborationProposal.update({
      where: { id: proposalId },
      data: { [otherVisibilityField]: "visible" },
    });
  }

  return NextResponse.json({
    swipe: {
      id: updatedSwipe.id,
      direction: updatedSwipe.direction,
      viewedDetail: updatedSwipe.viewedDetail,
      timeSpentMs: updatedSwipe.timeSpentMs,
    },
    matched,
    matchId,
  });
}
