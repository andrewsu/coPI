/**
 * Admin impersonation API.
 *
 * POST — Start impersonating a user by ORCID. Creates the user if they
 *        don't exist yet (fetches profile from ORCID public API).
 *        Sets a copi-impersonate cookie with the target user's DB ID.
 *
 * DELETE — Stop impersonating. Clears the cookie.
 *
 * Both endpoints verify the caller is an admin via the raw JWT (not the
 * session, which may already reflect an impersonated identity).
 */

import { getToken } from "next-auth/jwt";
import { cookies } from "next/headers";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { fetchOrcidProfile } from "@/lib/orcid";
import { ORCID_REGEX } from "@/services/seed-profile";

const COOKIE_NAME = "copi-impersonate";

export async function POST(request: NextRequest) {
  const token = await getToken({ req: request });
  if (!token?.isAdmin) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await request.json();
  const orcid = body.orcid?.trim();

  if (!orcid || !ORCID_REGEX.test(orcid)) {
    return NextResponse.json(
      { error: "Invalid ORCID format. Expected: 0000-0000-0000-000X" },
      { status: 400 },
    );
  }

  // Look up existing user
  let user = await prisma.user.findUnique({
    where: { orcid },
    select: { id: true, name: true, orcid: true },
  });

  // If user doesn't exist, create from ORCID public profile
  if (!user) {
    try {
      const profile = await fetchOrcidProfile(orcid);
      user = await prisma.user.create({
        data: {
          email: profile.email ?? `${orcid}@orcid.placeholder`,
          name: profile.name,
          institution: profile.institution ?? "Unknown",
          department: profile.department ?? null,
          orcid,
          // No claimedAt — this is an admin-created record, not a real login
        },
        select: { id: true, name: true, orcid: true },
      });
    } catch (err) {
      console.error("[Impersonate] Failed to fetch/create user:", err);
      return NextResponse.json(
        { error: "Could not fetch ORCID profile. Verify the ORCID exists." },
        { status: 422 },
      );
    }
  }

  // Set impersonation cookie
  const cookieStore = await cookies();
  cookieStore.set(COOKIE_NAME, user.id, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24, // 24 hours
  });

  return NextResponse.json({ ok: true, name: user.name, userId: user.id });
}

export async function DELETE(request: NextRequest) {
  const token = await getToken({ req: request });
  if (!token?.isAdmin) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const cookieStore = await cookies();
  cookieStore.set(COOKIE_NAME, "", {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 0,
  });

  return NextResponse.json({ ok: true });
}
