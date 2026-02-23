/**
 * Admin Proposals Table — interactive client component for the Proposals Overview page.
 *
 * Receives all proposal data from the server component and provides:
 * - Filters: confidence tier, match status, swipe status, visibility state
 * - Sortable columns: click header to toggle asc/desc
 * - Row click → navigate to /admin/proposals/[id] (proposal detail page)
 *
 * All filtering and sorting is client-side (no pagination in v1, pilot scale).
 * Spec reference: specs/admin-dashboard.md, "Proposals Overview" section.
 */

"use client";

import { useState, useMemo } from "react";
import { useRouter } from "next/navigation";
import type { AdminProposal } from "@/app/admin/proposals/page";

type SortField =
  | "researcherA"
  | "researcherB"
  | "title"
  | "collaborationType"
  | "confidenceTier"
  | "matched"
  | "createdAt";

type SortDirection = "asc" | "desc";

type ConfidenceTierFilter = "all" | "high" | "moderate" | "speculative";
type MatchStatusFilter = "all" | "matched" | "unmatched";
type SwipeStatusFilter = "all" | "both_swiped" | "one_swiped" | "neither_swiped";
type VisibilityFilter = "all" | "visible" | "pending_other_interest" | "hidden";

const CONFIDENCE_TIER_LABELS: Record<string, string> = {
  high: "High",
  moderate: "Moderate",
  speculative: "Speculative",
};

const CONFIDENCE_TIER_COLORS: Record<string, string> = {
  high: "bg-emerald-100 text-emerald-700",
  moderate: "bg-amber-100 text-amber-700",
  speculative: "bg-gray-100 text-gray-700",
};

const VISIBILITY_LABELS: Record<string, string> = {
  visible: "Visible",
  pending_other_interest: "Pending",
  hidden: "Hidden",
};

const VISIBILITY_COLORS: Record<string, string> = {
  visible: "bg-emerald-100 text-emerald-700",
  pending_other_interest: "bg-amber-100 text-amber-700",
  hidden: "bg-gray-100 text-gray-700",
};

const SWIPE_LABELS: Record<string, string> = {
  interested: "Interested",
  archive: "Archive",
};

const SWIPE_COLORS: Record<string, string> = {
  interested: "text-emerald-600",
  archive: "text-gray-400",
};

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}

