/**
 * Onboarding profile generation progress page.
 *
 * Shown to new users after ORCID login. Triggers the profile pipeline
 * and displays real-time progress as publications are fetched, analyzed,
 * and synthesized into a researcher profile.
 *
 * Spec reference: auth-and-user-management.md, Signup Flow step 2:
 * "Profile pipeline runs → Show progress indicator:
 *  Pulling your publications... Analyzing your research... Building your profile..."
 */

"use client";

import { useEffect, useRef, useState } from "react";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";

interface StatusResponse {
  stage: string;
  message: string;
  warnings: string[];
  error?: string;
  hasProfile?: boolean;
}

/** Visible progress steps shown in the UI. */
const PROGRESS_STEPS = [
  { key: "fetching_orcid", label: "Pulling your publications" },
  { key: "fetching_publications", label: "Fetching abstracts" },
  { key: "mining_methods", label: "Analyzing your research" },
  { key: "synthesizing", label: "Building your profile" },
];

/** Ordered stages for computing progress. */
const STAGE_ORDER = [
  "not_started",
  "starting",
  "fetching_orcid",
  "fetching_publications",
  "mining_methods",
  "synthesizing",
  "complete",
];

function stageIndex(stage: string): number {
  const idx = STAGE_ORDER.indexOf(stage);
  return idx >= 0 ? idx : 0;
}

export default function OnboardingPage() {
  const { data: session, status: sessionStatus } = useSession();
  const router = useRouter();
  const [status, setStatus] = useState<StatusResponse | null>(null);
  const [retryKey, setRetryKey] = useState(0);
  const triggeredRef = useRef(false);

  useEffect(() => {
    if (sessionStatus !== "authenticated") return;

    let active = true;
    triggeredRef.current = false;

    async function fetchStatus(): Promise<StatusResponse | null> {
      try {
        const res = await fetch("/api/onboarding/profile-status");
        if (!active) return null;
        return (await res.json()) as StatusResponse;
      } catch {
        return null;
      }
    }

    async function triggerPipeline() {
      if (triggeredRef.current) return;
      triggeredRef.current = true;
      try {
        const res = await fetch("/api/onboarding/generate-profile", {
          method: "POST",
        });
        const data = (await res.json()) as { status: string };
        if (data.status === "already_exists" && active) {
          router.replace("/");
        }
      } catch {
        // Pipeline start failure will be caught by status polling
      }
    }

    async function run() {
      // Initial status check
      const initial = await fetchStatus();
      if (!active) return;

      // Already has a profile — redirect to home
      if (initial?.hasProfile) {
        router.replace("/");
        return;
      }

      // Trigger pipeline if not yet started or if previous run errored
      if (
        !initial ||
        initial.stage === "not_started" ||
        initial.stage === "error"
      ) {
        await triggerPipeline();
      } else {
        setStatus(initial);
      }

      // Poll until complete or error
      while (active) {
        await new Promise((r) => setTimeout(r, 2000));
        if (!active) break;

        const data = await fetchStatus();
        if (!active || !data) continue;

        setStatus(data);

        if (data.stage === "complete") {
          // Brief delay to show completion state, then redirect
          await new Promise((r) => setTimeout(r, 2500));
          if (active) router.replace("/");
          break;
        }
        if (data.stage === "error") {
          break;
        }
      }
    }

    run();
    return () => {
      active = false;
    };
  }, [sessionStatus, retryKey, router]);

  // Loading state while session is being fetched
  if (sessionStatus === "loading") {
    return (
      <main className="flex min-h-screen items-center justify-center">
        <p className="animate-pulse text-gray-400">Loading...</p>
      </main>
    );
  }

  const currentIdx = status ? stageIndex(status.stage) : 0;
  const isComplete = status?.stage === "complete";
  const isError = status?.stage === "error";

  return (
    <main className="flex min-h-screen flex-col items-center justify-center p-8">
      <div className="w-full max-w-md">
        <h1 className="text-3xl font-bold tracking-tight text-center">CoPI</h1>
        <p className="mt-2 text-center text-sm text-gray-500">
          Setting up your research profile
        </p>

        {/* Progress steps */}
        <div className="mt-10 space-y-5">
          {PROGRESS_STEPS.map((step) => {
            const stepIdx = stageIndex(step.key);
            const isDone = isComplete || currentIdx > stepIdx;
            const isActive =
              !isComplete && !isError && status?.stage === step.key;

            return (
              <div key={step.key} className="flex items-center gap-3">
                <div className="flex-shrink-0 w-7 h-7 flex items-center justify-center">
                  {isDone ? (
                    <svg
                      className="w-5 h-5 text-green-500"
                      fill="none"
                      viewBox="0 0 24 24"
                      stroke="currentColor"
                      strokeWidth={2.5}
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        d="M5 13l4 4L19 7"
                      />
                    </svg>
                  ) : isActive ? (
                    <div className="w-5 h-5 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
                  ) : (
                    <div className="w-4 h-4 rounded-full border-2 border-gray-300" />
                  )}
                </div>
                <span
                  className={`text-sm font-medium ${
                    isDone
                      ? "text-green-700"
                      : isActive
                        ? "text-blue-700"
                        : "text-gray-400"
                  }`}
                >
                  {step.label}
                  {isActive ? "..." : ""}
                </span>
              </div>
            );
          })}
        </div>

        {/* Completion state */}
        {status?.stage === "complete" && (
          <div className="mt-8 text-center space-y-2">
            <p className="text-green-600 font-medium">
              Your profile is ready!
            </p>
            {status.warnings.length > 0 &&
              status.warnings.map((w, i) => (
                <p key={i} className="text-sm text-amber-600">
                  {w}
                </p>
              ))}
            <p className="mt-2 text-xs text-gray-400">Redirecting...</p>
          </div>
        )}

        {/* Error state */}
        {status?.stage === "error" && (
          <div className="mt-8 text-center space-y-3">
            <p className="text-red-600 font-medium">Something went wrong</p>
            {status.error && (
              <p className="text-sm text-red-500">{status.error}</p>
            )}
            <button
              onClick={() => setRetryKey((k) => k + 1)}
              className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 transition-colors"
            >
              Try again
            </button>
          </div>
        )}

        {/* Welcome message while pipeline is running */}
        {!isComplete && !isError && session?.user?.name && (
          <p className="mt-8 text-center text-xs text-gray-400">
            Welcome, {session.user.name}! This usually takes 1–2 minutes.
          </p>
        )}
      </div>
    </main>
  );
}
