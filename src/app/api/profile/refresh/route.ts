/**
 * POST /api/profile/refresh
 *
 * Triggers a full profile pipeline re-run for the authenticated user.
 * Unlike the onboarding endpoint, this REQUIRES an existing profile.
 * The pipeline re-fetches ORCID data, publications, and re-synthesizes.
 *
 * Runs the pipeline asynchronously in the background and returns immediately.
 * The frontend polls GET /api/profile/refresh-status for progress.
 *
 * Returns:
 *   { status: "started" }          — pipeline kicked off
 *   { status: "already_running" }  — pipeline is already in progress
 *   { status: "no_profile" }       — user has no profile to refresh
 *
 * Spec reference: profile-ingestion.md, Triggers table:
 * "User clicks 'refresh profile'" → Full pipeline
 */

import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { anthropic } from "@/lib/anthropic";
import { runProfilePipeline } from "@/services/profile-pipeline";
import { getPipelineStatus, setPipelineStage } from "@/lib/pipeline-status";
import { triggerMatchingForProfileUpdate } from "@/services/matching-triggers";

export async function POST() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id || !session?.user?.orcid) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const userId = session.user.id;
  const orcid = session.user.orcid;

  // Refresh requires an existing profile (unlike onboarding which creates one)
  const existingProfile = await prisma.researcherProfile.findUnique({
    where: { userId },
    select: { id: true },
  });
  if (!existingProfile) {
    return NextResponse.json({ status: "no_profile" });
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

      // Profile regenerated (version bumped) — trigger re-evaluation of all
      // pairs involving this user. Fire-and-forget within the pipeline callback.
      triggerMatchingForProfileUpdate(prisma, userId).catch((err) => {
        console.error(
          `[profile/refresh] Failed to trigger matching for user ${userId}:`,
          err,
        );
      });
    })
    .catch((err: unknown) => {
      console.error(`Profile refresh failed for user ${userId}:`, err);
      setPipelineStage(userId, "error", {
        error:
          err instanceof Error ? err.message : "Profile refresh failed",
      });
    });

  return NextResponse.json({ status: "started" });
}
