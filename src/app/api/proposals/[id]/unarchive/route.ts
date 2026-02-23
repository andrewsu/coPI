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
import { sendMatchNotificationEmails } from "@/services/match-notifications";
import { sendRecruitmentEmailIfUnclaimed } from "@/services/recruitment-email";
import type { InviteData } from "@/app/api/proposals/[id]/swipe/route";

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

    // Send match notification emails to both users (fire-and-forget).
    // Notification failures are logged but never block the unarchive response.
    sendMatchNotificationEmails(prisma, match.id, proposalId).catch(
      (err) => {
        console.error(
          `[Unarchive] Failed to send match notifications for match ${match.id}:`,
          err instanceof Error ? err.message : err,
        );
      },
    );
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

  // Send recruitment email to the other user if they are unclaimed (seeded).
  // Fire-and-forget: failures are logged but never block the unarchive response.
  sendRecruitmentEmailIfUnclaimed(prisma, otherUserId, proposalId).catch(
    (err) => {
      console.error(
        `[Unarchive] Failed to send recruitment email for user ${otherUserId}:`,
        err instanceof Error ? err.message : err,
      );
    },
  );

  // Per spec: when a user moves to interested on a proposal involving an unclaimed
  // researcher, show them a pre-filled invite email template they can copy/send.
  let invite: InviteData | undefined;
  const [otherUser, currentUser] = await Promise.all([
    prisma.user.findUnique({
      where: { id: otherUserId },
      select: { claimedAt: true, name: true },
    }),
    prisma.user.findUnique({
      where: { id: userId },
      select: { name: true },
    }),
  ]);

  if (otherUser && otherUser.claimedAt === null) {
    const oneLineSummary =
      side === "a" ? proposal.oneLineSummaryA : proposal.oneLineSummaryB;
    invite = {
      collaboratorName: otherUser.name,
      proposalTitle: proposal.title,
      oneLineSummary,
      inviterName: currentUser?.name ?? "A colleague",
      claimUrl: `${process.env.NEXTAUTH_URL ?? "http://localhost:3000"}/login`,
    };
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
    invite,
  });
}
