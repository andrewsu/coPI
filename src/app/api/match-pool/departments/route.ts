/**
 * GET /api/match-pool/departments — Get distinct departments for a given institution.
 *
 * Returns a list of distinct department names for users at a specific institution.
 * Used by the affiliation selection UI for department autocomplete after an
 * institution is selected.
 *
 * Query params:
 *   institution — Required. The institution to get departments for.
 *   q — Optional search string to filter departments (case-insensitive contains)
 *
 * Returns: { departments: string[] }
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
  const institution = searchParams.get("institution")?.trim();
  const query = searchParams.get("q")?.trim() || "";

  if (!institution) {
    return NextResponse.json(
      { error: "institution query parameter is required" },
      { status: 400 },
    );
  }

  const whereClause: Record<string, unknown> = {
    id: { not: session.user.id },
    institution: { equals: institution, mode: "insensitive" },
    department: { not: null },
  };

  if (query.length > 0) {
    whereClause.department = {
      not: null,
      contains: query,
      mode: "insensitive",
    };
  }

  const users = await prisma.user.findMany({
    where: whereClause,
    select: { department: true },
    distinct: ["department"],
    orderBy: { department: "asc" },
    take: 20,
  });

  const departments = users
    .map((u) => u.department)
    .filter((d): d is string => d !== null);

  return NextResponse.json({ departments });
}
