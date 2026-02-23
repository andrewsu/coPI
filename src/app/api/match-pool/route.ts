/**
 * GET /api/match-pool — Fetch the authenticated user's match pool entries.
 *
 * Returns all MatchPoolEntry records for the current user with target user
 * details (name, institution, department), plus any AffiliationSelection
 * records. Includes total count and the 200-user cap for UI display.
 *
 * Spec reference: auth-and-user-management.md, Match Pool Management section.
 */

import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { MATCH_POOL_CAP } from "@/services/eligible-pairs";

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const [entries, affiliationSelections] = await Promise.all([
    prisma.matchPoolEntry.findMany({
      where: { userId: session.user.id },
      include: {
        targetUser: {
          select: {
            id: true,
            name: true,
            institution: true,
            department: true,
          },
        },
      },
      orderBy: { createdAt: "desc" },
    }),
    prisma.affiliationSelection.findMany({
      where: { userId: session.user.id },
      orderBy: { createdAt: "desc" },
    }),
  ]);

  return NextResponse.json({
    entries: entries.map((e) => ({
      id: e.id,
      targetUser: e.targetUser,
      source: e.source,
      createdAt: e.createdAt,
    })),
    affiliationSelections: affiliationSelections.map((a) => ({
      id: a.id,
      institution: a.institution,
      department: a.department,
      selectAll: a.selectAll,
      createdAt: a.createdAt,
    })),
    totalCount: entries.length,
    cap: MATCH_POOL_CAP,
  });
}
