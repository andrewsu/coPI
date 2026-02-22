/**
 * Home page — the main app entry point after authentication.
 *
 * Server component that checks onboarding state and redirects:
 * - No profile → /onboarding (runs the profile pipeline)
 * - Has profile → shows the main app content
 *
 * Future: will also redirect to match pool setup if profile exists
 * but match pool is empty.
 */

import { redirect } from "next/navigation";
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

  return (
    <main className="flex min-h-screen flex-col items-center justify-center p-8">
      <h1 className="text-4xl font-bold tracking-tight">CoPI</h1>
      <div className="mt-6 text-center">
        <p className="text-lg text-gray-600">
          Welcome, {session.user.name ?? "Researcher"}
        </p>
        <p className="mt-1 text-sm text-gray-500">{session.user.orcid}</p>
        <p className="mt-6 text-gray-500">
          Profile review and match pool setup coming soon...
        </p>
        <div className="mt-6">
          <SignOutButton />
        </div>
      </div>
    </main>
  );
}
