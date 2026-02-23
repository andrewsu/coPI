/**
 * GET /api/admin/stats — Aggregate matching statistics and funnel data.
 *
 * Returns:
 * - Summary cards: total users (claimed/seeded), proposals, matches, generation rate
 * - MatchingResult records with researcher names and evaluation details
 * - Funnel data: eligible pairs → proposals → interested swipes → mutual matches
 *
 * Supports query param filters on matching results:
 * - outcome: proposals_generated | no_proposal
 *
 * Protected by middleware (isAdmin check) + defense-in-depth session check.
 *
 * Spec reference: specs/admin-dashboard.md, Matching Stats section.
 */

import { getServerSession } from "next-auth";
import { NextRequest, NextResponse } from "next/server";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import type { MatchingOutcome } from "@prisma/client";

export async function GET(request: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id || !session.user.isAdmin) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { searchParams } = request.nextUrl;
  const outcomeFilter = searchParams.get("outcome") as MatchingOutcome | null;

  // Run aggregate queries in parallel for efficiency
  const [
    totalUsers,
    claimedUsers,
    totalProposals,
    totalMatches,
    matchingResults,
    interestedSwipeCount,
  ] = await Promise.all([
    prisma.user.count({ where: { deletedAt: null } }),
    prisma.user.count({ where: { deletedAt: null, claimedAt: { not: null } } }),
    prisma.collaborationProposal.count(),
    prisma.match.count(),
    prisma.matchingResult.findMany({
      where: {
        ...(outcomeFilter && { outcome: outcomeFilter }),
      },
      include: {
        researcherA: {
          select: { id: true, name: true, institution: true },
        },
        researcherB: {
          select: { id: true, name: true, institution: true },
        },
      },
      orderBy: { evaluatedAt: "desc" },
    }),
    prisma.swipe.count({ where: { direction: "interested" } }),
  ]);

  // Compute funnel metrics
  const pairsEvaluated = matchingResults.length;
  const pairsWithProposals = matchingResults.filter(
    (r) => r.outcome === "proposals_generated",
  ).length;
  const generationRate =
    pairsEvaluated > 0 ? pairsWithProposals / pairsEvaluated : 0;

  // For the funnel, count proposals with at least one interested swipe
  const proposalsWithInterestedSwipe = await prisma.collaborationProposal.count({
    where: {
      swipes: {
        some: { direction: "interested" },
      },
    },
  });

  const matchingResultsFormatted = matchingResults.map((r) => ({
    id: r.id,
    researcherA: r.researcherA,
    researcherB: r.researcherB,
    outcome: r.outcome,
    profileVersionA: r.profileVersionA,
    profileVersionB: r.profileVersionB,
    evaluatedAt: r.evaluatedAt,
  }));

  return NextResponse.json({
    summary: {
      totalUsers,
      claimedUsers,
      seededUsers: totalUsers - claimedUsers,
      totalProposals,
      totalMatches,
      generationRate: Math.round(generationRate * 1000) / 1000,
    },
    funnel: {
      pairsEvaluated,
      proposalsGenerated: totalProposals,
      proposalsWithInterestedSwipe,
      interestedSwipes: interestedSwipeCount,
      mutualMatches: totalMatches,
    },
    matchingResults: matchingResultsFormatted,
    matchingResultsCount: matchingResultsFormatted.length,
  });
}
