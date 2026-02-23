/**
 * GET /api/admin/users — List all users with profile status and aggregate counts.
 *
 * Returns a table-ready list of all users with computed fields:
 * - profileStatus: no_profile | generating | complete | pending_update
 * - publicationCount, matchPoolSize, proposalsGenerated
 *
 * Supports query param filters:
 * - profileStatus: filter by computed profile status
 * - institution: case-insensitive contains match
 * - claimed: "true" (claimedAt not null) or "false" (claimedAt null)
 *
 * Protected by middleware (isAdmin check) + defense-in-depth session check.
 *
 * Spec reference: specs/admin-dashboard.md, Users Overview section.
 */

import { getServerSession } from "next-auth";
import { NextRequest, NextResponse } from "next/server";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getPipelineStatus } from "@/lib/pipeline-status";

type ProfileStatus = "no_profile" | "generating" | "complete" | "pending_update";

/**
 * Determines a user's profile status from their profile record and
 * the in-memory pipeline status (for detecting active generation).
 */
function computeProfileStatus(
  userId: string,
  hasProfile: boolean,
  hasPendingProfile: boolean,
): ProfileStatus {
  const pipelineStatus = getPipelineStatus(userId);
  if (
    pipelineStatus &&
    pipelineStatus.stage !== "complete" &&
    pipelineStatus.stage !== "error"
  ) {
    return "generating";
  }
  if (!hasProfile) return "no_profile";
  if (hasPendingProfile) return "pending_update";
  return "complete";
}

export async function GET(request: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id || !session.user.isAdmin) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { searchParams } = request.nextUrl;
  const profileStatusFilter = searchParams.get("profileStatus") as ProfileStatus | null;
  const institutionFilter = searchParams.get("institution");
  const claimedFilter = searchParams.get("claimed");

  const users = await prisma.user.findMany({
    where: {
      deletedAt: null,
      ...(institutionFilter && {
        institution: { contains: institutionFilter, mode: "insensitive" as const },
      }),
      ...(claimedFilter === "true" && { claimedAt: { not: null } }),
      ...(claimedFilter === "false" && { claimedAt: null }),
    },
    include: {
      profile: {
        select: { id: true, pendingProfile: true },
      },
      _count: {
        select: {
          publications: true,
          matchPoolSelections: true,
          proposalsAsA: true,
          proposalsAsB: true,
        },
      },
    },
    orderBy: { createdAt: "desc" },
  });

  const result = users.map((user) => {
    const profileStatus = computeProfileStatus(
      user.id,
      !!user.profile,
      user.profile?.pendingProfile != null,
    );

    return {
      id: user.id,
      name: user.name,
      institution: user.institution,
      department: user.department,
      orcid: user.orcid,
      profileStatus,
      publicationCount: user._count.publications,
      matchPoolSize: user._count.matchPoolSelections,
      proposalsGenerated: user._count.proposalsAsA + user._count.proposalsAsB,
      createdAt: user.createdAt,
      claimedAt: user.claimedAt,
    };
  });

  // profileStatus is computed in JS (not a DB column), so filter post-query
  const filtered = profileStatusFilter
    ? result.filter((u) => u.profileStatus === profileStatusFilter)
    : result;

  return NextResponse.json({ users: filtered, totalCount: filtered.length });
}
