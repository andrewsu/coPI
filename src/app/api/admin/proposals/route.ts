/**
 * GET /api/admin/proposals — List all collaboration proposals with swipe/match status.
 *
 * Returns a table-ready list of all proposals with:
 * - Researcher A/B names
 * - Title, collaboration type, confidence tier
 * - Visibility states (A and B)
 * - Swipe status (A and B)
 * - Match status
 * - Created date
 *
 * Supports query param filters:
 * - confidenceTier: high | moderate | speculative
 * - matchStatus: matched | unmatched
 * - swipeStatus: both_swiped | one_swiped | neither_swiped
 * - visibility: visible | pending_other_interest | hidden
 *
 * Protected by middleware (isAdmin check) + defense-in-depth session check.
 *
 * Spec reference: specs/admin-dashboard.md, Proposals Overview section.
 */

import { getServerSession } from "next-auth";
import { NextRequest, NextResponse } from "next/server";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import type { ConfidenceTier, ProposalVisibility } from "@prisma/client";

export async function GET(request: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id || !session.user.isAdmin) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { searchParams } = request.nextUrl;
  const confidenceTierFilter = searchParams.get("confidenceTier") as ConfidenceTier | null;
  const matchStatusFilter = searchParams.get("matchStatus");
  const swipeStatusFilter = searchParams.get("swipeStatus");
  const visibilityFilter = searchParams.get("visibility") as ProposalVisibility | null;

  const proposals = await prisma.collaborationProposal.findMany({
    where: {
      ...(confidenceTierFilter && { confidenceTier: confidenceTierFilter }),
      ...(visibilityFilter && {
        OR: [
          { visibilityA: visibilityFilter },
          { visibilityB: visibilityFilter },
        ],
      }),
    },
    include: {
      researcherA: {
        select: { id: true, name: true, institution: true },
      },
      researcherB: {
        select: { id: true, name: true, institution: true },
      },
      swipes: {
        select: {
          userId: true,
          direction: true,
        },
      },
      matches: {
        select: { id: true },
      },
    },
    orderBy: { createdAt: "desc" },
  });

  let result = proposals.map((p) => {
    const swipeA = p.swipes.find((s) => s.userId === p.researcherAId);
    const swipeB = p.swipes.find((s) => s.userId === p.researcherBId);

    return {
      id: p.id,
      researcherA: {
        id: p.researcherA.id,
        name: p.researcherA.name,
        institution: p.researcherA.institution,
      },
      researcherB: {
        id: p.researcherB.id,
        name: p.researcherB.name,
        institution: p.researcherB.institution,
      },
      title: p.title,
      collaborationType: p.collaborationType,
      confidenceTier: p.confidenceTier,
      visibilityA: p.visibilityA,
      visibilityB: p.visibilityB,
      swipeA: swipeA?.direction ?? null,
      swipeB: swipeB?.direction ?? null,
      matched: p.matches.length > 0,
      createdAt: p.createdAt,
    };
  });

  // Apply computed filters (match and swipe status are derived from relations)
  if (matchStatusFilter === "matched") {
    result = result.filter((p) => p.matched);
  } else if (matchStatusFilter === "unmatched") {
    result = result.filter((p) => !p.matched);
  }

  if (swipeStatusFilter === "both_swiped") {
    result = result.filter((p) => p.swipeA !== null && p.swipeB !== null);
  } else if (swipeStatusFilter === "one_swiped") {
    result = result.filter(
      (p) =>
        (p.swipeA !== null && p.swipeB === null) ||
        (p.swipeA === null && p.swipeB !== null),
    );
  } else if (swipeStatusFilter === "neither_swiped") {
    result = result.filter((p) => p.swipeA === null && p.swipeB === null);
  }

  return NextResponse.json({ proposals: result, totalCount: result.length });
}
