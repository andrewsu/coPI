/**
 * Tests for the admin CLI grant/revoke commands.
 *
 * These tests verify CLI argument parsing, ORCID validation, and the
 * setAdminAccess database operation. Per specs/admin-dashboard.md,
 * admin access is managed exclusively via CLI commands:
 *   npm run admin:grant -- <ORCID>
 *   npm run admin:revoke -- <ORCID>
 */

import {
  parseArgs,
  validateOrcid,
  setAdminAccess,
  type Action,
} from "../admin-access";

// Mock dependencies so importing the module doesn't trigger side effects
jest.mock("@/lib/prisma", () => ({ prisma: {} }));
jest.mock("@/services/seed-profile", () => ({
  ORCID_REGEX: /^\d{4}-\d{4}-\d{4}-\d{3}[\dX]$/,
}));

describe("parseArgs", () => {
  /** Verifies grant action with ORCID is parsed correctly. */
  it("parses grant action with ORCID", () => {
    const result = parseArgs(["grant", "0000-0001-2345-6789"]);
    expect(result.action).toBe("grant");
    expect(result.orcid).toBe("0000-0001-2345-6789");
    expect(result.help).toBe(false);
  });

  /** Verifies revoke action with ORCID is parsed correctly. */
  it("parses revoke action with ORCID", () => {
    const result = parseArgs(["revoke", "0000-0002-3456-7890"]);
    expect(result.action).toBe("revoke");
    expect(result.orcid).toBe("0000-0002-3456-7890");
    expect(result.help).toBe(false);
  });

  /** Verifies --help flag is recognized and short-circuits other validation. */
  it("parses --help flag", () => {
    const result = parseArgs(["--help"]);
    expect(result.help).toBe(true);
  });

  /** Verifies -h shorthand works the same as --help. */
  it("parses -h shorthand for --help", () => {
    const result = parseArgs(["-h"]);
    expect(result.help).toBe(true);
  });

  /** Verifies --help with other args still returns help=true. */
  it("parses --help even with action and ORCID", () => {
    const result = parseArgs(["grant", "0000-0001-2345-6789", "--help"]);
    expect(result.help).toBe(true);
  });

  /** Verifies invalid action name is rejected with a clear message. */
  it("throws on invalid action", () => {
    expect(() => parseArgs(["promote", "0000-0001-2345-6789"])).toThrow(
      'Invalid action: "promote". Must be "grant" or "revoke".',
    );
  });

  /** Verifies missing action argument is caught. */
  it("throws when no arguments given", () => {
    expect(() => parseArgs([])).toThrow(
      "Missing action. Must specify 'grant' or 'revoke'.",
    );
  });

  /** Verifies missing ORCID argument after action is caught. */
  it("throws when ORCID is missing", () => {
    expect(() => parseArgs(["grant"])).toThrow("Missing ORCID ID argument.");
  });

  /** Verifies extra arguments beyond action + ORCID are rejected. */
  it("throws on too many arguments", () => {
    expect(() =>
      parseArgs(["grant", "0000-0001-2345-6789", "0000-0002-3456-7890"]),
    ).toThrow("Too many arguments. Expected: <action> <ORCID>");
  });

  /** Verifies unknown flags are rejected. */
  it("throws on unknown option", () => {
    expect(() =>
      parseArgs(["--verbose", "grant", "0000-0001-2345-6789"]),
    ).toThrow("Unknown option: --verbose");
  });
});

describe("validateOrcid", () => {
  /** Verifies standard ORCID format is accepted. */
  it("accepts valid ORCID with numeric check digit", () => {
    expect(validateOrcid("0000-0001-2345-6789")).toBe(true);
  });

  /** Verifies ORCID with X check digit is accepted. */
  it("accepts valid ORCID with X check digit", () => {
    expect(validateOrcid("0000-0002-3456-789X")).toBe(true);
  });

  /** Verifies malformed strings are rejected. */
  it("rejects invalid ORCID formats", () => {
    expect(validateOrcid("invalid")).toBe(false);
    expect(validateOrcid("1234")).toBe(false);
    expect(validateOrcid("0000-0001-2345")).toBe(false);
    expect(validateOrcid("0000-0001-2345-67890")).toBe(false);
    expect(validateOrcid("")).toBe(false);
  });
});

