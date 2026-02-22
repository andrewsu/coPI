"use client";

import { useSession, signOut } from "next-auth/react";

export default function HomePage() {
  const { data: session } = useSession();

  return (
    <main className="flex min-h-screen flex-col items-center justify-center p-8">
      <h1 className="text-4xl font-bold tracking-tight">CoPI</h1>
      {session?.user ? (
        <div className="mt-6 text-center">
          <p className="text-lg text-gray-600">
            Welcome, {session.user.name ?? "Researcher"}
          </p>
          <p className="mt-1 text-sm text-gray-500">
            {session.user.orcid}
          </p>
          <p className="mt-6 text-gray-500">
            Profile setup coming soon...
          </p>
          <button
            onClick={() => signOut({ callbackUrl: "/login" })}
            className="mt-6 rounded-md border border-gray-300 px-4 py-2 text-sm text-gray-700 transition-colors hover:bg-gray-100"
          >
            Sign out
          </button>
        </div>
      ) : (
        <p className="mt-4 text-lg text-gray-600">
          Collaborative PI Matching — loading...
        </p>
      )}
    </main>
  );
}
