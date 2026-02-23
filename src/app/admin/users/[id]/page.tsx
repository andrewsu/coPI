/**
 * Admin User Detail page — full read-only view of a single user's data.
 *
 * Server component that queries the database directly (no API fetch needed)
 * and renders all user data in organized sections: header, profile,
 * publications, match pool, and proposals.
 *
 * Spec reference: specs/admin-dashboard.md, "User Detail" section.
 */

import { prisma } from "@/lib/prisma";
import { notFound } from "next/navigation";
import Link from "next/link";

export const dynamic = "force-dynamic";

function formatDate(date: Date): string {
  return date.toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}

function formatDateTime(date: Date): string {
  return (
    date.toLocaleDateString("en-US", {
      year: "numeric",
      month: "short",
      day: "numeric",
      timeZone: "UTC",
    }) +
    " " +
    date.toLocaleTimeString("en-US", {
      hour: "2-digit",
      minute: "2-digit",
      timeZone: "UTC",
    })
  );
}

const CONFIDENCE_COLORS: Record<string, string> = {
  high: "bg-emerald-100 text-emerald-700",
  moderate: "bg-amber-100 text-amber-700",
  speculative: "bg-gray-100 text-gray-700",
};

const VISIBILITY_COLORS: Record<string, string> = {
  visible: "text-emerald-600",
  pending_other_interest: "text-amber-600",
  hidden: "text-gray-400",
};

const VISIBILITY_LABELS: Record<string, string> = {
  visible: "Visible",
  pending_other_interest: "Pending",
  hidden: "Hidden",
};

const SOURCE_COLORS: Record<string, string> = {
  individual_select: "bg-blue-100 text-blue-700",
  affiliation_select: "bg-purple-100 text-purple-700",
  all_users: "bg-gray-100 text-gray-700",
};

const SOURCE_LABELS: Record<string, string> = {
  individual_select: "Individual",
  affiliation_select: "Affiliation",
  all_users: "All Users",
};

