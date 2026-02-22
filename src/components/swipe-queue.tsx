/**
 * SwipeQueue — Main swipe queue interface showing collaboration proposals.
 *
 * Displays proposals one at a time as summary cards, ordered by confidence
 * tier (high → moderate → speculative) then recency. Each card shows the
 * collaborator's name/institution, collaboration type, tailored one-line
 * summary, confidence tier indicator, and "Updated proposal" badge.
 *
 * Handles all empty states per spec:
 * - No proposals + match pool populated → "generating proposals"
 * - No proposals + empty match pool → "add colleagues"
 * - All proposals reviewed → "reviewed all current proposals"
 *
 * Spec reference: specs/swipe-interface.md
 */

"use client";

import { useCallback, useEffect, useState } from "react";
import { useSession } from "next-auth/react";

export interface ProposalCard {
  id: string;
  title: string;
  collaborationType: string;
  oneLineSummary: string;
  confidenceTier: "high" | "moderate" | "speculative";
  isUpdated: boolean;
  createdAt: string;
  collaborator: {
    id: string;
    name: string;
    institution: string;
    department: string | null;
  };
}

interface ProposalQueueData {
  proposals: ProposalCard[];
  totalCount: number;
}

/** Visual styling for each confidence tier. */
function confidenceTierStyle(tier: ProposalCard["confidenceTier"]): {
  dotClass: string;
  label: string;
} {
  switch (tier) {
    case "high":
      return { dotClass: "bg-emerald-500", label: "High confidence" };
    case "moderate":
      return { dotClass: "bg-amber-500", label: "Moderate confidence" };
    case "speculative":
      return { dotClass: "bg-purple-500", label: "Speculative" };
  }
}

interface SwipeQueueProps {
  /** Whether the user has any match pool entries. Drives empty state messaging. */
  hasMatchPool: boolean;
}

export function SwipeQueue({ hasMatchPool }: SwipeQueueProps) {
  const { status: sessionStatus } = useSession();
  const [data, setData] = useState<ProposalQueueData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [currentIndex, setCurrentIndex] = useState(0);

  const fetchProposals = useCallback(async () => {
    try {
      const res = await fetch("/api/proposals");
      if (!res.ok) {
        throw new Error("Failed to load proposals");
      }
      const queueData = (await res.json()) as ProposalQueueData;
      setData(queueData);
      setError(null);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to load proposals",
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (sessionStatus !== "authenticated") return;
    fetchProposals();
  }, [sessionStatus, fetchProposals]);

  if (sessionStatus === "loading" || loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <p className="animate-pulse text-gray-400">
          Loading proposals...
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
            fetchProposals();
          }}
          className="mt-4 rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
        >
          Retry
        </button>
      </div>
    );
  }

  const proposals = data?.proposals ?? [];
  const totalCount = data?.totalCount ?? 0;

  // Empty state: no proposals available
  if (totalCount === 0) {
    return <EmptyState hasMatchPool={hasMatchPool} />;
  }

  // Current card to display (clamped to bounds)
  const safeIndex = Math.min(currentIndex, totalCount - 1);
  const currentProposal = proposals[safeIndex] as ProposalCard | undefined;

  if (!currentProposal) {
    return <EmptyState hasMatchPool={hasMatchPool} />;
  }

  return (
    <div className="w-full max-w-lg mx-auto">
      {/* Queue counter */}
      <div className="mb-4 text-center">
        <span className="text-sm text-gray-500">
          {safeIndex + 1} of {totalCount}{" "}
          {totalCount === 1 ? "proposal" : "proposals"}
        </span>
      </div>

      {/* Error banner */}
      {error && data && (
        <div className="mb-4 rounded-md bg-red-50 p-3">
          <p className="text-sm text-red-700">{error}</p>
        </div>
      )}

      {/* Summary Card */}
      <ProposalSummaryCard proposal={currentProposal} />

      {/* Navigation for browsing queue (temporary, swipe actions will replace this) */}
      {totalCount > 1 && (
        <div className="mt-4 flex items-center justify-center gap-4">
          <button
            onClick={() => setCurrentIndex(Math.max(0, safeIndex - 1))}
            disabled={safeIndex === 0}
            className="rounded-md px-3 py-1.5 text-sm font-medium text-gray-600 hover:bg-gray-100 disabled:opacity-30 disabled:cursor-not-allowed"
          >
            Previous
          </button>
          <button
            onClick={() =>
              setCurrentIndex(Math.min(totalCount - 1, safeIndex + 1))
            }
            disabled={safeIndex === totalCount - 1}
            className="rounded-md px-3 py-1.5 text-sm font-medium text-gray-600 hover:bg-gray-100 disabled:opacity-30 disabled:cursor-not-allowed"
          >
            Next
          </button>
        </div>
      )}
    </div>
  );
}

