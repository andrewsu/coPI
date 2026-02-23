/**
 * Settings page — user privacy and notification preferences.
 *
 * Allows users to control:
 * - Email visibility (public_profile, mutual_matches, never)
 * - Allow incoming proposals toggle
 * - Notification preferences (master switch + per-type toggles)
 *
 * Also provides links to:
 * - User-submitted text management
 * - Profile refresh
 *
 * Spec reference: auth-and-user-management.md §Settings,
 * notifications.md §User preferences.
 */

"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { signOut, useSession } from "next-auth/react";
import Link from "next/link";

interface SettingsData {
  emailVisibility: "public_profile" | "mutual_matches" | "never";
  allowIncomingProposals: boolean;
  emailNotificationsEnabled: boolean;
  notifyMatches: boolean;
  notifyNewProposals: boolean;
  notifyProfileRefresh: boolean;
}

const EMAIL_VISIBILITY_OPTIONS = [
  {
    value: "public_profile" as const,
    label: "Public profile",
    description: "Your email is visible on your public profile and in matches.",
  },
  {
    value: "mutual_matches" as const,
    label: "Mutual matches only",
    description:
      "Your email is only shared when both parties express interest.",
  },
  {
    value: "never" as const,
    label: "Never",
    description:
      "Your email is never shared. Collaborators are directed to your institutional directory.",
  },
];

