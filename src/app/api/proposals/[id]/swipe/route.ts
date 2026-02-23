/**
 * POST /api/proposals/[id]/swipe — Record a swipe action on a proposal.
 *
 * Creates a Swipe record (interested or archive) with analytics data.
 * For "interested" swipes:
 *   - Checks if the other party already swiped interested → creates Match
 *   - Flips other user's visibility from pending_other_interest → visible
 * For "archive" swipes:
 *   - No visibility changes (pending_other_interest stays, proposal is dead)
 *   - Checks if it's time to show the periodic survey (every Nth archive)
 *
 * Returns: { swipe, matched, matchId?, showSurvey? }
 *
 * Spec reference: specs/swipe-interface.md, "Swipe Actions" and
 * "What Happens After Each Action" sections.
 */

import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getUserSide } from "@/lib/utils";
import { sendMatchNotificationEmails } from "@/services/match-notifications";
import { sendRecruitmentEmailIfUnclaimed } from "@/services/recruitment-email";

/** Show the periodic survey after every Nth archive action per spec. */
export const SURVEY_INTERVAL = 5;

interface SwipeRequestBody {
  direction: "interested" | "archive";
  viewedDetail: boolean;
  timeSpentMs?: number;
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id: proposalId } = await params;
  const userId = session.user.id;

  // Parse and validate request body
  let body: SwipeRequestBody;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: "Invalid request body" },
      { status: 400 }
    );
  }

  if (!body.direction || !["interested", "archive"].includes(body.direction)) {
    return NextResponse.json(
      { error: "direction must be 'interested' or 'archive'" },
      { status: 400 }
    );
  }

  if (typeof body.viewedDetail !== "boolean") {
    return NextResponse.json(
      { error: "viewedDetail must be a boolean" },
      { status: 400 }
    );
  }

  if (
    body.timeSpentMs !== undefined &&
    (typeof body.timeSpentMs !== "number" || body.timeSpentMs < 0)
  ) {
    return NextResponse.json(
      { error: "timeSpentMs must be a non-negative number" },
      { status: 400 }
    );
  }

  // Fetch proposal with existing swipes
  const proposal = await prisma.collaborationProposal.findUnique({
    where: { id: proposalId },
    include: {
      swipes: {
        select: { userId: true, direction: true },
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

  // Check for duplicate swipe (unique constraint on userId + proposalId)
  const existingSwipe = proposal.swipes.find((s) => s.userId === userId);
  if (existingSwipe) {
    return NextResponse.json(
      { error: "Already swiped on this proposal" },
      { status: 409 }
    );
  }

  const side = getUserSide(userId, proposal);
  const otherUserId =
    side === "a" ? proposal.researcherBId : proposal.researcherAId;

  // Create the swipe record
  const swipe = await prisma.swipe.create({
    data: {
      userId,
      proposalId,
      direction: body.direction,
      viewedDetail: body.viewedDetail,
      timeSpentMs: body.timeSpentMs ?? null,
    },
  });

  let matched = false;
  let matchId: string | undefined;

  if (body.direction === "interested") {
    // Check if the other user already swiped interested → mutual match
    const otherSwipe = proposal.swipes.find(
      (s) => s.userId === otherUserId && s.direction === "interested"
    );

    if (otherSwipe) {
      // Both users swiped interested → create Match
      const match = await prisma.match.create({
        data: { proposalId },
      });
      matched = true;
      matchId = match.id;

      // Send match notification emails to both users (fire-and-forget).
      // Notification failures are logged but never block the swipe response.
      sendMatchNotificationEmails(prisma, match.id, proposalId).catch(
        (err) => {
          console.error(
            `[Swipe] Failed to send match notifications for match ${match.id}:`,
            err instanceof Error ? err.message : err,
          );
        },
      );
    }

    // Flip other user's visibility from pending_other_interest → visible
    // This makes the proposal appear in the other user's swipe queue
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
    // Fire-and-forget: failures are logged but never block the swipe response.
    sendRecruitmentEmailIfUnclaimed(prisma, otherUserId, proposalId).catch(
      (err) => {
        console.error(
          `[Swipe] Failed to send recruitment email for user ${otherUserId}:`,
          err instanceof Error ? err.message : err,
        );
      },
    );
  }

  // Archive direction: no visibility changes needed per spec.
  // pending_other_interest stays — proposal is effectively dead.

  // For archive swipes, check if we should show the periodic survey.
  // The survey appears after every Nth archive action (default 5).
  let showSurvey = false;
  if (body.direction === "archive") {
    const archiveCount = await prisma.swipe.count({
      where: { userId, direction: "archive" },
    });
    // archiveCount includes the swipe we just created
    showSurvey = archiveCount > 0 && archiveCount % SURVEY_INTERVAL === 0;
  }

  return NextResponse.json({
    swipe: {
      id: swipe.id,
      direction: swipe.direction,
      viewedDetail: swipe.viewedDetail,
      timeSpentMs: swipe.timeSpentMs,
    },
    matched,
    matchId,
    showSurvey,
  });
}
