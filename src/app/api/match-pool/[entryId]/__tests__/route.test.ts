/**
 * Tests for DELETE /api/match-pool/[entryId] — Remove a match pool entry.
 *
 * Validates: authentication checks, ownership verification (cannot delete
 * another user's entry), 404 for non-existent entries, successful deletion
 * returns 204, and correct Prisma calls.
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
    matchPoolEntry: {
      findUnique: jest.fn(),
      delete: jest.fn(),
    },
  },
}));

import { getServerSession } from "next-auth";
import { prisma } from "@/lib/prisma";

const mockGetServerSession = jest.mocked(getServerSession);
const mockFindUnique = jest.mocked(prisma.matchPoolEntry.findUnique);
const mockDelete = jest.mocked(prisma.matchPoolEntry.delete);

const { DELETE } = require("../route");

/** Builds a params object matching Next.js 15 dynamic route convention (Promise). */
function makeParams(entryId: string) {
  return { params: Promise.resolve({ entryId }) };
}

describe("DELETE /api/match-pool/[entryId]", () => {
  beforeEach(() => jest.clearAllMocks());

  it("returns 401 when not authenticated", async () => {
    /** Unauthenticated users must be rejected. */
    mockGetServerSession.mockResolvedValue(null);
    const res = await DELETE({}, makeParams("entry-1"));
    expect(res.status).toBe(401);
  });

  it("returns 404 when entry does not exist", async () => {
    /** Non-existent entry IDs return 404. */
    mockGetServerSession.mockResolvedValue({ user: { id: "user-1" } });
    mockFindUnique.mockResolvedValue(null);

    const res = await DELETE({}, makeParams("nonexistent-id"));
    expect(res.status).toBe(404);
  });

  it("returns 404 when entry belongs to another user", async () => {
    /** Users cannot delete entries from another user's match pool. */
    mockGetServerSession.mockResolvedValue({ user: { id: "user-1" } });
    mockFindUnique.mockResolvedValue({
      id: "entry-1",
      userId: "user-2", // different user
    } as never);

    const res = await DELETE({}, makeParams("entry-1"));
    expect(res.status).toBe(404);
    expect(mockDelete).not.toHaveBeenCalled();
  });

  it("deletes entry and returns 204 when user owns it", async () => {
    /** Successful deletion returns 204 No Content. */
    mockGetServerSession.mockResolvedValue({ user: { id: "user-1" } });
    mockFindUnique.mockResolvedValue({
      id: "entry-1",
      userId: "user-1",
    } as never);
    mockDelete.mockResolvedValue({} as never);

    const res = await DELETE({}, makeParams("entry-1"));
    expect(res.status).toBe(204);

    expect(mockDelete).toHaveBeenCalledWith({
      where: { id: "entry-1" },
    });
  });

  it("looks up the entry by the correct entryId param", async () => {
    /** Verifies the dynamic route param is correctly extracted. */
    mockGetServerSession.mockResolvedValue({ user: { id: "user-1" } });
    mockFindUnique.mockResolvedValue(null);

    await DELETE({}, makeParams("specific-entry-id"));

    expect(mockFindUnique).toHaveBeenCalledWith({
      where: { id: "specific-entry-id" },
      select: { id: true, userId: true },
    });
  });
});