export default async function AdminUserDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  const user = await prisma.user.findUnique({
    where: { id },
    include: {
      profile: true,
      publications: {
        select: {
          id: true,
          pmid: true,
          pmcid: true,
          doi: true,
          title: true,
          journal: true,
          year: true,
          authorPosition: true,
          methodsText: true,
          createdAt: true,
        },
        orderBy: { year: "desc" },
      },
      matchPoolSelections: {
        include: {
          targetUser: {
            select: { id: true, name: true, institution: true },
          },
        },
        orderBy: { createdAt: "desc" },
      },
      matchPoolTargets: {
        include: {
          user: {
            select: { id: true, name: true, institution: true },
          },
        },
        orderBy: { createdAt: "desc" },
      },
      affiliationSelections: {
        orderBy: { createdAt: "desc" },
      },
    },
  });

  if (!user) notFound();

  const proposals = await prisma.collaborationProposal.findMany({
    where: {
      OR: [{ researcherAId: id }, { researcherBId: id }],
    },
    include: {
      researcherA: {
        select: { id: true, name: true, institution: true },
      },
      researcherB: {
        select: { id: true, name: true, institution: true },
      },
      swipes: {
        select: {
          userId: true,
          direction: true,
        },
      },
      matches: {
        select: { id: true, matchedAt: true },
      },
    },
    orderBy: { createdAt: "desc" },
  });

  const profile = user.profile;

  return (
    <div className="space-y-8">
      {/* Back link */}
      <Link
        href="/admin/users"
        className="inline-block text-sm text-gray-500 hover:text-gray-700"
      >
        &larr; Back to Users
      </Link>

      {/* Header */}
      <div className="rounded-lg border border-gray-200 bg-white p-6 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h2 className="text-2xl font-bold text-gray-900">{user.name}</h2>
            <p className="mt-1 text-sm text-gray-600">
              {user.institution}
              {user.department && (
                <span className="text-gray-400"> / {user.department}</span>
              )}
            </p>
            <a
              href={`https://orcid.org/${user.orcid}`}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-1 inline-block text-sm text-blue-600 hover:text-blue-800 hover:underline"
            >
              {user.orcid}
            </a>
          </div>
          <div className="flex flex-wrap gap-2">
            {user.isAdmin && (
              <span className="inline-block rounded-full bg-indigo-100 px-2.5 py-0.5 text-xs font-medium text-indigo-700">
                Admin
              </span>
            )}
            {user.claimedAt ? (
              <span className="inline-block rounded-full bg-emerald-100 px-2.5 py-0.5 text-xs font-medium text-emerald-700">
                Claimed
              </span>
            ) : (
              <span className="inline-block rounded-full bg-gray-100 px-2.5 py-0.5 text-xs font-medium text-gray-600">
                Seeded (Unclaimed)
              </span>
            )}
            {user.deletedAt && (
              <span className="inline-block rounded-full bg-red-100 px-2.5 py-0.5 text-xs font-medium text-red-700">
                Deleted
              </span>
            )}
          </div>
        </div>
        <div className="mt-4 flex flex-wrap gap-x-6 gap-y-1 text-xs text-gray-500">
          <span>Joined: {formatDate(user.createdAt)}</span>
          {user.claimedAt && (
            <span>Claimed: {formatDate(user.claimedAt)}</span>
          )}
          {user.deletedAt && (
            <span>Deleted: {formatDate(user.deletedAt)}</span>
          )}
          <span>Email: {user.email}</span>
        </div>
      </div>

      {/* Profile Section */}
      <section>
        <h3 className="mb-3 text-lg font-semibold text-gray-900">Profile</h3>
        {profile ? (
          <div className="rounded-lg border border-gray-200 bg-white p-6 shadow-sm space-y-5">
            <div className="flex flex-wrap gap-x-6 gap-y-1 text-xs text-gray-500">
              <span>Version {profile.profileVersion}</span>
              <span>
                Generated: {profile.profileGeneratedAt ? formatDateTime(profile.profileGeneratedAt) : "N/A"}
              </span>
              {profile.pendingProfile && (
                <span className="text-amber-600">
                  Pending update (
                  {profile.pendingProfileCreatedAt
                    ? formatDateTime(profile.pendingProfileCreatedAt)
                    : "date unknown"}
                  )
                </span>
              )}
            </div>

            <div>
              <h4 className="text-sm font-medium text-gray-700 mb-1">
                Research Summary
              </h4>
              <p className="text-sm text-gray-600 leading-relaxed">
                {profile.researchSummary}
              </p>
            </div>

            <TagList label="Techniques" items={profile.techniques} />
            <TagList
              label="Experimental Models"
              items={profile.experimentalModels}
            />
            <TagList label="Disease Areas" items={profile.diseaseAreas} />
            <TagList label="Key Targets" items={profile.keyTargets} />
            <TagList label="Keywords" items={profile.keywords} />

            {profile.grantTitles.length > 0 && (
              <div>
                <h4 className="text-sm font-medium text-gray-700 mb-1">
                  Grant Titles
                </h4>
                <ul className="list-disc list-inside text-sm text-gray-600 space-y-0.5">
                  {profile.grantTitles.map((grant, i) => (
                    <li key={i}>{grant}</li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        ) : (
          <div className="rounded-lg border border-gray-200 bg-white p-6 shadow-sm">
            <p className="text-sm text-gray-400">
              No profile generated yet.
            </p>
          </div>
        )}
      </section>

      {/* Publications Section */}
      <section>
        <h3 className="mb-3 text-lg font-semibold text-gray-900">
          Publications
          <span className="ml-2 text-sm font-normal text-gray-500">
            ({user.publications.length})
          </span>
        </h3>
        {user.publications.length > 0 ? (
          <div className="overflow-x-auto rounded-lg border border-gray-200 bg-white shadow-sm">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Title
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Journal
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Year
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Position
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    IDs
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Methods
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {user.publications.map((pub) => (
                  <tr key={pub.id} className="hover:bg-gray-50">
                    <td className="px-4 py-3 text-sm text-gray-900 max-w-md">
                      {pub.title}
                    </td>
                    <td className="px-4 py-3 text-sm text-gray-600 whitespace-nowrap">
                      {pub.journal}
                    </td>
                    <td className="px-4 py-3 text-sm text-gray-600 tabular-nums">
                      {pub.year}
                    </td>
                    <td className="px-4 py-3 text-sm text-gray-600 whitespace-nowrap capitalize">
                      {pub.authorPosition}
                    </td>
                    <td className="px-4 py-3 text-sm whitespace-nowrap space-x-2">
                      {pub.pmid && (
                        <a
                          href={`https://pubmed.ncbi.nlm.nih.gov/${pub.pmid}/`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-blue-600 hover:text-blue-800 hover:underline"
                        >
                          PMID
                        </a>
                      )}
                      {pub.doi && (
                        <a
                          href={`https://doi.org/${pub.doi}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-blue-600 hover:text-blue-800 hover:underline"
                        >
                          DOI
                        </a>
                      )}
                      {!pub.pmid && !pub.doi && (
                        <span className="text-gray-400">&mdash;</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-sm">
                      {pub.methodsText ? (
                        <span className="text-emerald-600">Yes</span>
                      ) : (
                        <span className="text-gray-400">No</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="rounded-lg border border-gray-200 bg-white p-6 shadow-sm">
            <p className="text-sm text-gray-400">No publications.</p>
          </div>
        )}
      </section>

      {/* Match Pool Section */}
      <section>
        <h3 className="mb-3 text-lg font-semibold text-gray-900">
          Match Pool
        </h3>
        <div className="space-y-4">
          {/* Their selections */}
          <div className="rounded-lg border border-gray-200 bg-white p-5 shadow-sm">
            <h4 className="text-sm font-medium text-gray-700 mb-3">
              Their Selections
              <span className="ml-1 text-gray-400">
                ({user.matchPoolSelections.length})
              </span>
            </h4>
            {user.matchPoolSelections.length > 0 ? (
              <div className="overflow-x-auto">
                <table className="min-w-full divide-y divide-gray-200">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                        Name
                      </th>
                      <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                        Institution
                      </th>
                      <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                        Source
                      </th>
                      <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                        Added
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {user.matchPoolSelections.map((entry) => (
                      <tr key={entry.id} className="hover:bg-gray-50">
                        <td className="px-4 py-2 text-sm">
                          <Link
                            href={`/admin/users/${entry.targetUser.id}`}
                            className="text-blue-600 hover:text-blue-800 hover:underline"
                          >
                            {entry.targetUser.name}
                          </Link>
                        </td>
                        <td className="px-4 py-2 text-sm text-gray-600">
                          {entry.targetUser.institution}
                        </td>
                        <td className="px-4 py-2 text-sm">
                          <span
                            className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${SOURCE_COLORS[entry.source] ?? "bg-gray-100 text-gray-700"}`}
                          >
                            {SOURCE_LABELS[entry.source] ?? entry.source}
                          </span>
                        </td>
                        <td className="px-4 py-2 text-xs text-gray-500">
                          {formatDate(entry.createdAt)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="text-sm text-gray-400">No selections.</p>
            )}
          </div>

          {/* Affiliation Selections */}
          {user.affiliationSelections.length > 0 && (
            <div className="rounded-lg border border-gray-200 bg-white p-5 shadow-sm">
              <h4 className="text-sm font-medium text-gray-700 mb-3">
                Affiliation Selections
                <span className="ml-1 text-gray-400">
                  ({user.affiliationSelections.length})
                </span>
              </h4>
              <div className="space-y-2">
                {user.affiliationSelections.map((sel) => (
                  <div
                    key={sel.id}
                    className="flex items-center gap-3 text-sm"
                  >
                    {sel.selectAll ? (
                      <span className="inline-block rounded-full bg-gray-100 px-2.5 py-0.5 text-xs font-medium text-gray-700">
                        All Users
                      </span>
                    ) : (
                      <span className="text-gray-700">
                        {sel.institution}
                        {sel.department && (
                          <span className="text-gray-400">
                            {" "}
                            / {sel.department}
                          </span>
                        )}
                      </span>
                    )}
                    <span className="text-xs text-gray-400">
                      {formatDate(sel.createdAt)}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Selected by others (reverse lookup) */}
          <div className="rounded-lg border border-gray-200 bg-white p-5 shadow-sm">
            <h4 className="text-sm font-medium text-gray-700 mb-3">
              Selected By Others
              <span className="ml-1 text-gray-400">
                ({user.matchPoolTargets.length})
              </span>
            </h4>
            {user.matchPoolTargets.length > 0 ? (
              <div className="overflow-x-auto">
                <table className="min-w-full divide-y divide-gray-200">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                        Name
                      </th>
                      <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                        Institution
                      </th>
                      <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                        Source
                      </th>
                      <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                        Added
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {user.matchPoolTargets.map((entry) => (
                      <tr key={entry.id} className="hover:bg-gray-50">
                        <td className="px-4 py-2 text-sm">
                          <Link
                            href={`/admin/users/${entry.user.id}`}
                            className="text-blue-600 hover:text-blue-800 hover:underline"
                          >
                            {entry.user.name}
                          </Link>
                        </td>
                        <td className="px-4 py-2 text-sm text-gray-600">
                          {entry.user.institution}
                        </td>
                        <td className="px-4 py-2 text-sm">
                          <span
                            className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${SOURCE_COLORS[entry.source] ?? "bg-gray-100 text-gray-700"}`}
                          >
                            {SOURCE_LABELS[entry.source] ?? entry.source}
                          </span>
                        </td>
                        <td className="px-4 py-2 text-xs text-gray-500">
                          {formatDate(entry.createdAt)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="text-sm text-gray-400">
                No other users have selected this researcher.
              </p>
            )}
          </div>
        </div>
      </section>

      {/* Proposals Section */}
      <section>
        <h3 className="mb-3 text-lg font-semibold text-gray-900">
          Proposals
          <span className="ml-2 text-sm font-normal text-gray-500">
            ({proposals.length})
          </span>
        </h3>
        {proposals.length > 0 ? (
          <div className="overflow-x-auto rounded-lg border border-gray-200 bg-white shadow-sm">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Other Researcher
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Title
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Confidence
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Visibility
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    User Swipe
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Other Swipe
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Match
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Created
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {proposals.map((p) => {
                  const isA = p.researcherAId === id;
                  const other = isA ? p.researcherB : p.researcherA;
                  const visibility = isA ? p.visibilityA : p.visibilityB;
                  const userSwipe = p.swipes.find((s) => s.userId === id);
                  const otherSwipe = p.swipes.find((s) => s.userId !== id);
                  const matched = p.matches.length > 0;

                  return (
                    <tr key={p.id} className="hover:bg-gray-50">
                      <td className="px-4 py-3 text-sm">
                        <Link
                          href={`/admin/users/${other.id}`}
                          className="text-blue-600 hover:text-blue-800 hover:underline"
                        >
                          {other.name}
                        </Link>
                        <div className="text-xs text-gray-400">
                          {other.institution}
                        </div>
                      </td>
                      <td className="px-4 py-3 text-sm text-gray-900 max-w-xs">
                        <Link
                          href={`/admin/proposals/${p.id}`}
                          className="hover:text-blue-600 hover:underline"
                        >
                          {p.title}
                        </Link>
                      </td>
                      <td className="px-4 py-3 text-sm">
                        <span
                          className={`inline-block rounded-full px-2.5 py-0.5 text-xs font-medium ${CONFIDENCE_COLORS[p.confidenceTier] ?? "bg-gray-100 text-gray-700"}`}
                        >
                          {p.confidenceTier}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-sm">
                        <span
                          className={`font-medium ${VISIBILITY_COLORS[visibility] ?? "text-gray-400"}`}
                        >
                          {VISIBILITY_LABELS[visibility] ?? visibility}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-sm">
                        <SwipeBadge direction={userSwipe?.direction ?? null} />
                      </td>
                      <td className="px-4 py-3 text-sm">
                        <SwipeBadge
                          direction={otherSwipe?.direction ?? null}
                        />
                      </td>
                      <td className="px-4 py-3 text-sm">
                        {matched ? (
                          <span className="font-medium text-emerald-600">
                            Yes
                          </span>
                        ) : (
                          <span className="text-gray-400">No</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-xs text-gray-500 whitespace-nowrap">
                        {formatDate(p.createdAt)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="rounded-lg border border-gray-200 bg-white p-6 shadow-sm">
            <p className="text-sm text-gray-400">
              No proposals involving this user.
            </p>
          </div>
        )}
      </section>
    </div>
  );
}

function TagList({ label, items }: { label: string; items: string[] }) {
  if (items.length === 0) return null;
  return (
    <div>
      <h4 className="text-sm font-medium text-gray-700 mb-1">{label}</h4>
      <div className="flex flex-wrap gap-1.5">
        {items.map((item, i) => (
          <span
            key={i}
            className="inline-block rounded-full bg-gray-100 px-2.5 py-0.5 text-xs text-gray-700"
          >
            {item}
          </span>
        ))}
      </div>
    </div>
  );
}

function SwipeBadge({ direction }: { direction: string | null }) {
  if (!direction) {
    return <span className="text-gray-400">&mdash;</span>;
  }
  if (direction === "interested") {
    return <span className="font-medium text-emerald-600">Interested</span>;
  }
  return <span className="text-gray-500">Archive</span>;
}
