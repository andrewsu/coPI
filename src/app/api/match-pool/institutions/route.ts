/**
 * GET /api/match-pool/institutions — Get distinct institutions for autocomplete.
 *
 * Returns a list of distinct institution names from the User table, optionally
 * filtered by a search query. Used by the affiliation selection UI for
 * institution autocomplete.
 *
 * Query params:
 *   q — Optional search string to filter institutions (case-insensitive contains)
 *
 * Returns: { institutions: string[] }
 */

import { getServerSession } from "next-auth";
import { NextRequest, NextResponse } from "next/server";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function GET(request: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const query = searchParams.get("q")?.trim() || "";

  // Build where clause: exclude the current user, optionally filter by query
  const whereClause: Record<string, unknown> = {
    id: { not: session.user.id },
  };

  if (query.length > 0) {
    whereClause.institution = {
      contains: query,
      mode: "insensitive",
    };
  }

  // Fetch distinct institutions. Prisma's findMany with distinct gives us
  // unique institution values, ordered alphabetically.
  const users = await prisma.user.findMany({
    where: whereClause,
    select: { institution: true },
    distinct: ["institution"],
    orderBy: { institution: "asc" },
    take: 20,
  });

  const institutions = users.map((u) => u.institution);

  return NextResponse.json({ institutions });
}
