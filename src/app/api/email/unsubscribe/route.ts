/**
 * GET /api/email/unsubscribe?token=...
 *
 * One-click email unsubscribe handler. Validates the HMAC-signed token,
 * updates the user's notification preferences in the database, and
 * redirects to the /unsubscribe confirmation page.
 *
 * This route is excluded from auth middleware (users click it from email
 * without being logged in). Token signature is the authentication.
 *
 * Per specs/notifications.md: "Every email includes an unsubscribe link."
 */

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import {
  verifyUnsubscribeToken,
  getUnsubscribeUpdate,
} from "@/lib/unsubscribe-token";
import type { UnsubscribeNotificationType } from "@/lib/unsubscribe-token";

export async function GET(request: NextRequest) {
  const token = request.nextUrl.searchParams.get("token");
  if (!token) {
    return redirectToConfirmation("invalid");
  }

  const payload = verifyUnsubscribeToken(token);
  if (!payload) {
    return redirectToConfirmation("invalid");
  }

  // Verify the user still exists (they may have been deleted)
  const user = await prisma.user.findUnique({
    where: { id: payload.userId },
    select: { id: true, deletedAt: true },
  });

  if (!user || user.deletedAt) {
    return redirectToConfirmation("invalid");
  }

  // Apply the preference update
  const update = getUnsubscribeUpdate(payload.type);
  await prisma.user.update({
    where: { id: payload.userId },
    data: update,
  });

  return redirectToConfirmation("success", payload.type);
}

function redirectToConfirmation(
  status: "success" | "invalid",
  type?: UnsubscribeNotificationType,
): NextResponse {
  const appUrl = process.env.NEXTAUTH_URL ?? "http://localhost:3000";
  const params = new URLSearchParams({ status });
  if (type) params.set("type", type);
  return NextResponse.redirect(`${appUrl}/unsubscribe?${params.toString()}`);
}
