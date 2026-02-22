/**
 * GET /api/settings — Fetch the authenticated user's settings.
 * PUT /api/settings — Update user settings (email visibility, incoming proposals, notifications).
 *
 * Settings fields:
 * - emailVisibility: "public_profile" | "mutual_matches" | "never"
 * - allowIncomingProposals: boolean
 * - emailNotificationsEnabled: boolean (master switch)
 * - notifyMatches: boolean
 * - notifyNewProposals: boolean
 * - notifyProfileRefresh: boolean
 *
 * Spec reference: auth-and-user-management.md §Settings,
 * notifications.md §User preferences.
 */

import { getServerSession } from "next-auth";
import { NextRequest, NextResponse } from "next/server";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

const VALID_EMAIL_VISIBILITY = [
  "public_profile",
  "mutual_matches",
  "never",
] as const;

type EmailVisibilityValue = (typeof VALID_EMAIL_VISIBILITY)[number];

interface SettingsUpdatePayload {
  emailVisibility?: EmailVisibilityValue;
  allowIncomingProposals?: boolean;
  emailNotificationsEnabled?: boolean;
  notifyMatches?: boolean;
  notifyNewProposals?: boolean;
  notifyProfileRefresh?: boolean;
}

/** Validates the incoming settings update payload. */
function validateSettingsUpdate(
  data: Record<string, unknown>,
): { valid: true; payload: SettingsUpdatePayload } | { valid: false; errors: string[] } {
  const errors: string[] = [];
  const payload: SettingsUpdatePayload = {};

  if ("emailVisibility" in data) {
    if (
      typeof data.emailVisibility !== "string" ||
      !VALID_EMAIL_VISIBILITY.includes(data.emailVisibility as EmailVisibilityValue)
    ) {
      errors.push(
        `emailVisibility must be one of: ${VALID_EMAIL_VISIBILITY.join(", ")}`,
      );
    } else {
      payload.emailVisibility = data.emailVisibility as EmailVisibilityValue;
    }
  }

  const booleanFields = [
    "allowIncomingProposals",
    "emailNotificationsEnabled",
    "notifyMatches",
    "notifyNewProposals",
    "notifyProfileRefresh",
  ] as const;

  for (const field of booleanFields) {
    if (field in data) {
      if (typeof data[field] !== "boolean") {
        errors.push(`${field} must be a boolean`);
      } else {
        (payload as Record<string, unknown>)[field] = data[field];
      }
    }
  }

  // At least one field must be provided
  if (Object.keys(payload).length === 0 && errors.length === 0) {
    errors.push("At least one setting field must be provided");
  }

  return errors.length === 0
    ? { valid: true, payload }
    : { valid: false, errors };
}

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: {
      emailVisibility: true,
      allowIncomingProposals: true,
      emailNotificationsEnabled: true,
      notifyMatches: true,
      notifyNewProposals: true,
      notifyProfileRefresh: true,
    },
  });

  if (!user) {
    return NextResponse.json({ error: "User not found" }, { status: 404 });
  }

  return NextResponse.json(user);
}

export async function PUT(request: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json(
      { error: "Invalid JSON body" },
      { status: 400 },
    );
  }

  const validation = validateSettingsUpdate(body);
  if (!validation.valid) {
    return NextResponse.json(
      { error: "Validation failed", details: validation.errors },
      { status: 422 },
    );
  }

  const updated = await prisma.user.update({
    where: { id: session.user.id },
    select: {
      emailVisibility: true,
      allowIncomingProposals: true,
      emailNotificationsEnabled: true,
      notifyMatches: true,
      notifyNewProposals: true,
      notifyProfileRefresh: true,
    },
    data: validation.payload,
  });

  return NextResponse.json(updated);
}
