/**
 * GET /api/proposals/archived — Fetch the user's archived proposals.
 *
 * Returns proposals the user has swiped "archive" on, sorted by most
 * recently archived first. Each proposal is transformed to the user's
 * perspective (one-line summary, collaborator mapping) same as the
 * swipe queue.
 *
 * Spec reference: specs/swipe-interface.md, "Archive Tab" section.
 */

import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getUserSide } from "@/lib/utils";

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const userId = session.user.id;

  // Fetch swipes where this user archived, including the full proposal data.
  // Sorted by most recently archived first per spec.
  const archivedSwipes = await prisma.swipe.findMany({
    where: {
      userId,
      direction: "archive",
    },
    include: {
      proposal: {
        include: {
          researcherA: {
            select: {
              id: true,
              name: true,
              institution: true,
              department: true,
            },
          },
          researcherB: {
            select: {
              id: true,
              name: true,
              institution: true,
              department: true,
            },
          },
        },
      },
    },
    orderBy: { createdAt: "desc" },
  });

  // Transform to user-perspective view, same shape as swipe queue.
  const proposals = archivedSwipes.map((swipe) => {
    const p = swipe.proposal;
    const side = getUserSide(userId, p);
    const collaborator = side === "a" ? p.researcherB : p.researcherA;

    return {
      id: p.id,
      title: p.title,
      collaborationType: p.collaborationType,
      oneLineSummary: side === "a" ? p.oneLineSummaryA : p.oneLineSummaryB,
      confidenceTier: p.confidenceTier,
      isUpdated: p.isUpdated,
      createdAt: p.createdAt,
      archivedAt: swipe.createdAt,
      collaborator: {
        id: collaborator.id,
        name: collaborator.name,
        institution: collaborator.institution,
        department: collaborator.department,
      },
    };
  });

  return NextResponse.json({
    proposals,
    totalCount: proposals.length,
  });
}
