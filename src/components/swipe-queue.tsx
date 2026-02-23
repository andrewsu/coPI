/**
 * SwipeQueue — Main swipe queue interface showing collaboration proposals.
 *
 * Displays proposals one at a time as summary cards, ordered by confidence
 * tier (high -> moderate -> speculative) then recency. Each card shows the
 * collaborator's name/institution, collaboration type, tailored one-line
 * summary, confidence tier indicator, and "Updated proposal" badge.
 *
 * Users can tap "See details" to expand the card and view the full proposal
 * including scientific question, rationale, contributions, benefits, first
 * experiment, anchoring publications, and collaborator profile.
 *
 * Swipe actions:
 * - "Interested" (green): records interested swipe, checks for mutual match
 * - "Archive" (gray): moves proposal to archive for later review
 *
 * Handles all empty states per spec:
 * - No proposals + match pool populated -> "generating proposals"
 * - No proposals + empty match pool -> "add colleagues"
 * - All proposals reviewed -> "reviewed all current proposals"
 *
 * Spec reference: specs/swipe-interface.md
 */

"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useSession } from "next-auth/react";
import { SurveyModal } from "@/components/survey-modal";

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

/** Full proposal detail returned by GET /api/proposals/[id]. */
export interface ProposalDetailData {
  id: string;
  title: string;
  collaborationType: string;
  oneLineSummary: string;
  confidenceTier: "high" | "moderate" | "speculative";
  isUpdated: boolean;
  createdAt: string;
  scientificQuestion: string;
  detailedRationale: string;
  yourContributions: string;
  theirContributions: string;
  yourBenefits: string;
  theirBenefits: string;
  proposedFirstExperiment: string;
  anchoringPublications: Array<{
    id: string;
    pmid: string | null;
    title: string;
    journal: string;
    year: number;
    authorPosition: string;
  }>;
  collaborator: {
    id: string;
    name: string;
    institution: string;
    department: string | null;
    profile: {
      researchSummary: string;
      techniques: string[];
      experimentalModels: string[];
      diseaseAreas: string[];
      keyTargets: string[];
      grantTitles: string[];
    } | null;
    publications: Array<{
      id: string;
      pmid: string | null;
      title: string;
      journal: string;
      year: number;
      authorPosition: string;
    }>;
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
  const [expandedProposalId, setExpandedProposalId] = useState<string | null>(
    null
  );
  const [swiping, setSwiping] = useState(false);
  const [matchBanner, setMatchBanner] = useState<string | null>(null);
  // Track whether the user has swiped at least once this session (distinguishes
  // "all proposals reviewed" from "no proposals ever generated")
  const [hasSwiped, setHasSwiped] = useState(false);
  // Track whether the user expanded details for the current card
  const [viewedDetailIds, setViewedDetailIds] = useState<Set<string>>(
    new Set()
  );
  // Track when each card was first shown (for timeSpentMs analytics)
  const cardShownAtRef = useRef<Map<string, number>>(new Map());
  // Show periodic quality survey after Nth archive per spec
  const [showSurvey, setShowSurvey] = useState(false);

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
        err instanceof Error ? err.message : "Failed to load proposals"
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (sessionStatus !== "authenticated") return;
    fetchProposals();
  }, [sessionStatus, fetchProposals]);

  // Record when a card is first shown (for time_spent_ms tracking)
  const proposals = data?.proposals ?? [];
  const totalCount = data?.totalCount ?? 0;
  const safeIndex = Math.min(currentIndex, Math.max(0, totalCount - 1));
  const currentProposal = proposals[safeIndex] as ProposalCard | undefined;

  useEffect(() => {
    if (currentProposal && !cardShownAtRef.current.has(currentProposal.id)) {
      cardShownAtRef.current.set(currentProposal.id, Date.now());
    }
  }, [currentProposal]);

  const handleSwipe = useCallback(
    async (direction: "interested" | "archive") => {
      if (!currentProposal || swiping) return;

      const proposalId = currentProposal.id;
      const viewedDetail = viewedDetailIds.has(proposalId);
      const shownAt = cardShownAtRef.current.get(proposalId);
      const timeSpentMs = shownAt ? Date.now() - shownAt : undefined;

      setSwiping(true);
      setError(null);

      try {
        const res = await fetch(`/api/proposals/${proposalId}/swipe`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ direction, viewedDetail, timeSpentMs }),
        });

        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          throw new Error(
            (err as { error?: string }).error || "Failed to record swipe"
          );
        }

        const result = (await res.json()) as {
          matched: boolean;
          matchId?: string;
          showSurvey?: boolean;
        };

        // Mark that the user has swiped during this session
        setHasSwiped(true);

        // Clean up tracking for this card
        cardShownAtRef.current.delete(proposalId);
        setViewedDetailIds((prev) => {
          const next = new Set(prev);
          next.delete(proposalId);
          return next;
        });

        // Remove the swiped proposal from the local queue
        setData((prev) => {
          if (!prev) return prev;
          const remaining = prev.proposals.filter((p) => p.id !== proposalId);
          return { proposals: remaining, totalCount: remaining.length };
        });

        // Collapse detail view
        setExpandedProposalId(null);

        // Keep index in bounds (if we were at the end, go back one)
        setCurrentIndex((prev) => {
          const remainingCount = (data?.totalCount ?? 1) - 1;
          if (prev >= remainingCount) return Math.max(0, remainingCount - 1);
          return prev;
        });

        // Show match banner briefly if a match was created
        if (result.matched) {
          setMatchBanner(
            `Match! You and ${currentProposal.collaborator.name} are both interested.`
          );
          setTimeout(() => setMatchBanner(null), 5000);
        }

        // Show periodic survey after Nth archive per spec
        if (result.showSurvey) {
          setShowSurvey(true);
        }
      } catch (err) {
        setError(
          err instanceof Error ? err.message : "Failed to record swipe"
        );
      } finally {
        setSwiping(false);
      }
    },
    [currentProposal, swiping, viewedDetailIds, data?.totalCount]
  );

  // Track detail expansion for viewedDetail analytics
  const handleToggleDetail = useCallback(() => {
    if (!currentProposal) return;
    const proposalId = currentProposal.id;
    if (expandedProposalId === proposalId) {
      // Collapsing
      setExpandedProposalId(null);
    } else {
      // Expanding — mark as viewed
      setExpandedProposalId(proposalId);
      setViewedDetailIds((prev) => new Set(prev).add(proposalId));
    }
  }, [currentProposal, expandedProposalId]);

  if (sessionStatus === "loading" || loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <p className="animate-pulse text-gray-400">Loading proposals...</p>
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

  // Empty state: no proposals available
  if (totalCount === 0 || !currentProposal) {
    return (
      <div className="w-full max-w-lg mx-auto">
        {matchBanner && (
          <div className="mb-4 rounded-lg bg-emerald-50 border border-emerald-200 p-4 text-center">
            <p className="text-sm font-medium text-emerald-800">
              {matchBanner}
            </p>
          </div>
        )}
        <EmptyState hasMatchPool={hasMatchPool} reviewed={hasSwiped} />
        {showSurvey && (
          <SurveyModal onClose={() => setShowSurvey(false)} />
        )}
      </div>
    );
  }

  const isExpanded = expandedProposalId === currentProposal.id;

  return (
    <div className="w-full max-w-lg mx-auto">
      {/* Match banner */}
      {matchBanner && (
        <div className="mb-4 rounded-lg bg-emerald-50 border border-emerald-200 p-4 text-center">
          <p className="text-sm font-medium text-emerald-800">{matchBanner}</p>
        </div>
      )}

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
      <ProposalSummaryCard
        proposal={currentProposal}
        isExpanded={isExpanded}
        onToggleDetail={handleToggleDetail}
      />

      {/* Detail View — fetches and renders full proposal data */}
      {isExpanded && <ProposalDetailView proposalId={currentProposal.id} />}

      {/* Swipe action buttons */}
      <div className="mt-6 flex items-center justify-center gap-6">
        <button
          onClick={() => handleSwipe("archive")}
          disabled={swiping}
          className="flex items-center gap-2 rounded-full border-2 border-gray-300 bg-white px-6 py-3 text-sm font-medium text-gray-600 shadow-sm hover:bg-gray-50 hover:border-gray-400 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          aria-label="Archive proposal"
        >
          <svg
            className="h-5 w-5"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M6 18L18 6M6 6l12 12"
            />
          </svg>
          Archive
        </button>
        <button
          onClick={() => handleSwipe("interested")}
          disabled={swiping}
          className="flex items-center gap-2 rounded-full border-2 border-emerald-500 bg-emerald-500 px-6 py-3 text-sm font-medium text-white shadow-sm hover:bg-emerald-600 hover:border-emerald-600 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          aria-label="Interested in proposal"
        >
          <svg
            className="h-5 w-5"
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
          Interested
        </button>
      </div>

      {/* Periodic quality survey modal */}
      {showSurvey && (
        <SurveyModal onClose={() => setShowSurvey(false)} />
      )}
    </div>
  );
}

