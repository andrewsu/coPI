/**
 * GET /api/onboarding/profile-status
 *
 * Returns the current pipeline execution status for the authenticated user.
 * Used by the onboarding UI to poll for progress updates.
 *
 * Also handles server-restart recovery: if the in-memory status is lost
 * but the user already has a profile in the database, returns "complete".
 */

import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getPipelineStatus } from "@/lib/pipeline-status";

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const userId = session.user.id;

  // Check if profile already exists (handles server restart mid-pipeline)
  const existingProfile = await prisma.researcherProfile.findUnique({
    where: { userId },
    select: { id: true },
  });
  if (existingProfile) {
    return NextResponse.json({
      stage: "complete",
      message: "Your profile is ready!",
      warnings: [],
      hasProfile: true,
    });
  }

  // Return in-memory pipeline status
  const status = getPipelineStatus(userId);
  if (!status) {
    return NextResponse.json({
      stage: "not_started",
      message: "Pipeline has not been started.",
      warnings: [],
      hasProfile: false,
    });
  }

  return NextResponse.json({
    ...status,
    hasProfile: false,
  });
}
