/**
 * Home page — the main app entry point after authentication.
 *
 * Server component that checks onboarding state and redirects:
 * - No profile → /onboarding (runs the profile pipeline)
 * - Has profile but empty match pool → /match-pool?onboarding=1
 * - Has profile and match pool → shows the swipe queue
 */

import { redirect } from "next/navigation";
import Link from "next/link";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { SignOutButton } from "@/components/sign-out-button";
import { SwipeQueue } from "@/components/swipe-queue";

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

  let hasMatchPool = matchPoolCount > 0;

  if (!hasMatchPool) {
    // Also check for affiliation selections (which might not have expanded yet)
    const affiliationCount = await prisma.affiliationSelection.count({
      where: { userId: session.user.id },
    });

    if (affiliationCount === 0) {
      redirect("/match-pool?onboarding=1");
    }
    // Has affiliation selections but no entries yet — treat as having a pool
    hasMatchPool = true;
  }

  return (
    <main className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="bg-white border-b border-gray-200">
        <div className="mx-auto max-w-3xl px-4 py-3 flex items-center justify-between">
          <h1 className="text-xl font-bold tracking-tight text-gray-900">
            CoPI
          </h1>
          <div className="flex items-center gap-3">
            <Link
              href="/profile/edit"
              className="text-sm text-gray-600 hover:text-gray-900"
            >
              Profile
            </Link>
            <Link
              href="/match-pool"
              className="text-sm text-gray-600 hover:text-gray-900"
            >
              Match Pool
            </Link>
            <SignOutButton />
          </div>
        </div>
      </header>

      {/* Swipe Queue */}
      <div className="mx-auto max-w-3xl px-4 py-8">
        <SwipeQueue hasMatchPool={hasMatchPool} />
      </div>
    </main>
  );
}
