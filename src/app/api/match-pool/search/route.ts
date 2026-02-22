/**
 * GET /api/match-pool/search — Search for users to add to match pool.
 *
 * Searches by name or institution (case-insensitive). Returns user details
 * plus a profile preview (research summary, techniques, disease areas, key
 * targets) for each result. Excludes the current user and indicates whether
 * each result is already in the user's match pool.
 *
 * Spec reference: auth-and-user-management.md, Individual Selection:
 * "search for users by name, institution, or email. Shows profile preview
 * (research summary, techniques, disease areas — NOT user-submitted texts)."
 *
 * Query params:
 *   q: search string (min 2 chars, required)
 *
 * Returns: { users: SearchResult[] }
 */

import { getServerSession } from "next-auth";
import { NextRequest, NextResponse } from "next/server";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

/** Maximum number of search results returned per query. */
const SEARCH_LIMIT = 20;

/** Minimum query length to perform a search. */
const MIN_QUERY_LENGTH = 2;

export interface SearchResultProfile {
  researchSummary: string;
  techniques: string[];
  diseaseAreas: string[];
  keyTargets: string[];
}

export interface SearchResult {
  id: string;
  name: string;
  institution: string;
  department: string | null;
  profile: SearchResultProfile | null;
  inMatchPool: boolean;
}

export async function GET(request: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const q = request.nextUrl.searchParams.get("q")?.trim() ?? "";

  if (q.length < MIN_QUERY_LENGTH) {
    return NextResponse.json(
      {
        error: `Search query must be at least ${MIN_QUERY_LENGTH} characters`,
      },
      { status: 400 },
    );
  }

  // Search users by name or institution (case-insensitive), excluding self
  const users = await prisma.user.findMany({
    where: {
      id: { not: session.user.id },
      OR: [
        { name: { contains: q, mode: "insensitive" } },
        { institution: { contains: q, mode: "insensitive" } },
      ],
    },
    select: {
      id: true,
      name: true,
      institution: true,
      department: true,
      profile: {
        select: {
          researchSummary: true,
          techniques: true,
          diseaseAreas: true,
          keyTargets: true,
        },
      },
    },
    take: SEARCH_LIMIT,
    orderBy: { name: "asc" },
  });

  // Get the set of user IDs already in the current user's match pool
  const existingEntries = await prisma.matchPoolEntry.findMany({
    where: {
      userId: session.user.id,
      targetUserId: { in: users.map((u) => u.id) },
    },
    select: { targetUserId: true },
  });
  const inPoolSet = new Set(existingEntries.map((e) => e.targetUserId));

  const results: SearchResult[] = users.map((u) => ({
    id: u.id,
    name: u.name,
    institution: u.institution,
    department: u.department,
    profile: u.profile
      ? {
          researchSummary: u.profile.researchSummary,
          techniques: u.profile.techniques,
          diseaseAreas: u.profile.diseaseAreas,
          keyTargets: u.profile.keyTargets,
        }
      : null,
    inMatchPool: inPoolSet.has(u.id),
  }));

  return NextResponse.json({ users: results });
}
