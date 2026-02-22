/**
 * POST /api/match-pool/add — Add a user to the match pool via individual selection.
 *
 * Creates a MatchPoolEntry with source=individual_select linking the
 * authenticated user to the target user. Returns 201 on success.
 *
 * Spec reference: auth-and-user-management.md, Individual Selection:
 * "search for users by name, institution, or email ... Click to add.
 * Creates MatchPoolEntry with source=individual_select."
 *
 * Body: { targetUserId: string }
 * Returns: { entry: { id, targetUserId, source, createdAt } }
 */

import { getServerSession } from "next-auth";
import { NextRequest, NextResponse } from "next/server";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { triggerMatchingForNewPair } from "@/services/matching-triggers";

export async function POST(request: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: { targetUserId?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: "Invalid request body" },
      { status: 400 },
    );
  }

  const { targetUserId } = body;

  if (!targetUserId || typeof targetUserId !== "string") {
    return NextResponse.json(
      { error: "targetUserId is required" },
      { status: 400 },
    );
  }

  // Cannot add self to match pool
  if (targetUserId === session.user.id) {
    return NextResponse.json(
      { error: "Cannot add yourself to your match pool" },
      { status: 400 },
    );
  }

  // Verify target user exists
  const targetUser = await prisma.user.findUnique({
    where: { id: targetUserId },
    select: { id: true },
  });
  if (!targetUser) {
    return NextResponse.json({ error: "User not found" }, { status: 404 });
  }

  // Check if already in match pool (unique constraint would also catch this)
  const existing = await prisma.matchPoolEntry.findUnique({
    where: {
      userId_targetUserId: {
        userId: session.user.id,
        targetUserId,
      },
    },
    select: { id: true },
  });
  if (existing) {
    return NextResponse.json(
      { error: "User is already in your match pool" },
      { status: 409 },
    );
  }

  const entry = await prisma.matchPoolEntry.create({
    data: {
      userId: session.user.id,
      targetUserId,
      source: "individual_select",
    },
    select: {
      id: true,
      targetUserId: true,
      source: true,
      createdAt: true,
    },
  });

  // Trigger matching for the new pair (fire-and-forget).
  // The handler checks eligibility before generating proposals.
  triggerMatchingForNewPair(session.user.id, targetUserId).catch((err) => {
    console.error("[match-pool/add] Failed to trigger matching:", err);
  });

  return NextResponse.json({ entry }, { status: 201 });
}
