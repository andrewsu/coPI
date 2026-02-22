/**
 * Tests for POST /api/match-pool/add — Add user to match pool.
 *
 * Validates: authentication, request body validation, self-addition prevention,
 * target user existence check, duplicate detection (409), and successful
 * creation with source=individual_select (201).
 */

/* eslint-disable @typescript-eslint/no-require-imports */

jest.mock("next-auth", () => ({
  getServerSession: jest.fn(),
}));
jest.mock("@/lib/auth", () => ({
  authOptions: {},
}));
jest.mock("@/lib/prisma", () => ({
  prisma: {
    user: {
      findUnique: jest.fn(),
    },
    matchPoolEntry: {
      findUnique: jest.fn(),
      create: jest.fn(),
    },
  },
}));

import { getServerSession } from "next-auth";
import { prisma } from "@/lib/prisma";
import { NextRequest } from "next/server";

const mockGetServerSession = jest.mocked(getServerSession);
const mockUserFindUnique = jest.mocked(prisma.user.findUnique);
const mockEntryFindUnique = jest.mocked(prisma.matchPoolEntry.findUnique);
const mockEntryCreate = jest.mocked(prisma.matchPoolEntry.create);

const { POST } = require("../route");

/** Helper to create a NextRequest with JSON body. */
function makeRequest(body: Record<string, unknown>): NextRequest {
  return new NextRequest("http://localhost/api/match-pool/add", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("POST /api/match-pool/add", () => {
  beforeEach(() => jest.clearAllMocks());

  it("returns 401 when not authenticated", async () => {
    /** Unauthenticated users must be rejected. */
    mockGetServerSession.mockResolvedValue(null);
    const res = await POST(makeRequest({ targetUserId: "user-2" }));
    expect(res.status).toBe(401);
  });

  it("returns 400 when targetUserId is missing", async () => {
    /** Request body must include targetUserId. */
    mockGetServerSession.mockResolvedValue({ user: { id: "user-1" } });
    const res = await POST(makeRequest({}));
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toContain("targetUserId is required");
  });

  it("returns 400 when targetUserId is not a string", async () => {
    /** targetUserId must be a string, not a number or other type. */
    mockGetServerSession.mockResolvedValue({ user: { id: "user-1" } });
    const res = await POST(makeRequest({ targetUserId: 123 }));
    expect(res.status).toBe(400);
  });

  it("returns 400 when trying to add self", async () => {
    /** Users cannot add themselves to their own match pool. */
    mockGetServerSession.mockResolvedValue({ user: { id: "user-1" } });
    const res = await POST(makeRequest({ targetUserId: "user-1" }));
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toContain("yourself");
  });

  it("returns 404 when target user does not exist", async () => {
    /** Cannot add non-existent users to the match pool. */
    mockGetServerSession.mockResolvedValue({ user: { id: "user-1" } });
    mockUserFindUnique.mockResolvedValue(null);

    const res = await POST(makeRequest({ targetUserId: "nonexistent" }));
    expect(res.status).toBe(404);
    const data = await res.json();
    expect(data.error).toContain("not found");
  });

  it("returns 409 when user is already in match pool", async () => {
    /** Duplicate match pool entries return 409 Conflict. */
    mockGetServerSession.mockResolvedValue({ user: { id: "user-1" } });
    mockUserFindUnique.mockResolvedValue({ id: "user-2" } as never);
    mockEntryFindUnique.mockResolvedValue({
      id: "existing-entry",
    } as never);

    const res = await POST(makeRequest({ targetUserId: "user-2" }));
    expect(res.status).toBe(409);
    const data = await res.json();
    expect(data.error).toContain("already in your match pool");
  });

  it("creates entry with source=individual_select and returns 201", async () => {
    /** Successful addition creates a MatchPoolEntry with individual_select source. */
    mockGetServerSession.mockResolvedValue({ user: { id: "user-1" } });
    mockUserFindUnique.mockResolvedValue({ id: "user-2" } as never);
    mockEntryFindUnique.mockResolvedValue(null);
    mockEntryCreate.mockResolvedValue({
      id: "new-entry-id",
      targetUserId: "user-2",
      source: "individual_select",
      createdAt: new Date("2025-07-01"),
    } as never);

    const res = await POST(makeRequest({ targetUserId: "user-2" }));
    expect(res.status).toBe(201);
    const data = await res.json();
    expect(data.entry).toEqual(
      expect.objectContaining({
        id: "new-entry-id",
        targetUserId: "user-2",
        source: "individual_select",
      }),
    );
  });

  it("passes correct data to Prisma create", async () => {
    /** Verifies the Prisma create call uses the authenticated user's ID and individual_select source. */
    mockGetServerSession.mockResolvedValue({ user: { id: "user-1" } });
    mockUserFindUnique.mockResolvedValue({ id: "user-2" } as never);
    mockEntryFindUnique.mockResolvedValue(null);
    mockEntryCreate.mockResolvedValue({
      id: "new-entry-id",
      targetUserId: "user-2",
      source: "individual_select",
      createdAt: new Date("2025-07-01"),
    } as never);

    await POST(makeRequest({ targetUserId: "user-2" }));

    expect(mockEntryCreate).toHaveBeenCalledWith({
      data: {
        userId: "user-1",
        targetUserId: "user-2",
        source: "individual_select",
      },
      select: {
        id: true,
        targetUserId: true,
        source: true,
        createdAt: true,
      },
    });
  });

  it("checks for existing entry using compound unique key", async () => {
    /** Uses the (userId, targetUserId) compound unique to detect duplicates. */
    mockGetServerSession.mockResolvedValue({ user: { id: "user-1" } });
    mockUserFindUnique.mockResolvedValue({ id: "user-2" } as never);
    mockEntryFindUnique.mockResolvedValue(null);
    mockEntryCreate.mockResolvedValue({
      id: "new-entry-id",
      targetUserId: "user-2",
      source: "individual_select",
      createdAt: new Date("2025-07-01"),
    } as never);

    await POST(makeRequest({ targetUserId: "user-2" }));

    expect(mockEntryFindUnique).toHaveBeenCalledWith({
      where: {
        userId_targetUserId: {
          userId: "user-1",
          targetUserId: "user-2",
        },
      },
      select: { id: true },
    });
  });

  it("returns 400 for invalid JSON body", async () => {
    /** Malformed request bodies are rejected with 400. */
    mockGetServerSession.mockResolvedValue({ user: { id: "user-1" } });
    const req = new NextRequest("http://localhost/api/match-pool/add", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "not-valid-json",
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
  });
});
