/**
 * GET /api/admin/users/[id] — Full admin detail view of a single user.
 *
 * Returns all user data including:
 * - Full ResearcherProfile fields (including pending profile)
 * - All publications with metadata
 * - Match pool entries (who they selected and who selected them)
 * - Affiliation selections
 * - All proposals involving this user with swipe/match status
 *
 * Protected by middleware (isAdmin check) + defense-in-depth session check.
 *
 * Spec reference: specs/admin-dashboard.md, User Detail section.
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

  const user = await prisma.user.findUnique({
    where: { id },
    include: {
      profile: true,
      publications: {
        select: {
          id: true,
          pmid: true,
          pmcid: true,
          doi: true,
          title: true,
          journal: true,
          year: true,
          authorPosition: true,
          methodsText: true,
          createdAt: true,
        },
        orderBy: { year: "desc" },
      },
      matchPoolSelections: {
        include: {
          targetUser: {
            select: { id: true, name: true, institution: true },
          },
        },
        orderBy: { createdAt: "desc" },
      },
      matchPoolTargets: {
        include: {
          user: {
            select: { id: true, name: true, institution: true },
          },
        },
        orderBy: { createdAt: "desc" },
      },
      affiliationSelections: {
        orderBy: { createdAt: "desc" },
      },
    },
  });

  if (!user) {
    return NextResponse.json({ error: "User not found" }, { status: 404 });
  }

  // Fetch proposals involving this user (as researcher A or B)
  const proposals = await prisma.collaborationProposal.findMany({
    where: {
      OR: [{ researcherAId: id }, { researcherBId: id }],
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
          createdAt: true,
        },
      },
      matches: {
        select: { id: true, matchedAt: true },
      },
    },
    orderBy: { createdAt: "desc" },
  });

  // Transform proposals to admin view
  const proposalSummaries = proposals.map((p) => {
    const isA = p.researcherAId === id;
    const otherResearcher = isA ? p.researcherB : p.researcherA;
    const userSwipe = p.swipes.find((s) => s.userId === id);
    const otherSwipe = p.swipes.find((s) => s.userId !== id);

    return {
      id: p.id,
      title: p.title,
      confidenceTier: p.confidenceTier,
      collaborationType: p.collaborationType,
      visibilityForUser: isA ? p.visibilityA : p.visibilityB,
      userSwipe: userSwipe?.direction ?? null,
      otherSwipe: otherSwipe?.direction ?? null,
      matched: p.matches.length > 0,
      otherResearcher: {
        id: otherResearcher.id,
        name: otherResearcher.name,
        institution: otherResearcher.institution,
      },
      createdAt: p.createdAt,
    };
  });

  // Transform publications: include whether methods text was extracted
  const publications = user.publications.map((pub) => ({
    id: pub.id,
    pmid: pub.pmid,
    pmcid: pub.pmcid,
    doi: pub.doi,
    title: pub.title,
    journal: pub.journal,
    year: pub.year,
    authorPosition: pub.authorPosition,
    hasMethodsText: !!pub.methodsText,
    createdAt: pub.createdAt,
  }));

  // Transform match pool
  const matchPoolSelections = user.matchPoolSelections.map((entry) => ({
    id: entry.id,
    source: entry.source,
    target: entry.targetUser,
    createdAt: entry.createdAt,
  }));

  const selectedByOthers = user.matchPoolTargets.map((entry) => ({
    id: entry.id,
    source: entry.source,
    selectedBy: entry.user,
    createdAt: entry.createdAt,
  }));

  return NextResponse.json({
    id: user.id,
    name: user.name,
    email: user.email,
    institution: user.institution,
    department: user.department,
    orcid: user.orcid,
    isAdmin: user.isAdmin,
    createdAt: user.createdAt,
    claimedAt: user.claimedAt,
    deletedAt: user.deletedAt,
    profile: user.profile
      ? {
          id: user.profile.id,
          researchSummary: user.profile.researchSummary,
          techniques: user.profile.techniques,
          experimentalModels: user.profile.experimentalModels,
          diseaseAreas: user.profile.diseaseAreas,
          keyTargets: user.profile.keyTargets,
          keywords: user.profile.keywords,
          grantTitles: user.profile.grantTitles,
          profileVersion: user.profile.profileVersion,
          profileGeneratedAt: user.profile.profileGeneratedAt,
          pendingProfile: user.profile.pendingProfile,
          pendingProfileCreatedAt: user.profile.pendingProfileCreatedAt,
        }
      : null,
    publications,
    matchPool: {
      selections: matchPoolSelections,
      selectedByOthers,
    },
    affiliationSelections: user.affiliationSelections.map((sel) => ({
      id: sel.id,
      institution: sel.institution,
      department: sel.department,
      selectAll: sel.selectAll,
      createdAt: sel.createdAt,
    })),
    proposals: proposalSummaries,
  });
}
