/**
 * GET /api/profile/pending — Fetch the pending profile candidate alongside
 * the current profile for side-by-side comparison.
 *
 * POST /api/profile/pending — Accept or dismiss the pending profile candidate.
 *   - action: "accept" — copies candidate fields to the current profile,
 *     bumps profile_version, clears pending_profile, triggers matching.
 *     Optional `fields` override lets the user edit before saving.
 *   - action: "dismiss" — clears pending_profile without applying changes.
 *
 * Spec reference: auth-and-user-management.md, Profile Refresh:
 * "User sees side-by-side comparison of current vs candidate profile,
 *  can accept as-is, edit before saving, or dismiss"
 */

import { getServerSession } from "next-auth";
import { Prisma } from "@prisma/client";
import { NextRequest, NextResponse } from "next/server";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { countWords } from "@/lib/profile-synthesis-prompt";
import { triggerMatchingForProfileUpdate } from "@/services/matching-triggers";
import type { PendingProfileCandidate } from "@/services/monthly-refresh";

/** Fields the user can override when accepting with edits. */
interface AcceptFieldOverrides {
  researchSummary?: string;
  techniques?: string[];
  experimentalModels?: string[];
  diseaseAreas?: string[];
  keyTargets?: string[];
  keywords?: string[];
}

interface PostBody {
  action: "accept" | "dismiss";
  fields?: AcceptFieldOverrides;
}

/** Validates profile fields against spec constraints (same rules as PUT /api/profile). */
function validateProfileFields(
  data: {
    researchSummary: string;
    techniques: string[];
    experimentalModels: string[];
    diseaseAreas: string[];
    keyTargets: string[];
    keywords: string[];
  },
): { valid: true } | { valid: false; errors: string[] } {
  const errors: string[] = [];

  if (typeof data.researchSummary !== "string" || !data.researchSummary.trim()) {
    errors.push("Research summary is required.");
  } else {
    const wordCount = countWords(data.researchSummary);
    if (wordCount < 150) {
      errors.push(
        `Research summary must be at least 150 words (currently ${wordCount}).`,
      );
    }
    if (wordCount > 250) {
      errors.push(
        `Research summary must be at most 250 words (currently ${wordCount}).`,
      );
    }
  }

  if (!Array.isArray(data.techniques) || data.techniques.length < 3) {
    errors.push("At least 3 techniques are required.");
  }

  if (!Array.isArray(data.diseaseAreas) || data.diseaseAreas.length < 1) {
    errors.push("At least 1 disease area or biological process is required.");
  }

  if (!Array.isArray(data.keyTargets)) {
    errors.push("Key targets must be an array.");
  }

  if (!Array.isArray(data.experimentalModels)) {
    errors.push("Experimental models must be an array.");
  }

  if (!Array.isArray(data.keywords)) {
    errors.push("Keywords must be an array.");
  }

  return errors.length === 0 ? { valid: true } : { valid: false, errors };
}

/** Clean array: trim whitespace, filter empty strings. */
function cleanArray(arr: unknown): string[] {
  if (!Array.isArray(arr)) return [];
  return arr
    .map((item: unknown) => (typeof item === "string" ? item.trim() : ""))
    .filter((s: string) => s.length > 0);
}

/** Detect which fields differ between current and candidate profiles. */
function detectChangedFields(
  current: {
    researchSummary: string;
    techniques: string[];
    experimentalModels: string[];
    diseaseAreas: string[];
    keyTargets: string[];
    keywords: string[];
    grantTitles: string[];
  },
  candidate: PendingProfileCandidate,
): string[] {
  const changed: string[] = [];

  if (current.researchSummary !== candidate.researchSummary) {
    changed.push("researchSummary");
  }
  if (!arraysEqual(current.techniques, candidate.techniques)) {
    changed.push("techniques");
  }
  if (!arraysEqual(current.experimentalModels, candidate.experimentalModels)) {
    changed.push("experimentalModels");
  }
  if (!arraysEqual(current.diseaseAreas, candidate.diseaseAreas)) {
    changed.push("diseaseAreas");
  }
  if (!arraysEqual(current.keyTargets, candidate.keyTargets)) {
    changed.push("keyTargets");
  }
  if (!arraysEqual(current.keywords, candidate.keywords)) {
    changed.push("keywords");
  }
  if (!arraysEqual(current.grantTitles, candidate.grantTitles)) {
    changed.push("grantTitles");
  }

  return changed;
}