/** A single proposal summary card — scannable in 10-15 seconds per spec. */
function ProposalSummaryCard({ proposal }: { proposal: ProposalCard }) {
  const tierStyle = confidenceTierStyle(proposal.confidenceTier);

  return (
    <div className="rounded-xl bg-white shadow-md border border-gray-200 overflow-hidden">
      {/* Updated badge */}
      {proposal.isUpdated && (
        <div className="bg-blue-50 px-4 py-1.5 text-xs font-medium text-blue-700 border-b border-blue-100">
          Updated proposal
        </div>
      )}

      <div className="p-5">
        {/* Collaborator info */}
        <div className="mb-3">
          <h3 className="text-lg font-semibold text-gray-900">
            {proposal.collaborator.name}
          </h3>
          <p className="text-sm text-gray-500">
            {proposal.collaborator.institution}
            {proposal.collaborator.department && (
              <span> &middot; {proposal.collaborator.department}</span>
            )}
          </p>
        </div>

        {/* Collaboration type */}
        <div className="mb-3">
          <span className="inline-block rounded-full bg-gray-100 px-3 py-1 text-xs font-medium text-gray-700">
            {proposal.collaborationType}
          </span>
        </div>

        {/* One-line summary — the core of the card */}
        <p className="text-sm text-gray-800 leading-relaxed mb-4">
          {proposal.oneLineSummary}
        </p>

        {/* Confidence tier indicator and title */}
        <div className="flex items-center justify-between">
          <p className="text-xs text-gray-400 truncate max-w-[70%]">
            {proposal.title}
          </p>
          <div className="flex items-center gap-1.5 flex-shrink-0">
            <span
              className={`inline-block h-2 w-2 rounded-full ${tierStyle.dotClass}`}
              title={tierStyle.label}
            />
            <span className="text-xs text-gray-400">{tierStyle.label}</span>
          </div>
        </div>
      </div>
    </div>
  );
}

/** Empty state messaging based on user context per spec. */
function EmptyState({ hasMatchPool }: { hasMatchPool: boolean }) {
  if (!hasMatchPool) {
    return (
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
            d="M18 18.72a9.094 9.094 0 003.741-.479 3 3 0 00-4.682-2.72m.94 3.198l.001.031c0 .225-.012.447-.037.666A11.944 11.944 0 0112 21c-2.17 0-4.207-.576-5.963-1.584A6.062 6.062 0 016 18.719m12 0a5.971 5.971 0 00-.941-3.197m0 0A5.995 5.995 0 0012 12.75a5.995 5.995 0 00-5.058 2.772m0 0a3 3 0 00-4.681 2.72 8.986 8.986 0 003.74.477m.94-3.197a5.971 5.971 0 00-.94 3.197M15 6.75a3 3 0 11-6 0 3 3 0 016 0zm6 3a2.25 2.25 0 11-4.5 0 2.25 2.25 0 014.5 0zm-13.5 0a2.25 2.25 0 11-4.5 0 2.25 2.25 0 014.5 0z"
          />
        </svg>
        <h3 className="mt-4 text-lg font-medium text-gray-900">
          Add colleagues to your network
        </h3>
        <p className="mt-2 text-sm text-gray-500">
          Add colleagues to your network to start seeing collaboration
          proposals.
        </p>
      </div>
    );
  }

  return (
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
          d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09zM18.259 8.715L18 9.75l-.259-1.035a3.375 3.375 0 00-2.455-2.456L14.25 6l1.036-.259a3.375 3.375 0 002.455-2.456L18 2.25l.259 1.035a3.375 3.375 0 002.455 2.456L21.75 6l-1.036.259a3.375 3.375 0 00-2.455 2.456zM16.894 20.567L16.5 21.75l-.394-1.183a2.25 2.25 0 00-1.423-1.423L13.5 18.75l1.183-.394a2.25 2.25 0 001.423-1.423l.394-1.183.394 1.183a2.25 2.25 0 001.423 1.423l1.183.394-1.183.394a2.25 2.25 0 00-1.423 1.423z"
        />
      </svg>
      <h3 className="mt-4 text-lg font-medium text-gray-900">
        Generating proposals for you
      </h3>
      <p className="mt-2 text-sm text-gray-500">
        We&apos;re generating collaboration proposals for you. Check back soon.
      </p>
    </div>
  );
}
