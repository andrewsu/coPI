/**
 * Onboarding profile review/edit page.
 *
 * Shown after the profile pipeline completes. Displays the LLM-generated
 * profile and allows the user to edit any field before proceeding.
 *
 * Spec reference: auth-and-user-management.md, Signup Flow step 3:
 * "Review generated profile → user can edit any field"
 *
 * Editable fields: research summary, techniques, experimental models,
 * disease areas, key targets, keywords.
 * Grant titles are displayed read-only (sourced from ORCID).
 */

"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import { TagInput } from "@/components/tag-input";

interface ProfileData {
  researchSummary: string;
  techniques: string[];
  experimentalModels: string[];
  diseaseAreas: string[];
  keyTargets: string[];
  keywords: string[];
  grantTitles: string[];
  profileVersion: number;
}

/** Counts words in text using whitespace splitting (mirrors server-side logic). */
function countWords(text: string): number {
  return text
    .trim()
    .split(/\s+/)
    .filter((w) => w.length > 0).length;
}

// ---------------------------------------------------------------------------
// Main review page
// ---------------------------------------------------------------------------

export default function ProfileReviewPage() {
  const { status: sessionStatus } = useSession();
  const router = useRouter();

  const [profile, setProfile] = useState<ProfileData | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saveErrors, setSaveErrors] = useState<string[]>([]);
  const [dirty, setDirty] = useState(false);

  // Fetch profile on mount
  useEffect(() => {
    if (sessionStatus !== "authenticated") return;

    async function fetchProfile() {
      try {
        const res = await fetch("/api/profile");
        if (res.status === 404) {
          // No profile yet — redirect to onboarding pipeline
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
    },
    [],
  );

  /** Save changes and proceed. If no changes, proceed without saving. */
  const handleContinue = useCallback(async () => {
    if (!profile) return;

    // If nothing changed, just proceed to match pool setup
    if (!dirty) {
      router.push("/match-pool?onboarding=1");
      return;
    }

    setSaving(true);
    setSaveErrors([]);
    setError(null);

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

      router.push("/match-pool?onboarding=1");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save profile");
    } finally {
      setSaving(false);
    }
  }, [profile, dirty, router]);

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
            onClick={() => router.replace("/onboarding")}
            className="mt-4 rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
          >
            Back to onboarding
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
        <div className="text-center mb-8">
          <h1 className="text-3xl font-bold tracking-tight">Review Your Profile</h1>
          <p className="mt-2 text-sm text-gray-500">
            We generated a research profile from your publications. Review it below
            and make any edits before continuing.
          </p>
        </div>

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
        </div>

        {/* Action buttons */}
        <div className="mt-8 flex justify-end gap-3">
          <button
            type="button"
            onClick={handleContinue}
            disabled={saving}
            className="rounded-md bg-blue-600 px-6 py-2.5 text-sm font-medium text-white shadow-sm hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {saving ? "Saving..." : dirty ? "Save & Continue" : "Looks Good"}
          </button>
        </div>
      </div>
    </main>
  );
}
