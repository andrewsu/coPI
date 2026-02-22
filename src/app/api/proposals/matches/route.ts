/**
 * GET /api/proposals/matches — Fetch the user's mutual matches.
 *
 * Returns all proposals where both researchers swiped "interested" (creating
 * a Match record). Each match includes the full proposal detail, both
 * researchers' public profiles, and contact information governed by the
 * collaborator's email_visibility setting.
 *
 * Per spec:
 * - public_profile or mutual_matches → show email
 * - never → show placeholder message
 * - Deleted account → banner text, name/institution preserved, profile/contact removed
 * - EXCLUDES user-submitted texts from both parties
 *
 * Spec reference: specs/swipe-interface.md, "Matches Tab" section.
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

  // Find all Match records for proposals where this user is researcher A or B.
  // Sorted by most recent match first.
  const matches = await prisma.match.findMany({
    where: {
      proposal: {
        OR: [{ researcherAId: userId }, { researcherBId: userId }],
      },
    },
    include: {
      proposal: {
        include: {
          researcherA: {
            select: {
              id: true,
              name: true,
              email: true,
              institution: true,
              department: true,
              emailVisibility: true,
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
                orderBy: { year: "desc" as const },
              },
            },
          },
          researcherB: {
            select: {
              id: true,
              name: true,
              email: true,
              institution: true,
              department: true,
              emailVisibility: true,
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
                orderBy: { year: "desc" as const },
              },
            },
          },
        },
      },
    },
    orderBy: { matchedAt: "desc" },
  });

  // Transform each match to the user's perspective with contact info.
  const matchesResponse = await Promise.all(
    matches.map(async (match) => {
      const p = match.proposal;
      const side = getUserSide(userId, p);
      const collaborator = side === "a" ? p.researcherB : p.researcherA;
      const self = side === "a" ? p.researcherA : p.researcherB;

      // Resolve anchoring publication IDs to actual publication data.
      let anchoringPublications: Array<{
        id: string;
        pmid: string | null;
        title: string;
        journal: string;
        year: number;
        authorPosition: string;
      }> = [];

      if (p.anchoringPublicationIds.length > 0) {
        anchoringPublications = await prisma.publication.findMany({
          where: { id: { in: p.anchoringPublicationIds } },
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

      // Determine contact info based on collaborator's email_visibility setting.
      // Per spec: public_profile or mutual_matches → show email; never → placeholder.
      let collaboratorEmail: string | null = null;
      let contactMessage: string | null = null;

      if (
        collaborator.emailVisibility === "public_profile" ||
        collaborator.emailVisibility === "mutual_matches"
      ) {
        collaboratorEmail = collaborator.email;
      } else {
        contactMessage =
          "This researcher prefers not to share their email. You may reach them through their institutional directory.";
      }

      return {
        matchId: match.id,
        matchedAt: match.matchedAt,

        // Full proposal detail
        proposal: {
          id: p.id,
          title: p.title,
          collaborationType: p.collaborationType,
          oneLineSummary: side === "a" ? p.oneLineSummaryA : p.oneLineSummaryB,
          confidenceTier: p.confidenceTier,
          isUpdated: p.isUpdated,
          createdAt: p.createdAt,
          scientificQuestion: p.scientificQuestion,
          detailedRationale: p.detailedRationale,
          yourContributions:
            side === "a" ? p.labAContributions : p.labBContributions,
          theirContributions:
            side === "a" ? p.labBContributions : p.labAContributions,
          yourBenefits: side === "a" ? p.labABenefits : p.labBBenefits,
          theirBenefits: side === "a" ? p.labBBenefits : p.labABenefits,
          proposedFirstExperiment: p.proposedFirstExperiment,
          anchoringPublications,
        },

        // Collaborator info with contact details
        collaborator: {
          id: collaborator.id,
          name: collaborator.name,
          institution: collaborator.institution,
          department: collaborator.department,
          email: collaboratorEmail,
          contactMessage,
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

        // User's own profile (for "both profiles" display per spec)
        yourProfile: {
          id: self.id,
          name: self.name,
          institution: self.institution,
          department: self.department,
          profile: self.profile
            ? {
                researchSummary: self.profile.researchSummary,
                techniques: self.profile.techniques,
                experimentalModels: self.profile.experimentalModels,
                diseaseAreas: self.profile.diseaseAreas,
                keyTargets: self.profile.keyTargets,
                grantTitles: self.profile.grantTitles,
              }
            : null,
          publications: self.publications.map((pub) => ({
            id: pub.id,
            pmid: pub.pmid,
            title: pub.title,
            journal: pub.journal,
            year: pub.year,
            authorPosition: pub.authorPosition,
          })),
        },
      };
    })
  );

  return NextResponse.json({
    matches: matchesResponse,
    totalCount: matchesResponse.length,
  });
}