describe("setAdminAccess", () => {
  /** Creates a mock PrismaClient for database operation tests. */
  function createMockPrisma(userData: {
    id?: string;
    name?: string | null;
    isAdmin?: boolean;
    deletedAt?: Date | null;
  } | null) {
    return {
      user: {
        findUnique: jest.fn().mockResolvedValue(userData),
        update: jest.fn().mockResolvedValue({}),
      },
    } as unknown as Parameters<typeof setAdminAccess>[0];
  }

  /** Verifies granting admin to a non-admin user updates the database. */
  it("grants admin to a non-admin user", async () => {
    const mockPrisma = createMockPrisma({
      id: "user-1",
      name: "Dr. Smith",
      isAdmin: false,
      deletedAt: null,
    });

    const result = await setAdminAccess(
      mockPrisma,
      "0000-0001-2345-6789",
      "grant",
    );

    expect(result.success).toBe(true);
    expect(result.userName).toBe("Dr. Smith");
    expect(result.wasAlready).toBe(false);
    expect(mockPrisma.user.update).toHaveBeenCalledWith({
      where: { orcid: "0000-0001-2345-6789" },
      data: { isAdmin: true },
    });
  });

  /** Verifies revoking admin from an admin user updates the database. */
  it("revokes admin from an admin user", async () => {
    const mockPrisma = createMockPrisma({
      id: "user-1",
      name: "Dr. Smith",
      isAdmin: true,
      deletedAt: null,
    });

    const result = await setAdminAccess(
      mockPrisma,
      "0000-0001-2345-6789",
      "revoke",
    );

    expect(result.success).toBe(true);
    expect(result.userName).toBe("Dr. Smith");
    expect(result.wasAlready).toBe(false);
    expect(mockPrisma.user.update).toHaveBeenCalledWith({
      where: { orcid: "0000-0001-2345-6789" },
      data: { isAdmin: false },
    });
  });

  /** Verifies granting admin to an already-admin user is a no-op. */
  it("reports wasAlready when granting to existing admin", async () => {
    const mockPrisma = createMockPrisma({
      id: "user-1",
      name: "Dr. Smith",
      isAdmin: true,
      deletedAt: null,
    });

    const result = await setAdminAccess(
      mockPrisma,
      "0000-0001-2345-6789",
      "grant",
    );

    expect(result.success).toBe(true);
    expect(result.wasAlready).toBe(true);
    expect(mockPrisma.user.update).not.toHaveBeenCalled();
  });

  /** Verifies revoking admin from a non-admin user is a no-op. */
  it("reports wasAlready when revoking from non-admin", async () => {
    const mockPrisma = createMockPrisma({
      id: "user-1",
      name: "Dr. Smith",
      isAdmin: false,
      deletedAt: null,
    });

    const result = await setAdminAccess(
      mockPrisma,
      "0000-0001-2345-6789",
      "revoke",
    );

    expect(result.success).toBe(true);
    expect(result.wasAlready).toBe(true);
    expect(mockPrisma.user.update).not.toHaveBeenCalled();
  });

  /** Verifies error when ORCID doesn't match any user in the database. */
  it("returns error when user not found", async () => {
    const mockPrisma = createMockPrisma(null);

    const result = await setAdminAccess(
      mockPrisma,
      "0000-0001-2345-6789",
      "grant",
    );

    expect(result.success).toBe(false);
    expect(result.error).toContain("No user found");
    expect(result.error).toContain("0000-0001-2345-6789");
  });

  /** Verifies error when trying to modify a deleted user. */
  it("returns error when user is deleted", async () => {
    const mockPrisma = createMockPrisma({
      id: "user-1",
      name: "Dr. Smith",
      isAdmin: false,
      deletedAt: new Date("2026-01-01"),
    });

    const result = await setAdminAccess(
      mockPrisma,
      "0000-0001-2345-6789",
      "grant",
    );

    expect(result.success).toBe(false);
    expect(result.error).toContain("has been deleted");
  });

  /** Verifies fallback to ORCID when user name is null. */
  it("uses ORCID as fallback when user name is null", async () => {
    const mockPrisma = createMockPrisma({
      id: "user-1",
      name: null,
      isAdmin: false,
      deletedAt: null,
    });

    const result = await setAdminAccess(
      mockPrisma,
      "0000-0001-2345-6789",
      "grant",
    );

    expect(result.success).toBe(true);
    expect(result.userName).toBe("0000-0001-2345-6789");
  });
});
