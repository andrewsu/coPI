/**
 * Admin Stats Dashboard — interactive client component for the Matching Stats page.
 *
 * Three sections per spec:
 * 1. Summary Cards — total users (claimed/seeded), proposals, matches, generation rate
 * 2. Funnel Visualization — eligible pairs → proposals → interested swipe → mutual matches
 *    with counts and conversion rates (simple text/numbers, not a chart)
 * 3. Matching Results Table — sortable by date, filterable by outcome
 *    with researcher A/B names, outcome, profile versions, evaluated date
 *
 * Spec reference: specs/admin-dashboard.md, "Matching Stats" section.
 */

"use client";

import { useState, useMemo } from "react";
import { useRouter } from "next/navigation";
import type {
  StatsData,
  FunnelData,
  AdminMatchingResult,
} from "@/app/admin/stats/page";

type OutcomeFilter = "all" | "proposals_generated" | "no_proposal";
type SortDirection = "asc" | "desc";

const OUTCOME_LABELS: Record<string, string> = {
  proposals_generated: "Proposals Generated",
  no_proposal: "No Proposal",
};

const OUTCOME_COLORS: Record<string, string> = {
  proposals_generated: "bg-emerald-100 text-emerald-700",
  no_proposal: "bg-gray-100 text-gray-700",
};

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}

function formatPercent(value: number): string {
  if (!isFinite(value)) return "N/A";
  return `${(value * 100).toFixed(1)}%`;
}

