/**
 * GET /api/profile/refresh-status
 *
 * Returns the current profile refresh pipeline status for the authenticated user.
 * Used by the profile edit UI to poll for progress updates during a manual refresh.
 *
 * Unlike the onboarding profile-status endpoint, this does NOT short-circuit
 * when a profile exists in the database (profile always exists during refresh).
 * Instead, it returns the actual in-memory pipeline status.
 *
 * Returns:
 *   { stage: "idle" }       — no refresh in progress
 *   { stage: "starting" }   — pipeline just started
 *   { stage: "fetching_orcid" | "fetching_publications" | ... }
 *   { stage: "complete", result: { ... } }
 *   { stage: "error", error: "..." }
 */

import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";
import { authOptions } from "@/lib/auth";
import { getPipelineStatus } from "@/lib/pipeline-status";

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const userId = session.user.id;

  // Return in-memory pipeline status
  const status = getPipelineStatus(userId);
  if (!status) {
    return NextResponse.json({
      stage: "idle",
      message: "No refresh in progress.",
      warnings: [],
    });
  }

  return NextResponse.json(status);
}
