/**
 * Tests for GET /api/match-pool/search — User search for match pool.
 *
 * Validates: authentication, minimum query length, case-insensitive search
 * by name and institution, profile preview inclusion (without user-submitted
 * texts), inMatchPool flag accuracy, self-exclusion, and result limit.
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
    matchPoolEntry: {
      findMany: jest.fn(),
    },
  },
}));

import { getServerSession } from "next-auth";
import { prisma } from "@/lib/prisma";
import { NextRequest } from "next/server";

const mockGetServerSession = jest.mocked(getServerSession);
const mockUserFindMany = jest.mocked(prisma.user.findMany);
const mockEntryFindMany = jest.mocked(prisma.matchPoolEntry.findMany);

const { GET } = require("../route");

/** Helper to create a NextRequest with search params. */
function makeRequest(q: string): NextRequest {
  return new NextRequest(`http://localhost/api/match-pool/search?q=${encodeURIComponent(q)}`);
}

/** Sample users as returned by Prisma with included profile. */
const SAMPLE_USERS = [
  {
    id: "user-2",
    name: "Alice Smith",
    institution: "MIT",
    department: "Biology",
    profile: {
      researchSummary: "Studies gene regulation...",
      techniques: ["CRISPR", "RNA-seq"],
      diseaseAreas: ["Cancer"],
      keyTargets: ["TP53"],
    },
  },
  {
    id: "user-3",
    name: "Bob Jones",
    institution: "Stanford",
    department: null,
    profile: null,
  },
];

describe("GET /api/match-pool/search", () => {
  beforeEach(() => jest.clearAllMocks());

  it("returns 401 when not authenticated", async () => {
    /** Unauthenticated users must be rejected. */
    mockGetServerSession.mockResolvedValue(null);
    const res = await GET(makeRequest("alice"));
    expect(res.status).toBe(401);
  });

  it("returns 400 when query is too short", async () => {
    /** Queries under 2 characters are rejected to prevent overly broad searches. */
    mockGetServerSession.mockResolvedValue({ user: { id: "user-1" } });
    const res = await GET(makeRequest("a"));
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toContain("at least 2 characters");
  });

  it("returns 400 when query is empty", async () => {
    /** Empty queries are rejected. */
    mockGetServerSession.mockResolvedValue({ user: { id: "user-1" } });
    const res = await GET(makeRequest(""));
    expect(res.status).toBe(400);
  });

  it("searches by name and institution case-insensitively", async () => {
    /** Verifies Prisma is called with case-insensitive contains for name and institution. */
    mockGetServerSession.mockResolvedValue({ user: { id: "user-1" } });
    mockUserFindMany.mockResolvedValue([]);
    mockEntryFindMany.mockResolvedValue([]);

    await GET(makeRequest("alice"));

    expect(mockUserFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          id: { not: "user-1" },
          OR: [
            { name: { contains: "alice", mode: "insensitive" } },
            { institution: { contains: "alice", mode: "insensitive" } },
          ],
        },
      }),
    );
  });

  it("excludes the current user from results", async () => {
    /** Users should not find themselves in search results. */
    mockGetServerSession.mockResolvedValue({ user: { id: "user-1" } });
    mockUserFindMany.mockResolvedValue([]);
    mockEntryFindMany.mockResolvedValue([]);

    await GET(makeRequest("john"));

    expect(mockUserFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id: { not: "user-1" },
        }),
      }),
    );
  });

  it("returns users with profile preview data", async () => {
    /**
     * Search results include profile preview (researchSummary, techniques,
     * diseaseAreas, keyTargets) but NOT user-submitted texts.
     */
    mockGetServerSession.mockResolvedValue({ user: { id: "user-1" } });
    mockUserFindMany.mockResolvedValue(SAMPLE_USERS as never);
    mockEntryFindMany.mockResolvedValue([]);

    const res = await GET(makeRequest("alice"));
    const data = await res.json();

    expect(data.users).toHaveLength(2);
    expect(data.users[0]).toEqual({
      id: "user-2",
      name: "Alice Smith",
      institution: "MIT",
      department: "Biology",
      profile: {
        researchSummary: "Studies gene regulation...",
        techniques: ["CRISPR", "RNA-seq"],
        diseaseAreas: ["Cancer"],
        keyTargets: ["TP53"],
      },
      inMatchPool: false,
    });
  });

  it("returns null profile for users without a profile", async () => {
    /** Users who haven't completed onboarding have no ResearcherProfile. */
    mockGetServerSession.mockResolvedValue({ user: { id: "user-1" } });
    mockUserFindMany.mockResolvedValue(SAMPLE_USERS as never);
    mockEntryFindMany.mockResolvedValue([]);

    const res = await GET(makeRequest("bob"));
    const data = await res.json();

    expect(data.users[1].profile).toBeNull();
  });

  it("marks users already in match pool with inMatchPool=true", async () => {
    /** The inMatchPool flag lets the UI show 'Already added' vs 'Add' button. */
    mockGetServerSession.mockResolvedValue({ user: { id: "user-1" } });
    mockUserFindMany.mockResolvedValue(SAMPLE_USERS as never);
    mockEntryFindMany.mockResolvedValue([
      { targetUserId: "user-2" },
    ] as never);

    const res = await GET(makeRequest("alice"));
    const data = await res.json();

    expect(data.users[0].inMatchPool).toBe(true);
    expect(data.users[1].inMatchPool).toBe(false);
  });

  it("limits results to 20", async () => {
    /** Verifies the take parameter is set on the Prisma query. */
    mockGetServerSession.mockResolvedValue({ user: { id: "user-1" } });
    mockUserFindMany.mockResolvedValue([]);
    mockEntryFindMany.mockResolvedValue([]);

    await GET(makeRequest("test"));

    expect(mockUserFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        take: 20,
      }),
    );
  });

  it("orders results by name ascending", async () => {
    /** Results are alphabetically sorted for consistent display. */
    mockGetServerSession.mockResolvedValue({ user: { id: "user-1" } });
    mockUserFindMany.mockResolvedValue([]);
    mockEntryFindMany.mockResolvedValue([]);

    await GET(makeRequest("test"));

    expect(mockUserFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        orderBy: { name: "asc" },
      }),
    );
  });

  it("trims whitespace from query", async () => {
    /** Leading/trailing spaces should be stripped before searching. */
    mockGetServerSession.mockResolvedValue({ user: { id: "user-1" } });
    mockUserFindMany.mockResolvedValue([]);
    mockEntryFindMany.mockResolvedValue([]);

    await GET(makeRequest("  alice  "));

    expect(mockUserFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          OR: [
            { name: { contains: "alice", mode: "insensitive" } },
            { institution: { contains: "alice", mode: "insensitive" } },
          ],
        }),
      }),
    );
  });

  it("only checks inMatchPool for returned user IDs", async () => {
    /**
     * The match pool lookup should only query for the IDs returned by the
     * user search, not all match pool entries, for efficiency.
     */
    mockGetServerSession.mockResolvedValue({ user: { id: "user-1" } });
    mockUserFindMany.mockResolvedValue(SAMPLE_USERS as never);
    mockEntryFindMany.mockResolvedValue([]);

    await GET(makeRequest("alice"));

    expect(mockEntryFindMany).toHaveBeenCalledWith({
      where: {
        userId: "user-1",
        targetUserId: { in: ["user-2", "user-3"] },
      },
      select: { targetUserId: true },
    });
  });
});
