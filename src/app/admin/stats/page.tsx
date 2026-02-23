/**
 * Admin Matching Stats page — summary cards, funnel visualization, and matching results table.
 *
 * Server component that queries the database directly (no API fetch needed)
 * and passes stats data to the interactive StatsDashboard client component.
 *
 * Computes summary metrics, funnel conversion rates, and matching result records.
 * No pagination in v1 (pilot scale).
 *
 * Spec reference: specs/admin-dashboard.md, "Matching Stats" section.
 */

import { prisma } from "@/lib/prisma";
import { StatsDashboard } from "@/components/admin/stats-dashboard";

export const dynamic = "force-dynamic";

export interface StatsData {
  totalUsers: number;
  claimedUsers: number;
  seededUsers: number;
  totalProposals: number;
  totalMatches: number;
  generationRate: number;
}

export interface FunnelData {
  pairsEvaluated: number;
  proposalsGenerated: number;
  proposalsWithInterestedSwipe: number;
  mutualMatches: number;
}

export interface AdminMatchingResult {
  id: string;
  researcherA: { id: string; name: string; institution: string };
  researcherB: { id: string; name: string; institution: string };
  outcome: string;
  profileVersionA: number;
  profileVersionB: number;
  evaluatedAt: string;
}

export default async function AdminStatsPage() {
  const [
    totalUsers,
    claimedUsers,
    totalProposals,
    totalMatches,
    matchingResults,
    _interestedSwipeCount,
    proposalsWithInterestedSwipe,
  ] = await Promise.all([
    prisma.user.count({ where: { deletedAt: null } }),
    prisma.user.count({ where: { deletedAt: null, claimedAt: { not: null } } }),
    prisma.collaborationProposal.count(),
    prisma.match.count(),
    prisma.matchingResult.findMany({
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
    prisma.collaborationProposal.count({
      where: {
        swipes: {
          some: { direction: "interested" },
        },
      },
    }),
  ]);

  const pairsEvaluated = matchingResults.length;
  const pairsWithProposals = matchingResults.filter(
    (r) => r.outcome === "proposals_generated",
  ).length;
  const generationRate =
    pairsEvaluated > 0 ? pairsWithProposals / pairsEvaluated : 0;

  const summary: StatsData = {
    totalUsers,
    claimedUsers,
    seededUsers: totalUsers - claimedUsers,
    totalProposals,
    totalMatches,
    generationRate: Math.round(generationRate * 1000) / 1000,
  };

  const funnel: FunnelData = {
    pairsEvaluated,
    proposalsGenerated: totalProposals,
    proposalsWithInterestedSwipe,
    mutualMatches: totalMatches,
  };

  const results: AdminMatchingResult[] = matchingResults.map((r) => ({
    id: r.id,
    researcherA: {
      id: r.researcherA.id,
      name: r.researcherA.name,
      institution: r.researcherA.institution,
    },
    researcherB: {
      id: r.researcherB.id,
      name: r.researcherB.name,
      institution: r.researcherB.institution,
    },
    outcome: r.outcome,
    profileVersionA: r.profileVersionA,
    profileVersionB: r.profileVersionB,
    evaluatedAt: r.evaluatedAt.toISOString(),
  }));

  return (
    <div>
      <div className="mb-6">
        <h2 className="text-2xl font-bold text-gray-900">Matching Stats</h2>
        <p className="mt-1 text-sm text-gray-500">
          Pipeline performance and matching results
        </p>
      </div>
      <StatsDashboard summary={summary} funnel={funnel} matchingResults={results} />
    </div>
  );
}
