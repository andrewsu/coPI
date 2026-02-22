/**
 * ArchiveTab — Shows all proposals the user has archived.
 *
 * Displays archived proposals sorted by most recently archived. Each card
 * shows the same summary view as the swipe queue, with detail expansion
 * and a "Move to Interested" button that triggers match-check logic.
 *
 * Per spec, moving to interested triggers the same match-check logic as
 * an initial interested swipe: if the other party already swiped interested,
 * a match is created immediately.
 *
 * Empty state: "No archived proposals yet."
 *
 * Spec reference: specs/swipe-interface.md, "Archive Tab" section.
 */

"use client";

import { useCallback, useEffect, useState } from "react";
import { useSession } from "next-auth/react";
import {
  ProposalSummaryCard,
  ProposalDetailView,
} from "@/components/swipe-queue";
import type { ProposalCard } from "@/components/swipe-queue";

interface ArchivedProposal extends ProposalCard {
  archivedAt: string;
}

interface ArchiveData {
  proposals: ArchivedProposal[];
  totalCount: number;
}

export function ArchiveTab() {
  const { status: sessionStatus } = useSession();
  const [data, setData] = useState<ArchiveData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expandedProposalId, setExpandedProposalId] = useState<string | null>(
    null
  );
  const [unarchiving, setUnarchiving] = useState<string | null>(null);
  const [matchBanner, setMatchBanner] = useState<string | null>(null);

  const fetchArchived = useCallback(async () => {
    try {
      const res = await fetch("/api/proposals/archived");
      if (!res.ok) {
        throw new Error("Failed to load archived proposals");
      }
      const archiveData = (await res.json()) as ArchiveData;
      setData(archiveData);
      setError(null);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to load archived proposals"
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (sessionStatus !== "authenticated") return;
    fetchArchived();
  }, [sessionStatus, fetchArchived]);

  const handleUnarchive = useCallback(
    async (proposalId: string, collaboratorName: string) => {
      if (unarchiving) return;

      setUnarchiving(proposalId);
      setError(null);

      try {
        const res = await fetch(`/api/proposals/${proposalId}/unarchive`, {
          method: "POST",
        });

        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          throw new Error(
            (err as { error?: string }).error || "Failed to move to interested"
          );
        }

        const result = (await res.json()) as {
          matched: boolean;
          matchId?: string;
        };

        // Remove the proposal from the archive list
        setData((prev) => {
          if (!prev) return prev;
          const remaining = prev.proposals.filter((p) => p.id !== proposalId);
          return { proposals: remaining, totalCount: remaining.length };
        });

        // Collapse detail if expanded
        if (expandedProposalId === proposalId) {
          setExpandedProposalId(null);
        }

        // Show match banner if a match was created
        if (result.matched) {
          setMatchBanner(
            `Match! You and ${collaboratorName} are both interested.`
          );
          setTimeout(() => setMatchBanner(null), 5000);
        }
      } catch (err) {
        setError(
          err instanceof Error ? err.message : "Failed to move to interested"
        );
      } finally {
        setUnarchiving(null);
      }
    },
    [unarchiving, expandedProposalId]
  );

  const handleToggleDetail = useCallback(
    (proposalId: string) => {
      setExpandedProposalId((prev) =>
        prev === proposalId ? null : proposalId
      );
    },
    []
  );

  if (sessionStatus === "loading" || loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <p className="animate-pulse text-gray-400">
          Loading archived proposals...
        </p>
      </div>
    );
  }

  if (error && !data) {
    return (
      <div className="flex flex-col items-center justify-center py-20">
        <p className="text-red-600 font-medium">{error}</p>
        <button
          onClick={() => {
            setLoading(true);
            setError(null);
            fetchArchived();
          }}
          className="mt-4 rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
        >
          Retry
        </button>
      </div>
    );
  }

  const proposals = data?.proposals ?? [];

  // Empty state per spec: "No archived proposals yet."
  if (proposals.length === 0) {
    return (
      <div className="w-full max-w-lg mx-auto">
        {matchBanner && (
          <div className="mb-4 rounded-lg bg-emerald-50 border border-emerald-200 p-4 text-center">
            <p className="text-sm font-medium text-emerald-800">
              {matchBanner}
            </p>
          </div>
        )}
        <div className="rounded-xl border-2 border-dashed border-gray-300 bg-white p-12 text-center">
          <svg
            className="mx-auto h-12 w-12 text-gray-400"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            aria-hidden="true"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={1.5}
              d="M20.25 7.5l-.625 10.632a2.25 2.25 0 01-2.247 2.118H6.622a2.25 2.25 0 01-2.247-2.118L3.75 7.5M10 11.25h4M3.375 7.5h17.25c.621 0 1.125-.504 1.125-1.125v-1.5c0-.621-.504-1.125-1.125-1.125H3.375c-.621 0-1.125.504-1.125 1.125v1.5c0 .621.504 1.125 1.125 1.125z"
            />
          </svg>
          <h3 className="mt-4 text-lg font-medium text-gray-900">
            No archived proposals yet
          </h3>
          <p className="mt-2 text-sm text-gray-500">
            Proposals you archive will appear here for later review.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="w-full max-w-lg mx-auto">
      {/* Match banner */}
      {matchBanner && (
        <div className="mb-4 rounded-lg bg-emerald-50 border border-emerald-200 p-4 text-center">
          <p className="text-sm font-medium text-emerald-800">{matchBanner}</p>
        </div>
      )}

      {/* Error banner */}
      {error && (
        <div className="mb-4 rounded-md bg-red-50 p-3">
          <p className="text-sm text-red-700">{error}</p>
        </div>
      )}

      {/* Count */}
      <div className="mb-4 text-center">
        <span className="text-sm text-gray-500">
          {proposals.length} archived{" "}
          {proposals.length === 1 ? "proposal" : "proposals"}
        </span>
      </div>

      {/* Archived proposals list */}
      <div className="space-y-4">
        {proposals.map((proposal) => {
          const isExpanded = expandedProposalId === proposal.id;
          const isUnarchiving = unarchiving === proposal.id;

          return (
            <div key={proposal.id}>
              <ProposalSummaryCard
                proposal={proposal}
                isExpanded={isExpanded}
                onToggleDetail={() => handleToggleDetail(proposal.id)}
              />

              {/* Detail View */}
              {isExpanded && (
                <ProposalDetailView proposalId={proposal.id} />
              )}

              {/* Move to Interested button */}
              <div className="mt-3 flex justify-center">
                <button
                  onClick={() =>
                    handleUnarchive(proposal.id, proposal.collaborator.name)
                  }
                  disabled={isUnarchiving}
                  className="flex items-center gap-2 rounded-full border-2 border-emerald-500 bg-emerald-500 px-5 py-2 text-sm font-medium text-white shadow-sm hover:bg-emerald-600 hover:border-emerald-600 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                  aria-label="Move to interested"
                >
                  <svg
                    className="h-4 w-4"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M5 13l4 4L19 7"
                    />
                  </svg>
                  {isUnarchiving ? "Moving..." : "Move to Interested"}
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
