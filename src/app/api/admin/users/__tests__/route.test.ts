/**
 * Tests for GET /api/admin/users.
 *
 * Validates: admin authorization (non-admin 403, unauthenticated 403),
 * full user list with computed profile status and aggregate counts,
 * query param filters (profileStatus, institution, claimed),
 * and correct exclusion of deleted users.
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
jest.mock("@/lib/pipeline-status", () => ({
  getPipelineStatus: jest.fn(),
}));

import { getServerSession } from "next-auth";
import { prisma } from "@/lib/prisma";
import { getPipelineStatus } from "@/lib/pipeline-status";

const mockGetServerSession = jest.mocked(getServerSession);
const mockFindMany = jest.mocked(prisma.user.findMany);
const mockGetPipelineStatus = jest.mocked(getPipelineStatus);

const { GET } = require("../route");

/** Helper to build a NextRequest with query params. */
function makeRequest(params: Record<string, string> = {}): {
  nextUrl: { searchParams: URLSearchParams };
} {
  const searchParams = new URLSearchParams(params);
  return { nextUrl: { searchParams } };
}

/** Factory for a mock user row as returned by the Prisma include query. */
function mockUserRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "user-1",
    name: "Dr. Alice",
    institution: "MIT",
    department: "Biology",
    orcid: "0000-0001-2345-6789",
    isAdmin: false,
    createdAt: new Date("2026-01-15"),
    claimedAt: new Date("2026-01-15"),
    deletedAt: null,
    profile: { id: "profile-1", pendingProfile: null },
    _count: {
      publications: 12,
      matchPoolSelections: 5,
      proposalsAsA: 3,
      proposalsAsB: 2,
    },
    ...overrides,
  };
}

