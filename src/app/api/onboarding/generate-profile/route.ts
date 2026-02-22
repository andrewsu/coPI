/**
 * POST /api/onboarding/generate-profile
 *
 * Triggers the profile pipeline for the authenticated user.
 * Runs the pipeline asynchronously in the background and returns immediately.
 * The frontend polls /api/onboarding/profile-status for progress.
 *
 * Returns:
 *   { status: "started" }          — pipeline kicked off
 *   { status: "already_exists" }   — user already has a profile
 *   { status: "already_running" }  — pipeline is already in progress
 */

import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { anthropic } from "@/lib/anthropic";
import { runProfilePipeline } from "@/services/profile-pipeline";
import { getPipelineStatus, setPipelineStage } from "@/lib/pipeline-status";

export async function POST() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id || !session?.user?.orcid) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const userId = session.user.id;
  const orcid = session.user.orcid;

  // Check if profile already exists
  const existingProfile = await prisma.researcherProfile.findUnique({
    where: { userId },
    select: { id: true },
  });
  if (existingProfile) {
    return NextResponse.json({ status: "already_exists" });
  }

  // Check if pipeline is already running
  const currentStatus = getPipelineStatus(userId);
  if (
    currentStatus &&
    currentStatus.stage !== "complete" &&
    currentStatus.stage !== "error"
  ) {
    return NextResponse.json({ status: "already_running" });
  }

  // Start pipeline in background (fire-and-forget)
  setPipelineStage(userId, "starting");

  runProfilePipeline(prisma, anthropic, userId, orcid, {
    onProgress: (stage) => setPipelineStage(userId, stage),
  })
    .then((result) => {
      setPipelineStage(userId, "complete", {
        warnings: result.warnings,
        result: {
          publicationsFound: result.publicationsStored,
          profileCreated: result.profileCreated,
        },
      });
    })
    .catch((err: unknown) => {
      console.error(`Pipeline failed for user ${userId}:`, err);
      setPipelineStage(userId, "error", {
        error:
          err instanceof Error ? err.message : "Profile generation failed",
      });
    });

  return NextResponse.json({ status: "started" });
}
