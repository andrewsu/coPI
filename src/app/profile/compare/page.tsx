/**
 * Profile comparison page — side-by-side view of current vs candidate profile.
 *
 * Shown when the monthly refresh detects new publications and generates a
 * candidate profile with array field changes. Users can:
 *   1. Accept as-is — applies candidate fields directly
 *   2. Edit & accept — enables inline editing of candidate fields before saving
 *   3. Dismiss — clears the pending profile
 *
 * Spec reference: auth-and-user-management.md, Profile Refresh:
 * "User sees side-by-side comparison of current vs candidate profile,
 *  can accept as-is, edit before saving, or dismiss"
 */

"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import { TagInput } from "@/components/tag-input";

interface ProfileFields {
  researchSummary: string;
  techniques: string[];
  experimentalModels: string[];
  diseaseAreas: string[];
  keyTargets: string[];
  keywords: string[];
  grantTitles: string[];
}

interface CandidateFields extends ProfileFields {
  generatedAt: string;
}

interface ComparisonData {
  current: ProfileFields;
  candidate: CandidateFields;
  changedFields: string[];
  pendingProfileCreatedAt: string;
  profileVersion: number;
}

/** Counts words in text using whitespace splitting. */
function countWords(text: string): number {
  return text
    .trim()
    .split(/\s+/)
    .filter((w) => w.length > 0).length;
}

/** Human-readable labels for profile field names. */
const FIELD_LABELS: Record<string, string> = {
  researchSummary: "Research Summary",
  techniques: "Techniques",
  experimentalModels: "Experimental Models",
  diseaseAreas: "Disease Areas",
  keyTargets: "Key Targets",
  keywords: "Keywords",
  grantTitles: "Grant Titles",
};

