/**
 * POST /api/match-pool/affiliation — Create an affiliation selection.
 *
 * Creates an AffiliationSelection record and auto-creates MatchPoolEntry rows
 * for all current users matching the criteria. Supports two modes:
 *
 * 1. Affiliation-based: specify institution (required) and optionally department.
 *    Creates entries with source=affiliation_select for all matching users.
 *
 * 2. All users: set selectAll=true. Creates entries with source=all_users
 *    for every other user on the platform.
 *
 * When new users join matching the criteria, MatchPoolEntry rows are
 * auto-created (handled by the expand_match_pool job, not this route).
 *
 * Spec reference: auth-and-user-management.md, Match Pool Management section.
 *
 * Body: { institution?: string, department?: string, selectAll?: boolean }
 * Returns: { affiliationSelection: {...}, entriesCreated: number }
 */

import { getServerSession } from "next-auth";
import { NextRequest, NextResponse } from "next/server";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function POST(request: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: {
    institution?: string;
    department?: string;
    selectAll?: boolean;
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: "Invalid request body" },
      { status: 400 },
    );
  }

  const { institution, department, selectAll } = body;

  // Validate: must be selectAll OR have an institution
  if (selectAll) {
    // "All users" mode — no institution/department needed
  } else if (!institution || typeof institution !== "string" || !institution.trim()) {
    return NextResponse.json(
      { error: "institution is required when selectAll is not true" },
      { status: 400 },
    );
  }

  // Validate department is a string if provided
  if (department !== undefined && department !== null && typeof department !== "string") {
    return NextResponse.json(
      { error: "department must be a string" },
      { status: 400 },
    );
  }

  const trimmedInstitution = selectAll ? null : institution!.trim();
  const trimmedDepartment = !selectAll && department && typeof department === "string"
    ? department.trim() || null
    : null;

  // Check for duplicate affiliation selection
  if (selectAll) {
    const existing = await prisma.affiliationSelection.findFirst({
      where: {
        userId: session.user.id,
        selectAll: true,
      },
    });
    if (existing) {
      return NextResponse.json(
        { error: "You already have an 'all users' selection active" },
        { status: 409 },
      );
    }
  } else {
    const existing = await prisma.affiliationSelection.findFirst({
      where: {
        userId: session.user.id,
        institution: trimmedInstitution,
        department: trimmedDepartment,
        selectAll: false,
      },
    });
    if (existing) {
      return NextResponse.json(
        { error: "You already have this affiliation selection active" },
        { status: 409 },
      );
    }
  }

  // Create the AffiliationSelection record
  const affiliationSelection = await prisma.affiliationSelection.create({
    data: {
      userId: session.user.id,
      institution: trimmedInstitution,
      department: trimmedDepartment,
      selectAll: selectAll === true,
    },
  });

  // Find all matching users (excluding the current user)
  const source = selectAll ? "all_users" : "affiliation_select";

  const whereClause: Record<string, unknown> = {
    id: { not: session.user.id },
  };

  if (!selectAll) {
    whereClause.institution = {
      equals: trimmedInstitution,
      mode: "insensitive",
    };
    if (trimmedDepartment) {
      whereClause.department = {
        equals: trimmedDepartment,
        mode: "insensitive",
      };
    }
  }

  const matchingUsers = await prisma.user.findMany({
    where: whereClause,
    select: { id: true },
  });

  // Create MatchPoolEntry rows for matching users, skipping duplicates.
  // The compound unique (userId, targetUserId) prevents duplicates at the DB level.
  // We use skipDuplicates to handle the case where an individually-selected user
  // also matches the affiliation criteria.
  let entriesCreated = 0;
  if (matchingUsers.length > 0) {
    const result = await prisma.matchPoolEntry.createMany({
      data: matchingUsers.map((u) => ({
        userId: session.user.id,
        targetUserId: u.id,
        source: source as "affiliation_select" | "all_users",
      })),
      skipDuplicates: true,
    });
    entriesCreated = result.count;
  }

  return NextResponse.json(
    {
      affiliationSelection: {
        id: affiliationSelection.id,
        institution: affiliationSelection.institution,
        department: affiliationSelection.department,
        selectAll: affiliationSelection.selectAll,
        createdAt: affiliationSelection.createdAt,
      },
      entriesCreated,
    },
    { status: 201 },
  );
}
