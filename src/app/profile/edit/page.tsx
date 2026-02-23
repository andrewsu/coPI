/**
 * Profile edit page — direct editing of all synthesized profile fields.
 *
 * Accessible from the main app after onboarding. Allows users to edit
 * their research profile at any time. Also provides a "Refresh Profile"
 * button that re-runs the full pipeline (ORCID -> PubMed -> synthesis).
 *
 * Spec reference: auth-and-user-management.md, Profile Management:
 * "Users can view and directly edit all profile fields"
 * "Edits save immediately and bump profile_version"
 * "User can click 'Refresh profile' to re-run the full pipeline"
 *
 * Editable fields: research summary, techniques, experimental models,
 * disease areas, key targets, keywords.
 * Grant titles are displayed read-only (sourced from ORCID).
 *
 * Uses the same PUT /api/profile endpoint as the onboarding review page,
 * with identical validation (150–250 word summary, ≥3 techniques, ≥1
 * disease area, ≥1 key target).
 */

"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import { TagInput } from "@/components/tag-input";

interface SubmittedTextEntry {
  label: string;
  content: string;
  submitted_at: string;
}

interface ProfileData {
  researchSummary: string;
  techniques: string[];
  experimentalModels: string[];
  diseaseAreas: string[];
  keyTargets: string[];
  keywords: string[];
  grantTitles: string[];
  userSubmittedTexts: SubmittedTextEntry[];
  profileVersion: number;
  profileGeneratedAt: string;
  hasPendingProfile?: boolean;
}

interface RefreshStatusResponse {
  stage: string;
  message: string;
  warnings: string[];
  error?: string;
  result?: {
    publicationsFound: number;
    profileCreated: boolean;
  };
}

/** Counts words in text using whitespace splitting (mirrors server-side logic). */
function countWords(text: string): number {
  return text
    .trim()
    .split(/\s+/)
    .filter((w) => w.length > 0).length;
}

/** Polling interval for refresh status (ms). */
const REFRESH_POLL_INTERVAL = 2000;

