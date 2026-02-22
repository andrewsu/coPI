/**
 * Tests for GET /api/match-pool/institutions — Institution autocomplete.
 *
 * Validates: authentication, returns distinct institution names, filters by
 * search query (case-insensitive), excludes the current user's institution from
 * being the only result, respects the 20-result limit.
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
      findMany: jest.fn(),
    },
  },
}));

import { getServerSession } from "next-auth";
import { prisma } from "@/lib/prisma";
import { NextRequest } from "next/server";

const mockGetServerSession = jest.mocked(getServerSession);
const mockUserFindMany = jest.mocked(prisma.user.findMany);

const { GET } = require("../route");

/** Helper to create a NextRequest with optional query params. */
function makeRequest(query?: string): NextRequest {
  const url = query
    ? `http://localhost/api/match-pool/institutions?q=${encodeURIComponent(query)}`
    : "http://localhost/api/match-pool/institutions";
  return new NextRequest(url);
}

describe("GET /api/match-pool/institutions", () => {
  beforeEach(() => jest.clearAllMocks());

  it("returns 401 when not authenticated", async () => {
    /** Unauthenticated users must be rejected. */
    mockGetServerSession.mockResolvedValue(null);
    const res = await GET(makeRequest());
    expect(res.status).toBe(401);
  });

  it("returns distinct institutions without query filter", async () => {
    /** Without a search query, returns all distinct institutions. */
    mockGetServerSession.mockResolvedValue({ user: { id: "user-1" } });
    mockUserFindMany.mockResolvedValue([
      { institution: "MIT" },
      { institution: "Stanford" },
      { institution: "Harvard" },
    ] as never);

    const res = await GET(makeRequest());
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.institutions).toEqual(["MIT", "Stanford", "Harvard"]);
  });

  it("passes query filter to Prisma contains with insensitive mode", async () => {
    /** Search query should filter institutions case-insensitively. */
    mockGetServerSession.mockResolvedValue({ user: { id: "user-1" } });
    mockUserFindMany.mockResolvedValue([{ institution: "MIT" }] as never);

    await GET(makeRequest("mit"));

    expect(mockUserFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          institution: { contains: "mit", mode: "insensitive" },
        }),
      }),
    );
  });

  it("excludes the current user from results", async () => {
    /** The user shouldn't see their own institution unless others share it. */
    mockGetServerSession.mockResolvedValue({ user: { id: "user-1" } });
    mockUserFindMany.mockResolvedValue([] as never);

    await GET(makeRequest());

    expect(mockUserFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id: { not: "user-1" },
        }),
      }),
    );
  });

  it("uses distinct and limits to 20 results", async () => {
    /** Results are distinct by institution and capped at 20. */
    mockGetServerSession.mockResolvedValue({ user: { id: "user-1" } });
    mockUserFindMany.mockResolvedValue([] as never);

    await GET(makeRequest());

    expect(mockUserFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        distinct: ["institution"],
        take: 20,
      }),
    );
  });
});
