/**
 * Admin Proposals Overview page — sortable, filterable table of all proposals.
 *
 * Server component that queries the database directly (no API fetch needed)
 * and passes proposal data to the interactive ProposalsTable client component.
 *
 * Computes swipe/match status from Swipe and Match relations.
 * No pagination in v1 (pilot scale).
 *
 * Spec reference: specs/admin-dashboard.md, "Proposals Overview" section.
 */

import { prisma } from "@/lib/prisma";
import { ProposalsTable } from "@/components/admin/proposals-table";
import type { ConfidenceTier, ProposalVisibility } from "@prisma/client";

export type SwipeDirection = "interested" | "archive";

export interface AdminProposal {
  id: string;
  researcherA: { id: string; name: string; institution: string };
  researcherB: { id: string; name: string; institution: string };
  title: string;
  collaborationType: string;
  confidenceTier: ConfidenceTier;
  visibilityA: ProposalVisibility;
  visibilityB: ProposalVisibility;
  swipeA: SwipeDirection | null;
  swipeB: SwipeDirection | null;
  matched: boolean;
  createdAt: string;
}

export default async function AdminProposalsPage() {
  const dbProposals = await prisma.collaborationProposal.findMany({
    include: {
      researcherA: {
        select: { id: true, name: true, institution: true },
      },
      researcherB: {
        select: { id: true, name: true, institution: true },
      },
      swipes: {
        select: { userId: true, direction: true },
      },
      matches: {
        select: { id: true },
      },
    },
    orderBy: { createdAt: "desc" },
  });

  const proposals: AdminProposal[] = dbProposals.map((p) => {
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
      swipeA: (swipeA?.direction as SwipeDirection) ?? null,
      swipeB: (swipeB?.direction as SwipeDirection) ?? null,
      matched: p.matches.length > 0,
      createdAt: p.createdAt.toISOString(),
    };
  });

  return (
    <div>
      <div className="mb-6">
        <h2 className="text-2xl font-bold text-gray-900">Proposals</h2>
        <p className="mt-1 text-sm text-gray-500">
          {proposals.length} total proposal{proposals.length !== 1 ? "s" : ""}
        </p>
      </div>
      <ProposalsTable proposals={proposals} />
    </div>
  );
}
