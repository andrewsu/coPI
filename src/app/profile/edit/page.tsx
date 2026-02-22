/**
 * Profile edit page — direct editing of all synthesized profile fields.
 *
 * Accessible from the main app after onboarding. Allows users to edit
 * their research profile at any time.
 *
 * Spec reference: auth-and-user-management.md, Profile Management:
 * "Users can view and directly edit all profile fields"
 * "Edits save immediately and bump profile_version"
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

import { useCallback, useEffect, useState } from "react";
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
}

/** Counts words in text using whitespace splitting (mirrors server-side logic). */
function countWords(text: string): number {
  return text
    .trim()
    .split(/\s+/)
    .filter((w) => w.length > 0).length;
}

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

  // Fetch profile on mount
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
          <h1 className="text-3xl font-bold tracking-tight">Edit Your Profile</h1>
          <p className="mt-2 text-sm text-gray-500">
            Update your research profile. Changes will bump your profile version
            and trigger re-evaluation of collaboration proposals.
          </p>
          <p className="mt-1 text-xs text-gray-400">
            Profile version {profile.profileVersion}
          </p>
        </div>

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
              className="mt-1.5 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
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
            minItems={1}
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
            disabled={saving || !dirty}
            className="rounded-md bg-blue-600 px-6 py-2.5 text-sm font-medium text-white shadow-sm hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {saving ? "Saving..." : "Save Changes"}
          </button>
        </div>
      </div>
    </main>
  );
}
