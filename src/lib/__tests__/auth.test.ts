/**
 * Tests for NextAuth callbacks (signIn, jwt, session).
 *
 * Validates the authentication flow:
 * - signIn: creates new users, links returning users, claims seeded profiles
 * - jwt: stores database user ID in the token
 * - session: exposes user ID and ORCID in the session
 *
 * These callbacks are the bridge between ORCID OAuth and the CoPI database.
 * Getting them wrong means users can't authenticate or see the wrong data.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */
import type { Account, User } from "next-auth";
import type { JWT } from "next-auth/jwt";
import type { AdapterUser } from "next-auth/adapters";

// Mock Prisma before importing auth
jest.mock("@/lib/prisma", () => ({
  prisma: {
    user: {
      findUnique: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
  },
}));

// Mock ORCID client (used by the provider, not directly by callbacks)
jest.mock("@/lib/orcid", () => ({
  fetchOrcidProfile: jest.fn(),
}));

// Mock seed-profile service for visibility transition on claim
jest.mock("@/services/seed-profile", () => ({
  flipPendingProposalsOnClaim: jest.fn().mockResolvedValue(0),
}));

import { authOptions } from "../auth";
import { prisma } from "@/lib/prisma";
import { flipPendingProposalsOnClaim } from "@/services/seed-profile";

const mockPrisma = prisma as jest.Mocked<typeof prisma>;

// Helper to call signIn callback with proper types
function callSignIn(
  user: Partial<User> & { id: string },
  account: Partial<Account> & { provider: string },
  profile?: Record<string, unknown>
) {
  const signIn = authOptions.callbacks!.signIn!;
  return signIn({
    user: user as User | AdapterUser,
    account: account as Account,
    profile: profile as any,
    email: undefined,
    credentials: undefined,
  });
}

// Helper to call jwt callback
function callJwt(
  token: JWT,
  user?: Partial<User> & { id: string },
  account?: Partial<Account> & { provider: string }
) {
  const jwt = authOptions.callbacks!.jwt!;
  return jwt({
    token,
    user: user as User | AdapterUser,
    account: account as Account | null,
    trigger: user ? "signIn" : "update",
  });
}

// Helper to call session callback
function callSession(
  session: { user: Record<string, unknown>; expires: string },
  token: JWT
) {
  const sessionCb = authOptions.callbacks!.session!;
  return sessionCb({
    session: session as any,
    token,
    user: {} as any,
    trigger: "update",
    newSession: undefined,
  });
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe("signIn callback", () => {
  // The signIn callback handles three scenarios:
  // 1. New user: creates a User record from ORCID data
  // 2. Returning user: updates name if changed
  // 3. Seeded profile: links existing record, updates placeholder fields

  it("creates a new user on first ORCID login", async () => {
    (mockPrisma.user.findUnique as jest.Mock).mockResolvedValue(null);
    (mockPrisma.user.create as jest.Mock).mockResolvedValue({
      id: "db-uuid-1",
      orcid: "0000-0001-2345-6789",
    });

    const result = await callSignIn(
      { id: "0000-0001-2345-6789", name: "Jane Doe", email: "jane@uni.edu" },
      { provider: "orcid" },
      { institution: "MIT", department: "Biology" }
    );

    expect(result).toBe(true);
    expect(mockPrisma.user.create).toHaveBeenCalledWith({
      data: {
        email: "jane@uni.edu",
        name: "Jane Doe",
        institution: "MIT",
        department: "Biology",
        orcid: "0000-0001-2345-6789",
        claimedAt: expect.any(Date),
      },
    });
  });

  it("uses placeholder email when ORCID provides none", async () => {
    (mockPrisma.user.findUnique as jest.Mock).mockResolvedValue(null);
    (mockPrisma.user.create as jest.Mock).mockResolvedValue({
      id: "db-uuid-2",
    });

    await callSignIn(
      { id: "0000-0001-0000-0001", name: "No Email", email: null },
      { provider: "orcid" },
      { institution: null, department: null }
    );

    expect(mockPrisma.user.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        email: "0000-0001-0000-0001@orcid.placeholder",
        institution: "Unknown",
        claimedAt: expect.any(Date),
      }),
    });
  });

  it("returns true for returning user without updates", async () => {
    /** Returning user with claimedAt set and no field changes — no update needed. */
    (mockPrisma.user.findUnique as jest.Mock).mockResolvedValue({
      id: "db-uuid-3",
      orcid: "0000-0001-0000-0002",
      name: "Existing Name",
      institution: "Harvard",
      department: "CS",
      claimedAt: new Date("2024-01-01"),
    });

    const result = await callSignIn(
      { id: "0000-0001-0000-0002", name: "Existing Name", email: "e@h.edu" },
      { provider: "orcid" },
      { institution: "Harvard", department: "CS" }
    );

    expect(result).toBe(true);
    expect(mockPrisma.user.update).not.toHaveBeenCalled();
    expect(mockPrisma.user.create).not.toHaveBeenCalled();
  });

  it("updates name for returning user when changed on ORCID", async () => {
    /** Returning user who already claimed — only name should be updated. */
    (mockPrisma.user.findUnique as jest.Mock).mockResolvedValue({
      id: "db-uuid-4",
      orcid: "0000-0001-0000-0003",
      name: "Old Name",
      institution: "Stanford",
      department: "Physics",
      claimedAt: new Date("2024-01-01"),
    });

    await callSignIn(
      { id: "0000-0001-0000-0003", name: "New Name", email: "e@s.edu" },
      { provider: "orcid" },
      { institution: "Stanford", department: "Physics" }
    );

    expect(mockPrisma.user.update).toHaveBeenCalledWith({
      where: { id: "db-uuid-4" },
      data: { name: "New Name" },
    });
  });

  it("updates placeholder institution on seeded profile claim", async () => {
    /** Seeded profile (claimedAt=null) being claimed via ORCID login.
     *  Should update institution, department, AND set claimedAt. */
    (mockPrisma.user.findUnique as jest.Mock).mockResolvedValue({
      id: "seeded-uuid",
      orcid: "0000-0001-0000-0004",
      name: "Seeded User",
      institution: "Unknown",
      department: null,
      claimedAt: null,
    });

    await callSignIn(
      { id: "0000-0001-0000-0004", name: "Seeded User", email: "s@u.edu" },
      { provider: "orcid" },
      { institution: "UCSD", department: "Medicine" }
    );

    expect(mockPrisma.user.update).toHaveBeenCalledWith({
      where: { id: "seeded-uuid" },
      data: {
        institution: "UCSD",
        department: "Medicine",
        claimedAt: expect.any(Date),
      },
    });
  });

  it("flips pending proposals to visible when seeded profile is claimed", async () => {
    /** Per spec: when a seeded profile is claimed, proposals with
     *  pending_other_interest visibility should be flipped to visible
     *  so they appear in the newly-claimed user's swipe queue. */
    (mockPrisma.user.findUnique as jest.Mock).mockResolvedValue({
      id: "seeded-uuid",
      orcid: "0000-0001-0000-0004",
      name: "Seeded User",
      institution: "Unknown",
      department: null,
      claimedAt: null,
    });

    await callSignIn(
      { id: "0000-0001-0000-0004", name: "Seeded User", email: "s@u.edu" },
      { provider: "orcid" },
      { institution: "UCSD", department: "Medicine" }
    );

    expect(flipPendingProposalsOnClaim).toHaveBeenCalledWith(
      prisma,
      "seeded-uuid"
    );
  });

  it("does not flip proposals for already-claimed users", async () => {
    /** Returning users who already claimed should not trigger visibility changes. */
    (mockPrisma.user.findUnique as jest.Mock).mockResolvedValue({
      id: "db-uuid-3",
      orcid: "0000-0001-0000-0002",
      name: "Existing Name",
      institution: "Harvard",
      department: "CS",
      claimedAt: new Date("2024-01-01"),
    });

    await callSignIn(
      { id: "0000-0001-0000-0002", name: "Existing Name", email: "e@h.edu" },
      { provider: "orcid" },
      { institution: "Harvard", department: "CS" }
    );

    expect(flipPendingProposalsOnClaim).not.toHaveBeenCalled();
  });

  it("rejects non-ORCID provider", async () => {
    const result = await callSignIn(
      { id: "some-id", name: "Test" },
      { provider: "google" }
    );
    expect(result).toBe(false);
  });

  it("rejects when no account provided", async () => {
    const signIn = authOptions.callbacks!.signIn!;
    const result = await signIn({
      user: { id: "test" } as User | AdapterUser,
      account: null,
      profile: undefined,
      email: undefined,
      credentials: undefined,
    });
    expect(result).toBe(false);
  });

  it("returns false on database error", async () => {
    (mockPrisma.user.findUnique as jest.Mock).mockRejectedValue(
      new Error("DB connection failed")
    );

    const result = await callSignIn(
      { id: "0000-0001-0000-0005", name: "Error User" },
      { provider: "orcid" }
    );

    expect(result).toBe(false);
  });
});

