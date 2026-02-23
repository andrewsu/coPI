/**
 * Admin Jobs Table — interactive client component for the Jobs page.
 *
 * Provides status and type filter dropdowns, sortable columns, and
 * color-coded status badges. All filtering/sorting is client-side.
 */

"use client";

import { useState, useMemo } from "react";
import type { AdminJob } from "@/app/admin/jobs/page";
import type { JobStatus } from "@prisma/client";

type SortField = "type" | "status" | "attempts" | "enqueuedAt" | "completedAt";
type SortDirection = "asc" | "desc";

const STATUS_LABELS: Record<JobStatus, string> = {
  pending: "Pending",
  processing: "Processing",
  completed: "Completed",
  failed: "Failed",
  dead: "Dead",
};

const STATUS_COLORS: Record<JobStatus, string> = {
  pending: "bg-yellow-100 text-yellow-700",
  processing: "bg-blue-100 text-blue-700",
  completed: "bg-emerald-100 text-emerald-700",
  failed: "bg-red-100 text-red-700",
  dead: "bg-gray-200 text-gray-800",
};

const JOB_TYPE_LABELS: Record<string, string> = {
  run_matching: "Run Matching",
  generate_profile: "Generate Profile",
  send_email: "Send Email",
  expand_match_pool: "Expand Match Pool",
  monthly_refresh: "Monthly Refresh",
};

function formatDateTime(iso: string | null): string {
  if (!iso) return "\u2014";
  return new Date(iso).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "UTC",
  });
}

interface JobsTableProps {
  jobs: AdminJob[];
}