export default function SettingsPage() {
  const { status: sessionStatus } = useSession();
  const router = useRouter();

  const [settings, setSettings] = useState<SettingsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [saveErrors, setSaveErrors] = useState<string[]>([]);

  // Confirmation modal state for disabling match notifications
  const [showMatchConfirm, setShowMatchConfirm] = useState(false);

  // Account deletion state
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deleteConfirmChecked, setDeleteConfirmChecked] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  // Fetch settings on mount
  useEffect(() => {
    if (sessionStatus !== "authenticated") return;

    async function fetchSettings() {
      try {
        const res = await fetch("/api/settings");
        if (!res.ok) {
          throw new Error("Failed to load settings");
        }
        const data = (await res.json()) as SettingsData;
        setSettings(data);
      } catch (err) {
        setError(
          err instanceof Error ? err.message : "Failed to load settings",
        );
      } finally {
        setLoading(false);
      }
    }

    fetchSettings();
  }, [sessionStatus]);

  /** Update a single settings field and mark as dirty. */
  const updateField = useCallback(
    <K extends keyof SettingsData>(field: K, value: SettingsData[K]) => {
      setSettings((prev) => (prev ? { ...prev, [field]: value } : prev));
      setDirty(true);
      setSaveErrors([]);
      setSaveSuccess(false);
    },
    [],
  );

  /** Handle match notifications toggle with confirmation when turning off. */
  const handleMatchNotifyToggle = useCallback(() => {
    if (!settings) return;
    if (settings.notifyMatches) {
      // Turning off — show confirmation
      setShowMatchConfirm(true);
    } else {
      // Turning on — no confirmation needed
      updateField("notifyMatches", true);
    }
  }, [settings, updateField]);

  /** Confirm turning off match notifications. */
  const confirmDisableMatchNotify = useCallback(() => {
    updateField("notifyMatches", false);
    setShowMatchConfirm(false);
  }, [updateField]);

  /** Save settings via PUT /api/settings. */
  const handleSave = useCallback(async () => {
    if (!settings || !dirty) return;

    setSaving(true);
    setSaveErrors([]);
    setError(null);
    setSaveSuccess(false);

    try {
      const res = await fetch("/api/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(settings),
      });

      if (res.status === 422) {
        const data = (await res.json()) as { details: string[] };
        setSaveErrors(data.details);
        return;
      }

      if (!res.ok) {
        throw new Error("Failed to save settings");
      }

      const updated = (await res.json()) as SettingsData;
      setSettings(updated);
      setDirty(false);
      setSaveSuccess(true);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to save settings",
      );
    } finally {
      setSaving(false);
    }
  }, [settings, dirty]);

  /** Discard unsaved changes by reloading from server. */
  const handleDiscard = useCallback(async () => {
    setLoading(true);
    setDirty(false);
    setSaveErrors([]);
    setSaveSuccess(false);
    setError(null);

    try {
      const res = await fetch("/api/settings");
      if (!res.ok) throw new Error("Failed to reload settings");
      const data = (await res.json()) as SettingsData;
      setSettings(data);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to reload settings",
      );
    } finally {
      setLoading(false);
    }
  }, []);

  /** Handle account deletion via DELETE /api/account. */
  const handleDeleteAccount = useCallback(async () => {
    setDeleting(true);
    setDeleteError(null);

    try {
      const res = await fetch("/api/account", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ confirm: true }),
      });

      if (!res.ok) {
        const data = (await res.json()) as { error: string };
        throw new Error(data.error || "Failed to delete account");
      }

      // Sign out and redirect to login
      await signOut({ callbackUrl: "/login" });
    } catch (err) {
      setDeleteError(
        err instanceof Error ? err.message : "Failed to delete account",
      );
      setDeleting(false);
    }
  }, []);

  // Loading states
  if (sessionStatus === "loading" || loading) {
    return (
      <main className="flex min-h-screen items-center justify-center">
        <p className="animate-pulse text-gray-400">Loading settings...</p>
      </main>
    );
  }

  if (error && !settings) {
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

  if (!settings) return null;

  return (
    <main className="min-h-screen bg-gray-50 py-10 px-4">
      <div className="mx-auto max-w-2xl">
        {/* Header with back navigation */}
        <div className="mb-8">
          <button
            onClick={() => router.push("/")}
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
          <h1 className="text-3xl font-bold tracking-tight">Settings</h1>
          <p className="mt-2 text-sm text-gray-500">
            Manage your privacy preferences and notification settings.
          </p>
        </div>

        {/* Success message */}
        {saveSuccess && (
          <div className="mb-6 rounded-md bg-green-50 p-4">
            <p className="text-sm text-green-700">Settings saved successfully.</p>
          </div>
        )}

        {/* Validation errors */}
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
        {error && settings && (
          <div className="mb-6 rounded-md bg-red-50 p-4">
            <p className="text-sm text-red-700">{error}</p>
          </div>
        )}

        <div className="space-y-6">
          {/* Email Visibility */}
          <section className="rounded-lg bg-white p-6 shadow-sm">
            <h2 className="text-lg font-semibold text-gray-900">
              Email Visibility
            </h2>
            <p className="mt-1 text-sm text-gray-500">
              Control who can see your email address when you match.
            </p>
            <fieldset className="mt-4 space-y-3">
              {EMAIL_VISIBILITY_OPTIONS.map((option) => (
                <label
                  key={option.value}
                  className={`flex cursor-pointer items-start gap-3 rounded-md border p-4 transition-colors ${
                    settings.emailVisibility === option.value
                      ? "border-blue-500 bg-blue-50"
                      : "border-gray-200 hover:bg-gray-50"
                  }`}
                >
                  <input
                    type="radio"
                    name="emailVisibility"
                    value={option.value}
                    checked={settings.emailVisibility === option.value}
                    onChange={() =>
                      updateField("emailVisibility", option.value)
                    }
                    className="mt-0.5 h-4 w-4 text-blue-600 focus:ring-blue-500"
                  />
                  <div>
                    <span className="text-sm font-medium text-gray-900">
                      {option.label}
                    </span>
                    <p className="mt-0.5 text-xs text-gray-500">
                      {option.description}
                    </p>
                  </div>
                </label>
              ))}
            </fieldset>
          </section>

          {/* Incoming Proposals */}
          <section className="rounded-lg bg-white p-6 shadow-sm">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-lg font-semibold text-gray-900">
                  Allow Incoming Proposals
                </h2>
                <p className="mt-1 text-sm text-gray-500">
                  When enabled, researchers who add you to their match pool can
                  generate collaboration proposals with you, even if you
                  haven&apos;t added them to yours.
                </p>
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={settings.allowIncomingProposals}
                onClick={() =>
                  updateField(
                    "allowIncomingProposals",
                    !settings.allowIncomingProposals,
                  )
                }
                className={`relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 ${
                  settings.allowIncomingProposals
                    ? "bg-blue-600"
                    : "bg-gray-200"
                }`}
              >
                <span
                  className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${
                    settings.allowIncomingProposals
                      ? "translate-x-5"
                      : "translate-x-0"
                  }`}
                />
              </button>
            </div>
          </section>

          {/* Notification Preferences */}
          <section className="rounded-lg bg-white p-6 shadow-sm">
            <h2 className="text-lg font-semibold text-gray-900">
              Email Notifications
            </h2>
            <p className="mt-1 text-sm text-gray-500">
              Choose which email notifications you&apos;d like to receive.
            </p>

            <div className="mt-4 space-y-4">
              {/* Master switch */}
              <div className="flex items-center justify-between border-b border-gray-100 pb-4">
                <div>
                  <span className="text-sm font-medium text-gray-900">
                    All email notifications
                  </span>
                  <p className="text-xs text-gray-500">
                    Master switch for all email notifications
                  </p>
                </div>
                <button
                  type="button"
                  role="switch"
                  aria-checked={settings.emailNotificationsEnabled}
                  onClick={() =>
                    updateField(
                      "emailNotificationsEnabled",
                      !settings.emailNotificationsEnabled,
                    )
                  }
                  className={`relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 ${
                    settings.emailNotificationsEnabled
                      ? "bg-blue-600"
                      : "bg-gray-200"
                  }`}
                >
                  <span
                    className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${
                      settings.emailNotificationsEnabled
                        ? "translate-x-5"
                        : "translate-x-0"
                    }`}
                  />
                </button>
              </div>

              {/* Individual toggles — dimmed when master switch is off */}
              <div
                className={
                  settings.emailNotificationsEnabled ? "" : "opacity-50"
                }
              >
                {/* Match notifications */}
                <div className="flex items-center justify-between py-3">
                  <div>
                    <span className="text-sm font-medium text-gray-900">
                      Match notifications
                    </span>
                    <p className="text-xs text-gray-500">
                      Get notified when someone you&apos;re interested in is also
                      interested in collaborating with you
                    </p>
                  </div>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={settings.notifyMatches}
                    disabled={!settings.emailNotificationsEnabled}
                    onClick={handleMatchNotifyToggle}
                    className={`relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 disabled:cursor-not-allowed ${
                      settings.notifyMatches ? "bg-blue-600" : "bg-gray-200"
                    }`}
                  >
                    <span
                      className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${
                        settings.notifyMatches
                          ? "translate-x-5"
                          : "translate-x-0"
                      }`}
                    />
                  </button>
                </div>

                {/* New proposals digest */}
                <div className="flex items-center justify-between py-3">
                  <div>
                    <span className="text-sm font-medium text-gray-900">
                      New proposals digest
                    </span>
                    <p className="text-xs text-gray-500">
                      Weekly summary of new collaboration proposals in your queue
                    </p>
                  </div>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={settings.notifyNewProposals}
                    disabled={!settings.emailNotificationsEnabled}
                    onClick={() =>
                      updateField(
                        "notifyNewProposals",
                        !settings.notifyNewProposals,
                      )
                    }
                    className={`relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 disabled:cursor-not-allowed ${
                      settings.notifyNewProposals
                        ? "bg-blue-600"
                        : "bg-gray-200"
                    }`}
                  >
                    <span
                      className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${
                        settings.notifyNewProposals
                          ? "translate-x-5"
                          : "translate-x-0"
                      }`}
                    />
                  </button>
                </div>

                {/* Profile refresh notifications */}
                <div className="flex items-center justify-between py-3">
                  <div>
                    <span className="text-sm font-medium text-gray-900">
                      Profile refresh notifications
                    </span>
                    <p className="text-xs text-gray-500">
                      Get notified when new publications are detected and your
                      profile is ready to update
                    </p>
                  </div>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={settings.notifyProfileRefresh}
                    disabled={!settings.emailNotificationsEnabled}
                    onClick={() =>
                      updateField(
                        "notifyProfileRefresh",
                        !settings.notifyProfileRefresh,
                      )
                    }
                    className={`relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 disabled:cursor-not-allowed ${
                      settings.notifyProfileRefresh
                        ? "bg-blue-600"
                        : "bg-gray-200"
                    }`}
                  >
                    <span
                      className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${
                        settings.notifyProfileRefresh
                          ? "translate-x-5"
                          : "translate-x-0"
                      }`}
                    />
                  </button>
                </div>
              </div>
            </div>
          </section>

          {/* Quick links to related pages */}
          <section className="rounded-lg bg-white p-6 shadow-sm">
            <h2 className="text-lg font-semibold text-gray-900">
              Profile & Data
            </h2>
            <div className="mt-4 space-y-3">
              <Link
                href="/profile/submitted-texts"
                className="flex items-center justify-between rounded-md border border-gray-200 px-4 py-3 text-sm hover:bg-gray-50"
              >
                <div>
                  <span className="font-medium text-gray-900">
                    Manage research texts
                  </span>
                  <p className="text-xs text-gray-500">
                    Add or edit free-text submissions that inform your profile
                    and matching
                  </p>
                </div>
                <svg
                  className="h-5 w-5 text-gray-400"
                  viewBox="0 0 20 20"
                  fill="currentColor"
                >
                  <path
                    fillRule="evenodd"
                    d="M7.21 14.77a.75.75 0 01.02-1.06L11.168 10 7.23 6.29a.75.75 0 111.04-1.08l4.5 4.25a.75.75 0 010 1.08l-4.5 4.25a.75.75 0 01-1.06-.02z"
                    clipRule="evenodd"
                  />
                </svg>
              </Link>
              <Link
                href="/profile/edit"
                className="flex items-center justify-between rounded-md border border-gray-200 px-4 py-3 text-sm hover:bg-gray-50"
              >
                <div>
                  <span className="font-medium text-gray-900">
                    Edit profile & refresh
                  </span>
                  <p className="text-xs text-gray-500">
                    Edit your research profile or trigger a full re-synthesis
                    from publications
                  </p>
                </div>
                <svg
                  className="h-5 w-5 text-gray-400"
                  viewBox="0 0 20 20"
                  fill="currentColor"
                >
                  <path
                    fillRule="evenodd"
                    d="M7.21 14.77a.75.75 0 01.02-1.06L11.168 10 7.23 6.29a.75.75 0 111.04-1.08l4.5 4.25a.75.75 0 010 1.08l-4.5 4.25a.75.75 0 01-1.06-.02z"
                    clipRule="evenodd"
                  />
                </svg>
              </Link>
            </div>
          </section>

          {/* Delete Account — danger zone */}
          <section className="rounded-lg border border-red-200 bg-white p-6 shadow-sm">
            <h2 className="text-lg font-semibold text-red-900">
              Delete Account
            </h2>
            <div className="mt-2 text-sm text-gray-600 space-y-2">
              <p>
                Permanently delete your account. This action cannot be undone.
              </p>
              <p className="font-medium text-gray-700">What will be deleted:</p>
              <ul className="list-disc pl-5 text-gray-600 space-y-1">
                <li>Your research profile and synthesized data</li>
                <li>All publications and submitted texts</li>
                <li>Swipe history and survey responses</li>
                <li>Match pool entries and affiliation selections</li>
              </ul>
              <p className="font-medium text-gray-700">What will be preserved:</p>
              <ul className="list-disc pl-5 text-gray-600 space-y-1">
                <li>
                  Collaboration proposals where the other researcher expressed
                  interest (your name and institution are retained, but your
                  profile and contact info are removed)
                </li>
              </ul>
              <p className="text-xs text-gray-500 mt-2">
                If you need a full scrub of all preserved data, you can email us
                after deletion.
              </p>
            </div>
            <button
              type="button"
              onClick={() => {
                setShowDeleteConfirm(true);
                setDeleteConfirmChecked(false);
                setDeleteError(null);
              }}
              className="mt-4 rounded-md border border-red-300 bg-white px-4 py-2 text-sm font-medium text-red-700 hover:bg-red-50"
            >
              Delete my account
            </button>
          </section>
        </div>

        {/* Action buttons */}
        <div className="mt-8 flex justify-between">
          <button
            type="button"
            onClick={dirty ? handleDiscard : () => router.push("/")}
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
            {saving ? "Saving..." : "Save Settings"}
          </button>
        </div>
      </div>

      {/* Match notification confirmation modal */}
      {showMatchConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="mx-4 max-w-sm rounded-lg bg-white p-6 shadow-xl">
            <h3 className="text-lg font-semibold text-gray-900">
              Disable match notifications?
            </h3>
            <p className="mt-2 text-sm text-gray-600">
              Are you sure? You won&apos;t be notified when someone wants to
              collaborate with you.
            </p>
            <div className="mt-4 flex justify-end gap-3">
              <button
                type="button"
                onClick={() => setShowMatchConfirm(false)}
                className="rounded-md border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-100"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={confirmDisableMatchNotify}
                className="rounded-md bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700"
              >
                Turn Off
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Account deletion confirmation modal */}
      {showDeleteConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="mx-4 max-w-md rounded-lg bg-white p-6 shadow-xl">
            <h3 className="text-lg font-semibold text-red-900">
              Delete your account?
            </h3>
            <p className="mt-2 text-sm text-gray-600">
              This will permanently delete your profile, publications, swipe
              history, and all associated data. Proposals where the other
              researcher expressed interest will be preserved with your name
              and institution only.
            </p>
            <p className="mt-2 text-sm text-gray-600">
              This action cannot be undone.
            </p>

            {deleteError && (
              <div className="mt-3 rounded-md bg-red-50 p-3">
                <p className="text-sm text-red-700">{deleteError}</p>
              </div>
            )}

            <label className="mt-4 flex items-start gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={deleteConfirmChecked}
                onChange={(e) => setDeleteConfirmChecked(e.target.checked)}
                className="mt-0.5 h-4 w-4 rounded border-gray-300 text-red-600 focus:ring-red-500"
              />
              <span className="text-sm text-gray-700">
                I understand that this action is permanent and my data will be
                deleted
              </span>
            </label>

            <div className="mt-4 flex justify-end gap-3">
              <button
                type="button"
                onClick={() => setShowDeleteConfirm(false)}
                disabled={deleting}
                className="rounded-md border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-100 disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleDeleteAccount}
                disabled={!deleteConfirmChecked || deleting}
                className="rounded-md bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {deleting ? "Deleting..." : "Delete Account"}
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
