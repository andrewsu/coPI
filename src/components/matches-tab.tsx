/**
 * MatchesTab — Shows all mutual matches with full proposal details and contact info.
 *
 * Displays matches sorted by most recent first. Each match shows:
 * - Full collaboration proposal (all detail fields)
 * - Both researchers' public profiles
 * - Contact information per email_visibility setting
 * - "Reach out to [name]" prompt
 * - Deleted account banner if applicable
 *
 * EXCLUDES user-submitted texts per spec.
 *
 * Empty state: "No matches yet. Keep reviewing proposals!"
 *
 * Spec reference: specs/swipe-interface.md, "Matches Tab" section.
 */

"use client";

import { useCallback, useEffect, useState } from "react";
import { useSession } from "next-auth/react";

interface PublicationData {
  id: string;
  pmid: string | null;
  title: string;
  journal: string;
  year: number;
  authorPosition: string;
}

interface ProfileData {
  researchSummary: string;
  techniques: string[];
  experimentalModels: string[];
  diseaseAreas: string[];
  keyTargets: string[];
  grantTitles: string[];
}

interface ResearcherData {
  id: string;
  name: string;
  institution: string;
  department: string | null;
  profile: ProfileData | null;
  publications: PublicationData[];
}

interface MatchProposal {
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
  anchoringPublications: PublicationData[];
}

interface MatchData {
  matchId: string;
  matchedAt: string;
  proposal: MatchProposal;
  collaborator: ResearcherData & {
    email: string | null;
    contactMessage: string | null;
  };
  yourProfile: ResearcherData;
}

interface MatchesResponse {
  matches: MatchData[];
  totalCount: number;
}

export function MatchesTab() {
  const { status: sessionStatus } = useSession();
  const [data, setData] = useState<MatchesResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expandedMatchId, setExpandedMatchId] = useState<string | null>(null);

  const fetchMatches = useCallback(async () => {
    try {
      const res = await fetch("/api/proposals/matches");
      if (!res.ok) {
        throw new Error("Failed to load matches");
      }
      const matchesData = (await res.json()) as MatchesResponse;
      setData(matchesData);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load matches");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (sessionStatus !== "authenticated") return;
    fetchMatches();
  }, [sessionStatus, fetchMatches]);

  const handleToggleExpand = useCallback((matchId: string) => {
    setExpandedMatchId((prev) => (prev === matchId ? null : matchId));
  }, []);

  if (sessionStatus === "loading" || loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <p className="animate-pulse text-gray-400">Loading matches...</p>
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
            fetchMatches();
          }}
          className="mt-4 rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
        >
          Retry
        </button>
      </div>
    );
  }

  const matches = data?.matches ?? [];

  // Empty state per spec: "No matches yet. Keep reviewing proposals!"
  if (matches.length === 0) {
    return (
      <div className="w-full max-w-lg mx-auto">
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
              d="M21 8.25c0-2.485-2.099-4.5-4.688-4.5-1.935 0-3.597 1.126-4.312 2.733-.715-1.607-2.377-2.733-4.313-2.733C5.1 3.75 3 5.765 3 8.25c0 7.22 9 12 9 12s9-4.78 9-12z"
            />
          </svg>
          <h3 className="mt-4 text-lg font-medium text-gray-900">
            No matches yet
          </h3>
          <p className="mt-2 text-sm text-gray-500">
            Keep reviewing proposals! Matches appear when both you and a
            collaborator express interest.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="w-full max-w-2xl mx-auto">
      {/* Error banner */}
      {error && (
        <div className="mb-4 rounded-md bg-red-50 p-3">
          <p className="text-sm text-red-700">{error}</p>
        </div>
      )}

      {/* Count */}
      <div className="mb-4 text-center">
        <span className="text-sm text-gray-500">
          {matches.length} {matches.length === 1 ? "match" : "matches"}
        </span>
      </div>

      {/* Matches list */}
      <div className="space-y-6">
        {matches.map((match) => {
          const isExpanded = expandedMatchId === match.matchId;

          return (
            <MatchCard
              key={match.matchId}
              match={match}
              isExpanded={isExpanded}
              onToggleExpand={() => handleToggleExpand(match.matchId)}
            />
          );
        })}
      </div>
    </div>
  );
}

