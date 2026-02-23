/**
 * SurveyModal — Periodic quality survey shown after every Nth archive action.
 *
 * Asks: "What's the most common issue you've seen in recent proposals?"
 * Users can multi-select from predefined failure modes and optionally
 * provide free-text feedback. Responses are stored as SurveyResponse
 * records for aggregate quality analysis.
 *
 * Per spec, this survey is lightweight — users can skip it entirely.
 * The "Other" option reveals a free-text input field.
 *
 * Spec reference: specs/swipe-interface.md, "Periodic Survey" section.
 */

"use client";

import { useCallback, useState } from "react";

/** Failure mode options matching the spec and API validation. */
export const FAILURE_MODE_OPTIONS = [
  { value: "scientifically_nonsensical", label: "Scientifically nonsensical" },
  {
    value: "scientifically_uninteresting",
    label: "Scientifically uninteresting",
  },
  { value: "lack_of_synergy", label: "Lack of synergy between labs" },
  {
    value: "experiment_too_complex",
    label: "Initial experiment is too large/complex",
  },
  { value: "too_generic", label: "Too generic / not specific enough" },
  {
    value: "already_pursuing_similar",
    label: "Already pursuing something similar",
  },
  { value: "other", label: "Other" },
] as const;

interface SurveyModalProps {
  /** Called when the survey is submitted or skipped. */
  onClose: () => void;
}

export function SurveyModal({ onClose }: SurveyModalProps) {
  const [selectedModes, setSelectedModes] = useState<Set<string>>(new Set());
  const [freeText, setFreeText] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleToggle = useCallback((value: string) => {
    setSelectedModes((prev) => {
      const next = new Set(prev);
      if (next.has(value)) {
        next.delete(value);
      } else {
        next.add(value);
      }
      return next;
    });
  }, []);

  const handleSubmit = useCallback(async () => {
    if (selectedModes.size === 0) return;

    setSubmitting(true);
    setError(null);

    try {
      const body: { failureModes: string[]; freeText?: string } = {
        failureModes: Array.from(selectedModes),
      };
      if (selectedModes.has("other") && freeText.trim()) {
        body.freeText = freeText.trim();
      }

      const res = await fetch("/api/survey", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        throw new Error("Failed to submit survey");
      }

      onClose();
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to submit survey"
      );
    } finally {
      setSubmitting(false);
    }
  }, [selectedModes, freeText, onClose]);

  const showFreeText = selectedModes.has("other");

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
      role="dialog"
      aria-modal="true"
      aria-label="Proposal quality survey"
    >
      <div className="mx-4 w-full max-w-md rounded-xl bg-white shadow-xl">
        <div className="p-6">
          {/* Header */}
          <h3 className="text-lg font-semibold text-gray-900">
            Quick feedback
          </h3>
          <p className="mt-1 text-sm text-gray-600">
            What&apos;s the most common issue you&apos;ve seen in recent
            proposals?
          </p>

          {/* Options — multi-select checkboxes */}
          <div className="mt-4 space-y-2">
            {FAILURE_MODE_OPTIONS.map((option) => (
              <label
                key={option.value}
                className="flex items-start gap-3 rounded-lg border border-gray-200 p-3 cursor-pointer hover:bg-gray-50 transition-colors"
              >
                <input
                  type="checkbox"
                  checked={selectedModes.has(option.value)}
                  onChange={() => handleToggle(option.value)}
                  className="mt-0.5 h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                />
                <span className="text-sm text-gray-800">{option.label}</span>
              </label>
            ))}
          </div>

          {/* Free text input — shown when "Other" is selected */}
          {showFreeText && (
            <div className="mt-3">
              <textarea
                value={freeText}
                onChange={(e) => setFreeText(e.target.value)}
                placeholder="Tell us more (optional)..."
                maxLength={1000}
                rows={3}
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-800 placeholder-gray-400 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
              />
              <p className="mt-1 text-xs text-gray-400 text-right">
                {freeText.length}/1000
              </p>
            </div>
          )}

          {/* Error */}
          {error && (
            <p className="mt-3 text-sm text-red-600">{error}</p>
          )}

          {/* Actions */}
          <div className="mt-5 flex items-center justify-end gap-3">
            <button
              onClick={onClose}
              disabled={submitting}
              className="rounded-md px-4 py-2 text-sm font-medium text-gray-600 hover:text-gray-900 hover:bg-gray-100 transition-colors disabled:opacity-50"
            >
              Skip
            </button>
            <button
              onClick={handleSubmit}
              disabled={submitting || selectedModes.size === 0}
              className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {submitting ? "Submitting..." : "Submit"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
