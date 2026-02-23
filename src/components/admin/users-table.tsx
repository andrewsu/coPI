/**
 * Admin Users Table — interactive client component for the Users Overview page.
 *
 * Receives all user data from the server component and provides:
 * - Filters: profile status dropdown, institution text search, claimed/unclaimed toggle
 * - Sortable columns: click header to sort asc/desc
 * - Row click → navigate to /admin/users/[id] (user detail page)
 *
 * All filtering and sorting is client-side (no pagination in v1, pilot scale).
 * Spec reference: specs/admin-dashboard.md, "Users Overview" section.
 */

"use client";

import { useState, useMemo } from "react";
import { useRouter } from "next/navigation";
import type { AdminUser, ProfileStatus } from "@/app/admin/users/page";

type SortField =
  | "name"
  | "institution"
  | "profileStatus"
  | "publicationCount"
  | "matchPoolSize"
  | "proposalsGenerated"
  | "createdAt";

type SortDirection = "asc" | "desc";

const PROFILE_STATUS_LABELS: Record<ProfileStatus, string> = {
  no_profile: "No Profile",
  generating: "Generating",
  complete: "Complete",
  pending_update: "Pending Update",
};

const PROFILE_STATUS_COLORS: Record<ProfileStatus, string> = {
  no_profile: "bg-gray-100 text-gray-700",
  generating: "bg-blue-100 text-blue-700",
  complete: "bg-emerald-100 text-emerald-700",
  pending_update: "bg-amber-100 text-amber-700",
};

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}

interface UsersTableProps {
  users: AdminUser[];
}

