/**
 * GET /api/profile — Fetch the authenticated user's researcher profile.
 * PUT /api/profile — Update editable profile fields with validation and version bump.
 *
 * Profile fields editable by the user: researchSummary, techniques,
 * experimentalModels, diseaseAreas, keyTargets, keywords.
 * Grant titles are sourced from ORCID and not editable here.
 *
 * Validation mirrors the synthesis output rules:
 * - researchSummary: 150–250 words
 * - techniques: >= 3 items
 * - diseaseAreas: >= 1 item
 * - keyTargets: >= 1 item
 *
 * On successful PUT, profileVersion is incremented and profileGeneratedAt
 * is set to now (per spec: "direct editing bumps profile_version").
 */

import { getServerSession } from "next-auth";
import { NextRequest, NextResponse } from "next/server";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { countWords } from "@/lib/profile-synthesis-prompt";
import { triggerMatchingForProfileUpdate } from "@/services/matching-triggers";

/** Editable profile fields accepted by PUT. */
interface ProfileUpdatePayload {
  researchSummary: string;
  techniques: string[];
  experimentalModels: string[];
  diseaseAreas: string[];
  keyTargets: string[];
  keywords: string[];
}

/** Validates the incoming profile update payload against spec constraints. */
function validateProfileUpdate(
  data: ProfileUpdatePayload,
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

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const profile = await prisma.researcherProfile.findUnique({
    where: { userId: session.user.id },
  });

  if (!profile) {
    return NextResponse.json({ error: "Profile not found" }, { status: 404 });
  }

  // Parse user-submitted texts from JSONB field
  const userSubmittedTexts = Array.isArray(profile.userSubmittedTexts)
    ? profile.userSubmittedTexts
    : [];

  return NextResponse.json({
    researchSummary: profile.researchSummary,
    techniques: profile.techniques,
    experimentalModels: profile.experimentalModels,
    diseaseAreas: profile.diseaseAreas,
    keyTargets: profile.keyTargets,
    keywords: profile.keywords,
    grantTitles: profile.grantTitles,
    userSubmittedTexts,
    profileVersion: profile.profileVersion,
    profileGeneratedAt: profile.profileGeneratedAt,
    hasPendingProfile: profile.pendingProfile != null,
  });
}

export async function PUT(request: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const existing = await prisma.researcherProfile.findUnique({
    where: { userId: session.user.id },
    select: { id: true, profileVersion: true },
  });

  if (!existing) {
    return NextResponse.json({ error: "Profile not found" }, { status: 404 });
  }

  let body: ProfileUpdatePayload;
  try {
    body = (await request.json()) as ProfileUpdatePayload;
  } catch {
    return NextResponse.json(
      { error: "Invalid JSON body" },
      { status: 400 },
    );
  }

  // Clean array fields: trim whitespace, filter out empty strings
  const clean = (arr: unknown): string[] => {
    if (!Array.isArray(arr)) return [];
    return arr
      .map((item: unknown) => (typeof item === "string" ? item.trim() : ""))
      .filter((s: string) => s.length > 0);
  };

  const payload: ProfileUpdatePayload = {
    researchSummary:
      typeof body.researchSummary === "string"
        ? body.researchSummary.trim()
        : "",
    techniques: clean(body.techniques),
    experimentalModels: clean(body.experimentalModels),
    diseaseAreas: clean(body.diseaseAreas),
    keyTargets: clean(body.keyTargets),
    keywords: clean(body.keywords),
  };

  const validation = validateProfileUpdate(payload);
  if (!validation.valid) {
    return NextResponse.json(
      { error: "Validation failed", details: validation.errors },
      { status: 422 },
    );
  }

  const updated = await prisma.researcherProfile.update({
    where: { userId: session.user.id },
    data: {
      researchSummary: payload.researchSummary,
      techniques: payload.techniques,
      experimentalModels: payload.experimentalModels,
      diseaseAreas: payload.diseaseAreas,
      keyTargets: payload.keyTargets,
      keywords: payload.keywords,
      profileVersion: existing.profileVersion + 1,
      profileGeneratedAt: new Date(),
    },
  });

  // Profile version bumped — trigger re-evaluation of all pairs (fire-and-forget).
  triggerMatchingForProfileUpdate(prisma, session.user.id).catch((err) => {
    console.error("[profile/PUT] Failed to trigger matching:", err);
  });

  return NextResponse.json({
    researchSummary: updated.researchSummary,
    techniques: updated.techniques,
    experimentalModels: updated.experimentalModels,
    diseaseAreas: updated.diseaseAreas,
    keyTargets: updated.keyTargets,
    keywords: updated.keywords,
    grantTitles: updated.grantTitles,
    profileVersion: updated.profileVersion,
    profileGeneratedAt: updated.profileGeneratedAt,
  });
}
