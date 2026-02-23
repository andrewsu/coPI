/**
 * Admin Proposal Detail page — full read-only view of a single proposal.
 *
 * Server component that queries the database directly (no API fetch needed)
 * and renders all proposal fields in organized sections: header, content,
 * anchoring publications, LLM info, visibility/status, swipes, and match.
 *
 * Spec reference: specs/admin-dashboard.md, "Proposal Detail" section.
 */

import { prisma } from "@/lib/prisma";
import { notFound } from "next/navigation";
import Link from "next/link";

function formatDateTime(date: Date): string {
  return (
    date.toLocaleDateString("en-US", {
      year: "numeric",
      month: "short",
      day: "numeric",
      timeZone: "UTC",
    }) +
    " " +
    date.toLocaleTimeString("en-US", {
      hour: "2-digit",
      minute: "2-digit",
      timeZone: "UTC",
    })
  );
}

function formatCollaborationType(type: string): string {
  return type
    .split("_")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

function formatTimeSpent(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  const seconds = Math.round(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const remaining = seconds % 60;
  return `${minutes}m ${remaining}s`;
}

const CONFIDENCE_COLORS: Record<string, string> = {
  high: "bg-emerald-100 text-emerald-700",
  moderate: "bg-amber-100 text-amber-700",
  speculative: "bg-gray-100 text-gray-700",
};

const VISIBILITY_COLORS: Record<string, string> = {
  visible: "text-emerald-600",
  pending_other_interest: "text-amber-600",
  hidden: "text-gray-400",
};

const VISIBILITY_LABELS: Record<string, string> = {
  visible: "Visible",
  pending_other_interest: "Pending Other Interest",
  hidden: "Hidden",
};

export default async function AdminProposalDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
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
        orderBy: { createdAt: "asc" as const },
      },
      matches: {
        orderBy: { matchedAt: "desc" as const },
      },
    },
  });

  if (!proposal) notFound();

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

  const match =
    proposal.matches.length > 0 ? proposal.matches[0]! : null;

  return (
    <div className="space-y-8">
      {/* Back link */}
      <Link
        href="/admin/proposals"
        className="inline-block text-sm text-gray-500 hover:text-gray-700"
      >
        &larr; Back to Proposals
      </Link>

      {/* Header */}
      <div className="rounded-lg border border-gray-200 bg-white p-6 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h2 className="text-2xl font-bold text-gray-900">
              {proposal.title}
            </h2>
            <p className="mt-1 text-sm text-gray-600">
              {formatCollaborationType(proposal.collaborationType)}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <span
              className={`inline-block rounded-full px-2.5 py-0.5 text-xs font-medium ${CONFIDENCE_COLORS[proposal.confidenceTier] ?? "bg-gray-100 text-gray-700"}`}
            >
              {proposal.confidenceTier}
            </span>
            {match && (
              <span className="inline-block rounded-full bg-emerald-100 px-2.5 py-0.5 text-xs font-medium text-emerald-700">
                Matched
              </span>
            )}
            {proposal.isUpdated && (
              <span className="inline-block rounded-full bg-blue-100 px-2.5 py-0.5 text-xs font-medium text-blue-700">
                Updated
              </span>
            )}
          </div>
        </div>

        {/* Researchers */}
        <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div className="rounded-md bg-gray-50 p-3">
            <p className="text-xs font-medium uppercase text-gray-400">
              Researcher A
            </p>
            <Link
              href={`/admin/users/${proposal.researcherA.id}`}
              className="text-sm font-medium text-blue-600 hover:text-blue-800 hover:underline"
            >
              {proposal.researcherA.name}
            </Link>
            <p className="text-xs text-gray-500">
              {proposal.researcherA.institution}
              {proposal.researcherA.department && (
                <span className="text-gray-400">
                  {" "}
                  / {proposal.researcherA.department}
                </span>
              )}
            </p>
          </div>
          <div className="rounded-md bg-gray-50 p-3">
            <p className="text-xs font-medium uppercase text-gray-400">
              Researcher B
            </p>
            <Link
              href={`/admin/users/${proposal.researcherB.id}`}
              className="text-sm font-medium text-blue-600 hover:text-blue-800 hover:underline"
            >
              {proposal.researcherB.name}
            </Link>
            <p className="text-xs text-gray-500">
              {proposal.researcherB.institution}
              {proposal.researcherB.department && (
                <span className="text-gray-400">
                  {" "}
                  / {proposal.researcherB.department}
                </span>
              )}
            </p>
          </div>
        </div>

        <div className="mt-4 text-xs text-gray-500">
          Created: {formatDateTime(proposal.createdAt)}
        </div>
      </div>

      {/* Scientific Question */}
      <section>
        <h3 className="mb-3 text-lg font-semibold text-gray-900">
          Scientific Question
        </h3>
        <div className="rounded-lg border border-gray-200 bg-white p-6 shadow-sm">
          <p className="text-sm text-gray-800 leading-relaxed italic">
            {proposal.scientificQuestion}
          </p>
        </div>
      </section>

      {/* One-Line Summaries */}
      <section>
        <h3 className="mb-3 text-lg font-semibold text-gray-900">
          One-Line Summaries
        </h3>
        <div className="rounded-lg border border-gray-200 bg-white p-6 shadow-sm space-y-4">
          <div>
            <p className="text-xs font-medium uppercase text-gray-400 mb-1">
              For {proposal.researcherA.name} (A)
            </p>
            <p className="text-sm text-gray-700">
              {proposal.oneLineSummaryA}
            </p>
          </div>
          <div>
            <p className="text-xs font-medium uppercase text-gray-400 mb-1">
              For {proposal.researcherB.name} (B)
            </p>
            <p className="text-sm text-gray-700">
              {proposal.oneLineSummaryB}
            </p>
          </div>
        </div>
      </section>

      {/* Detailed Rationale */}
      <section>
        <h3 className="mb-3 text-lg font-semibold text-gray-900">
          Detailed Rationale
        </h3>
        <div className="rounded-lg border border-gray-200 bg-white p-6 shadow-sm">
          <p className="text-sm text-gray-700 leading-relaxed whitespace-pre-wrap">
            {proposal.detailedRationale}
          </p>
        </div>
      </section>

      {/* Contributions & Benefits */}
      <section>
        <h3 className="mb-3 text-lg font-semibold text-gray-900">
          Contributions &amp; Benefits
        </h3>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div className="rounded-lg border border-gray-200 bg-white p-6 shadow-sm space-y-4">
            <div>
              <h4 className="text-sm font-medium text-gray-700 mb-1">
                {proposal.researcherA.name}&apos;s Contributions
              </h4>
              <p className="text-sm text-gray-600 leading-relaxed whitespace-pre-wrap">
                {proposal.labAContributions}
              </p>
            </div>
            <div>
              <h4 className="text-sm font-medium text-gray-700 mb-1">
                {proposal.researcherA.name}&apos;s Benefits
              </h4>
              <p className="text-sm text-gray-600 leading-relaxed whitespace-pre-wrap">
                {proposal.labABenefits}
              </p>
            </div>
          </div>
          <div className="rounded-lg border border-gray-200 bg-white p-6 shadow-sm space-y-4">
            <div>
              <h4 className="text-sm font-medium text-gray-700 mb-1">
                {proposal.researcherB.name}&apos;s Contributions
              </h4>
              <p className="text-sm text-gray-600 leading-relaxed whitespace-pre-wrap">
                {proposal.labBContributions}
              </p>
            </div>
            <div>
              <h4 className="text-sm font-medium text-gray-700 mb-1">
                {proposal.researcherB.name}&apos;s Benefits
              </h4>
              <p className="text-sm text-gray-600 leading-relaxed whitespace-pre-wrap">
                {proposal.labBBenefits}
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* Proposed First Experiment */}
      <section>
        <h3 className="mb-3 text-lg font-semibold text-gray-900">
          Proposed First Experiment
        </h3>
        <div className="rounded-lg border border-gray-200 bg-white p-6 shadow-sm">
          <p className="text-sm text-gray-700 leading-relaxed whitespace-pre-wrap">
            {proposal.proposedFirstExperiment}
          </p>
        </div>
      </section>

      {/* Anchoring Publications */}
      <section>
        <h3 className="mb-3 text-lg font-semibold text-gray-900">
          Anchoring Publications
          <span className="ml-2 text-sm font-normal text-gray-500">
            ({anchoringPublications.length})
          </span>
        </h3>
        {anchoringPublications.length > 0 ? (
          <div className="overflow-x-auto rounded-lg border border-gray-200 bg-white shadow-sm">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Title
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Journal
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Year
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Position
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    IDs
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {anchoringPublications.map((pub) => (
                  <tr key={pub.id} className="hover:bg-gray-50">
                    <td className="px-4 py-3 text-sm text-gray-900 max-w-md">
                      {pub.title}
                    </td>
                    <td className="px-4 py-3 text-sm text-gray-600 whitespace-nowrap">
                      {pub.journal}
                    </td>
                    <td className="px-4 py-3 text-sm text-gray-600 tabular-nums">
                      {pub.year}
                    </td>
                    <td className="px-4 py-3 text-sm text-gray-600 whitespace-nowrap capitalize">
                      {pub.authorPosition}
                    </td>
                    <td className="px-4 py-3 text-sm whitespace-nowrap space-x-2">
                      {pub.pmid && (
                        <a
                          href={`https://pubmed.ncbi.nlm.nih.gov/${pub.pmid}/`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-blue-600 hover:text-blue-800 hover:underline"
                        >
                          PMID
                        </a>
                      )}
                      {pub.doi && (
                        <a
                          href={`https://doi.org/${pub.doi}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-blue-600 hover:text-blue-800 hover:underline"
                        >
                          DOI
                        </a>
                      )}
                      {!pub.pmid && !pub.doi && (
                        <span className="text-gray-400">&mdash;</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="rounded-lg border border-gray-200 bg-white p-6 shadow-sm">
            <p className="text-sm text-gray-400">
              No anchoring publications.
            </p>
          </div>
        )}
      </section>

      {/* LLM Information */}
      <section>
        <h3 className="mb-3 text-lg font-semibold text-gray-900">
          LLM Information
        </h3>
        <div className="rounded-lg border border-gray-200 bg-white p-6 shadow-sm space-y-4">
          <div className="flex flex-wrap gap-x-6 gap-y-1 text-sm">
            <div>
              <span className="text-gray-500">Model: </span>
              <span className="font-mono text-xs text-gray-700">
                {proposal.llmModel}
              </span>
            </div>
            <div>
              <span className="text-gray-500">Confidence: </span>
              <span
                className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${CONFIDENCE_COLORS[proposal.confidenceTier] ?? "bg-gray-100 text-gray-700"}`}
              >
                {proposal.confidenceTier}
              </span>
            </div>
          </div>
          {proposal.llmReasoning && (
            <div>
              <h4 className="text-sm font-medium text-gray-700 mb-1">
                Reasoning
              </h4>
              <p className="text-sm text-gray-600 leading-relaxed whitespace-pre-wrap">
                {proposal.llmReasoning}
              </p>
            </div>
          )}
        </div>
      </section>

      {/* Visibility & Status */}
      <section>
        <h3 className="mb-3 text-lg font-semibold text-gray-900">
          Visibility &amp; Status
        </h3>
        <div className="rounded-lg border border-gray-200 bg-white p-6 shadow-sm">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <p className="text-xs font-medium uppercase text-gray-400 mb-1">
                {proposal.researcherA.name} (A)
              </p>
              <span
                className={`text-sm font-medium ${VISIBILITY_COLORS[proposal.visibilityA] ?? "text-gray-400"}`}
              >
                {VISIBILITY_LABELS[proposal.visibilityA] ??
                  proposal.visibilityA}
              </span>
              <p className="text-xs text-gray-500 mt-0.5">
                Profile version: {proposal.profileVersionA}
              </p>
            </div>
            <div>
              <p className="text-xs font-medium uppercase text-gray-400 mb-1">
                {proposal.researcherB.name} (B)
              </p>
              <span
                className={`text-sm font-medium ${VISIBILITY_COLORS[proposal.visibilityB] ?? "text-gray-400"}`}
              >
                {VISIBILITY_LABELS[proposal.visibilityB] ??
                  proposal.visibilityB}
              </span>
              <p className="text-xs text-gray-500 mt-0.5">
                Profile version: {proposal.profileVersionB}
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* Swipe Records */}
      <section>
        <h3 className="mb-3 text-lg font-semibold text-gray-900">
          Swipe Records
          <span className="ml-2 text-sm font-normal text-gray-500">
            ({proposal.swipes.length})
          </span>
        </h3>
        {proposal.swipes.length > 0 ? (
          <div className="overflow-x-auto rounded-lg border border-gray-200 bg-white shadow-sm">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    User
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Direction
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Viewed Detail
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Time Spent
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Date
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {proposal.swipes.map((swipe) => (
                  <tr key={swipe.id} className="hover:bg-gray-50">
                    <td className="px-4 py-3 text-sm">
                      <Link
                        href={`/admin/users/${swipe.user.id}`}
                        className="text-blue-600 hover:text-blue-800 hover:underline"
                      >
                        {swipe.user.name}
                      </Link>
                    </td>
                    <td className="px-4 py-3 text-sm">
                      {swipe.direction === "interested" ? (
                        <span className="font-medium text-emerald-600">
                          Interested
                        </span>
                      ) : (
                        <span className="text-gray-500">Archive</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-sm">
                      {swipe.viewedDetail ? (
                        <span className="text-emerald-600">Yes</span>
                      ) : (
                        <span className="text-gray-400">No</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-sm text-gray-600 tabular-nums">
                      {swipe.timeSpentMs
                        ? formatTimeSpent(swipe.timeSpentMs)
                        : "\u2014"}
                    </td>
                    <td className="px-4 py-3 text-xs text-gray-500 whitespace-nowrap">
                      {formatDateTime(swipe.createdAt)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="rounded-lg border border-gray-200 bg-white p-6 shadow-sm">
            <p className="text-sm text-gray-400">No swipes recorded.</p>
          </div>
        )}
      </section>

      {/* Match Record */}
      <section>
        <h3 className="mb-3 text-lg font-semibold text-gray-900">
          Match
        </h3>
        {match ? (
          <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-6 shadow-sm">
            <div className="flex flex-wrap gap-x-6 gap-y-2 text-sm">
              <div>
                <span className="text-gray-500">Matched: </span>
                <span className="font-medium text-emerald-700">
                  {formatDateTime(match.matchedAt)}
                </span>
              </div>
              <div>
                <span className="text-gray-500">Notification A: </span>
                {match.notificationSentA ? (
                  <span className="text-emerald-600">Sent</span>
                ) : (
                  <span className="text-gray-400">Not sent</span>
                )}
              </div>
              <div>
                <span className="text-gray-500">Notification B: </span>
                {match.notificationSentB ? (
                  <span className="text-emerald-600">Sent</span>
                ) : (
                  <span className="text-gray-400">Not sent</span>
                )}
              </div>
            </div>
          </div>
        ) : (
          <div className="rounded-lg border border-gray-200 bg-white p-6 shadow-sm">
            <p className="text-sm text-gray-400">No match yet.</p>
          </div>
        )}
      </section>
    </div>
  );
}
