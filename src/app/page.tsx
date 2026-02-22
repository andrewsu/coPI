/**
 * Home page — the main app entry point after authentication.
 *
 * Server component that checks onboarding state and redirects:
 * - No profile → /onboarding (runs the profile pipeline)
 * - Has profile but empty match pool → /match-pool?onboarding=1
 * - Has profile and match pool → shows the main app content
 */

import { redirect } from "next/navigation";
import Link from "next/link";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { SignOutButton } from "@/components/sign-out-button";

export default async function HomePage() {
  const session = await getServerSession(authOptions);

  if (!session?.user?.id) {
    redirect("/login");
  }

  // Check if user has a profile — if not, redirect to onboarding
  const profile = await prisma.researcherProfile.findUnique({
    where: { userId: session.user.id },
    select: { id: true },
  });

  if (!profile) {
    redirect("/onboarding");
  }

  // Check if user has match pool entries — if not, redirect to match pool setup
  const matchPoolCount = await prisma.matchPoolEntry.count({
    where: { userId: session.user.id },
  });

  if (matchPoolCount === 0) {
    // Also check for affiliation selections (which might not have expanded yet)
    const affiliationCount = await prisma.affiliationSelection.count({
      where: { userId: session.user.id },
    });

    if (affiliationCount === 0) {
      redirect("/match-pool?onboarding=1");
    }
  }

  return (
    <main className="flex min-h-screen flex-col items-center justify-center p-8">
      <h1 className="text-4xl font-bold tracking-tight">CoPI</h1>
      <div className="mt-6 text-center">
        <p className="text-lg text-gray-600">
          Welcome, {session.user.name ?? "Researcher"}
        </p>
        <p className="mt-1 text-sm text-gray-500">{session.user.orcid}</p>
        <p className="mt-6 text-gray-500">
          Swipe interface coming soon...
        </p>
        <div className="mt-6 flex flex-col items-center gap-3">
          <Link
            href="/profile/edit"
            className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-700"
          >
            Edit Profile
          </Link>
          <Link
            href="/match-pool"
            className="rounded-md bg-gray-100 px-4 py-2 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-200"
          >
            Manage Match Pool
          </Link>
          <SignOutButton />
        </div>
      </div>
    </main>
  );
}