function formatRate(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

interface StatsDashboardProps {
  summary: StatsData;
  funnel: FunnelData;
  matchingResults: AdminMatchingResult[];
}

export function StatsDashboard({
  summary,
  funnel,
  matchingResults,
}: StatsDashboardProps) {
  const router = useRouter();
  const [outcomeFilter, setOutcomeFilter] = useState<OutcomeFilter>("all");
  const [sortDirection, setSortDirection] = useState<SortDirection>("desc");

  const filteredAndSorted = useMemo(() => {
    let result = [...matchingResults];

    if (outcomeFilter !== "all") {
      result = result.filter((r) => r.outcome === outcomeFilter);
    }

    result.sort((a, b) => {
      const cmp =
        new Date(a.evaluatedAt).getTime() - new Date(b.evaluatedAt).getTime();
      return sortDirection === "asc" ? cmp : -cmp;
    });

    return result;
  }, [matchingResults, outcomeFilter, sortDirection]);

  const funnelSteps = [
    {
      label: "Pairs Evaluated",
      count: funnel.pairsEvaluated,
      rate: null as number | null,
    },
    {
      label: "Proposals Generated",
      count: funnel.proposalsGenerated,
      rate:
        funnel.pairsEvaluated > 0
          ? funnel.proposalsGenerated / funnel.pairsEvaluated
          : null,
    },
    {
      label: "At Least One Interested Swipe",
      count: funnel.proposalsWithInterestedSwipe,
      rate:
        funnel.proposalsGenerated > 0
          ? funnel.proposalsWithInterestedSwipe / funnel.proposalsGenerated
          : null,
    },
    {
      label: "Mutual Matches",
      count: funnel.mutualMatches,
      rate:
        funnel.proposalsWithInterestedSwipe > 0
          ? funnel.mutualMatches / funnel.proposalsWithInterestedSwipe
          : null,
    },
  ];

  return (
    <div className="space-y-8">
      {/* Summary Cards */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <div className="rounded-lg border border-gray-200 bg-white p-5 shadow-sm">
          <p className="text-sm font-medium text-gray-500">Total Users</p>
          <p className="mt-1 text-3xl font-bold text-gray-900">
            {summary.totalUsers}
          </p>
          <p className="mt-1 text-xs text-gray-400">
            {summary.claimedUsers} claimed, {summary.seededUsers} seeded
          </p>
        </div>
        <div className="rounded-lg border border-gray-200 bg-white p-5 shadow-sm">
          <p className="text-sm font-medium text-gray-500">
            Total Proposals
          </p>
          <p className="mt-1 text-3xl font-bold text-gray-900">
            {summary.totalProposals}
          </p>
        </div>
        <div className="rounded-lg border border-gray-200 bg-white p-5 shadow-sm">
          <p className="text-sm font-medium text-gray-500">
            Total Matches
          </p>
          <p className="mt-1 text-3xl font-bold text-gray-900">
            {summary.totalMatches}
          </p>
        </div>
        <div className="rounded-lg border border-gray-200 bg-white p-5 shadow-sm">
          <p className="text-sm font-medium text-gray-500">
            Generation Rate
          </p>
          <p className="mt-1 text-3xl font-bold text-gray-900">
            {formatRate(summary.generationRate)}
          </p>
          <p className="mt-1 text-xs text-gray-400">
            pairs with proposals / pairs evaluated
          </p>
        </div>
      </div>

      {/* Funnel Visualization */}
      <div className="rounded-lg border border-gray-200 bg-white p-5 shadow-sm">
        <h3 className="text-lg font-semibold text-gray-900 mb-4">
          Matching Funnel
        </h3>
        <div className="space-y-3">
          {funnelSteps.map((step, i) => (
            <div key={step.label} className="flex items-center gap-4">
              <div className="flex-1">
                <div className="flex items-center gap-2">
                  {i > 0 && (
                    <span className="text-gray-300 text-sm" aria-hidden="true">
                      {"->"}
                    </span>
                  )}
                  <span className="text-sm font-medium text-gray-700">
                    {step.label}
                  </span>
                </div>
              </div>
              <div className="flex items-center gap-3">
                <span className="text-lg font-bold text-gray-900 tabular-nums min-w-[3rem] text-right">
                  {step.count}
                </span>
                {step.rate !== null && (
                  <span className="text-sm text-gray-500 min-w-[4rem] text-right">
                    {formatPercent(step.rate)}
                  </span>
                )}
                {step.rate === null && i > 0 && (
                  <span className="text-sm text-gray-400 min-w-[4rem] text-right">
                    N/A
                  </span>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Matching Results Table */}
      <div>
        <h3 className="text-lg font-semibold text-gray-900 mb-4">
          Matching Results
        </h3>

        {/* Filter */}
        <div className="mb-4 flex flex-wrap items-end gap-4">
          <div>
            <label
              htmlFor="outcome-filter"
              className="block text-xs font-medium text-gray-500 mb-1"
            >
              Outcome
            </label>
            <select
              id="outcome-filter"
              value={outcomeFilter}
              onChange={(e) =>
                setOutcomeFilter(e.target.value as OutcomeFilter)
              }
              className="rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm text-gray-700"
            >
              <option value="all">All</option>
              <option value="proposals_generated">Proposals Generated</option>
              <option value="no_proposal">No Proposal</option>
            </select>
          </div>
          {outcomeFilter !== "all" && (
            <button
              onClick={() => setOutcomeFilter("all")}
              className="rounded-md px-3 py-1.5 text-sm text-gray-500 hover:text-gray-700 hover:bg-gray-100"
            >
              Clear filters
            </button>
          )}
        </div>

        {/* Results count */}
        <p className="mb-2 text-xs text-gray-400">
          {`Showing ${filteredAndSorted.length} of ${matchingResults.length} result${matchingResults.length !== 1 ? "s" : ""}`}
        </p>

        {/* Table */}
        <div className="overflow-x-auto rounded-lg border border-gray-200 bg-white shadow-sm">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Researcher A
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Researcher B
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Outcome
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Profile Ver A
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Profile Ver B
                </th>
                <th
                  onClick={() =>
                    setSortDirection((d) => (d === "asc" ? "desc" : "asc"))
                  }
                  className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider cursor-pointer select-none hover:text-gray-700"
                >
                  Evaluated{" "}
                  <span className="ml-1">
                    {sortDirection === "asc" ? "\u2191" : "\u2193"}
                  </span>
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {filteredAndSorted.length === 0 ? (
                <tr>
                  <td
                    colSpan={6}
                    className="px-4 py-12 text-center text-sm text-gray-400"
                  >
                    No matching results found.
                  </td>
                </tr>
              ) : (
                filteredAndSorted.map((result) => (
                  <tr
                    key={result.id}
                    className="hover:bg-gray-50 transition-colors"
                  >
                    <td className="px-4 py-3 text-sm font-medium text-gray-900 whitespace-nowrap">
                      <a
                        href={`/admin/users/${result.researcherA.id}`}
                        onClick={(e) => {
                          e.preventDefault();
                          router.push(
                            `/admin/users/${result.researcherA.id}`,
                          );
                        }}
                        className="text-blue-600 hover:text-blue-800 hover:underline"
                      >
                        {result.researcherA.name}
                      </a>
                    </td>
                    <td className="px-4 py-3 text-sm font-medium text-gray-900 whitespace-nowrap">
                      <a
                        href={`/admin/users/${result.researcherB.id}`}
                        onClick={(e) => {
                          e.preventDefault();
                          router.push(
                            `/admin/users/${result.researcherB.id}`,
                          );
                        }}
                        className="text-blue-600 hover:text-blue-800 hover:underline"
                      >
                        {result.researcherB.name}
                      </a>
                    </td>
                    <td className="px-4 py-3 text-sm whitespace-nowrap">
                      <span
                        className={`inline-block rounded-full px-2.5 py-0.5 text-xs font-medium ${OUTCOME_COLORS[result.outcome] ?? ""}`}
                      >
                        {OUTCOME_LABELS[result.outcome] ?? result.outcome}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-sm text-gray-700 whitespace-nowrap tabular-nums">
                      v{result.profileVersionA}
                    </td>
                    <td className="px-4 py-3 text-sm text-gray-700 whitespace-nowrap tabular-nums">
                      v{result.profileVersionB}
                    </td>
                    <td className="px-4 py-3 text-sm text-gray-500 whitespace-nowrap">
                      {formatDate(result.evaluatedAt)}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