function formatCollaborationType(type: string): string {
  return type
    .split("_")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

interface ProposalsTableProps {
  proposals: AdminProposal[];
}

export function ProposalsTable({ proposals }: ProposalsTableProps) {
  const router = useRouter();
  const [confidenceTierFilter, setConfidenceTierFilter] = useState<ConfidenceTierFilter>("all");
  const [matchStatusFilter, setMatchStatusFilter] = useState<MatchStatusFilter>("all");
  const [swipeStatusFilter, setSwipeStatusFilter] = useState<SwipeStatusFilter>("all");
  const [visibilityFilter, setVisibilityFilter] = useState<VisibilityFilter>("all");
  const [sortField, setSortField] = useState<SortField>("createdAt");
  const [sortDirection, setSortDirection] = useState<SortDirection>("desc");

  const filteredAndSorted = useMemo(() => {
    let result = [...proposals];

    // Apply filters
    if (confidenceTierFilter !== "all") {
      result = result.filter((p) => p.confidenceTier === confidenceTierFilter);
    }
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
    if (visibilityFilter !== "all") {
      result = result.filter(
        (p) => p.visibilityA === visibilityFilter || p.visibilityB === visibilityFilter,
      );
    }

    // Apply sorting
    result.sort((a, b) => {
      let cmp = 0;
      switch (sortField) {
        case "researcherA":
          cmp = a.researcherA.name.localeCompare(b.researcherA.name);
          break;
        case "researcherB":
          cmp = a.researcherB.name.localeCompare(b.researcherB.name);
          break;
        case "title":
          cmp = a.title.localeCompare(b.title);
          break;
        case "collaborationType":
          cmp = a.collaborationType.localeCompare(b.collaborationType);
          break;
        case "confidenceTier": {
          const tierOrder = { high: 0, moderate: 1, speculative: 2 };
          cmp = (tierOrder[a.confidenceTier] ?? 3) - (tierOrder[b.confidenceTier] ?? 3);
          break;
        }
        case "matched":
          cmp = (a.matched ? 1 : 0) - (b.matched ? 1 : 0);
          break;
        case "createdAt":
          cmp = new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
          break;
      }
      return sortDirection === "asc" ? cmp : -cmp;
    });

    return result;
  }, [proposals, confidenceTierFilter, matchStatusFilter, swipeStatusFilter, visibilityFilter, sortField, sortDirection]);

  function handleSort(field: SortField) {
    if (sortField === field) {
      setSortDirection((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortField(field);
      setSortDirection("asc");
    }
  }

  const hasActiveFilters =
    confidenceTierFilter !== "all" ||
    matchStatusFilter !== "all" ||
    swipeStatusFilter !== "all" ||
    visibilityFilter !== "all";

  return (
    <div>
      {/* Filters */}
      <div className="mb-4 flex flex-wrap items-end gap-4">
        <div>
          <label
            htmlFor="confidence-tier-filter"
            className="block text-xs font-medium text-gray-500 mb-1"
          >
            Confidence Tier
          </label>
          <select
            id="confidence-tier-filter"
            value={confidenceTierFilter}
            onChange={(e) => setConfidenceTierFilter(e.target.value as ConfidenceTierFilter)}
            className="rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm text-gray-700"
          >
            <option value="all">All</option>
            <option value="high">High</option>
            <option value="moderate">Moderate</option>
            <option value="speculative">Speculative</option>
          </select>
        </div>
        <div>
          <label
            htmlFor="match-status-filter"
            className="block text-xs font-medium text-gray-500 mb-1"
          >
            Match Status
          </label>
          <select
            id="match-status-filter"
            value={matchStatusFilter}
            onChange={(e) => setMatchStatusFilter(e.target.value as MatchStatusFilter)}
            className="rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm text-gray-700"
          >
            <option value="all">All</option>
            <option value="matched">Matched</option>
            <option value="unmatched">Unmatched</option>
          </select>
        </div>
        <div>
          <label
            htmlFor="swipe-status-filter"
            className="block text-xs font-medium text-gray-500 mb-1"
          >
            Swipe Status
          </label>
          <select
            id="swipe-status-filter"
            value={swipeStatusFilter}
            onChange={(e) => setSwipeStatusFilter(e.target.value as SwipeStatusFilter)}
            className="rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm text-gray-700"
          >
            <option value="all">All</option>
            <option value="both_swiped">Both Swiped</option>
            <option value="one_swiped">One Swiped</option>
            <option value="neither_swiped">Neither Swiped</option>
          </select>
        </div>
        <div>
          <label
            htmlFor="visibility-filter"
            className="block text-xs font-medium text-gray-500 mb-1"
          >
            Visibility
          </label>
          <select
            id="visibility-filter"
            value={visibilityFilter}
            onChange={(e) => setVisibilityFilter(e.target.value as VisibilityFilter)}
            className="rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm text-gray-700"
          >
            <option value="all">All</option>
            <option value="visible">Visible</option>
            <option value="pending_other_interest">Pending Other Interest</option>
            <option value="hidden">Hidden</option>
          </select>
        </div>
        {hasActiveFilters && (
          <button
            onClick={() => {
              setConfidenceTierFilter("all");
              setMatchStatusFilter("all");
              setSwipeStatusFilter("all");
              setVisibilityFilter("all");
            }}
            className="rounded-md px-3 py-1.5 text-sm text-gray-500 hover:text-gray-700 hover:bg-gray-100"
          >
            Clear filters
          </button>
        )}
      </div>

      {/* Results count */}
      <p className="mb-2 text-xs text-gray-400">
        {`Showing ${filteredAndSorted.length} of ${proposals.length} proposal${proposals.length !== 1 ? "s" : ""}`}
      </p>

      {/* Table */}
      <div className="overflow-x-auto rounded-lg border border-gray-200 bg-white shadow-sm">
        <table className="min-w-full divide-y divide-gray-200">
          <thead className="bg-gray-50">
            <tr>
              <SortableHeader
                label="Researcher A"
                field="researcherA"
                current={sortField}
                direction={sortDirection}
                onClick={handleSort}
              />
              <SortableHeader
                label="Researcher B"
                field="researcherB"
                current={sortField}
                direction={sortDirection}
                onClick={handleSort}
              />
              <SortableHeader
                label="Title"
                field="title"
                current={sortField}
                direction={sortDirection}
                onClick={handleSort}
              />
              <SortableHeader
                label="Type"
                field="collaborationType"
                current={sortField}
                direction={sortDirection}
                onClick={handleSort}
              />
              <SortableHeader
                label="Confidence"
                field="confidenceTier"
                current={sortField}
                direction={sortDirection}
                onClick={handleSort}
              />
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                Vis A
              </th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                Vis B
              </th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                Swipe A
              </th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                Swipe B
              </th>
              <SortableHeader
                label="Matched"
                field="matched"
                current={sortField}
                direction={sortDirection}
                onClick={handleSort}
              />
              <SortableHeader
                label="Created"
                field="createdAt"
                current={sortField}
                direction={sortDirection}
                onClick={handleSort}
              />
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {filteredAndSorted.length === 0 ? (
              <tr>
                <td
                  colSpan={11}
                  className="px-4 py-12 text-center text-sm text-gray-400"
                >
                  No proposals match the current filters.
                </td>
              </tr>
            ) : (
              filteredAndSorted.map((proposal) => (
                <tr
                  key={proposal.id}
                  onClick={() => router.push(`/admin/proposals/${proposal.id}`)}
                  className="cursor-pointer hover:bg-gray-50 transition-colors"
                >
                  <td className="px-4 py-3 text-sm font-medium text-gray-900 whitespace-nowrap">
                    <a
                      href={`/admin/users/${proposal.researcherA.id}`}
                      onClick={(e) => e.stopPropagation()}
                      className="text-blue-600 hover:text-blue-800 hover:underline"
                    >
                      {proposal.researcherA.name}
                    </a>
                  </td>
                  <td className="px-4 py-3 text-sm font-medium text-gray-900 whitespace-nowrap">
                    <a
                      href={`/admin/users/${proposal.researcherB.id}`}
                      onClick={(e) => e.stopPropagation()}
                      className="text-blue-600 hover:text-blue-800 hover:underline"
                    >
                      {proposal.researcherB.name}
                    </a>
                  </td>
                  <td className="px-4 py-3 text-sm text-gray-700 max-w-xs truncate" title={proposal.title}>
                    {proposal.title}
                  </td>
                  <td className="px-4 py-3 text-sm text-gray-700 whitespace-nowrap">
                    {formatCollaborationType(proposal.collaborationType)}
                  </td>
                  <td className="px-4 py-3 text-sm whitespace-nowrap">
                    <span
                      className={`inline-block rounded-full px-2.5 py-0.5 text-xs font-medium ${CONFIDENCE_TIER_COLORS[proposal.confidenceTier] ?? ""}`}
                    >
                      {CONFIDENCE_TIER_LABELS[proposal.confidenceTier] ?? proposal.confidenceTier}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-sm whitespace-nowrap">
                    <span
                      className={`inline-block rounded-full px-2.5 py-0.5 text-xs font-medium ${VISIBILITY_COLORS[proposal.visibilityA] ?? ""}`}
                    >
                      {VISIBILITY_LABELS[proposal.visibilityA] ?? proposal.visibilityA}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-sm whitespace-nowrap">
                    <span
                      className={`inline-block rounded-full px-2.5 py-0.5 text-xs font-medium ${VISIBILITY_COLORS[proposal.visibilityB] ?? ""}`}
                    >
                      {VISIBILITY_LABELS[proposal.visibilityB] ?? proposal.visibilityB}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-sm whitespace-nowrap">
                    {proposal.swipeA ? (
                      <span className={SWIPE_COLORS[proposal.swipeA] ?? ""}>
                        {SWIPE_LABELS[proposal.swipeA] ?? proposal.swipeA}
                      </span>
                    ) : (
                      <span className="text-gray-300">{"\u2014"}</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-sm whitespace-nowrap">
                    {proposal.swipeB ? (
                      <span className={SWIPE_COLORS[proposal.swipeB] ?? ""}>
                        {SWIPE_LABELS[proposal.swipeB] ?? proposal.swipeB}
                      </span>
                    ) : (
                      <span className="text-gray-300">{"\u2014"}</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-sm whitespace-nowrap">
                    {proposal.matched ? (
                      <span className="text-emerald-600 font-medium">Yes</span>
                    ) : (
                      <span className="text-gray-400">No</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-sm text-gray-500 whitespace-nowrap">
                    {formatDate(proposal.createdAt)}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function SortableHeader({
  label,
  field,
  current,
  direction,
  onClick,
}: {
  label: string;
  field: SortField;
  current: SortField;
  direction: SortDirection;
  onClick: (field: SortField) => void;
}) {
  const isActive = current === field;
  return (
    <th
      onClick={() => onClick(field)}
      className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider cursor-pointer select-none hover:text-gray-700"
    >
      {label}
      {isActive && (
        <span className="ml-1">{direction === "asc" ? "\u2191" : "\u2193"}</span>
      )}
    </th>
  );
}