describe("GET /api/admin/users", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetPipelineStatus.mockReturnValue(null);
  });

  it("returns 403 when not authenticated", async () => {
    /** Unauthenticated requests must be rejected with 403. */
    mockGetServerSession.mockResolvedValue(null);
    const res = await GET(makeRequest());
    expect(res.status).toBe(403);
  });

  it("returns 403 when user is not admin", async () => {
    /** Non-admin authenticated users must be rejected with 403. */
    mockGetServerSession.mockResolvedValue({
      user: { id: "user-1", isAdmin: false },
    });
    const res = await GET(makeRequest());
    expect(res.status).toBe(403);
  });

  it("returns all users with computed fields for admin", async () => {
    /** Admin users receive a full user list with profile status and counts. */
    mockGetServerSession.mockResolvedValue({
      user: { id: "admin-1", isAdmin: true },
    });
    mockFindMany.mockResolvedValue([mockUserRow()] as never);

    const res = await GET(makeRequest());
    expect(res.status).toBe(200);
    const data = await res.json();

    expect(data.totalCount).toBe(1);
    expect(data.users[0]).toMatchObject({
      id: "user-1",
      name: "Dr. Alice",
      institution: "MIT",
      department: "Biology",
      orcid: "0000-0001-2345-6789",
      profileStatus: "complete",
      publicationCount: 12,
      matchPoolSize: 5,
      proposalsGenerated: 5, // 3 + 2
    });
  });

  it("computes profileStatus as no_profile when no profile exists", async () => {
    /** Users without a ResearcherProfile get status 'no_profile'. */
    mockGetServerSession.mockResolvedValue({
      user: { id: "admin-1", isAdmin: true },
    });
    mockFindMany.mockResolvedValue([
      mockUserRow({ profile: null }),
    ] as never);

    const res = await GET(makeRequest());
    const data = await res.json();
    expect(data.users[0].profileStatus).toBe("no_profile");
  });

  it("computes profileStatus as generating when pipeline is active", async () => {
    /** Users with an active pipeline get status 'generating'. */
    mockGetServerSession.mockResolvedValue({
      user: { id: "admin-1", isAdmin: true },
    });
    mockFindMany.mockResolvedValue([mockUserRow()] as never);
    mockGetPipelineStatus.mockReturnValue({
      stage: "fetching_publications",
      message: "Pulling your publications...",
      warnings: [],
    });

    const res = await GET(makeRequest());
    const data = await res.json();
    expect(data.users[0].profileStatus).toBe("generating");
  });

  it("computes profileStatus as pending_update when pending profile exists", async () => {
    /** Users with a pending profile candidate get status 'pending_update'. */
    mockGetServerSession.mockResolvedValue({
      user: { id: "admin-1", isAdmin: true },
    });
    mockFindMany.mockResolvedValue([
      mockUserRow({
        profile: { id: "profile-1", pendingProfile: { techniques: ["RNA-seq"] } },
      }),
    ] as never);

    const res = await GET(makeRequest());
    const data = await res.json();
    expect(data.users[0].profileStatus).toBe("pending_update");
  });

  it("filters by profileStatus query param", async () => {
    /** The profileStatus filter is applied post-query on computed values. */
    mockGetServerSession.mockResolvedValue({
      user: { id: "admin-1", isAdmin: true },
    });
    mockFindMany.mockResolvedValue([
      mockUserRow({ id: "user-1" }),
      mockUserRow({ id: "user-2", profile: null }),
    ] as never);

    const res = await GET(makeRequest({ profileStatus: "no_profile" }));
    const data = await res.json();
    expect(data.totalCount).toBe(1);
    expect(data.users[0].id).toBe("user-2");
  });

  it("passes institution filter to Prisma query", async () => {
    /** Institution filter is passed as a case-insensitive contains to Prisma. */
    mockGetServerSession.mockResolvedValue({
      user: { id: "admin-1", isAdmin: true },
    });
    mockFindMany.mockResolvedValue([] as never);

    await GET(makeRequest({ institution: "Harvard" }));

    expect(mockFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          institution: { contains: "Harvard", mode: "insensitive" },
        }),
      }),
    );
  });

  it("passes claimed=true filter to Prisma query", async () => {
    /** claimed=true filters for users with a non-null claimedAt. */
    mockGetServerSession.mockResolvedValue({
      user: { id: "admin-1", isAdmin: true },
    });
    mockFindMany.mockResolvedValue([] as never);

    await GET(makeRequest({ claimed: "true" }));

    expect(mockFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          claimedAt: { not: null },
        }),
      }),
    );
  });

  it("passes claimed=false filter for unclaimed/seeded profiles", async () => {
    /** claimed=false filters for users with null claimedAt (seeded profiles). */
    mockGetServerSession.mockResolvedValue({
      user: { id: "admin-1", isAdmin: true },
    });
    mockFindMany.mockResolvedValue([] as never);

    await GET(makeRequest({ claimed: "false" }));

    expect(mockFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          claimedAt: null,
        }),
      }),
    );
  });

  it("excludes deleted users from results", async () => {
    /** Deleted users (deletedAt not null) are excluded via the where clause. */
    mockGetServerSession.mockResolvedValue({
      user: { id: "admin-1", isAdmin: true },
    });
    mockFindMany.mockResolvedValue([] as never);

    await GET(makeRequest());

    expect(mockFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          deletedAt: null,
        }),
      }),
    );
  });

  it("returns claimedAt for each user", async () => {
    /** claimedAt distinguishes OAuth signups from unclaimed seeded profiles. */
    mockGetServerSession.mockResolvedValue({
      user: { id: "admin-1", isAdmin: true },
    });
    const claimedUser = mockUserRow({ id: "user-1", claimedAt: new Date("2026-01-15") });
    const seededUser = mockUserRow({ id: "user-2", claimedAt: null });
    mockFindMany.mockResolvedValue([claimedUser, seededUser] as never);

    const res = await GET(makeRequest());
    const data = await res.json();
    expect(data.users[0].claimedAt).not.toBeNull();
    expect(data.users[1].claimedAt).toBeNull();
  });
});