describe("jwt callback", () => {
  // The jwt callback stores the database user ID, ORCID, and isAdmin in the JWT token.
  // This only happens on initial sign-in (when user and account are present).

  it("stores database user ID and isAdmin in token on sign-in", async () => {
    (mockPrisma.user.findUnique as jest.Mock).mockResolvedValue({
      id: "db-uuid-100",
      orcid: "0000-0001-2345-6789",
      isAdmin: false,
    });

    const result = await callJwt(
      { sub: "test" },
      { id: "0000-0001-2345-6789", name: "Jane" },
      { provider: "orcid" }
    );

    expect(result.userId).toBe("db-uuid-100");
    expect(result.orcid).toBe("0000-0001-2345-6789");
    expect(result.isAdmin).toBe(false);
  });

  it("stores isAdmin=true in token for admin users", async () => {
    /** Admin users should have isAdmin=true propagated to the JWT
     *  so the session callback can expose it to the client. */
    (mockPrisma.user.findUnique as jest.Mock).mockResolvedValue({
      id: "admin-uuid-1",
      orcid: "0000-0001-9999-0001",
      isAdmin: true,
    });

    const result = await callJwt(
      { sub: "test" },
      { id: "0000-0001-9999-0001", name: "Admin User" },
      { provider: "orcid" }
    );

    expect(result.isAdmin).toBe(true);
  });

  it("preserves existing token on subsequent requests (no user)", async () => {
    const existingToken: JWT = {
      sub: "test",
      userId: "db-uuid-100",
      orcid: "0000-0001-2345-6789",
      isAdmin: false,
    };

    const result = await callJwt(existingToken);

    expect(result.userId).toBe("db-uuid-100");
    expect(result.orcid).toBe("0000-0001-2345-6789");
    expect(result.isAdmin).toBe(false);
    expect(mockPrisma.user.findUnique).not.toHaveBeenCalled();
  });
});