/** Confidence tier visual styling. */
function confidenceTierStyle(tier: MatchProposal["confidenceTier"]): {
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

/** A single match card showing the collaborator, proposal summary, contact info, and expandable details. */
function MatchCard({
  match,
  isExpanded,
  onToggleExpand,
}: {
  match: MatchData;
  isExpanded: boolean;
  onToggleExpand: () => void;
}) {
  const { collaborator, proposal } = match;
  const tierStyle = confidenceTierStyle(proposal.confidenceTier);
  const isDeletedAccount = !collaborator.profile;

  return (
    <div className="rounded-xl bg-white shadow-md border border-gray-200 overflow-hidden">
      {/* Match indicator banner */}
      <div className="bg-emerald-50 px-4 py-2 border-b border-emerald-100 flex items-center gap-2">
        <svg
          className="h-4 w-4 text-emerald-600"
          fill="currentColor"
          viewBox="0 0 24 24"
        >
          <path d="M21 8.25c0-2.485-2.099-4.5-4.688-4.5-1.935 0-3.597 1.126-4.312 2.733-.715-1.607-2.377-2.733-4.313-2.733C5.1 3.75 3 5.765 3 8.25c0 7.22 9 12 9 12s9-4.78 9-12z" />
        </svg>
        <span className="text-sm font-medium text-emerald-800">
          Mutual Match
        </span>
        <span className="ml-auto text-xs text-emerald-600">
          {new Date(match.matchedAt).toLocaleDateString()}
        </span>
      </div>

      {/* Deleted account banner */}
      {isDeletedAccount && (
        <div className="bg-amber-50 px-4 py-2 border-b border-amber-100">
          <p className="text-sm text-amber-800">
            The other researcher has deleted their account.
          </p>
        </div>
      )}

      <div className="p-5">
        {/* Collaborator info */}
        <div className="mb-3">
          <h3 className="text-lg font-semibold text-gray-900">
            {collaborator.name}
          </h3>
          <p className="text-sm text-gray-500">
            {collaborator.institution}
            {collaborator.department && (
              <span> &middot; {collaborator.department}</span>
            )}
          </p>
        </div>

        {/* Contact info — per email_visibility setting */}
        {!isDeletedAccount && (
          <div className="mb-4 rounded-lg bg-blue-50 border border-blue-100 p-3">
            <p className="text-sm font-medium text-blue-900 mb-1">
              Reach out to {collaborator.name} to discuss this collaboration
            </p>
            {collaborator.email ? (
              <a
                href={`mailto:${collaborator.email}`}
                className="text-sm text-blue-700 hover:text-blue-900 hover:underline"
              >
                {collaborator.email}
              </a>
            ) : (
              <p className="text-sm text-blue-700 italic">
                {collaborator.contactMessage}
              </p>
            )}
          </div>
        )}

        {/* Proposal summary */}
        <div className="mb-3">
          <span className="inline-block rounded-full bg-gray-100 px-3 py-1 text-xs font-medium text-gray-700">
            {proposal.collaborationType}
          </span>
        </div>

        <p className="text-sm text-gray-800 leading-relaxed mb-4">
          {proposal.oneLineSummary}
        </p>

        {/* Confidence tier and title */}
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
          onClick={onToggleExpand}
          className="w-full rounded-md border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors"
        >
          {isExpanded ? "Hide details" : "See full proposal & profiles"}
        </button>
      </div>

      {/* Expanded detail view — inline, not fetched separately */}
      {isExpanded && (
        <MatchDetailView match={match} isDeletedAccount={isDeletedAccount} />
      )}
    </div>
  );
}

/** Full detail view for a match — shows proposal details and both profiles. */
function MatchDetailView({
  match,
  isDeletedAccount,
}: {
  match: MatchData;
  isDeletedAccount: boolean;
}) {
  const { proposal, collaborator, yourProfile } = match;

  return (
    <div className="border-t border-gray-200 p-5 space-y-6">
      {/* Scientific Question */}
      <DetailSection title="Scientific Question">
        <p className="text-sm text-gray-800 leading-relaxed italic bg-blue-50 rounded-lg p-3">
          {proposal.scientificQuestion}
        </p>
      </DetailSection>

      {/* Detailed Rationale */}
      <DetailSection title="Rationale">
        <p className="text-sm text-gray-700 leading-relaxed whitespace-pre-line">
          {proposal.detailedRationale}
        </p>
      </DetailSection>

      {/* Contributions */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <DetailSection title="What you bring">
          <p className="text-sm text-gray-700 leading-relaxed">
            {proposal.yourContributions}
          </p>
        </DetailSection>
        <DetailSection title="What they bring">
          <p className="text-sm text-gray-700 leading-relaxed">
            {proposal.theirContributions}
          </p>
        </DetailSection>
      </div>

      {/* Benefits */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <DetailSection title="What you gain">
          <p className="text-sm text-gray-700 leading-relaxed">
            {proposal.yourBenefits}
          </p>
        </DetailSection>
        <DetailSection title="What they gain">
          <p className="text-sm text-gray-700 leading-relaxed">
            {proposal.theirBenefits}
          </p>
        </DetailSection>
      </div>

      {/* Proposed First Experiment */}
      <DetailSection title="Proposed First Experiment">
        <p className="text-sm text-gray-700 leading-relaxed">
          {proposal.proposedFirstExperiment}
        </p>
      </DetailSection>

      {/* Anchoring Publications */}
      {proposal.anchoringPublications.length > 0 && (
        <DetailSection title="Key Publications">
          <ul className="space-y-2">
            {proposal.anchoringPublications.map((pub) => (
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
      {!isDeletedAccount && collaborator.profile && (
        <ResearcherProfileSection
          title={`About ${collaborator.name}`}
          researcher={collaborator}
        />
      )}

      {/* Your Profile */}
      {yourProfile.profile && (
        <ResearcherProfileSection
          title={`Your Profile — ${yourProfile.name}`}
          researcher={yourProfile}
        />
      )}
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

/** Displays a researcher's public profile. */
function ResearcherProfileSection({
  title,
  researcher,
}: {
  title: string;
  researcher: ResearcherData;
}) {
  const { profile, publications } = researcher;

  if (!profile) return null;

  return (
    <DetailSection title={title}>
      <div className="space-y-3 rounded-lg bg-gray-50 p-4">
        <p className="text-sm text-gray-700 leading-relaxed">
          {profile.researchSummary}
        </p>

        {profile.techniques.length > 0 && (
          <TagList label="Techniques" items={profile.techniques} />
        )}
        {profile.experimentalModels.length > 0 && (
          <TagList
            label="Experimental models"
            items={profile.experimentalModels}
          />
        )}
        {profile.diseaseAreas.length > 0 && (
          <TagList label="Disease areas" items={profile.diseaseAreas} />
        )}
        {profile.keyTargets.length > 0 && (
          <TagList label="Key targets" items={profile.keyTargets} />
        )}

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

/** Renders a labeled row of inline tags. */
function TagList({ label, items }: { label: string; items: string[] }) {
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
