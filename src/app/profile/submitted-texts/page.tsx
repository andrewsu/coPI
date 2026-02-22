/**
 * User-submitted text management page.
 *
 * Allows users to add, edit, and delete free-text submissions that inform
 * profile synthesis and the matching engine. Max 5 entries, each max 2000 words.
 *
 * Spec reference: auth-and-user-management.md, User-Submitted Texts:
 * "Users can add, replace, and delete submissions."
 *
 * Privacy: user-submitted texts are NEVER shown to other users. They inform
 * profile synthesis and the matching engine only.
 */

"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useSession } from "next-auth/react";

const MAX_ENTRIES = 5;
const MAX_WORDS_PER_ENTRY = 2000;

interface SubmittedText {
  label: string;
  content: string;
  submitted_at: string;
}

/** Counts words in text using whitespace splitting. */
function countWords(text: string): number {
  return text
    .trim()
    .split(/\s+/)
    .filter((w) => w.length > 0).length;
}

export default function SubmittedTextsPage() {
  const { status: sessionStatus } = useSession();
  const router = useRouter();

  const [texts, setTexts] = useState<SubmittedText[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saveErrors, setSaveErrors] = useState<string[]>([]);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [dirty, setDirty] = useState(false);

  // Track which entry is being edited (index), or null if adding new
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const [editLabel, setEditLabel] = useState("");
  const [editContent, setEditContent] = useState("");
  const [isAdding, setIsAdding] = useState(false);

  // Fetch submitted texts on mount
  useEffect(() => {
    if (sessionStatus !== "authenticated") return;

    async function fetchTexts() {
      try {
        const res = await fetch("/api/profile/submitted-texts");
        if (res.status === 404) {
          router.replace("/onboarding");
          return;
        }
        if (!res.ok) {
          throw new Error("Failed to load submitted texts");
        }
        const data = await res.json();
        setTexts(data.texts || []);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load submitted texts");
      } finally {
        setLoading(false);
      }
    }

    fetchTexts();
  }, [sessionStatus, router]);

  /** Save all texts to the server via PUT. */
  const handleSave = useCallback(async () => {
    if (!dirty) return;

    setSaving(true);
    setSaveErrors([]);
    setError(null);
    setSaveSuccess(false);

    try {
      const res = await fetch("/api/profile/submitted-texts", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          texts: texts.map((t) => ({ label: t.label, content: t.content })),
        }),
      });

      if (res.status === 422) {
        const data = await res.json();
        setSaveErrors(data.details || []);
        return;
      }

      if (!res.ok) {
        throw new Error("Failed to save submitted texts");
      }

      const data = await res.json();
      setTexts(data.texts || []);
      setDirty(false);
      setSaveSuccess(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save submitted texts");
    } finally {
      setSaving(false);
    }
  }, [texts, dirty]);

  /** Start adding a new entry. */
  const startAdd = useCallback(() => {
    setEditingIndex(null);
    setEditLabel("");
    setEditContent("");
    setIsAdding(true);
    setSaveErrors([]);
    setSaveSuccess(false);
  }, []);

  /** Start editing an existing entry. */
  const startEdit = useCallback(
    (index: number) => {
      const entry = texts[index];
      if (!entry) return;
      setEditingIndex(index);
      setEditLabel(entry.label);
      setEditContent(entry.content);
      setIsAdding(false);
      setSaveErrors([]);
      setSaveSuccess(false);
    },
    [texts],
  );

  /** Cancel add/edit. */
  const cancelEdit = useCallback(() => {
    setEditingIndex(null);
    setIsAdding(false);
    setEditLabel("");
    setEditContent("");
  }, []);

  /** Confirm adding a new entry. */
  const confirmAdd = useCallback(() => {
    if (!editLabel.trim() || !editContent.trim()) return;

    const newEntry: SubmittedText = {
      label: editLabel.trim(),
      content: editContent.trim(),
      submitted_at: new Date().toISOString(),
    };
    setTexts((prev) => [...prev, newEntry]);
    setDirty(true);
    setIsAdding(false);
    setEditLabel("");
    setEditContent("");
    setSaveSuccess(false);
  }, [editLabel, editContent]);

  /** Confirm editing an existing entry. */
  const confirmEdit = useCallback(() => {
    if (editingIndex === null || !editLabel.trim() || !editContent.trim()) return;

    setTexts((prev) =>
      prev.map((t, i) =>
        i === editingIndex
          ? { ...t, label: editLabel.trim(), content: editContent.trim() }
          : t,
      ),
    );
    setDirty(true);
    setEditingIndex(null);
    setEditLabel("");
    setEditContent("");
    setSaveSuccess(false);
  }, [editingIndex, editLabel, editContent]);

  /** Delete an entry by index. */
  const deleteEntry = useCallback((index: number) => {
    setTexts((prev) => prev.filter((_, i) => i !== index));
    setDirty(true);
    setSaveSuccess(false);
    // Cancel edit if we're editing the deleted entry
    setEditingIndex((prev) => {
      if (prev === index) {
        setIsAdding(false);
        setEditLabel("");
        setEditContent("");
        return null;
      }
      // Adjust index if we deleted before the current editing index
      if (prev !== null && prev > index) return prev - 1;
      return prev;
    });
  }, []);

  const handleBack = useCallback(() => {
    router.push("/profile/edit");
  }, [router]);

  const editWordCount = countWords(editContent);
  const editOverLimit = editWordCount > MAX_WORDS_PER_ENTRY;
  const canConfirmEdit =
    editLabel.trim().length > 0 &&
    editContent.trim().length > 0 &&
    !editOverLimit;
  const canAdd = texts.length < MAX_ENTRIES && !isAdding && editingIndex === null;
  const isEditingAny = isAdding || editingIndex !== null;

  // Loading states
  if (sessionStatus === "loading" || loading) {
    return (
      <main className="flex min-h-screen items-center justify-center">
        <p className="animate-pulse text-gray-400">Loading...</p>
      </main>
    );
  }

  if (error && texts.length === 0 && !dirty) {
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

  return (
    <main className="min-h-screen bg-gray-50 py-10 px-4">
      <div className="mx-auto max-w-2xl">
        {/* Header */}
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
            Back to profile
          </button>
          <h1 className="text-3xl font-bold tracking-tight">Research Texts</h1>
          <p className="mt-2 text-sm text-gray-500">
            Add text about your research priorities, such as grant specific aims,
            research statements, or descriptions of equipment and resources.
            These inform your profile synthesis and collaboration matching.
          </p>
        </div>

        {/* Privacy notice */}
        <div className="mb-6 rounded-md bg-amber-50 border border-amber-200 p-4">
          <p className="text-sm text-amber-800">
            <strong>Privacy:</strong> Your submitted texts are never shown to other
            researchers. They are only used to improve your profile synthesis and
            collaboration matching.
          </p>
        </div>

        {/* Success message */}
        {saveSuccess && (
          <div className="mb-6 rounded-md bg-green-50 p-4">
            <p className="text-sm text-green-700">Changes saved successfully.</p>
          </div>
        )}

        {/* Validation errors from server */}
        {saveErrors.length > 0 && (
          <div className="mb-6 rounded-md bg-red-50 p-4">
            <h3 className="text-sm font-medium text-red-800">Please fix the following:</h3>
            <ul className="mt-2 list-disc pl-5 text-sm text-red-700">
              {saveErrors.map((err, i) => (
                <li key={i}>{err}</li>
              ))}
            </ul>
          </div>
        )}

        {/* General error */}
        {error && (texts.length > 0 || dirty) && (
          <div className="mb-6 rounded-md bg-red-50 p-4">
            <p className="text-sm text-red-700">{error}</p>
          </div>
        )}

        {/* Entry count */}
        <div className="mb-4 flex items-center justify-between">
          <p className="text-sm text-gray-600">
            {texts.length} of {MAX_ENTRIES} texts used
          </p>
          {canAdd && (
            <button
              onClick={startAdd}
              className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
            >
              Add Text
            </button>
          )}
        </div>

        {/* Add form */}
        {isAdding && (
          <div className="mb-6 rounded-lg bg-white p-6 shadow-sm border-2 border-blue-200">
            <h3 className="text-sm font-medium text-gray-700 mb-4">New Submission</h3>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700">
                  Label
                </label>
                <p className="mt-0.5 text-xs text-gray-500">
                  e.g., &quot;R01 specific aims&quot;, &quot;current research interests&quot;,
                  &quot;equipment and resources&quot;
                </p>
                <input
                  type="text"
                  value={editLabel}
                  onChange={(e) => setEditLabel(e.target.value)}
                  placeholder="Give this text a descriptive label"
                  className="mt-1.5 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                  data-testid="edit-label"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700">
                  Content
                </label>
                <textarea
                  value={editContent}
                  onChange={(e) => setEditContent(e.target.value)}
                  rows={8}
                  placeholder="Paste or type your research text here"
                  className="mt-1.5 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                  data-testid="edit-content"
                />
                <p
                  className={`mt-1 text-xs ${
                    editOverLimit ? "text-red-600" : "text-gray-500"
                  }`}
                >
                  {editWordCount} / {MAX_WORDS_PER_ENTRY} words
                </p>
              </div>
              <div className="flex gap-2">
                <button
                  onClick={confirmAdd}
                  disabled={!canConfirmEdit}
                  className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  Add
                </button>
                <button
                  onClick={cancelEdit}
                  className="rounded-md border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-100"
                >
                  Cancel
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Existing entries */}
        {texts.length === 0 && !isAdding && (
          <div className="rounded-lg bg-white p-8 shadow-sm text-center">
            <p className="text-gray-500">
              No submitted texts yet. Add research texts to improve your profile
              and matching quality.
            </p>
          </div>
        )}

        <div className="space-y-4">
          {texts.map((text, index) => (
            <div key={index} className="rounded-lg bg-white p-6 shadow-sm">
              {editingIndex === index ? (
                /* Edit form for existing entry */
                <div className="space-y-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700">
                      Label
                    </label>
                    <input
                      type="text"
                      value={editLabel}
                      onChange={(e) => setEditLabel(e.target.value)}
                      className="mt-1.5 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                      data-testid="edit-label"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700">
                      Content
                    </label>
                    <textarea
                      value={editContent}
                      onChange={(e) => setEditContent(e.target.value)}
                      rows={8}
                      className="mt-1.5 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                      data-testid="edit-content"
                    />
                    <p
                      className={`mt-1 text-xs ${
                        editOverLimit ? "text-red-600" : "text-gray-500"
                      }`}
                    >
                      {editWordCount} / {MAX_WORDS_PER_ENTRY} words
                    </p>
                  </div>
                  <div className="flex gap-2">
                    <button
                      onClick={confirmEdit}
                      disabled={!canConfirmEdit}
                      className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      Save
                    </button>
                    <button
                      onClick={cancelEdit}
                      className="rounded-md border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-100"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              ) : (
                /* Read-only display */
                <div>
                  <div className="flex items-start justify-between">
                    <div>
                      <h3 className="text-sm font-medium text-gray-900">
                        {text.label}
                      </h3>
                      <p className="mt-0.5 text-xs text-gray-400">
                        {countWords(text.content)} words
                        {text.submitted_at &&
                          ` \u00B7 Added ${new Date(text.submitted_at).toLocaleDateString()}`}
                      </p>
                    </div>
                    <div className="flex gap-2">
                      <button
                        onClick={() => startEdit(index)}
                        disabled={isEditingAny}
                        className="text-sm text-blue-600 hover:text-blue-800 disabled:opacity-40 disabled:cursor-not-allowed"
                        data-testid={`edit-button-${index}`}
                      >
                        Edit
                      </button>
                      <button
                        onClick={() => deleteEntry(index)}
                        disabled={isEditingAny}
                        className="text-sm text-red-600 hover:text-red-800 disabled:opacity-40 disabled:cursor-not-allowed"
                        data-testid={`delete-button-${index}`}
                      >
                        Delete
                      </button>
                    </div>
                  </div>
                  <p className="mt-3 text-sm text-gray-700 whitespace-pre-wrap line-clamp-4">
                    {text.content}
                  </p>
                </div>
              )}
            </div>
          ))}
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