describe("session callback", () => {
  // The session callback exposes user ID, ORCID, and isAdmin from the JWT to the client session.
  // This is how client-side code (useSession) gets the database user ID and admin status.

  it("adds user ID, ORCID, and isAdmin to session", async () => {
    const session = {
      user: { name: "Jane", email: "jane@test.com" },
      expires: "2099-01-01",
    };
    const token: JWT = {
      sub: "test",
      userId: "db-uuid-200",
      orcid: "0000-0001-2345-6789",
      isAdmin: false,
    };

    const result = await callSession(session, token);

    expect((result as any).user.id).toBe("db-uuid-200");
    expect((result as any).user.orcid).toBe("0000-0001-2345-6789");
    expect((result as any).user.isAdmin).toBe(false);
  });

  it("exposes isAdmin=true for admin users", async () => {
    /** Verifies admin status flows from JWT to client-visible session,
     *  enabling UI features like the admin dashboard link. */
    const session = {
      user: { name: "Admin", email: "admin@test.com" },
      expires: "2099-01-01",
    };
    const token: JWT = {
      sub: "test",
      userId: "admin-uuid-1",
      orcid: "0000-0001-9999-0001",
      isAdmin: true,
    };

    const result = await callSession(session, token);

    expect((result as any).user.isAdmin).toBe(true);
  });

  it("defaults isAdmin to false when not set in token", async () => {
    /** When the JWT token lacks isAdmin (e.g., tokens issued before
     *  the isAdmin migration), the session should default to false
     *  rather than undefined. */
    const session = {
      user: { name: "Old Token User", email: "old@test.com" },
      expires: "2099-01-01",
    };
    const token: JWT = {
      sub: "test",
      userId: "db-uuid-300",
      orcid: "0000-0001-0000-0099",
      // isAdmin intentionally omitted — simulates pre-migration JWT
    };

    const result = await callSession(session, token);

    expect((result as any).user.isAdmin).toBe(false);
  });
});

describe("authOptions configuration", () => {
  // Validates the static NextAuth configuration matches spec requirements.

  it("uses JWT session strategy", () => {
    expect(authOptions.session?.strategy).toBe("jwt");
  });

  it("sets 30-day session expiration", () => {
    expect(authOptions.session?.maxAge).toBe(30 * 24 * 60 * 60);
  });

  it("configures /login as sign-in page", () => {
    expect(authOptions.pages?.signIn).toBe("/login");
  });

  it("has exactly one provider (ORCID)", () => {
    expect(authOptions.providers).toHaveLength(1);
    expect(authOptions.providers[0]!.id).toBe("orcid");
  });
});
