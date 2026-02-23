/**
 * Tests for DELETE /api/account — account deletion endpoint.
 *
 * Validates:
 * - Authentication required (401)
 * - Confirmation required in request body (400)
 * - Successful deletion returns 200 with summary
 * - Already-deleted or missing accounts return 404
 * - Server errors return 500
 */

jest.mock("next-auth", () => ({
  getServerSession: jest.fn(),
}));

jest.mock("@/lib/auth", () => ({
  authOptions: {},
}));

jest.mock("@/lib/prisma", () => ({
  prisma: {},
}));

jest.mock("@/services/account-deletion", () => ({
  deleteAccount: jest.fn(),
}));

import { getServerSession } from "next-auth";
import { deleteAccount } from "@/services/account-deletion";

const mockGetServerSession = jest.mocked(getServerSession);
const mockDeleteAccount = jest.mocked(deleteAccount);

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { DELETE } = require("../route");

/** Builds a NextRequest-like object for DELETE with JSON body. */
function makeDeleteRequest(body: unknown): { json: () => Promise<unknown> } {
  return { json: () => Promise.resolve(body) };
}

/** Builds a NextRequest-like object that throws on json() — simulates invalid JSON. */
function makeBadRequest(): { json: () => Promise<never> } {
  return { json: () => Promise.reject(new Error("Invalid JSON")) };
}

describe("DELETE /api/account", () => {
  beforeEach(() => jest.clearAllMocks());

  it("returns 401 when not authenticated", async () => {
    /** Unauthenticated requests should be rejected. */
    mockGetServerSession.mockResolvedValue(null);

    const res = await DELETE(makeDeleteRequest({ confirm: true }));
    expect(res.status).toBe(401);

    const data = await res.json();
    expect(data.error).toBe("Unauthorized");
  });

  it("returns 400 for invalid JSON body", async () => {
    mockGetServerSession.mockResolvedValue({ user: { id: "user-1" } });

    const res = await DELETE(makeBadRequest());
    expect(res.status).toBe(400);

    const data = await res.json();
    expect(data.error).toBe("Invalid JSON body");
  });

  it("returns 400 when confirm is missing", async () => {
    /** Per spec: requires explicit confirmation to prevent accidental deletion. */
    mockGetServerSession.mockResolvedValue({ user: { id: "user-1" } });

    const res = await DELETE(makeDeleteRequest({}));
    expect(res.status).toBe(400);

    const data = await res.json();
    expect(data.error).toMatch(/Confirmation required/);
  });

  it("returns 400 when confirm is false", async () => {
    mockGetServerSession.mockResolvedValue({ user: { id: "user-1" } });

    const res = await DELETE(makeDeleteRequest({ confirm: false }));
    expect(res.status).toBe(400);

    const data = await res.json();
    expect(data.error).toMatch(/Confirmation required/);
  });

  it("returns 400 when confirm is a string instead of boolean true", async () => {
    mockGetServerSession.mockResolvedValue({ user: { id: "user-1" } });

    const res = await DELETE(makeDeleteRequest({ confirm: "true" }));
    expect(res.status).toBe(400);

    const data = await res.json();
    expect(data.error).toMatch(/Confirmation required/);
  });

  it("returns 200 on successful deletion with summary", async () => {
    /** Happy path: authenticated user confirms deletion, service succeeds. */
    mockGetServerSession.mockResolvedValue({ user: { id: "user-1" } });
    mockDeleteAccount.mockResolvedValue({
      preservedProposalCount: 2,
      deletedProposalCount: 3,
    });

    const res = await DELETE(makeDeleteRequest({ confirm: true }));
    expect(res.status).toBe(200);

    const data = await res.json();
    expect(data.message).toBe("Account deleted successfully");
    expect(data.preservedProposalCount).toBe(2);
    expect(data.deletedProposalCount).toBe(3);

    // Verify deleteAccount was called with the correct user ID
    expect(mockDeleteAccount).toHaveBeenCalledWith(
      expect.anything(),
      "user-1",
    );
  });

  it("returns 404 when user not found", async () => {
    mockGetServerSession.mockResolvedValue({ user: { id: "user-1" } });
    mockDeleteAccount.mockRejectedValue(new Error("User not found"));

    const res = await DELETE(makeDeleteRequest({ confirm: true }));
    expect(res.status).toBe(404);

    const data = await res.json();
    expect(data.error).toBe("User not found");
  });

  it("returns 404 when account is already deleted", async () => {
    mockGetServerSession.mockResolvedValue({ user: { id: "user-1" } });
    mockDeleteAccount.mockRejectedValue(
      new Error("Account is already deleted"),
    );

    const res = await DELETE(makeDeleteRequest({ confirm: true }));
    expect(res.status).toBe(404);

    const data = await res.json();
    expect(data.error).toBe("Account is already deleted");
  });

  it("returns 500 on unexpected service error", async () => {
    mockGetServerSession.mockResolvedValue({ user: { id: "user-1" } });
    mockDeleteAccount.mockRejectedValue(new Error("Database connection lost"));

    const res = await DELETE(makeDeleteRequest({ confirm: true }));
    expect(res.status).toBe(500);

    const data = await res.json();
    expect(data.error).toBe("Failed to delete account");
  });
});
