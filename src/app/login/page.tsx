"use client";

import { signIn } from "next-auth/react";
import { useSearchParams } from "next/navigation";
import { Suspense } from "react";

function LoginContent() {
  const searchParams = useSearchParams();
  const error = searchParams.get("error");

  return (
    <main className="flex min-h-screen flex-col items-center justify-center p-8">
      <div className="w-full max-w-sm space-y-8 text-center">
        <div>
          <h1 className="text-4xl font-bold tracking-tight">CoPI</h1>
          <p className="mt-2 text-gray-600">
            Discover synergistic collaboration opportunities
          </p>
        </div>

        {error && (
          <div className="rounded-md bg-red-50 p-4 text-sm text-red-700">
            {error === "OAuthSignin" && "Could not start ORCID sign-in. Please try again."}
            {error === "OAuthCallback" && "Error during ORCID authentication. Please try again."}
            {error === "Callback" && "Could not complete sign-in. Please try again."}
            {!["OAuthSignin", "OAuthCallback", "Callback"].includes(error) &&
              "An error occurred during sign-in. Please try again."}
          </div>
        )}

        <button
          onClick={() => signIn("orcid", { callbackUrl: "/" })}
          className="inline-flex w-full items-center justify-center gap-3 rounded-lg bg-[#A6CE39] px-6 py-3 text-lg font-semibold text-white shadow-sm transition-colors hover:bg-[#95BA33]"
        >
          <svg
            className="h-6 w-6"
            viewBox="0 0 256 256"
            aria-hidden="true"
          >
            <path
              d="M256 128c0 70.7-57.3 128-128 128S0 198.7 0 128 57.3 0 128 0s128 57.3 128 128z"
              fill="currentColor"
            />
            <g fill="#A6CE39">
              <path d="M86.3 186.2H70.9V79.1h15.4v107.1z" />
              <path d="M108.9 79.1h41.6c39.6 0 57 28.3 57 53.6 0 27.5-21.5 53.6-56.8 53.6h-41.8V79.1zm15.4 93.3h24.5c34.9 0 42.9-26.5 42.9-39.7 0-21.5-13.7-39.7-43.7-39.7h-23.7v79.4z" />
              <circle cx="78.6" cy="54.5" r="10.7" />
            </g>
          </svg>
          Sign in with ORCID
        </button>

        <p className="text-sm text-gray-500">
          ORCID provides a persistent digital identifier for researchers.
          <br />
          <a
            href="https://orcid.org/register"
            target="_blank"
            rel="noopener noreferrer"
            className="text-blue-600 hover:underline"
          >
            Don&apos;t have an ORCID? Register here.
          </a>
        </p>
      </div>
    </main>
  );
}

export default function LoginPage() {
  return (
    <Suspense>
      <LoginContent />
    </Suspense>
  );
}
