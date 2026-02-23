/**
 * Admin Users Overview page — sortable, filterable table of all users.
 *
 * Server component that queries the database directly (no API fetch needed)
 * and passes user data to the interactive UsersTable client component.
 *
 * Computes profile status from database state + in-memory pipeline status.
 * Excludes deleted users. No pagination in v1 (pilot scale).
 *
 * Spec reference: specs/admin-dashboard.md, "Users Overview" section.
 */

import { prisma } from "@/lib/prisma";
import { getPipelineStatus } from "@/lib/pipeline-status";
import { UsersTable } from "@/components/admin/users-table";

export const dynamic = "force-dynamic";

export type ProfileStatus = "no_profile" | "generating" | "complete" | "pending_update";

export interface AdminUser {
  id: string;
  name: string;
  institution: string;
  department: string | null;
  orcid: string;
  profileStatus: ProfileStatus;
  publicationCount: number;
  matchPoolSize: number;
  proposalsGenerated: number;
  createdAt: string;
  claimedAt: string | null;
}

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

export default async function AdminUsersPage() {
  const dbUsers = await prisma.user.findMany({
    where: { deletedAt: null },
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

  const users: AdminUser[] = dbUsers.map((user) => ({
    id: user.id,
    name: user.name,
    institution: user.institution,
    department: user.department,
    orcid: user.orcid,
    profileStatus: computeProfileStatus(
      user.id,
      !!user.profile,
      user.profile?.pendingProfile != null,
    ),
    publicationCount: user._count.publications,
    matchPoolSize: user._count.matchPoolSelections,
    proposalsGenerated: user._count.proposalsAsA + user._count.proposalsAsB,
    createdAt: user.createdAt.toISOString(),
    claimedAt: user.claimedAt?.toISOString() ?? null,
  }));

  return (
    <div>
      <div className="mb-6">
        <h2 className="text-2xl font-bold text-gray-900">Users</h2>
        <p className="mt-1 text-sm text-gray-500">
          {users.length} total user{users.length !== 1 ? "s" : ""}
        </p>
      </div>
      <UsersTable users={users} />
    </div>
  );
}
