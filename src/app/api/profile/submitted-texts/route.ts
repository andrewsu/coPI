/**
 * GET /api/profile/submitted-texts — Fetch the user's submitted texts.
 * PUT /api/profile/submitted-texts — Replace all submitted texts with validation.
 *
 * User-submitted texts are stored as a JSONB array on ResearcherProfile.
 * Each entry has: label (user-provided), content (free text), submitted_at (timestamp).
 *
 * Constraints per spec (auth-and-user-management.md):
 * - Max 5 entries
 * - Each entry max 2000 words
 * - Each entry must have non-empty label and content
 *
 * Privacy: user-submitted texts are NEVER shown to other users. They inform
 * profile synthesis and the matching engine only.
 */

import { getServerSession } from "next-auth";
import { NextRequest, NextResponse } from "next/server";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

const MAX_ENTRIES = 5;
const MAX_WORDS_PER_ENTRY = 2000;

/** Shape of a single user-submitted text entry in the JSONB field. */
export interface SubmittedTextEntry {
  label: string;
  content: string;
  submitted_at: string;
}

/** Shape accepted by PUT request body. */
interface SubmittedTextInput {
  label: string;
  content: string;
}

/** Counts words in text using whitespace splitting. */
function countWords(text: string): number {
  return text
    .trim()
    .split(/\s+/)
    .filter((w) => w.length > 0).length;
}

/** Parses existing JSONB data into typed entries. */
function parseExistingTexts(json: unknown): SubmittedTextEntry[] {
  if (!json || !Array.isArray(json)) return [];
  return json.filter(
    (entry: unknown): entry is SubmittedTextEntry =>
      typeof entry === "object" &&
      entry !== null &&
      "label" in entry &&
      "content" in entry &&
      "submitted_at" in entry,
  );
}

/** Validates the submitted texts array. */
function validateSubmittedTexts(
  entries: SubmittedTextInput[],
): { valid: true } | { valid: false; errors: string[] } {
  const errors: string[] = [];

  if (!Array.isArray(entries)) {
    return { valid: false, errors: ["Request body must be an array."] };
  }

  if (entries.length > MAX_ENTRIES) {
    errors.push(`Maximum ${MAX_ENTRIES} submitted texts allowed (currently ${entries.length}).`);
  }

  entries.forEach((entry, i) => {
    const idx = i + 1;
    if (typeof entry.label !== "string" || !entry.label.trim()) {
      errors.push(`Entry ${idx}: label is required.`);
    }
    if (typeof entry.content !== "string" || !entry.content.trim()) {
      errors.push(`Entry ${idx}: content is required.`);
    } else {
      const words = countWords(entry.content);
      if (words > MAX_WORDS_PER_ENTRY) {
        errors.push(
          `Entry ${idx}: content exceeds ${MAX_WORDS_PER_ENTRY} word limit (currently ${words}).`,
        );
      }
    }
  });

  return errors.length === 0 ? { valid: true } : { valid: false, errors };
}

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const profile = await prisma.researcherProfile.findUnique({
    where: { userId: session.user.id },
    select: { userSubmittedTexts: true },
  });

  if (!profile) {
    return NextResponse.json({ error: "Profile not found" }, { status: 404 });
  }

  const texts = parseExistingTexts(profile.userSubmittedTexts);
  return NextResponse.json({ texts });
}

export async function PUT(request: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const profile = await prisma.researcherProfile.findUnique({
    where: { userId: session.user.id },
    select: { id: true, userSubmittedTexts: true },
  });

  if (!profile) {
    return NextResponse.json({ error: "Profile not found" }, { status: 404 });
  }

  let body: SubmittedTextInput[];
  try {
    const parsed = await request.json();
    body = parsed.texts;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  if (!Array.isArray(body)) {
    return NextResponse.json(
      { error: "Validation failed", details: ["Request body must contain a 'texts' array."] },
      { status: 422 },
    );
  }

  // Clean inputs
  const cleaned: SubmittedTextInput[] = body.map((entry) => ({
    label: typeof entry.label === "string" ? entry.label.trim() : "",
    content: typeof entry.content === "string" ? entry.content.trim() : "",
  }));

  const validation = validateSubmittedTexts(cleaned);
  if (!validation.valid) {
    return NextResponse.json(
      { error: "Validation failed", details: validation.errors },
      { status: 422 },
    );
  }

  // Determine which entries are new or modified vs carried over.
  // New/modified entries get a fresh submitted_at timestamp.
  // Existing entries that haven't changed keep their original timestamp.
  const existingTexts = parseExistingTexts(profile.userSubmittedTexts);

  const now = new Date().toISOString();
  const entries: SubmittedTextEntry[] = cleaned.map((entry) => {
    // Check if there's an existing entry with the same label and content
    const existing = existingTexts.find(
      (e) => e.label === entry.label && e.content === entry.content,
    );
    return {
      label: entry.label,
      content: entry.content,
      submitted_at: existing ? existing.submitted_at : now,
    };
  });

  await prisma.researcherProfile.update({
    where: { userId: session.user.id },
    data: {
      userSubmittedTexts: entries as unknown as import("@prisma/client").Prisma.InputJsonValue,
    },
  });

  return NextResponse.json({ texts: entries });
}
