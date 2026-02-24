/**
 * Admin Jobs page — shows all jobs in the PostgreSQL-backed queue.
 *
 * Server component that queries the Job table, resolves researcher names
 * for run_matching jobs, and passes data to the interactive JobsTable
 * client component.
 */

import { prisma } from "@/lib/prisma";
import { JobsTable } from "@/components/admin/jobs-table";
import type { JobStatus } from "@prisma/client";

export const dynamic = "force-dynamic";

export interface AdminJob {
  id: string;
  type: string;
  status: JobStatus;
  priority: number;
  payloadSummary: string;
  attempts: number;
  maxAttempts: number;
  lastError: string | null;
  enqueuedAt: string;
  startedAt: string | null;
  completedAt: string | null;
}

export default async function AdminJobsPage() {
  const jobs = await prisma.job.findMany({
    orderBy: { enqueuedAt: "desc" },
  });

  // Collect researcher IDs from run_matching payloads for batch lookup
  const researcherIds = new Set<string>();
  for (const job of jobs) {
    if (job.type === "run_matching") {
      const payload = job.payload as { researcherAId?: string; researcherBId?: string };
      if (payload.researcherAId) researcherIds.add(payload.researcherAId);
      if (payload.researcherBId) researcherIds.add(payload.researcherBId);
    }
  }

  // Batch-fetch researcher names
  const nameMap = new Map<string, string>();
  if (researcherIds.size > 0) {
    const users = await prisma.user.findMany({
      where: { id: { in: [...researcherIds] } },
      select: { id: true, name: true },
    });
    for (const u of users) {
      nameMap.set(u.id, u.name);
    }
  }

  // Build payload summary for each job
  function summarizePayload(type: string, payload: Record<string, unknown>): string {
    switch (type) {
      case "run_matching": {
        const aName = nameMap.get(payload.researcherAId as string) ?? (payload.researcherAId as string)?.slice(0, 8);
        const bName = nameMap.get(payload.researcherBId as string) ?? (payload.researcherBId as string)?.slice(0, 8);
        return `${aName} \u2194 ${bName}`;
      }
      case "generate_profile":
        return `User: ${nameMap.get(payload.userId as string) ?? (payload.userId as string)?.slice(0, 8)}`;
      case "send_email":
        return `${payload.templateId} \u2192 ${payload.to}`;
      case "expand_match_pool":
        return `User: ${nameMap.get(payload.userId as string) ?? (payload.userId as string)?.slice(0, 8)}`;
      case "monthly_refresh":
        return `User: ${nameMap.get(payload.userId as string) ?? (payload.userId as string)?.slice(0, 8)}`;
      default:
        return JSON.stringify(payload).slice(0, 80);
    }
  }

  // Also collect user IDs from generate_profile/expand_match_pool/monthly_refresh for name resolution
  const extraUserIds = new Set<string>();
  for (const job of jobs) {
    if (["generate_profile", "expand_match_pool", "monthly_refresh"].includes(job.type)) {
      const payload = job.payload as { userId?: string };
      if (payload.userId && !nameMap.has(payload.userId)) {
        extraUserIds.add(payload.userId);
      }
    }
  }
  if (extraUserIds.size > 0) {
    const extraUsers = await prisma.user.findMany({
      where: { id: { in: [...extraUserIds] } },
      select: { id: true, name: true },
    });
    for (const u of extraUsers) {
      nameMap.set(u.id, u.name);
    }
  }

  const adminJobs: AdminJob[] = jobs.map((job) => ({
    id: job.id,
    type: job.type,
    status: job.status,
    priority: job.priority,
    payloadSummary: summarizePayload(job.type, job.payload as Record<string, unknown>),
    attempts: job.attempts,
    maxAttempts: job.maxAttempts,
    lastError: job.lastError,
    enqueuedAt: job.enqueuedAt.toISOString(),
    startedAt: job.startedAt?.toISOString() ?? null,
    completedAt: job.completedAt?.toISOString() ?? null,
  }));

  // Summary counts
  const counts = {
    total: adminJobs.length,
    pending: adminJobs.filter((j) => j.status === "pending").length,
    processing: adminJobs.filter((j) => j.status === "processing").length,
    completed: adminJobs.filter((j) => j.status === "completed").length,
    failed: adminJobs.filter((j) => j.status === "failed").length,
    dead: adminJobs.filter((j) => j.status === "dead").length,
  };

  return (
    <div>
      <div className="mb-6">
        <h2 className="text-2xl font-bold text-gray-900">Jobs</h2>
        <div className="mt-2 flex flex-wrap gap-3 text-sm">
          <span className="text-gray-500">{counts.total} total</span>
          <span className="text-yellow-600">{counts.pending} pending</span>
          <span className="text-blue-600">{counts.processing} processing</span>
          <span className="text-emerald-600">{counts.completed} completed</span>
          <span className="text-red-600">{counts.failed} failed</span>
          <span className="text-gray-800">{counts.dead} dead</span>
        </div>
      </div>
      <JobsTable jobs={adminJobs} />
    </div>
  );
}
