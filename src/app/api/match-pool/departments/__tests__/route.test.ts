/**
 * Tests for GET /api/match-pool/departments — Department autocomplete for a given institution.
 *
 * Validates: authentication, requires institution parameter, returns distinct
 * non-null department names, filters by search query, excludes current user.
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

/** Helper to create a NextRequest with query params. */
function makeRequest(params: Record<string, string>): NextRequest {
  const url = new URL("http://localhost/api/match-pool/departments");
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, value);
  }
  return new NextRequest(url.toString());
}

describe("GET /api/match-pool/departments", () => {
  beforeEach(() => jest.clearAllMocks());

  it("returns 401 when not authenticated", async () => {
    /** Unauthenticated users must be rejected. */
    mockGetServerSession.mockResolvedValue(null);
    const res = await GET(makeRequest({ institution: "MIT" }));
    expect(res.status).toBe(401);
  });

  it("returns 400 when institution param is missing", async () => {
    /** Department lookup requires an institution to scope the search. */
    mockGetServerSession.mockResolvedValue({ user: { id: "user-1" } });
    const res = await GET(makeRequest({}));
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toContain("institution");
  });

  it("returns distinct departments for the given institution", async () => {
    /** Returns non-null department names for users at the specified institution. */
    mockGetServerSession.mockResolvedValue({ user: { id: "user-1" } });
    mockUserFindMany.mockResolvedValue([
      { department: "Biology" },
      { department: "Chemistry" },
    ] as never);

    const res = await GET(makeRequest({ institution: "MIT" }));
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.departments).toEqual(["Biology", "Chemistry"]);
  });

  it("filters departments by search query", async () => {
    /** Search query narrows department results case-insensitively. */
    mockGetServerSession.mockResolvedValue({ user: { id: "user-1" } });
    mockUserFindMany.mockResolvedValue([{ department: "Biology" }] as never);

    await GET(makeRequest({ institution: "MIT", q: "bio" }));

    expect(mockUserFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          institution: { equals: "MIT", mode: "insensitive" },
          department: { not: null, contains: "bio", mode: "insensitive" },
        }),
      }),
    );
  });

  it("excludes the current user from results", async () => {
    /** The user shouldn't see their own department in results. */
    mockGetServerSession.mockResolvedValue({ user: { id: "user-1" } });
    mockUserFindMany.mockResolvedValue([] as never);

    await GET(makeRequest({ institution: "MIT" }));

    expect(mockUserFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id: { not: "user-1" },
        }),
      }),
    );
  });

  it("filters out null departments from the response", async () => {
    /** Only non-null department values should be returned. */
    mockGetServerSession.mockResolvedValue({ user: { id: "user-1" } });
    mockUserFindMany.mockResolvedValue([
      { department: "Biology" },
      { department: null },
    ] as never);

    const res = await GET(makeRequest({ institution: "MIT" }));
    const data = await res.json();
    expect(data.departments).toEqual(["Biology"]);
  });
});
