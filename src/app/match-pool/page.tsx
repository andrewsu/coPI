/**
 * Match pool management page.
 *
 * Displays the user's current match pool with entry details (name, institution,
 * how added) and allows removal of individual entries. Shows pool stats including
 * total count and the 200-user cap warning when exceeded.
 *
 * Includes a search interface for finding and adding researchers by name or
 * institution. Search results show a profile preview (research summary,
 * techniques, disease areas, key targets) per spec — user-submitted texts
 * are never exposed.
 *
 * Spec reference: auth-and-user-management.md, Match Pool Management section.
 *
 * This page serves as both:
 * - An onboarding step (user must add at least one person before proceeding)
 * - A persistent management page accessible from the main app
 */

"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useSession } from "next-auth/react";
import Link from "next/link";

interface TargetUser {
  id: string;
  name: string;
  institution: string;
  department: string | null;
}

interface MatchPoolEntry {
  id: string;
  targetUser: TargetUser;
  source: "individual_select" | "affiliation_select" | "all_users";
  createdAt: string;
}

interface AffiliationSelection {
  id: string;
  institution: string | null;
  department: string | null;
  selectAll: boolean;
  createdAt: string;
}

interface MatchPoolData {
  entries: MatchPoolEntry[];
  affiliationSelections: AffiliationSelection[];
  totalCount: number;
  cap: number;
}

interface SearchResultProfile {
  researchSummary: string;
  techniques: string[];
  diseaseAreas: string[];
  keyTargets: string[];
}

interface SearchResult {
  id: string;
  name: string;
  institution: string;
  department: string | null;
  profile: SearchResultProfile | null;
  inMatchPool: boolean;
}

/** Human-readable label for each match pool source. */
function sourceLabel(source: MatchPoolEntry["source"]): string {
  switch (source) {
    case "individual_select":
      return "Individual";
    case "affiliation_select":
      return "Affiliation";
    case "all_users":
      return "All Users";
  }
}

/** Tailwind classes for source badge styling. */
function sourceBadgeClass(source: MatchPoolEntry["source"]): string {
  switch (source) {
    case "individual_select":
      return "bg-blue-100 text-blue-800";
    case "affiliation_select":
      return "bg-purple-100 text-purple-800";
    case "all_users":
      return "bg-green-100 text-green-800";
  }
}

