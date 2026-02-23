"use client";

/**
 * Unsubscribe confirmation page shown after clicking an email unsubscribe link.
 *
 * Accessible without authentication (the unsubscribe API route redirects here
 * after processing the token). Shows success or error state based on query params.
 *
 * Query params:
 *   - status: "success" | "invalid"
 *   - type: notification type that was disabled (only on success)
 */

import { useSearchParams } from "next/navigation";
import { Suspense } from "react";

const TYPE_LABELS: Record<string, string> = {
  all: "all email notifications",
  matches: "match notifications",
  new_proposals: "new proposals digest emails",
  profile_refresh: "profile refresh notifications",
};

function UnsubscribeContent() {
  const searchParams = useSearchParams();
  const status = searchParams.get("status");
  const type = searchParams.get("type");

  const typeLabel = type ? TYPE_LABELS[type] ?? type : null;
  const isSuccess = status === "success";

  return (
    <main className="flex min-h-screen flex-col items-center justify-center p-8">
      <div className="w-full max-w-md space-y-6 text-center">
        <h1 className="text-3xl font-bold tracking-tight">CoPI</h1>

        {isSuccess ? (
          <div className="space-y-4">
            <div className="rounded-lg bg-green-50 p-6">
              <svg
                className="mx-auto h-12 w-12 text-green-500"
                fill="none"
                viewBox="0 0 24 24"
                strokeWidth={1.5}
                stroke="currentColor"
                aria-hidden="true"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
                />
              </svg>
              <h2 className="mt-3 text-lg font-semibold text-green-800">
                Successfully unsubscribed
              </h2>
              <p className="mt-2 text-sm text-green-700">
                You have been unsubscribed from{" "}
                <strong>{typeLabel}</strong>.
              </p>
            </div>

            <p className="text-sm text-gray-600">
              You can manage all your notification preferences from your{" "}
              <a
                href="/settings"
                className="text-blue-600 hover:underline font-medium"
              >
                account settings
              </a>
              .
            </p>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="rounded-lg bg-amber-50 p-6">
              <svg
                className="mx-auto h-12 w-12 text-amber-500"
                fill="none"
                viewBox="0 0 24 24"
                strokeWidth={1.5}
                stroke="currentColor"
                aria-hidden="true"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z"
                />
              </svg>
              <h2 className="mt-3 text-lg font-semibold text-amber-800">
                Invalid or expired link
              </h2>
              <p className="mt-2 text-sm text-amber-700">
                This unsubscribe link is no longer valid. It may have expired
                or already been used.
              </p>
            </div>

            <p className="text-sm text-gray-600">
              To manage your notification preferences, sign in and visit your{" "}
              <a
                href="/settings"
                className="text-blue-600 hover:underline font-medium"
              >
                account settings
              </a>
              .
            </p>
          </div>
        )}
      </div>
    </main>
  );
}

export default function UnsubscribePage() {
  return (
    <Suspense>
      <UnsubscribeContent />
    </Suspense>
  );
}
