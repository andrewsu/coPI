/**
 * POST /api/survey — Record a survey response about proposal quality.
 *
 * After every Nth archive action (default 5), the UI shows a lightweight
 * survey asking about common issues with recent proposals. Responses are
 * stored as SurveyResponse records for aggregate quality analysis.
 *
 * Request body: { failureModes: string[], freeText?: string }
 *
 * Spec reference: specs/swipe-interface.md, "Periodic Survey" section.
 */

import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

/** The valid failure mode options per spec. */
export const VALID_FAILURE_MODES = [
  "scientifically_nonsensical",
  "scientifically_uninteresting",
  "lack_of_synergy",
  "experiment_too_complex",
  "too_generic",
  "already_pursuing_similar",
  "other",
] as const;

export async function POST(request: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const userId = session.user.id;

  // Parse and validate request body
  let body: { failureModes?: unknown; freeText?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: "Invalid request body" },
      { status: 400 }
    );
  }

  // Validate failureModes: required, must be a non-empty array of valid strings
  if (!Array.isArray(body.failureModes) || body.failureModes.length === 0) {
    return NextResponse.json(
      { error: "failureModes must be a non-empty array" },
      { status: 400 }
    );
  }

  const failureModes = body.failureModes as string[];
  const invalidModes = failureModes.filter(
    (mode) => !VALID_FAILURE_MODES.includes(mode as typeof VALID_FAILURE_MODES[number])
  );
  if (invalidModes.length > 0) {
    return NextResponse.json(
      { error: `Invalid failure modes: ${invalidModes.join(", ")}` },
      { status: 400 }
    );
  }

  // Validate freeText: optional, must be a string if provided, max 1000 chars
  let freeText: string | null = null;
  if (body.freeText !== undefined && body.freeText !== null) {
    if (typeof body.freeText !== "string") {
      return NextResponse.json(
        { error: "freeText must be a string" },
        { status: 400 }
      );
    }
    if (body.freeText.length > 1000) {
      return NextResponse.json(
        { error: "freeText must be at most 1000 characters" },
        { status: 400 }
      );
    }
    freeText = body.freeText.trim() || null;
  }

  const surveyResponse = await prisma.surveyResponse.create({
    data: {
      userId,
      failureModes,
      freeText,
    },
  });

  return NextResponse.json({
    id: surveyResponse.id,
    failureModes: surveyResponse.failureModes,
    freeText: surveyResponse.freeText,
    createdAt: surveyResponse.createdAt.toISOString(),
  });
}