export default function ProfileEditPage() {
  const { status: sessionStatus } = useSession();
  const router = useRouter();

  const [profile, setProfile] = useState<ProfileData | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saveErrors, setSaveErrors] = useState<string[]>([]);
  const [dirty, setDirty] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);

  // Refresh state
  const [refreshing, setRefreshing] = useState(false);
  const [refreshStage, setRefreshStage] = useState<string | null>(null);
  const [refreshMessage, setRefreshMessage] = useState<string | null>(null);
  const [refreshError, setRefreshError] = useState<string | null>(null);
  const [refreshWarnings, setRefreshWarnings] = useState<string[]>([]);
  const pollTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Fetch profile on mount (inline to avoid unstable router dependency in useCallback)
  useEffect(() => {
    if (sessionStatus !== "authenticated") return;

    async function fetchProfile() {
      try {
        const res = await fetch("/api/profile");
        if (res.status === 404) {
          // No profile yet — redirect to onboarding
          router.replace("/onboarding");
          return;
        }
        if (!res.ok) {
          throw new Error("Failed to load profile");
        }
        const data = (await res.json()) as ProfileData;
        setProfile(data);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load profile");
      } finally {
        setLoading(false);
      }
    }

    fetchProfile();
  }, [sessionStatus, router]);

  // Cleanup polling timer on unmount
  useEffect(() => {
    return () => {
      if (pollTimerRef.current) {
        clearInterval(pollTimerRef.current);
      }
    };
  }, []);

  /** Reload profile from API (used after refresh completes). */
  const reloadProfile = useCallback(async () => {
    try {
      const res = await fetch("/api/profile");
      if (!res.ok) return;
      const data = (await res.json()) as ProfileData;
      setProfile(data);
      setDirty(false);
      setSaveSuccess(false);
      setSaveErrors([]);
    } catch {
      // Silently handle reload errors — the profile was already updated server-side
    }
  }, []);

  /** Update a single field and mark form as dirty. */
  const updateField = useCallback(
    <K extends keyof ProfileData>(field: K, value: ProfileData[K]) => {
      setProfile((prev) => (prev ? { ...prev, [field]: value } : prev));
      setDirty(true);
      setSaveErrors([]);
      setSaveSuccess(false);
    },
    [],
  );

  /** Save profile changes via PUT /api/profile. */
  const handleSave = useCallback(async () => {
    if (!profile || !dirty) return;

    setSaving(true);
    setSaveErrors([]);
    setError(null);
    setSaveSuccess(false);

    try {
      const res = await fetch("/api/profile", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          researchSummary: profile.researchSummary,
          techniques: profile.techniques,
          experimentalModels: profile.experimentalModels,
          diseaseAreas: profile.diseaseAreas,
          keyTargets: profile.keyTargets,
          keywords: profile.keywords,
        }),
      });

      if (res.status === 422) {
        const data = (await res.json()) as { details: string[] };
        setSaveErrors(data.details);
        return;
      }

      if (!res.ok) {
        throw new Error("Failed to save profile");
      }

      const updated = (await res.json()) as ProfileData;
      setProfile(updated);
      setDirty(false);
      setSaveSuccess(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save profile");
    } finally {
      setSaving(false);
    }
  }, [profile, dirty]);

  /** Poll refresh status and handle completion/error. */
  const pollRefreshStatus = useCallback(async () => {
    try {
      const res = await fetch("/api/profile/refresh-status");
      if (!res.ok) return;

      const data = (await res.json()) as RefreshStatusResponse;
      setRefreshStage(data.stage);
      setRefreshMessage(data.message);

      if (data.stage === "complete") {
        // Refresh finished — stop polling, reload profile
        if (pollTimerRef.current) {
          clearInterval(pollTimerRef.current);
          pollTimerRef.current = null;
        }
        setRefreshing(false);
        setRefreshWarnings(data.warnings ?? []);
        // Reload the updated profile
        await reloadProfile();
      } else if (data.stage === "error") {
        // Refresh failed — stop polling, show error
        if (pollTimerRef.current) {
          clearInterval(pollTimerRef.current);
          pollTimerRef.current = null;
        }
        setRefreshing(false);
        setRefreshError(data.error ?? "Profile refresh failed");
      }
    } catch {
      // Silently handle network errors during polling
    }
  }, [reloadProfile]);

  /** Trigger a full profile refresh via POST /api/profile/refresh. */
  const handleRefresh = useCallback(async () => {
    if (refreshing || dirty) return;

    setRefreshing(true);
    setRefreshStage("starting");
    setRefreshMessage("Starting profile refresh...");
    setRefreshError(null);
    setRefreshWarnings([]);
    setSaveSuccess(false);
    setError(null);

    try {
      const res = await fetch("/api/profile/refresh", { method: "POST" });
      const data = (await res.json()) as { status: string };

      if (data.status === "already_running") {
        // Already running — just start polling
      } else if (data.status === "no_profile") {
        setRefreshing(false);
        setRefreshStage(null);
        setRefreshMessage(null);
        setError("No profile found. Please complete onboarding first.");
        return;
      } else if (data.status !== "started") {
        setRefreshing(false);
        setRefreshStage(null);
        setRefreshMessage(null);
        setError("Unexpected response from refresh endpoint.");
        return;
      }

      // Start polling for refresh progress
      pollTimerRef.current = setInterval(pollRefreshStatus, REFRESH_POLL_INTERVAL);
    } catch (err) {
      setRefreshing(false);
      setRefreshStage(null);
      setRefreshMessage(null);
      setError(err instanceof Error ? err.message : "Failed to start refresh");
    }
  }, [refreshing, dirty, pollRefreshStatus]);

  /** Navigate back to home without saving. */
  const handleBack = useCallback(() => {
    router.push("/");
  }, [router]);

  // Loading states
  if (sessionStatus === "loading" || loading) {
    return (
      <main className="flex min-h-screen items-center justify-center">
        <p className="animate-pulse text-gray-400">Loading your profile...</p>
      </main>
    );
  }

  if (error && !profile) {
    return (
      <main className="flex min-h-screen items-center justify-center p-8">
        <div className="text-center">
          <p className="text-red-600 font-medium">{error}</p>
          <button
            onClick={() => router.push("/")}
            className="mt-4 rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
          >
            Back to home
          </button>
        </div>
      </main>
    );
  }

  if (!profile) return null;

  const summaryWordCount = countWords(profile.researchSummary);
  const summaryInRange = summaryWordCount >= 150 && summaryWordCount <= 250;

  return (
    <main className="min-h-screen bg-gray-50 py-10 px-4">
      <div className="mx-auto max-w-2xl">
        {/* Header with back navigation */}
        <div className="mb-8">
          <button
            onClick={handleBack}
            className="mb-4 inline-flex items-center gap-1 text-sm text-gray-500 hover:text-gray-700"
          >
            <svg className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
              <path
                fillRule="evenodd"
                d="M17 10a.75.75 0 01-.75.75H5.612l4.158 3.96a.75.75 0 11-1.04 1.08l-5.5-5.25a.75.75 0 010-1.08l5.5-5.25a.75.75 0 111.04 1.08L5.612 9.25H16.25A.75.75 0 0117 10z"
                clipRule="evenodd"
              />
            </svg>
            Back to home
          </button>
          <div className="flex items-start justify-between">
            <div>
              <h1 className="text-3xl font-bold tracking-tight">Edit Your Profile</h1>
              <p className="mt-2 text-sm text-gray-500">
                Update your research profile. Changes will bump your profile version
                and trigger re-evaluation of collaboration proposals.
              </p>
              <p className="mt-1 text-xs text-gray-400">
                Profile version {profile.profileVersion}
              </p>
            </div>
            <button
              type="button"
              onClick={handleRefresh}
              disabled={refreshing || dirty}
              title={dirty ? "Save or discard changes before refreshing" : "Re-fetch publications from ORCID and re-synthesize your profile"}
              className="ml-4 mt-1 inline-flex items-center gap-1.5 rounded-md border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-700 shadow-sm hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <svg
                className={`h-4 w-4 ${refreshing ? "animate-spin" : ""}`}
                viewBox="0 0 20 20"
                fill="currentColor"
              >
                <path
                  fillRule="evenodd"
                  d="M15.312 11.424a5.5 5.5 0 01-9.201 2.466l-.312-.311h2.433a.75.75 0 000-1.5H4.598a.75.75 0 00-.75.75v3.634a.75.75 0 001.5 0v-2.09l.195.194a7 7 0 0011.713-3.143.75.75 0 10-1.444-.424zm-10.624-2.85a5.5 5.5 0 019.201-2.465l.312.31H11.77a.75.75 0 000 1.5h3.634a.75.75 0 00.75-.75V3.535a.75.75 0 00-1.5 0v2.09l-.195-.193A7 7 0 002.745 8.575a.75.75 0 101.444.424z"
                  clipRule="evenodd"
                />
              </svg>
              {refreshing ? "Refreshing..." : "Refresh Profile"}
            </button>
          </div>
        </div>

        {/* Pending profile update banner */}
        {profile.hasPendingProfile && (
          <div className="mb-6 rounded-md bg-amber-50 border border-amber-200 p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-amber-800">
                  Profile update available
                </p>
                <p className="text-xs text-amber-600 mt-0.5">
                  New publications were found. Review the updated profile to
                  accept or dismiss changes.
                </p>
              </div>
              <button
                type="button"
                onClick={() => router.push("/profile/compare")}
                className="ml-4 inline-flex items-center rounded-md bg-amber-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-amber-700"
              >
                Review Update
              </button>
            </div>
          </div>
        )}

        {/* Refresh progress indicator */}
        {refreshing && refreshMessage && (
          <div className="mb-6 rounded-md bg-blue-50 border border-blue-200 p-4">
            <div className="flex items-center gap-3">
              <svg
                className="h-5 w-5 animate-spin text-blue-600"
                xmlns="http://www.w3.org/2000/svg"
                fill="none"
                viewBox="0 0 24 24"
              >
                <circle
                  className="opacity-25"
                  cx="12"
                  cy="12"
                  r="10"
                  stroke="currentColor"
                  strokeWidth="4"
                />
                <path
                  className="opacity-75"
                  fill="currentColor"
                  d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
                />
              </svg>
              <div>
                <p className="text-sm font-medium text-blue-800">
                  {refreshMessage}
                </p>
                <p className="text-xs text-blue-600 mt-0.5">
                  This may take a minute. Your publications are being re-fetched
                  and your profile re-synthesized.
                </p>
              </div>
            </div>
          </div>
        )}

        {/* Refresh completion with warnings */}
        {!refreshing && refreshStage === "complete" && (
          <div className="mb-6 rounded-md bg-green-50 p-4">
            <p className="text-sm text-green-700">
              Profile refreshed successfully (version {profile.profileVersion}).
            </p>
            {refreshWarnings.length > 0 && (
              <ul className="mt-2 list-disc pl-5 text-sm text-yellow-700">
                {refreshWarnings.map((w, i) => (
                  <li key={i}>{w}</li>
                ))}
              </ul>
            )}
          </div>
        )}

        {/* Refresh error */}
        {!refreshing && refreshError && (
          <div className="mb-6 rounded-md bg-red-50 p-4">
            <p className="text-sm text-red-700">
              Refresh failed: {refreshError}
            </p>
            <button
              type="button"
              onClick={handleRefresh}
              className="mt-2 text-sm font-medium text-red-600 hover:text-red-800 underline"
            >
              Try again
            </button>
          </div>
        )}

        {/* Success message */}
        {saveSuccess && (
          <div className="mb-6 rounded-md bg-green-50 p-4">
            <p className="text-sm text-green-700">
              Profile saved successfully (version {profile.profileVersion}).
            </p>
          </div>
        )}

        {/* Validation errors from server */}
        {saveErrors.length > 0 && (
          <div className="mb-6 rounded-md bg-red-50 p-4">
            <h3 className="text-sm font-medium text-red-800">
              Please fix the following:
            </h3>
            <ul className="mt-2 list-disc pl-5 text-sm text-red-700">
              {saveErrors.map((err, i) => (
                <li key={i}>{err}</li>
              ))}
            </ul>
          </div>
        )}

        {/* General error */}
        {error && profile && (
          <div className="mb-6 rounded-md bg-red-50 p-4">
            <p className="text-sm text-red-700">{error}</p>
          </div>
        )}

        <div className="space-y-6 rounded-lg bg-white p-6 shadow-sm">
          {/* Research Summary */}
          <div>
            <label className="block text-sm font-medium text-gray-700">
              Research Summary
            </label>
            <p className="mt-0.5 text-xs text-gray-500">
              A narrative overview of your research program (150–250 words)
            </p>
            <textarea
              value={profile.researchSummary}
              onChange={(e) => updateField("researchSummary", e.target.value)}
              rows={8}
              disabled={refreshing}
              className="mt-1.5 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 disabled:bg-gray-100 disabled:cursor-not-allowed"
            />
            <p
              className={`mt-1 text-xs ${
                summaryInRange ? "text-gray-500" : "text-red-600"
              }`}
            >
              {summaryWordCount} / 150–250 words
            </p>
          </div>

          {/* Techniques */}
          <TagInput
            label="Techniques"
            items={profile.techniques}
            onChange={(v) => updateField("techniques", v)}
            minItems={3}
            helpText="Specific methodologies (e.g., RNA-seq, CRISPR screening, cryo-EM)"
          />

          {/* Experimental Models */}
          <TagInput
            label="Experimental Models"
            items={profile.experimentalModels}
            onChange={(v) => updateField("experimentalModels", v)}
            helpText="Organisms, cell lines, databases used in your research"
          />

          {/* Disease Areas */}
          <TagInput
            label="Disease Areas"
            items={profile.diseaseAreas}
            onChange={(v) => updateField("diseaseAreas", v)}
            minItems={1}
            helpText="Standardized disease terms or biological processes"
          />

          {/* Key Targets */}
          <TagInput
            label="Key Targets"
            items={profile.keyTargets}
            onChange={(v) => updateField("keyTargets", v)}
            helpText="Proteins, pathways, or molecular systems"
          />

          {/* Keywords */}
          <TagInput
            label="Keywords"
            items={profile.keywords}
            onChange={(v) => updateField("keywords", v)}
            helpText="Additional terms from MeSH or your domain"
          />

          {/* Grant Titles — read-only */}
          {profile.grantTitles.length > 0 && (
            <div>
              <label className="block text-sm font-medium text-gray-700">
                Grant Titles
              </label>
              <p className="mt-0.5 text-xs text-gray-500">
                Sourced from ORCID (not editable here)
              </p>
              <ul className="mt-1.5 space-y-1">
                {profile.grantTitles.map((title, idx) => (
                  <li
                    key={idx}
                    className="rounded-md bg-gray-50 px-3 py-2 text-sm text-gray-700"
                  >
                    {title}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* User-Submitted Texts — link to management page */}
          <div>
            <label className="block text-sm font-medium text-gray-700">
              Research Texts
            </label>
            <p className="mt-0.5 text-xs text-gray-500">
              Free-text submissions that inform your profile and matching (never
              shown to other researchers)
            </p>
            <div className="mt-1.5 flex items-center justify-between rounded-md bg-gray-50 px-4 py-3">
              <span className="text-sm text-gray-700">
                {(profile.userSubmittedTexts?.length ?? 0) > 0
                  ? `${profile.userSubmittedTexts.length} text${profile.userSubmittedTexts.length === 1 ? "" : "s"} submitted`
                  : "No texts submitted yet"}
              </span>
              <button
                type="button"
                onClick={() => router.push("/profile/submitted-texts")}
                className="text-sm font-medium text-blue-600 hover:text-blue-800"
              >
                Manage
              </button>
            </div>
          </div>
        </div>

        {/* Action buttons */}
        <div className="mt-8 flex justify-between">
          <button
            type="button"
            onClick={handleBack}
            className="rounded-md border border-gray-300 px-4 py-2.5 text-sm font-medium text-gray-700 hover:bg-gray-100"
          >
            {dirty ? "Discard Changes" : "Back"}
          </button>
          <button
            type="button"
            onClick={handleSave}
            disabled={saving || !dirty || refreshing}
            className="rounded-md bg-blue-600 px-6 py-2.5 text-sm font-medium text-white shadow-sm hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {saving ? "Saving..." : "Save Changes"}
          </button>
        </div>
      </div>
    </main>
  );
}