export default function ProfileComparePage() {
  const { status: sessionStatus } = useSession();
  const router = useRouter();

  const [data, setData] = useState<ComparisonData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [editMode, setEditMode] = useState(false);
  const [validationErrors, setValidationErrors] = useState<string[]>([]);

  // Editable candidate fields (used in edit mode)
  const [editedFields, setEditedFields] = useState<ProfileFields | null>(null);

  // Fetch comparison data on mount
  useEffect(() => {
    if (sessionStatus !== "authenticated") return;

    async function fetchComparison() {
      try {
        const res = await fetch("/api/profile/pending");
        if (res.status === 404) {
          // No pending profile — redirect to profile edit
          router.replace("/profile/edit");
          return;
        }
        if (!res.ok) {
          throw new Error("Failed to load profile comparison");
        }
        const result = (await res.json()) as ComparisonData;
        setData(result);
      } catch (err) {
        setError(
          err instanceof Error ? err.message : "Failed to load comparison",
        );
      } finally {
        setLoading(false);
      }
    }

    fetchComparison();
  }, [sessionStatus, router]);

  /** Enter edit mode — initialize editable fields from candidate. */
  const handleEnterEditMode = useCallback(() => {
    if (!data) return;
    setEditedFields({ ...data.candidate });
    setEditMode(true);
    setValidationErrors([]);
  }, [data]);

  /** Exit edit mode without saving. */
  const handleCancelEdit = useCallback(() => {
    setEditMode(false);
    setEditedFields(null);
    setValidationErrors([]);
  }, []);

  /** Update a single edited field. */
  const updateEditedField = useCallback(
    <K extends keyof ProfileFields>(field: K, value: ProfileFields[K]) => {
      setEditedFields((prev) => (prev ? { ...prev, [field]: value } : prev));
      setValidationErrors([]);
    },
    [],
  );

  /** Accept the pending profile (as-is or with edits). */
  const handleAccept = useCallback(async () => {
    if (!data) return;
    setSubmitting(true);
    setError(null);
    setValidationErrors([]);

    try {
      const body: { action: string; fields?: Partial<ProfileFields> } = {
        action: "accept",
      };

      if (editMode && editedFields) {
        body.fields = {
          researchSummary: editedFields.researchSummary,
          techniques: editedFields.techniques,
          experimentalModels: editedFields.experimentalModels,
          diseaseAreas: editedFields.diseaseAreas,
          keyTargets: editedFields.keyTargets,
          keywords: editedFields.keywords,
        };
      }

      const res = await fetch("/api/profile/pending", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      if (res.status === 422) {
        const result = (await res.json()) as { details: string[] };
        setValidationErrors(result.details);
        return;
      }

      if (!res.ok) {
        const result = (await res.json()) as { error?: string };
        throw new Error(result.error ?? "Failed to accept profile update");
      }

      // Success — redirect to profile edit page
      router.push("/profile/edit");
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to accept profile update",
      );
    } finally {
      setSubmitting(false);
    }
  }, [data, editMode, editedFields, router]);

  /** Dismiss the pending profile. */
  const handleDismiss = useCallback(async () => {
    if (!data) return;
    setSubmitting(true);
    setError(null);

    try {
      const res = await fetch("/api/profile/pending", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "dismiss" }),
      });

      if (!res.ok) {
        const result = (await res.json()) as { error?: string };
        throw new Error(result.error ?? "Failed to dismiss profile update");
      }

      // Success — redirect back
      router.push("/profile/edit");
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to dismiss profile update",
      );
    } finally {
      setSubmitting(false);
    }
  }, [data, router]);

  // Loading state
  if (sessionStatus === "loading" || loading) {
    return (
      <main className="flex min-h-screen items-center justify-center">
        <p className="animate-pulse text-gray-400">
          Loading profile comparison...
        </p>
      </main>
    );
  }

  // Error state (no data loaded)
  if (error && !data) {
    return (
      <main className="flex min-h-screen items-center justify-center p-8">
        <div className="text-center">
          <p className="text-red-600 font-medium">{error}</p>
          <button
            onClick={() => router.push("/profile/edit")}
            className="mt-4 rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
          >
            Back to profile
          </button>
        </div>
      </main>
    );
  }

  if (!data) return null;

  const { current, candidate, changedFields } = data;
  const candidateDate = new Date(candidate.generatedAt).toLocaleDateString(
    "en-US",
    { year: "numeric", month: "long", day: "numeric" },
  );

  return (
    <main className="min-h-screen bg-gray-50 py-10 px-4">
      <div className="mx-auto max-w-6xl">
        {/* Header */}
        <div className="mb-8">
          <button
            onClick={() => router.push("/profile/edit")}
            className="mb-4 inline-flex items-center gap-1 text-sm text-gray-500 hover:text-gray-700"
          >
            <svg className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
              <path
                fillRule="evenodd"
                d="M17 10a.75.75 0 01-.75.75H5.612l4.158 3.96a.75.75 0 11-1.04 1.08l-5.5-5.25a.75.75 0 010-1.08l5.5-5.25a.75.75 0 111.04 1.08L5.612 9.25H16.25A.75.75 0 0117 10z"
                clipRule="evenodd"
              />
            </svg>
            Back to profile
          </button>

          <h1 className="text-3xl font-bold tracking-tight">
            Review Profile Update
          </h1>
          <p className="mt-2 text-sm text-gray-500">
            New publications were found in your ORCID record. Compare your
            current profile with the updated candidate generated on{" "}
            {candidateDate}.
          </p>
        </div>

        {/* Changed fields summary */}
        <div className="mb-6 rounded-md bg-amber-50 border border-amber-200 p-4">
          <p className="text-sm font-medium text-amber-800">
            Changed sections:{" "}
            {changedFields.map((f) => FIELD_LABELS[f] ?? f).join(", ")}
          </p>
        </div>

        {/* Error display */}
        {error && data && (
          <div className="mb-6 rounded-md bg-red-50 p-4">
            <p className="text-sm text-red-700">{error}</p>
          </div>
        )}

        {/* Validation errors */}
        {validationErrors.length > 0 && (
          <div className="mb-6 rounded-md bg-red-50 p-4">
            <h3 className="text-sm font-medium text-red-800">
              Please fix the following:
            </h3>
            <ul className="mt-2 list-disc pl-5 text-sm text-red-700">
              {validationErrors.map((err, i) => (
                <li key={i}>{err}</li>
              ))}
            </ul>
          </div>
        )}

        {/* Side-by-side comparison */}
        <div className="space-y-6">
          {/* Research Summary */}
          <ComparisonSection
            label="Research Summary"
            changed={changedFields.includes("researchSummary")}
          >
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <SectionLabel>Current</SectionLabel>
                <div className="rounded-md bg-white border border-gray-200 p-4 text-sm text-gray-700 leading-relaxed">
                  {current.researchSummary}
                </div>
              </div>
              <div>
                <SectionLabel>
                  {editMode ? "Updated (editing)" : "Updated"}
                </SectionLabel>
                {editMode && editedFields ? (
                  <div>
                    <textarea
                      value={editedFields.researchSummary}
                      onChange={(e) =>
                        updateEditedField("researchSummary", e.target.value)
                      }
                      rows={8}
                      className="block w-full rounded-md border border-blue-300 bg-blue-50 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                    />
                    <p
                      className={`mt-1 text-xs ${
                        countWords(editedFields.researchSummary) >= 150 &&
                        countWords(editedFields.researchSummary) <= 250
                          ? "text-gray-500"
                          : "text-red-600"
                      }`}
                    >
                      {countWords(editedFields.researchSummary)} / 150-250 words
                    </p>
                  </div>
                ) : (
                  <div
                    className={`rounded-md border p-4 text-sm leading-relaxed ${
                      changedFields.includes("researchSummary")
                        ? "bg-green-50 border-green-200 text-green-900"
                        : "bg-white border-gray-200 text-gray-700"
                    }`}
                  >
                    {candidate.researchSummary}
                  </div>
                )}
              </div>
            </div>
          </ComparisonSection>

          {/* Array fields */}
          <ArrayComparisonSection
            label="Techniques"
            fieldKey="techniques"
            current={current.techniques}
            candidate={candidate.techniques}
            changed={changedFields.includes("techniques")}
            editMode={editMode}
            editedValues={editedFields?.techniques}
            onEditChange={(v) => updateEditedField("techniques", v)}
            minItems={3}
            helpText="Specific methodologies"
          />

          <ArrayComparisonSection
            label="Experimental Models"
            fieldKey="experimentalModels"
            current={current.experimentalModels}
            candidate={candidate.experimentalModels}
            changed={changedFields.includes("experimentalModels")}
            editMode={editMode}
            editedValues={editedFields?.experimentalModels}
            onEditChange={(v) => updateEditedField("experimentalModels", v)}
            helpText="Organisms, cell lines, databases"
          />

          <ArrayComparisonSection
            label="Disease Areas"
            fieldKey="diseaseAreas"
            current={current.diseaseAreas}
            candidate={candidate.diseaseAreas}
            changed={changedFields.includes("diseaseAreas")}
            editMode={editMode}
            editedValues={editedFields?.diseaseAreas}
            onEditChange={(v) => updateEditedField("diseaseAreas", v)}
            minItems={1}
            helpText="Disease terms or biological processes"
          />

          <ArrayComparisonSection
            label="Key Targets"
            fieldKey="keyTargets"
            current={current.keyTargets}
            candidate={candidate.keyTargets}
            changed={changedFields.includes("keyTargets")}
            editMode={editMode}
            editedValues={editedFields?.keyTargets}
            onEditChange={(v) => updateEditedField("keyTargets", v)}
            minItems={1}
            helpText="Proteins, pathways, or molecular systems"
          />

          <ArrayComparisonSection
            label="Keywords"
            fieldKey="keywords"
            current={current.keywords}
            candidate={candidate.keywords}
            changed={changedFields.includes("keywords")}
            editMode={editMode}
            editedValues={editedFields?.keywords}
            onEditChange={(v) => updateEditedField("keywords", v)}
            helpText="Additional terms"
          />

          <ArrayComparisonSection
            label="Grant Titles"
            fieldKey="grantTitles"
            current={current.grantTitles}
            candidate={candidate.grantTitles}
            changed={changedFields.includes("grantTitles")}
            editMode={false}
            helpText="Sourced from ORCID (not editable)"
          />
        </div>

        {/* Action buttons */}
        <div className="mt-10 flex flex-wrap justify-between gap-4 border-t border-gray-200 pt-6">
          <button
            type="button"
            onClick={handleDismiss}
            disabled={submitting}
            className="rounded-md border border-gray-300 px-5 py-2.5 text-sm font-medium text-gray-700 hover:bg-gray-100 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Dismiss Update
          </button>

          <div className="flex gap-3">
            {editMode ? (
              <>
                <button
                  type="button"
                  onClick={handleCancelEdit}
                  disabled={submitting}
                  className="rounded-md border border-gray-300 px-5 py-2.5 text-sm font-medium text-gray-700 hover:bg-gray-100 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  Cancel Editing
                </button>
                <button
                  type="button"
                  onClick={handleAccept}
                  disabled={submitting}
                  className="rounded-md bg-blue-600 px-6 py-2.5 text-sm font-medium text-white shadow-sm hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {submitting ? "Saving..." : "Save Edited Profile"}
                </button>
              </>
            ) : (
              <>
                <button
                  type="button"
                  onClick={handleEnterEditMode}
                  disabled={submitting}
                  className="rounded-md border border-blue-300 px-5 py-2.5 text-sm font-medium text-blue-700 hover:bg-blue-50 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  Edit & Accept
                </button>
                <button
                  type="button"
                  onClick={handleAccept}
                  disabled={submitting}
                  className="rounded-md bg-green-600 px-6 py-2.5 text-sm font-medium text-white shadow-sm hover:bg-green-700 focus:outline-none focus:ring-2 focus:ring-green-500 focus:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {submitting ? "Accepting..." : "Accept as-is"}
                </button>
              </>
            )}
          </div>
        </div>
      </div>
    </main>
  );
}

