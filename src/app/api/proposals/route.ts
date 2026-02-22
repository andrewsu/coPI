/**
 * GET /api/proposals — Fetch the authenticated user's swipe queue.
 *
 * Returns collaboration proposals where the user's visibility is "visible"
 * and the user has not yet swiped. Ordered by confidence tier
 * (high → moderate → speculative), then most recent first.
 *
 * Each proposal is tailored to the user's perspective: the one-line summary,
 * contributions, and benefits are mapped to "yours" and "theirs" based on
 * which side (A or B) the user is. The collaborator's public info is included.
 *
 * Spec reference: specs/swipe-interface.md, Swipe Queue section.
 */

import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getUserSide } from "@/lib/utils";

/** Confidence tier sort priority: lower number = shown first. */
const CONFIDENCE_TIER_ORDER: Record<string, number> = {
  high: 0,
  moderate: 1,
  speculative: 2,
};

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const userId = session.user.id;

  // Fetch proposals where user has "visible" visibility and hasn't swiped yet.
  // Prisma enum ordering for ConfidenceTier follows schema definition order
  // (high, moderate, speculative), so orderBy asc gives us the right priority.
  const proposals = await prisma.collaborationProposal.findMany({
    where: {
      OR: [
        { researcherAId: userId, visibilityA: "visible" },
        { researcherBId: userId, visibilityB: "visible" },
      ],
      NOT: {
        swipes: {
          some: { userId },
        },
      },
    },
    include: {
      researcherA: {
        select: { id: true, name: true, institution: true, department: true },
      },
      researcherB: {
        select: { id: true, name: true, institution: true, department: true },
      },
    },
    orderBy: [
      { confidenceTier: "asc" },
      { createdAt: "desc" },
    ],
  });

  // Transform proposals to user-perspective view.
  const queue = proposals.map((p) => {
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
      collaborator: {
        id: collaborator.id,
        name: collaborator.name,
        institution: collaborator.institution,
        department: collaborator.department,
      },
    };
  });

  // Sort by confidence tier priority, then recency (most recent first).
  // While Prisma's enum ordering should handle this, we enforce it in-app
  // to guarantee correctness regardless of DB collation behavior.
  queue.sort((a, b) => {
    const tierDiff =
      (CONFIDENCE_TIER_ORDER[a.confidenceTier] ?? 99) -
      (CONFIDENCE_TIER_ORDER[b.confidenceTier] ?? 99);
    if (tierDiff !== 0) return tierDiff;
    return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
  });

  return NextResponse.json({
    proposals: queue,
    totalCount: queue.length,
  });
}