export function JobsTable({ jobs }: JobsTableProps) {
  const [statusFilter, setStatusFilter] = useState<JobStatus | "all">("all");
  const [typeFilter, setTypeFilter] = useState<string>("all");
  const [sortField, setSortField] = useState<SortField>("enqueuedAt");
  const [sortDirection, setSortDirection] = useState<SortDirection>("desc");

  // Derive unique job types from data
  const jobTypes = useMemo(() => {
    const types = new Set(jobs.map((j) => j.type));
    return [...types].sort();
  }, [jobs]);

  const filteredAndSorted = useMemo(() => {
    let result = [...jobs];

    if (statusFilter !== "all") {
      result = result.filter((j) => j.status === statusFilter);
    }
    if (typeFilter !== "all") {
      result = result.filter((j) => j.type === typeFilter);
    }

    result.sort((a, b) => {
      let cmp = 0;
      switch (sortField) {
        case "type":
          cmp = a.type.localeCompare(b.type);
          break;
        case "status":
          cmp = a.status.localeCompare(b.status);
          break;
        case "attempts":
          cmp = a.attempts - b.attempts;
          break;
        case "enqueuedAt":
          cmp = new Date(a.enqueuedAt).getTime() - new Date(b.enqueuedAt).getTime();
          break;
        case "completedAt": {
          const aTime = a.completedAt ? new Date(a.completedAt).getTime() : 0;
          const bTime = b.completedAt ? new Date(b.completedAt).getTime() : 0;
          cmp = aTime - bTime;
          break;
        }
      }
      return sortDirection === "asc" ? cmp : -cmp;
    });

    return result;
  }, [jobs, statusFilter, typeFilter, sortField, sortDirection]);

  function handleSort(field: SortField) {
    if (sortField === field) {
      setSortDirection((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortField(field);
      setSortDirection("asc");
    }
  }

  const hasFilters = statusFilter !== "all" || typeFilter !== "all";

  return (
    <div>
      {/* Filters */}
      <div className="mb-4 flex flex-wrap items-end gap-4">
        <div>
          <label
            htmlFor="status-filter"
            className="block text-xs font-medium text-gray-500 mb-1"
          >
            Status
          </label>
          <select
            id="status-filter"
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as JobStatus | "all")}
            className="rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm text-gray-700"
          >
            <option value="all">All</option>
            <option value="pending">Pending</option>
            <option value="processing">Processing</option>
            <option value="completed">Completed</option>
            <option value="failed">Failed</option>
            <option value="dead">Dead</option>
          </select>
        </div>
        <div>
          <label
            htmlFor="type-filter"
            className="block text-xs font-medium text-gray-500 mb-1"
          >
            Type
          </label>
          <select
            id="type-filter"
            value={typeFilter}
            onChange={(e) => setTypeFilter(e.target.value)}
            className="rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm text-gray-700"
          >
            <option value="all">All</option>
            {jobTypes.map((t) => (
              <option key={t} value={t}>
                {JOB_TYPE_LABELS[t] ?? t}
              </option>
            ))}
          </select>
        </div>
        {hasFilters && (
          <button
            onClick={() => {
              setStatusFilter("all");
              setTypeFilter("all");
            }}
            className="rounded-md px-3 py-1.5 text-sm text-gray-500 hover:text-gray-700 hover:bg-gray-100"
          >
            Clear filters
          </button>
        )}
      </div>

      {/* Results count */}
      <p className="mb-2 text-xs text-gray-400">
        {`Showing ${filteredAndSorted.length} of ${jobs.length} job${jobs.length !== 1 ? "s" : ""}`}
      </p>

      {/* Table */}
      <div className="overflow-x-auto rounded-lg border border-gray-200 bg-white shadow-sm">
        <table className="min-w-full divide-y divide-gray-200">
          <thead className="bg-gray-50">
            <tr>
              <SortableHeader
                label="Type"
                field="type"
                current={sortField}
                direction={sortDirection}
                onClick={handleSort}
              />
              <SortableHeader
                label="Status"
                field="status"
                current={sortField}
                direction={sortDirection}
                onClick={handleSort}
              />
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                Payload
              </th>
              <SortableHeader
                label="Attempts"
                field="attempts"
                current={sortField}
                direction={sortDirection}
                onClick={handleSort}
              />
              <SortableHeader
                label="Enqueued"
                field="enqueuedAt"
                current={sortField}
                direction={sortDirection}
                onClick={handleSort}
              />
              <SortableHeader
                label="Completed"
                field="completedAt"
                current={sortField}
                direction={sortDirection}
                onClick={handleSort}
              />
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                Error
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {filteredAndSorted.length === 0 ? (
              <tr>
                <td
                  colSpan={7}
                  className="px-4 py-12 text-center text-sm text-gray-400"
                >
                  No jobs match the current filters.
                </td>
              </tr>
            ) : (
              filteredAndSorted.map((job) => (
                <tr key={job.id} className="hover:bg-gray-50 transition-colors">
                  <td className="px-4 py-3 text-sm font-medium text-gray-900 whitespace-nowrap">
                    {JOB_TYPE_LABELS[job.type] ?? job.type}
                  </td>
                  <td className="px-4 py-3 text-sm whitespace-nowrap">
                    <span
                      className={`inline-block rounded-full px-2.5 py-0.5 text-xs font-medium ${STATUS_COLORS[job.status]}`}
                    >
                      {STATUS_LABELS[job.status]}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-sm text-gray-700 max-w-xs truncate" title={job.payloadSummary}>
                    {job.payloadSummary}
                  </td>
                  <td className="px-4 py-3 text-sm text-gray-700 text-right tabular-nums whitespace-nowrap">
                    {job.attempts}/{job.maxAttempts}
                  </td>
                  <td className="px-4 py-3 text-sm text-gray-500 whitespace-nowrap">
                    {formatDateTime(job.enqueuedAt)}
                  </td>
                  <td className="px-4 py-3 text-sm text-gray-500 whitespace-nowrap">
                    {formatDateTime(job.completedAt)}
                  </td>
                  <td className="px-4 py-3 text-sm text-red-600 max-w-xs truncate" title={job.lastError ?? undefined}>
                    {job.lastError
                      ? job.lastError.length > 60
                        ? job.lastError.slice(0, 60) + "\u2026"
                        : job.lastError
                      : "\u2014"}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function SortableHeader({
  label,
  field,
  current,
  direction,
  onClick,
}: {
  label: string;
  field: SortField;
  current: SortField;
  direction: SortDirection;
  onClick: (field: SortField) => void;
}) {
  const isActive = current === field;
  return (
    <th
      onClick={() => onClick(field)}
      className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider cursor-pointer select-none hover:text-gray-700"
    >
      {label}
      {isActive && (
        <span className="ml-1">{direction === "asc" ? "\u2191" : "\u2193"}</span>
      )}
    </th>
  );
}