export default function MatchPoolPage() {
  const { status: sessionStatus } = useSession();
  const router = useRouter();
  const searchParams = useSearchParams();
  const isOnboarding = searchParams.get("onboarding") === "1";

  const [data, setData] = useState<MatchPoolData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [removingId, setRemovingId] = useState<string | null>(null);
  const [confirmRemoveId, setConfirmRemoveId] = useState<string | null>(null);

  // Search state
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const [addingUserId, setAddingUserId] = useState<string | null>(null);
  const [expandedProfileId, setExpandedProfileId] = useState<string | null>(
    null,
  );
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const fetchPool = useCallback(async () => {
    try {
      const res = await fetch("/api/match-pool");
      if (!res.ok) {
        throw new Error("Failed to load match pool");
      }
      const poolData = (await res.json()) as MatchPoolData;
      setData(poolData);
      setError(null);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to load match pool",
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (sessionStatus !== "authenticated") return;
    fetchPool();
  }, [sessionStatus, fetchPool]);

  /** Debounced search — fires 300ms after the user stops typing. */
  useEffect(() => {
    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
    }

    const trimmed = searchQuery.trim();
    if (trimmed.length < 2) {
      setSearchResults([]);
      setSearchLoading(false);
      return;
    }

    setSearchLoading(true);
    debounceRef.current = setTimeout(async () => {
      try {
        const res = await fetch(
          `/api/match-pool/search?q=${encodeURIComponent(trimmed)}`,
        );
        if (!res.ok) {
          throw new Error("Search failed");
        }
        const json = (await res.json()) as { users: SearchResult[] };
        setSearchResults(json.users);
      } catch {
        setSearchResults([]);
      } finally {
        setSearchLoading(false);
      }
    }, 300);

    return () => {
      if (debounceRef.current) {
        clearTimeout(debounceRef.current);
      }
    };
  }, [searchQuery]);

  /** Add a user to the match pool via individual selection. */
  const handleAdd = useCallback(
    async (targetUserId: string) => {
      setAddingUserId(targetUserId);
      try {
        const res = await fetch("/api/match-pool/add", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ targetUserId }),
        });
        if (!res.ok) {
          const errData = await res.json();
          throw new Error(errData.error || "Failed to add researcher");
        }
        // Mark the user as in pool in search results
        setSearchResults((prev) =>
          prev.map((u) =>
            u.id === targetUserId ? { ...u, inMatchPool: true } : u,
          ),
        );
        // Re-fetch the pool data to get updated counts and entries
        await fetchPool();
      } catch (err) {
        setError(
          err instanceof Error ? err.message : "Failed to add researcher",
        );
      } finally {
        setAddingUserId(null);
      }
    },
    [fetchPool],
  );

  /** Remove a single match pool entry after user confirms. */
  const handleRemove = useCallback(
    async (entryId: string) => {
      setRemovingId(entryId);
      setConfirmRemoveId(null);
      try {
        const res = await fetch(`/api/match-pool/${entryId}`, {
          method: "DELETE",
        });
        if (!res.ok && res.status !== 204) {
          throw new Error("Failed to remove entry");
        }
        // Re-fetch the pool data to get updated counts
        await fetchPool();
      } catch (err) {
        setError(
          err instanceof Error ? err.message : "Failed to remove entry",
        );
      } finally {
        setRemovingId(null);
      }
    },
    [fetchPool],
  );

  /** Navigate to the next step: home page (or future settings page). */
  const handleContinue = useCallback(() => {
    router.push("/");
  }, [router]);

  // Loading states
  if (sessionStatus === "loading" || loading) {
    return (
      <main className="flex min-h-screen items-center justify-center">
        <p className="animate-pulse text-gray-400">
          Loading your match pool...
        </p>
      </main>
    );
  }

  if (error && !data) {
    return (
      <main className="flex min-h-screen items-center justify-center p-8">
        <div className="text-center">
          <p className="text-red-600 font-medium">{error}</p>
          <button
            onClick={() => {
              setLoading(true);
              setError(null);
              fetchPool();
            }}
            className="mt-4 rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
          >
            Retry
          </button>
        </div>
      </main>
    );
  }

  const entries = data?.entries ?? [];
  const affiliationSelections = data?.affiliationSelections ?? [];
  const totalCount = data?.totalCount ?? 0;
  const cap = data?.cap ?? 200;
  const isEmpty = totalCount === 0 && affiliationSelections.length === 0;

  // Count by source for the stats breakdown
  const individualCount = entries.filter(
    (e) => e.source === "individual_select",
  ).length;
  const affiliationCount = entries.filter(
    (e) => e.source === "affiliation_select",
  ).length;
  const allUsersCount = entries.filter((e) => e.source === "all_users").length;

  return (
    <main className="min-h-screen bg-gray-50 py-10 px-4">
      <div className="mx-auto max-w-3xl">
        {/* Header */}
        <div className="mb-8">
          {!isOnboarding && (
            <Link
              href="/"
              className="mb-4 inline-block text-sm text-blue-600 hover:text-blue-800"
            >
              &larr; Back to home
            </Link>
          )}
          <h1 className="text-3xl font-bold tracking-tight">
            {isOnboarding ? "Build Your Match Pool" : "Match Pool"}
          </h1>
          <p className="mt-2 text-sm text-gray-500">
            {isOnboarding
              ? "Choose which researchers you'd like to explore collaborations with. You must add at least one researcher before continuing."
              : "Manage the researchers in your match pool. CoPI will generate collaboration proposals with these researchers."}
          </p>
        </div>

        {/* Error banner */}
        {error && data && (
          <div className="mb-6 rounded-md bg-red-50 p-4">
            <p className="text-sm text-red-700">{error}</p>
          </div>
        )}

        {/* Search section */}
        <div className="mb-6 rounded-lg bg-white p-4 shadow-sm">
          <h2 className="text-sm font-medium text-gray-700 mb-3">
            Add Researchers
          </h2>
          <div className="relative">
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search by name or institution..."
              className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm placeholder-gray-400 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
            />
            {searchLoading && (
              <div className="absolute right-3 top-2.5">
                <div className="h-4 w-4 animate-spin rounded-full border-2 border-gray-300 border-t-blue-600" />
              </div>
            )}
          </div>

          {/* Search results */}
          {searchQuery.trim().length >= 2 && !searchLoading && (
            <div className="mt-3">
              {searchResults.length === 0 ? (
                <p className="text-sm text-gray-500 py-2">
                  No researchers found matching &ldquo;{searchQuery.trim()}
                  &rdquo;
                </p>
              ) : (
                <ul className="divide-y divide-gray-100 border border-gray-200 rounded-md">
                  {searchResults.map((user) => (
                    <li key={user.id} className="px-3 py-3">
                      <div className="flex items-start justify-between">
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-medium text-gray-900">
                            {user.name}
                          </p>
                          <p className="text-xs text-gray-500">
                            {user.institution}
                            {user.department && (
                              <span> &middot; {user.department}</span>
                            )}
                          </p>
                          {/* Profile preview toggle */}
                          {user.profile && (
                            <button
                              onClick={() =>
                                setExpandedProfileId(
                                  expandedProfileId === user.id
                                    ? null
                                    : user.id,
                                )
                              }
                              className="mt-1 text-xs text-blue-600 hover:text-blue-800"
                            >
                              {expandedProfileId === user.id
                                ? "Hide profile"
                                : "View profile"}
                            </button>
                          )}
                          {!user.profile && (
                            <p className="mt-1 text-xs text-gray-400 italic">
                              Profile not yet generated
                            </p>
                          )}
                        </div>
                        <div className="ml-3 flex-shrink-0">
                          {user.inMatchPool ? (
                            <span className="inline-flex items-center rounded-full bg-green-50 px-2.5 py-1 text-xs font-medium text-green-700">
                              Added
                            </span>
                          ) : (
                            <button
                              onClick={() => handleAdd(user.id)}
                              disabled={addingUserId === user.id}
                              className="rounded-md bg-blue-600 px-3 py-1 text-xs font-medium text-white hover:bg-blue-700 disabled:opacity-50"
                            >
                              {addingUserId === user.id
                                ? "Adding..."
                                : "Add"}
                            </button>
                          )}
                        </div>
                      </div>
                      {/* Expanded profile preview */}
                      {expandedProfileId === user.id && user.profile && (
                        <div className="mt-3 rounded-md bg-gray-50 p-3 text-xs text-gray-700">
                          <p className="mb-2 leading-relaxed">
                            {user.profile.researchSummary}
                          </p>
                          {user.profile.techniques.length > 0 && (
                            <div className="mb-1.5">
                              <span className="font-medium text-gray-600">
                                Techniques:{" "}
                              </span>
                              <span>
                                {user.profile.techniques.join(", ")}
                              </span>
                            </div>
                          )}
                          {user.profile.diseaseAreas.length > 0 && (
                            <div className="mb-1.5">
                              <span className="font-medium text-gray-600">
                                Disease areas:{" "}
                              </span>
                              <span>
                                {user.profile.diseaseAreas.join(", ")}
                              </span>
                            </div>
                          )}
                          {user.profile.keyTargets.length > 0 && (
                            <div>
                              <span className="font-medium text-gray-600">
                                Key targets:{" "}
                              </span>
                              <span>
                                {user.profile.keyTargets.join(", ")}
                              </span>
                            </div>
                          )}
                        </div>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </div>

        {/* Stats bar — shown when pool is not empty */}
        {!isEmpty && (
          <div className="mb-6 rounded-lg bg-white p-4 shadow-sm">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-gray-700">
                  {totalCount}{" "}
                  {totalCount === 1 ? "researcher" : "researchers"} in your
                  match pool
                </p>
                <p className="mt-0.5 text-xs text-gray-500">
                  {individualCount > 0 && (
                    <span>{individualCount} individually selected</span>
                  )}
                  {individualCount > 0 && affiliationCount > 0 && (
                    <span> &middot; </span>
                  )}
                  {affiliationCount > 0 && (
                    <span>{affiliationCount} from affiliations</span>
                  )}
                  {(individualCount > 0 || affiliationCount > 0) &&
                    allUsersCount > 0 && <span> &middot; </span>}
                  {allUsersCount > 0 && (
                    <span>{allUsersCount} from all users</span>
                  )}
                </p>
              </div>
              <div className="text-right">
                <span
                  className={`inline-block rounded-full px-3 py-1 text-xs font-medium ${
                    totalCount > cap
                      ? "bg-amber-100 text-amber-800"
                      : "bg-gray-100 text-gray-600"
                  }`}
                >
                  {totalCount} / {cap}
                </span>
              </div>
            </div>
            {totalCount > cap && (
              <p className="mt-3 text-xs text-amber-700">
                Your match pool includes {totalCount} researchers. We&apos;ll
                evaluate up to {cap} collaboration opportunities per cycle,
                prioritizing researchers you individually selected.
              </p>
            )}
          </div>
        )}

        {/* Affiliation selections summary */}
        {affiliationSelections.length > 0 && (
          <div className="mb-6 rounded-lg bg-white p-4 shadow-sm">
            <h2 className="text-sm font-medium text-gray-700 mb-3">
              Active Selections
            </h2>
            <div className="space-y-2">
              {affiliationSelections.map((sel) => (
                <div
                  key={sel.id}
                  className="flex items-center justify-between rounded-md bg-gray-50 px-3 py-2"
                >
                  <div className="text-sm text-gray-700">
                    {sel.selectAll ? (
                      <span className="font-medium">All researchers</span>
                    ) : (
                      <>
                        <span className="font-medium">
                          {sel.institution ?? "Any institution"}
                        </span>
                        {sel.department && (
                          <span className="text-gray-500">
                            {" "}
                            &middot; {sel.department}
                          </span>
                        )}
                      </>
                    )}
                  </div>
                  <span className="text-xs text-gray-400">
                    Auto-expands on new joins
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Empty state */}
        {isEmpty && (
          <div className="rounded-lg border-2 border-dashed border-gray-300 bg-white p-12 text-center">
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
              No researchers in your pool yet
            </h3>
            <p className="mt-2 text-sm text-gray-500">
              Use the search above to find and add researchers.
            </p>
            {isOnboarding && (
              <p className="mt-3 text-xs text-amber-700">
                You must add at least one researcher to continue.
              </p>
            )}
          </div>
        )}

        {/* Match pool entries list */}
        {entries.length > 0 && (
          <div className="rounded-lg bg-white shadow-sm">
            <div className="px-4 py-3 border-b border-gray-100">
              <h2 className="text-sm font-medium text-gray-700">
                Researchers
              </h2>
            </div>
            <ul className="divide-y divide-gray-100">
              {entries.map((entry) => (
                <li
                  key={entry.id}
                  className="flex items-center justify-between px-4 py-3"
                >
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-gray-900 truncate">
                      {entry.targetUser.name}
                    </p>
                    <p className="text-xs text-gray-500 truncate">
                      {entry.targetUser.institution}
                      {entry.targetUser.department && (
                        <span> &middot; {entry.targetUser.department}</span>
                      )}
                    </p>
                  </div>
                  <div className="ml-4 flex items-center gap-3">
                    <span
                      className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${sourceBadgeClass(entry.source)}`}
                    >
                      {sourceLabel(entry.source)}
                    </span>
                    {/* Confirm removal dialog */}
                    {confirmRemoveId === entry.id ? (
                      <div className="flex items-center gap-1.5">
                        <button
                          onClick={() => handleRemove(entry.id)}
                          disabled={removingId === entry.id}
                          className="rounded px-2 py-1 text-xs font-medium text-red-700 bg-red-100 hover:bg-red-200 disabled:opacity-50"
                        >
                          {removingId === entry.id ? "Removing..." : "Confirm"}
                        </button>
                        <button
                          onClick={() => setConfirmRemoveId(null)}
                          className="rounded px-2 py-1 text-xs font-medium text-gray-600 bg-gray-100 hover:bg-gray-200"
                        >
                          Cancel
                        </button>
                      </div>
                    ) : (
                      <button
                        onClick={() => setConfirmRemoveId(entry.id)}
                        className="rounded px-2 py-1 text-xs font-medium text-gray-500 hover:text-red-600 hover:bg-red-50 transition-colors"
                        title="Remove from match pool"
                      >
                        Remove
                      </button>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* Action buttons */}
        <div className="mt-8 flex justify-between items-center">
          {!isOnboarding && (
            <Link
              href="/"
              className="text-sm text-gray-500 hover:text-gray-700"
            >
              Back to home
            </Link>
          )}
          {isOnboarding && <div />}
          {isOnboarding && (
            <button
              onClick={handleContinue}
              disabled={isEmpty}
              className="rounded-md bg-blue-600 px-6 py-2.5 text-sm font-medium text-white shadow-sm hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed"
              title={
                isEmpty
                  ? "Add at least one researcher to continue"
                  : undefined
              }
            >
              Continue
            </button>
          )}
        </div>
      </div>
    </main>
  );
}