/** Case-insensitive sorted comparison of two string arrays. */
function arraysEqual(a: string[], b: string[]): boolean {
  const normalize = (arr: string[]) =>
    arr.map((s) => s.trim().toLowerCase()).sort();
  const left = normalize(a);
  const right = normalize(b);
  if (left.length !== right.length) return false;
  return left.every((v, i) => v === right[i]);
}

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const profile = await prisma.researcherProfile.findUnique({
    where: { userId: session.user.id },
    select: {
      researchSummary: true,
      techniques: true,
      experimentalModels: true,
      diseaseAreas: true,
      keyTargets: true,
      keywords: true,
      grantTitles: true,
      pendingProfile: true,
      pendingProfileCreatedAt: true,
      profileVersion: true,
    },
  });

  if (!profile) {
    return NextResponse.json({ error: "Profile not found" }, { status: 404 });
  }

  if (!profile.pendingProfile) {
    return NextResponse.json(
      { error: "No pending profile update" },
      { status: 404 },
    );
  }

  const candidate = profile.pendingProfile as unknown as PendingProfileCandidate;

  const changedFields = detectChangedFields(
    {
      researchSummary: profile.researchSummary,
      techniques: profile.techniques,
      experimentalModels: profile.experimentalModels,
      diseaseAreas: profile.diseaseAreas,
      keyTargets: profile.keyTargets,
      keywords: profile.keywords,
      grantTitles: profile.grantTitles,
    },
    candidate,
  );

  return NextResponse.json({
    current: {
      researchSummary: profile.researchSummary,
      techniques: profile.techniques,
      experimentalModels: profile.experimentalModels,
      diseaseAreas: profile.diseaseAreas,
      keyTargets: profile.keyTargets,
      keywords: profile.keywords,
      grantTitles: profile.grantTitles,
    },
    candidate: {
      researchSummary: candidate.researchSummary,
      techniques: candidate.techniques,
      experimentalModels: candidate.experimentalModels,
      diseaseAreas: candidate.diseaseAreas,
      keyTargets: candidate.keyTargets,
      keywords: candidate.keywords,
      grantTitles: candidate.grantTitles,
      generatedAt: candidate.generatedAt,
    },
    changedFields,
    pendingProfileCreatedAt: profile.pendingProfileCreatedAt,
    profileVersion: profile.profileVersion,
  });
}

export async function POST(request: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: PostBody;
  try {
    body = (await request.json()) as PostBody;
  } catch {
    return NextResponse.json(
      { error: "Invalid JSON body" },
      { status: 400 },
    );
  }

  if (!body.action || !["accept", "dismiss"].includes(body.action)) {
    return NextResponse.json(
      { error: "Invalid action. Must be 'accept' or 'dismiss'." },
      { status: 400 },
    );
  }

  const profile = await prisma.researcherProfile.findUnique({
    where: { userId: session.user.id },
    select: {
      id: true,
      profileVersion: true,
      pendingProfile: true,
    },
  });

  if (!profile) {
    return NextResponse.json({ error: "Profile not found" }, { status: 404 });
  }

  if (!profile.pendingProfile) {
    return NextResponse.json(
      { error: "No pending profile update" },
      { status: 404 },
    );
  }

  if (body.action === "dismiss") {
    await prisma.researcherProfile.update({
      where: { userId: session.user.id },
      data: {
        pendingProfile: Prisma.DbNull,
        pendingProfileCreatedAt: null,
      },
    });

    return NextResponse.json({ status: "dismissed" });
  }

  // action === "accept"
  const candidate = profile.pendingProfile as unknown as PendingProfileCandidate;

  // Determine the fields to apply — candidate fields with optional user overrides
  let finalFields: {
    researchSummary: string;
    techniques: string[];
    experimentalModels: string[];
    diseaseAreas: string[];
    keyTargets: string[];
    keywords: string[];
  };

  if (body.fields) {
    // User edited the candidate before accepting — merge overrides
    finalFields = {
      researchSummary:
        typeof body.fields.researchSummary === "string"
          ? body.fields.researchSummary.trim()
          : candidate.researchSummary,
      techniques: body.fields.techniques
        ? cleanArray(body.fields.techniques)
        : candidate.techniques,
      experimentalModels: body.fields.experimentalModels
        ? cleanArray(body.fields.experimentalModels)
        : candidate.experimentalModels,
      diseaseAreas: body.fields.diseaseAreas
        ? cleanArray(body.fields.diseaseAreas)
        : candidate.diseaseAreas,
      keyTargets: body.fields.keyTargets
        ? cleanArray(body.fields.keyTargets)
        : candidate.keyTargets,
      keywords: body.fields.keywords
        ? cleanArray(body.fields.keywords)
        : candidate.keywords,
    };
  } else {
    // Accept as-is
    finalFields = {
      researchSummary: candidate.researchSummary,
      techniques: candidate.techniques,
      experimentalModels: candidate.experimentalModels,
      diseaseAreas: candidate.diseaseAreas,
      keyTargets: candidate.keyTargets,
      keywords: candidate.keywords,
    };
  }

  // Validate the final fields
  const validation = validateProfileFields(finalFields);
  if (!validation.valid) {
    return NextResponse.json(
      { error: "Validation failed", details: validation.errors },
      { status: 422 },
    );
  }

  const updated = await prisma.researcherProfile.update({
    where: { userId: session.user.id },
    data: {
      researchSummary: finalFields.researchSummary,
      techniques: finalFields.techniques,
      experimentalModels: finalFields.experimentalModels,
      diseaseAreas: finalFields.diseaseAreas,
      keyTargets: finalFields.keyTargets,
      keywords: finalFields.keywords,
      grantTitles: candidate.grantTitles,
      rawAbstractsHash: candidate.rawAbstractsHash,
      profileVersion: profile.profileVersion + 1,
      profileGeneratedAt: new Date(),
      pendingProfile: Prisma.DbNull,
      pendingProfileCreatedAt: null,
    },
  });

  // Profile version bumped — trigger re-evaluation of all pairs (fire-and-forget).
  triggerMatchingForProfileUpdate(prisma, session.user.id).catch((err) => {
    console.error("[profile/pending/POST] Failed to trigger matching:", err);
  });

  return NextResponse.json({
    status: "accepted",
    profileVersion: updated.profileVersion,
    researchSummary: updated.researchSummary,
    techniques: updated.techniques,
    experimentalModels: updated.experimentalModels,
    diseaseAreas: updated.diseaseAreas,
    keyTargets: updated.keyTargets,
    keywords: updated.keywords,
    grantTitles: updated.grantTitles,
  });
}
