/**
 * DELETE /api/account — Delete the authenticated user's account.
 *
 * Requires a confirmation body: { confirm: true }.
 *
 * Per spec (auth-and-user-management.md §Account Deletion):
 * - Deletes profile, publications, user-submitted texts, swipe history,
 *   match pool entries, affiliation selections, survey responses
 * - Preserves proposals where the other party swiped interested
 *   (name and institution retained on the soft-deleted User record)
 *
 * Returns 200 with deletion summary on success.
 * The client should sign the user out after receiving this response.
 */

import { getServerSession } from "next-auth";
import { NextRequest, NextResponse } from "next/server";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { deleteAccount } from "@/services/account-deletion";

export async function DELETE(request: NextRequest) {
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

  if (body.confirm !== true) {
    return NextResponse.json(
      { error: "Confirmation required. Send { confirm: true } to proceed." },
      { status: 400 },
    );
  }

  try {
    const result = await deleteAccount(prisma, session.user.id);

    return NextResponse.json({
      message: "Account deleted successfully",
      preservedProposalCount: result.preservedProposalCount,
      deletedProposalCount: result.deletedProposalCount,
    });
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Failed to delete account";

    if (message === "User not found" || message === "Account is already deleted") {
      return NextResponse.json({ error: message }, { status: 404 });
    }

    console.error("Account deletion error:", err);
    return NextResponse.json(
      { error: "Failed to delete account" },
      { status: 500 },
    );
  }
}