/** Section wrapper with change indicator. */
function ComparisonSection({
  label,
  changed,
  children,
}: {
  label: string;
  changed: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-lg bg-white p-6 shadow-sm">
      <div className="mb-4 flex items-center gap-2">
        <h2 className="text-lg font-semibold text-gray-900">{label}</h2>
        {changed && (
          <span className="inline-flex items-center rounded-full bg-amber-100 px-2.5 py-0.5 text-xs font-medium text-amber-800">
            Changed
          </span>
        )}
      </div>
      {children}
    </div>
  );
}

/** Label for current/updated column. */
function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <p className="mb-2 text-xs font-medium uppercase tracking-wide text-gray-500">
      {children}
    </p>
  );
}

/** Side-by-side comparison for array fields with diff highlighting. */
function ArrayComparisonSection({
  label,
  fieldKey,
  current,
  candidate,
  changed,
  editMode,
  editedValues,
  onEditChange,
  minItems,
  helpText,
}: {
  label: string;
  fieldKey: string;
  current: string[];
  candidate: string[];
  changed: boolean;
  editMode: boolean;
  editedValues?: string[];
  onEditChange?: (values: string[]) => void;
  minItems?: number;
  helpText?: string;
}) {
  // Compute added/removed items for diff display
  const currentLower = new Set(current.map((s) => s.toLowerCase()));
  const candidateLower = new Set(candidate.map((s) => s.toLowerCase()));
  const added = candidate.filter((s) => !currentLower.has(s.toLowerCase()));
  const removed = current.filter((s) => !candidateLower.has(s.toLowerCase()));
  const kept = current.filter((s) => candidateLower.has(s.toLowerCase()));

  return (
    <ComparisonSection label={label} changed={changed}>
      {helpText && (
        <p className="mb-3 -mt-2 text-xs text-gray-500">{helpText}</p>
      )}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Current */}
        <div>
          <SectionLabel>Current</SectionLabel>
          <div className="rounded-md border border-gray-200 bg-white p-3">
            <div className="flex flex-wrap gap-1.5">
              {current.length === 0 ? (
                <span className="text-sm text-gray-400 italic">None</span>
              ) : (
                current.map((item, i) => (
                  <span
                    key={`${fieldKey}-current-${i}`}
                    className={`inline-flex items-center rounded-full px-2.5 py-1 text-xs font-medium ${
                      removed.some(
                        (r) => r.toLowerCase() === item.toLowerCase(),
                      )
                        ? "bg-red-100 text-red-800 line-through"
                        : "bg-gray-100 text-gray-700"
                    }`}
                  >
                    {item}
                  </span>
                ))
              )}
            </div>
          </div>
        </div>

        {/* Candidate / Edited */}
        <div>
          <SectionLabel>
            {editMode ? "Updated (editing)" : "Updated"}
          </SectionLabel>
          {editMode && editedValues && onEditChange ? (
            <TagInput
              label=""
              items={editedValues}
              onChange={onEditChange}
              minItems={minItems}
            />
          ) : (
            <div
              className={`rounded-md border p-3 ${
                changed
                  ? "border-green-200 bg-green-50"
                  : "border-gray-200 bg-white"
              }`}
            >
              <div className="flex flex-wrap gap-1.5">
                {candidate.length === 0 ? (
                  <span className="text-sm text-gray-400 italic">None</span>
                ) : (
                  candidate.map((item, i) => (
                    <span
                      key={`${fieldKey}-candidate-${i}`}
                      className={`inline-flex items-center rounded-full px-2.5 py-1 text-xs font-medium ${
                        added.some(
                          (a) => a.toLowerCase() === item.toLowerCase(),
                        )
                          ? "bg-green-200 text-green-800"
                          : kept.some(
                                (k) => k.toLowerCase() === item.toLowerCase(),
                              )
                            ? "bg-gray-100 text-gray-700"
                            : "bg-gray-100 text-gray-700"
                      }`}
                    >
                      {item}
                      {added.some(
                        (a) => a.toLowerCase() === item.toLowerCase(),
                      ) && (
                        <span className="ml-1 text-green-600" aria-label="new">
                          +
                        </span>
                      )}
                    </span>
                  ))
                )}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Diff summary for changed fields */}
      {changed && !editMode && (added.length > 0 || removed.length > 0) && (
        <div className="mt-2 text-xs text-gray-500">
          {added.length > 0 && (
            <span className="text-green-600">
              +{added.length} added
            </span>
          )}
          {added.length > 0 && removed.length > 0 && <span> / </span>}
          {removed.length > 0 && (
            <span className="text-red-600">
              -{removed.length} removed
            </span>
          )}
        </div>
      )}
    </ComparisonSection>
  );
}
