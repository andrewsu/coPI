/**
 * GET /api/proposals/[id] — Fetch full detail view for a single proposal.
 *
 * Returns all detail fields for expansion: scientific question, rationale,
 * contributions/benefits mapped to the user's perspective ("you" vs "them"),
 * proposed first experiment, anchoring publications resolved to actual records,
 * and the collaborator's public profile data.
 *
 * Authorization: user must be researcher A or B on the proposal.
 *
 * Privacy: EXCLUDES userSubmittedTexts, keywords, and raw abstracts per spec.
 *
 * Spec reference: specs/swipe-interface.md, "The Card — Detail View" section.
 */

import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getUserSide } from "@/lib/utils";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const userId = session.user.id;

  const proposal = await prisma.collaborationProposal.findUnique({
    where: { id },
    include: {
      researcherA: {
        select: {
          id: true,
          name: true,
          institution: true,
          department: true,
          profile: {
            select: {
              researchSummary: true,
              techniques: true,
              experimentalModels: true,
              diseaseAreas: true,
              keyTargets: true,
              grantTitles: true,
            },
          },
          publications: {
            select: {
              id: true,
              pmid: true,
              title: true,
              journal: true,
              year: true,
              authorPosition: true,
            },
            orderBy: { year: "desc" },
          },
        },
      },
      researcherB: {
        select: {
          id: true,
          name: true,
          institution: true,
          department: true,
          profile: {
            select: {
              researchSummary: true,
              techniques: true,
              experimentalModels: true,
              diseaseAreas: true,
              keyTargets: true,
              grantTitles: true,
            },
          },
          publications: {
            select: {
              id: true,
              pmid: true,
              title: true,
              journal: true,
              year: true,
              authorPosition: true,
            },
            orderBy: { year: "desc" },
          },
        },
      },
    },
  });

  if (!proposal) {
    return NextResponse.json({ error: "Proposal not found" }, { status: 404 });
  }

  // Authorization: user must be part of this proposal.
  if (
    proposal.researcherAId !== userId &&
    proposal.researcherBId !== userId
  ) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const side = getUserSide(userId, proposal);
  const collaborator = side === "a" ? proposal.researcherB : proposal.researcherA;

  // Resolve anchoring publication IDs to actual publication data.
  // These are UUIDs stored in the proposal that reference Publication records.
  let anchoringPublications: Array<{
    id: string;
    pmid: string | null;
    title: string;
    journal: string;
    year: number;
    authorPosition: string;
  }> = [];

  if (proposal.anchoringPublicationIds.length > 0) {
    anchoringPublications = await prisma.publication.findMany({
      where: { id: { in: proposal.anchoringPublicationIds } },
      select: {
        id: true,
        pmid: true,
        title: true,
        journal: true,
        year: true,
        authorPosition: true,
      },
    });
  }

  return NextResponse.json({
    id: proposal.id,
    title: proposal.title,
    collaborationType: proposal.collaborationType,
    oneLineSummary:
      side === "a" ? proposal.oneLineSummaryA : proposal.oneLineSummaryB,
    confidenceTier: proposal.confidenceTier,
    isUpdated: proposal.isUpdated,
    createdAt: proposal.createdAt,

    // Detail fields
    scientificQuestion: proposal.scientificQuestion,
    detailedRationale: proposal.detailedRationale,
    yourContributions:
      side === "a" ? proposal.labAContributions : proposal.labBContributions,
    theirContributions:
      side === "a" ? proposal.labBContributions : proposal.labAContributions,
    yourBenefits:
      side === "a" ? proposal.labABenefits : proposal.labBBenefits,
    theirBenefits:
      side === "a" ? proposal.labBBenefits : proposal.labABenefits,
    proposedFirstExperiment: proposal.proposedFirstExperiment,
    anchoringPublications,

    // Collaborator info
    collaborator: {
      id: collaborator.id,
      name: collaborator.name,
      institution: collaborator.institution,
      department: collaborator.department,
      profile: collaborator.profile
        ? {
            researchSummary: collaborator.profile.researchSummary,
            techniques: collaborator.profile.techniques,
            experimentalModels: collaborator.profile.experimentalModels,
            diseaseAreas: collaborator.profile.diseaseAreas,
            keyTargets: collaborator.profile.keyTargets,
            grantTitles: collaborator.profile.grantTitles,
          }
        : null,
      publications: collaborator.publications.map((pub) => ({
        id: pub.id,
        pmid: pub.pmid,
        title: pub.title,
        journal: pub.journal,
        year: pub.year,
        authorPosition: pub.authorPosition,
      })),
    },
  });
}