/** A single proposal summary card — scannable in 10-15 seconds per spec. */
export function ProposalSummaryCard({
  proposal,
  isExpanded,
  onToggleDetail,
}: {
  proposal: ProposalCard;
  isExpanded: boolean;
  onToggleDetail: () => void;
}) {
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
        <div className="flex items-center justify-between mb-4">
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

        {/* See details / Hide details button */}
        <button
          onClick={onToggleDetail}
          className="w-full rounded-md border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors"
        >
          {isExpanded ? "Hide details" : "See details"}
        </button>
      </div>
    </div>
  );
}

/**
 * ProposalDetailView — Fetches and renders full proposal detail.
 *
 * Loads data from GET /api/proposals/[id] and displays: scientific question,
 * rationale, contributions, benefits, first experiment, anchoring publications,
 * and collaborator's public profile. Designed to be readable in 1-2 minutes.
 */
export function ProposalDetailView({ proposalId }: { proposalId: string }) {
  const [detail, setDetail] = useState<ProposalDetailData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);

    fetch(`/api/proposals/${proposalId}`)
      .then((res) => {
        if (!res.ok) throw new Error("Failed to load proposal details");
        return res.json();
      })
      .then((data: ProposalDetailData) => {
        if (!cancelled) {
          setDetail(data);
          setLoading(false);
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setError(
            err instanceof Error
              ? err.message
              : "Failed to load proposal details"
          );
          setLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [proposalId]);

  if (loading) {
    return (
      <div className="mt-4 rounded-xl bg-white shadow-md border border-gray-200 p-6">
        <p className="animate-pulse text-gray-400 text-sm text-center">
          Loading details...
        </p>
      </div>
    );
  }

  if (error || !detail) {
    return (
      <div className="mt-4 rounded-xl bg-white shadow-md border border-gray-200 p-6">
        <p className="text-red-600 text-sm text-center">
          {error || "Failed to load details"}
        </p>
      </div>
    );
  }

  return (
    <div className="mt-4 rounded-xl bg-white shadow-md border border-gray-200 overflow-hidden">
      <div className="p-5 space-y-6">
        {/* Scientific Question */}
        <DetailSection title="Scientific Question">
          <p className="text-sm text-gray-800 leading-relaxed italic bg-blue-50 rounded-lg p-3">
            {detail.scientificQuestion}
          </p>
        </DetailSection>

        {/* Detailed Rationale */}
        <DetailSection title="Rationale">
          <p className="text-sm text-gray-700 leading-relaxed whitespace-pre-line">
            {detail.detailedRationale}
          </p>
        </DetailSection>

        {/* Contributions */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <DetailSection title="What you bring">
            <p className="text-sm text-gray-700 leading-relaxed">
              {detail.yourContributions}
            </p>
          </DetailSection>
          <DetailSection title="What they bring">
            <p className="text-sm text-gray-700 leading-relaxed">
              {detail.theirContributions}
            </p>
          </DetailSection>
        </div>

        {/* Benefits */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <DetailSection title="What you gain">
            <p className="text-sm text-gray-700 leading-relaxed">
              {detail.yourBenefits}
            </p>
          </DetailSection>
          <DetailSection title="What they gain">
            <p className="text-sm text-gray-700 leading-relaxed">
              {detail.theirBenefits}
            </p>
          </DetailSection>
        </div>

        {/* Proposed First Experiment */}
        <DetailSection title="Proposed First Experiment">
          <p className="text-sm text-gray-700 leading-relaxed">
            {detail.proposedFirstExperiment}
          </p>
        </DetailSection>

        {/* Anchoring Publications */}
        {detail.anchoringPublications.length > 0 && (
          <DetailSection title="Key Publications">
            <ul className="space-y-2">
              {detail.anchoringPublications.map((pub) => (
                <li key={pub.id} className="text-sm text-gray-700">
                  {pub.pmid ? (
                    <a
                      href={`https://pubmed.ncbi.nlm.nih.gov/${pub.pmid}/`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-blue-600 hover:text-blue-800 hover:underline"
                    >
                      {pub.title}
                    </a>
                  ) : (
                    <span>{pub.title}</span>
                  )}
                  <span className="text-gray-400 text-xs ml-1">
                    {pub.journal} ({pub.year})
                  </span>
                </li>
              ))}
            </ul>
          </DetailSection>
        )}

        {/* Collaborator Profile */}
        <CollaboratorProfileSection collaborator={detail.collaborator} />
      </div>
    </div>
  );
}

/** Reusable section wrapper with a title. */
function DetailSection({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <h4 className="text-sm font-semibold text-gray-900 mb-2">{title}</h4>
      {children}
    </div>
  );
}

/** Displays the collaborator's public profile in the detail view. */
function CollaboratorProfileSection({
  collaborator,
}: {
  collaborator: ProposalDetailData["collaborator"];
}) {
  if (!collaborator.profile) {
    return (
      <DetailSection title={`About ${collaborator.name}`}>
        <p className="text-sm text-gray-500 italic">
          Profile information is not available.
        </p>
      </DetailSection>
    );
  }

  const { profile, publications } = collaborator;

  return (
    <DetailSection title={`About ${collaborator.name}`}>
      <div className="space-y-3 rounded-lg bg-gray-50 p-4">
        {/* Research Summary */}
        <p className="text-sm text-gray-700 leading-relaxed">
          {profile.researchSummary}
        </p>

        {/* Techniques */}
        {profile.techniques.length > 0 && (
          <ProfileTagList label="Techniques" items={profile.techniques} />
        )}

        {/* Experimental Models */}
        {profile.experimentalModels.length > 0 && (
          <ProfileTagList
            label="Experimental models"
            items={profile.experimentalModels}
          />
        )}

        {/* Disease Areas */}
        {profile.diseaseAreas.length > 0 && (
          <ProfileTagList label="Disease areas" items={profile.diseaseAreas} />
        )}

        {/* Key Targets */}
        {profile.keyTargets.length > 0 && (
          <ProfileTagList label="Key targets" items={profile.keyTargets} />
        )}

        {/* Grant Titles */}
        {profile.grantTitles.length > 0 && (
          <div>
            <span className="text-xs font-medium text-gray-500 uppercase tracking-wide">
              Grants
            </span>
            <ul className="mt-1 list-disc list-inside">
              {profile.grantTitles.map((grant, i) => (
                <li key={i} className="text-sm text-gray-700">
                  {grant}
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* Publications */}
        {publications.length > 0 && (
          <div>
            <span className="text-xs font-medium text-gray-500 uppercase tracking-wide">
              Publications ({publications.length})
            </span>
            <ul className="mt-1 space-y-1">
              {publications.slice(0, 10).map((pub) => (
                <li key={pub.id} className="text-sm text-gray-700">
                  {pub.pmid ? (
                    <a
                      href={`https://pubmed.ncbi.nlm.nih.gov/${pub.pmid}/`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-blue-600 hover:text-blue-800 hover:underline"
                    >
                      {pub.title}
                    </a>
                  ) : (
                    <span>{pub.title}</span>
                  )}
                  <span className="text-gray-400 text-xs ml-1">
                    {pub.journal} ({pub.year})
                  </span>
                </li>
              ))}
              {publications.length > 10 && (
                <li className="text-xs text-gray-400 italic">
                  and {publications.length - 10} more...
                </li>
              )}
            </ul>
          </div>
        )}
      </div>
    </DetailSection>
  );
}

/** Renders a labeled row of inline tags for profile array fields. */
function ProfileTagList({
  label,
  items,
}: {
  label: string;
  items: string[];
}) {
  return (
    <div>
      <span className="text-xs font-medium text-gray-500 uppercase tracking-wide">
        {label}
      </span>
      <div className="mt-1 flex flex-wrap gap-1.5">
        {items.map((item, i) => (
          <span
            key={i}
            className="inline-block rounded-full bg-white border border-gray-200 px-2.5 py-0.5 text-xs text-gray-700"
          >
            {item}
          </span>
        ))}
      </div>
    </div>
  );
}

/**
 * Empty state messaging based on user context per spec.
 * Shows different messages depending on match pool status and whether
 * the user has reviewed all available proposals.
 */
function EmptyState({
  hasMatchPool,
  reviewed,
}: {
  hasMatchPool: boolean;
  reviewed?: boolean;
}) {
  // "All proposals reviewed" state — user has swiped through everything
  if (hasMatchPool && reviewed) {
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
            d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
          />
        </svg>
        <h3 className="mt-4 text-lg font-medium text-gray-900">
          All caught up
        </h3>
        <p className="mt-2 text-sm text-gray-500">
          You&apos;ve reviewed all current proposals. We&apos;ll notify you when
          new ones are available.
        </p>
      </div>
    );
  }

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
