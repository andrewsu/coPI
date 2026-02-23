/**
 * GET /api/admin/proposals/[id] — Full admin detail view of a single proposal.
 *
 * Returns all proposal fields including:
 * - Title, collaboration type, scientific question
 * - One-line summaries (A and B versions)
 * - Detailed rationale, contributions, benefits
 * - Proposed first experiment
 * - Anchoring publications (resolved to Publication records)
 * - Confidence tier, LLM reasoning, LLM model
 * - Visibility states (A and B)
 * - Swipe records with detail (who, direction, viewedDetail, timeSpentMs, when)
 * - Match record (if matched)
 * - Profile versions at generation time
 *
 * Protected by middleware (isAdmin check) + defense-in-depth session check.
 *
 * Spec reference: specs/admin-dashboard.md, Proposal Detail section.
 */

import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id || !session.user.isAdmin) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id } = await params;

  const proposal = await prisma.collaborationProposal.findUnique({
    where: { id },
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
      swipes: {
        include: {
          user: {
            select: { id: true, name: true },
          },
        },
        orderBy: { createdAt: "asc" },
      },
      matches: {
        orderBy: { matchedAt: "desc" },
      },
    },
  });

  if (!proposal) {
    return NextResponse.json({ error: "Proposal not found" }, { status: 404 });
  }

  // Resolve anchoring publication IDs to Publication records
  const anchoringPublications =
    proposal.anchoringPublicationIds.length > 0
      ? await prisma.publication.findMany({
          where: { id: { in: proposal.anchoringPublicationIds } },
          select: {
            id: true,
            pmid: true,
            doi: true,
            title: true,
            journal: true,
            year: true,
            authorPosition: true,
          },
        })
      : [];

  return NextResponse.json({
    id: proposal.id,
    researcherA: proposal.researcherA,
    researcherB: proposal.researcherB,
    title: proposal.title,
    collaborationType: proposal.collaborationType,
    scientificQuestion: proposal.scientificQuestion,
    oneLineSummaryA: proposal.oneLineSummaryA,
    oneLineSummaryB: proposal.oneLineSummaryB,
    detailedRationale: proposal.detailedRationale,
    labAContributions: proposal.labAContributions,
    labBContributions: proposal.labBContributions,
    labABenefits: proposal.labABenefits,
    labBBenefits: proposal.labBBenefits,
    proposedFirstExperiment: proposal.proposedFirstExperiment,
    anchoringPublications,
    confidenceTier: proposal.confidenceTier,
    llmReasoning: proposal.llmReasoning,
    llmModel: proposal.llmModel,
    visibilityA: proposal.visibilityA,
    visibilityB: proposal.visibilityB,
    profileVersionA: proposal.profileVersionA,
    profileVersionB: proposal.profileVersionB,
    isUpdated: proposal.isUpdated,
    createdAt: proposal.createdAt,
    swipes: proposal.swipes.map((s) => ({
      id: s.id,
      user: s.user,
      direction: s.direction,
      viewedDetail: s.viewedDetail,
      timeSpentMs: s.timeSpentMs,
      createdAt: s.createdAt,
    })),
    match: proposal.matches.length > 0
      ? {
          id: proposal.matches[0]!.id,
          matchedAt: proposal.matches[0]!.matchedAt,
          notificationSentA: proposal.matches[0]!.notificationSentA,
          notificationSentB: proposal.matches[0]!.notificationSentB,
        }
      : null,
  });
}