export function UsersTable({ users }: UsersTableProps) {
  const router = useRouter();
  const [profileStatusFilter, setProfileStatusFilter] = useState<ProfileStatus | "all">("all");
  const [institutionFilter, setInstitutionFilter] = useState("");
  const [claimedFilter, setClaimedFilter] = useState<"all" | "claimed" | "unclaimed">("all");
  const [sortField, setSortField] = useState<SortField>("createdAt");
  const [sortDirection, setSortDirection] = useState<SortDirection>("desc");

  const filteredAndSorted = useMemo(() => {
    let result = [...users];

    // Apply filters
    if (profileStatusFilter !== "all") {
      result = result.filter((u) => u.profileStatus === profileStatusFilter);
    }
    if (institutionFilter.trim()) {
      const query = institutionFilter.trim().toLowerCase();
      result = result.filter((u) =>
        u.institution.toLowerCase().includes(query),
      );
    }
    if (claimedFilter === "claimed") {
      result = result.filter((u) => u.claimedAt !== null);
    } else if (claimedFilter === "unclaimed") {
      result = result.filter((u) => u.claimedAt === null);
    }

    // Apply sorting
    result.sort((a, b) => {
      let cmp = 0;
      switch (sortField) {
        case "name":
          cmp = a.name.localeCompare(b.name);
          break;
        case "institution":
          cmp = a.institution.localeCompare(b.institution);
          break;
        case "profileStatus":
          cmp = a.profileStatus.localeCompare(b.profileStatus);
          break;
        case "publicationCount":
          cmp = a.publicationCount - b.publicationCount;
          break;
        case "matchPoolSize":
          cmp = a.matchPoolSize - b.matchPoolSize;
          break;
        case "proposalsGenerated":
          cmp = a.proposalsGenerated - b.proposalsGenerated;
          break;
        case "createdAt":
          cmp = new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
          break;
      }
      return sortDirection === "asc" ? cmp : -cmp;
    });

    return result;
  }, [users, profileStatusFilter, institutionFilter, claimedFilter, sortField, sortDirection]);

  function handleSort(field: SortField) {
    if (sortField === field) {
      setSortDirection((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortField(field);
      setSortDirection("asc");
    }
  }

  return (
    <div>
      {/* Filters */}
      <div className="mb-4 flex flex-wrap items-end gap-4">
        <div>
          <label
            htmlFor="profile-status-filter"
            className="block text-xs font-medium text-gray-500 mb-1"
          >
            Profile Status
          </label>
          <select
            id="profile-status-filter"
            value={profileStatusFilter}
            onChange={(e) =>
              setProfileStatusFilter(e.target.value as ProfileStatus | "all")
            }
            className="rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm text-gray-700"
          >
            <option value="all">All</option>
            <option value="no_profile">No Profile</option>
            <option value="generating">Generating</option>
            <option value="complete">Complete</option>
            <option value="pending_update">Pending Update</option>
          </select>
        </div>
        <div>
          <label
            htmlFor="institution-filter"
            className="block text-xs font-medium text-gray-500 mb-1"
          >
            Institution
          </label>
          <input
            id="institution-filter"
            type="text"
            placeholder="Search institution..."
            value={institutionFilter}
            onChange={(e) => setInstitutionFilter(e.target.value)}
            className="rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm text-gray-700 placeholder:text-gray-400"
          />
        </div>
        <div>
          <label
            htmlFor="claimed-filter"
            className="block text-xs font-medium text-gray-500 mb-1"
          >
            Claimed
          </label>
          <select
            id="claimed-filter"
            value={claimedFilter}
            onChange={(e) =>
              setClaimedFilter(e.target.value as "all" | "claimed" | "unclaimed")
            }
            className="rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm text-gray-700"
          >
            <option value="all">All</option>
            <option value="claimed">Claimed</option>
            <option value="unclaimed">Unclaimed (Seeded)</option>
          </select>
        </div>
        {(profileStatusFilter !== "all" ||
          institutionFilter.trim() ||
          claimedFilter !== "all") && (
          <button
            onClick={() => {
              setProfileStatusFilter("all");
              setInstitutionFilter("");
              setClaimedFilter("all");
            }}
            className="rounded-md px-3 py-1.5 text-sm text-gray-500 hover:text-gray-700 hover:bg-gray-100"
          >
            Clear filters
          </button>
        )}
      </div>

      {/* Results count */}
      <p className="mb-2 text-xs text-gray-400">
        {`Showing ${filteredAndSorted.length} of ${users.length} user${users.length !== 1 ? "s" : ""}`}
      </p>

      {/* Table */}
      <div className="overflow-x-auto rounded-lg border border-gray-200 bg-white shadow-sm">
        <table className="min-w-full divide-y divide-gray-200">
          <thead className="bg-gray-50">
            <tr>
              <SortableHeader
                label="Name"
                field="name"
                current={sortField}
                direction={sortDirection}
                onClick={handleSort}
              />
              <SortableHeader
                label="Institution"
                field="institution"
                current={sortField}
                direction={sortDirection}
                onClick={handleSort}
              />
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                Dept
              </th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                ORCID
              </th>
              <SortableHeader
                label="Profile"
                field="profileStatus"
                current={sortField}
                direction={sortDirection}
                onClick={handleSort}
              />
              <SortableHeader
                label="Pubs"
                field="publicationCount"
                current={sortField}
                direction={sortDirection}
                onClick={handleSort}
              />
              <SortableHeader
                label="Pool"
                field="matchPoolSize"
                current={sortField}
                direction={sortDirection}
                onClick={handleSort}
              />
              <SortableHeader
                label="Proposals"
                field="proposalsGenerated"
                current={sortField}
                direction={sortDirection}
                onClick={handleSort}
              />
              <SortableHeader
                label="Joined"
                field="createdAt"
                current={sortField}
                direction={sortDirection}
                onClick={handleSort}
              />
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                Claimed
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {filteredAndSorted.length === 0 ? (
              <tr>
                <td
                  colSpan={10}
                  className="px-4 py-12 text-center text-sm text-gray-400"
                >
                  No users match the current filters.
                </td>
              </tr>
            ) : (
              filteredAndSorted.map((user) => (
                <tr
                  key={user.id}
                  onClick={() => router.push(`/admin/users/${user.id}`)}
                  className="cursor-pointer hover:bg-gray-50 transition-colors"
                >
                  <td className="px-4 py-3 text-sm font-medium text-gray-900 whitespace-nowrap">
                    {user.name}
                  </td>
                  <td className="px-4 py-3 text-sm text-gray-700 whitespace-nowrap">
                    {user.institution}
                  </td>
                  <td className="px-4 py-3 text-sm text-gray-500 whitespace-nowrap">
                    {user.department ?? "\u2014"}
                  </td>
                  <td className="px-4 py-3 text-sm whitespace-nowrap">
                    <a
                      href={`https://orcid.org/${user.orcid}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      onClick={(e) => e.stopPropagation()}
                      className="text-blue-600 hover:text-blue-800 hover:underline"
                    >
                      {user.orcid}
                    </a>
                  </td>
                  <td className="px-4 py-3 text-sm whitespace-nowrap">
                    <span
                      className={`inline-block rounded-full px-2.5 py-0.5 text-xs font-medium ${PROFILE_STATUS_COLORS[user.profileStatus]}`}
                    >
                      {PROFILE_STATUS_LABELS[user.profileStatus]}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-sm text-gray-700 text-right tabular-nums">
                    {user.publicationCount}
                  </td>
                  <td className="px-4 py-3 text-sm text-gray-700 text-right tabular-nums">
                    {user.matchPoolSize}
                  </td>
                  <td className="px-4 py-3 text-sm text-gray-700 text-right tabular-nums">
                    {user.proposalsGenerated}
                  </td>
                  <td className="px-4 py-3 text-sm text-gray-500 whitespace-nowrap">
                    {formatDate(user.createdAt)}
                  </td>
                  <td className="px-4 py-3 text-sm whitespace-nowrap">
                    {user.claimedAt ? (
                      <span className="text-emerald-600" title={formatDate(user.claimedAt)}>
                        Yes
                      </span>
                    ) : (
                      <span className="text-gray-400">Seeded</span>
                    )}
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
