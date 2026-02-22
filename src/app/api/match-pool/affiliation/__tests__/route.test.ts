/**
 * Tests for POST /api/match-pool/affiliation — Create affiliation selection.
 *
 * Validates: authentication, body validation (institution required when not selectAll),
 * duplicate detection (409), AffiliationSelection creation, auto-creation of
 * MatchPoolEntry rows for matching users (skipping duplicates), selectAll mode
 * for "all users" selection, and correct response shape.
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
    affiliationSelection: {
      findFirst: jest.fn(),
      create: jest.fn(),
    },
    user: {
      findMany: jest.fn(),
    },
    matchPoolEntry: {
      createMany: jest.fn(),
    },
  },
}));

import { getServerSession } from "next-auth";
import { prisma } from "@/lib/prisma";
import { NextRequest } from "next/server";

const mockGetServerSession = jest.mocked(getServerSession);
const mockAffiliationFindFirst = jest.mocked(
  prisma.affiliationSelection.findFirst,
);
const mockAffiliationCreate = jest.mocked(prisma.affiliationSelection.create);
const mockUserFindMany = jest.mocked(prisma.user.findMany);
const mockEntryCreateMany = jest.mocked(prisma.matchPoolEntry.createMany);

const { POST } = require("../route");

/** Helper to create a NextRequest with JSON body. */
function makeRequest(body: Record<string, unknown>): NextRequest {
  return new NextRequest("http://localhost/api/match-pool/affiliation", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("POST /api/match-pool/affiliation", () => {
  beforeEach(() => jest.clearAllMocks());

  it("returns 401 when not authenticated", async () => {
    /** Unauthenticated users must be rejected. */
    mockGetServerSession.mockResolvedValue(null);
    const res = await POST(makeRequest({ institution: "MIT" }));
    expect(res.status).toBe(401);
  });

  it("returns 400 when institution is missing and selectAll is not true", async () => {
    /** Affiliation selections without selectAll must specify an institution. */
    mockGetServerSession.mockResolvedValue({ user: { id: "user-1" } });
    const res = await POST(makeRequest({}));
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toContain("institution is required");
  });

  it("returns 400 when institution is empty string", async () => {
    /** Empty string institution is treated as missing. */
    mockGetServerSession.mockResolvedValue({ user: { id: "user-1" } });
    const res = await POST(makeRequest({ institution: "  " }));
    expect(res.status).toBe(400);
  });

  it("returns 400 for invalid JSON body", async () => {
    /** Malformed request bodies are rejected with 400. */
    mockGetServerSession.mockResolvedValue({ user: { id: "user-1" } });
    const req = new NextRequest("http://localhost/api/match-pool/affiliation", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "not-valid-json",
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
  });

  it("returns 409 when duplicate affiliation selection exists", async () => {
    /** Cannot create the same institution+department selection twice. */
    mockGetServerSession.mockResolvedValue({ user: { id: "user-1" } });
    mockAffiliationFindFirst.mockResolvedValue({
      id: "existing-aff",
    } as never);

    const res = await POST(makeRequest({ institution: "MIT" }));
    expect(res.status).toBe(409);
    const data = await res.json();
    expect(data.error).toContain("already have this affiliation selection");
  });

  it("returns 409 when duplicate selectAll selection exists", async () => {
    /** Cannot create a second "all users" selection. */
    mockGetServerSession.mockResolvedValue({ user: { id: "user-1" } });
    mockAffiliationFindFirst.mockResolvedValue({
      id: "existing-all",
    } as never);

    const res = await POST(makeRequest({ selectAll: true }));
    expect(res.status).toBe(409);
    const data = await res.json();
    expect(data.error).toContain("all users");
  });

  it("creates affiliation selection with institution and creates entries for matching users", async () => {
    /** Successful affiliation selection creates the record and entry rows. */
    mockGetServerSession.mockResolvedValue({ user: { id: "user-1" } });
    mockAffiliationFindFirst.mockResolvedValue(null);
    mockAffiliationCreate.mockResolvedValue({
      id: "aff-new",
      userId: "user-1",
      institution: "MIT",
      department: null,
      selectAll: false,
      createdAt: new Date("2025-07-01"),
    } as never);
    mockUserFindMany.mockResolvedValue([
      { id: "user-2" },
      { id: "user-3" },
    ] as never);
    mockEntryCreateMany.mockResolvedValue({ count: 2 } as never);

    const res = await POST(makeRequest({ institution: "MIT" }));
    expect(res.status).toBe(201);

    const data = await res.json();
    expect(data.affiliationSelection).toEqual(
      expect.objectContaining({
        id: "aff-new",
        institution: "MIT",
        department: null,
        selectAll: false,
      }),
    );
    expect(data.entriesCreated).toBe(2);
  });

  it("creates entries with source=affiliation_select for institution-based selection", async () => {
    /** Institution-based entries use the affiliation_select source. */
    mockGetServerSession.mockResolvedValue({ user: { id: "user-1" } });
    mockAffiliationFindFirst.mockResolvedValue(null);
    mockAffiliationCreate.mockResolvedValue({
      id: "aff-new",
      userId: "user-1",
      institution: "Stanford",
      department: "Biology",
      selectAll: false,
      createdAt: new Date("2025-07-01"),
    } as never);
    mockUserFindMany.mockResolvedValue([{ id: "user-2" }] as never);
    mockEntryCreateMany.mockResolvedValue({ count: 1 } as never);

    await POST(
      makeRequest({ institution: "Stanford", department: "Biology" }),
    );

    expect(mockEntryCreateMany).toHaveBeenCalledWith({
      data: [
        {
          userId: "user-1",
          targetUserId: "user-2",
          source: "affiliation_select",
        },
      ],
      skipDuplicates: true,
    });
  });

  it("creates entries with source=all_users for selectAll selection", async () => {
    /** All-users entries use the all_users source. */
    mockGetServerSession.mockResolvedValue({ user: { id: "user-1" } });
    mockAffiliationFindFirst.mockResolvedValue(null);
    mockAffiliationCreate.mockResolvedValue({
      id: "aff-all",
      userId: "user-1",
      institution: null,
      department: null,
      selectAll: true,
      createdAt: new Date("2025-07-01"),
    } as never);
    mockUserFindMany.mockResolvedValue([
      { id: "user-2" },
      { id: "user-3" },
    ] as never);
    mockEntryCreateMany.mockResolvedValue({ count: 2 } as never);

    const res = await POST(makeRequest({ selectAll: true }));
    expect(res.status).toBe(201);

    expect(mockEntryCreateMany).toHaveBeenCalledWith({
      data: expect.arrayContaining([
        expect.objectContaining({ source: "all_users" }),
      ]),
      skipDuplicates: true,
    });
  });

  it("does not require institution when selectAll is true", async () => {
    /** selectAll mode doesn't need institution — it matches all users. */
    mockGetServerSession.mockResolvedValue({ user: { id: "user-1" } });
    mockAffiliationFindFirst.mockResolvedValue(null);
    mockAffiliationCreate.mockResolvedValue({
      id: "aff-all",
      userId: "user-1",
      institution: null,
      department: null,
      selectAll: true,
      createdAt: new Date("2025-07-01"),
    } as never);
    mockUserFindMany.mockResolvedValue([] as never);

    const res = await POST(makeRequest({ selectAll: true }));
    expect(res.status).toBe(201);
  });

  it("excludes current user from matching users", async () => {
    /** The current user should never appear in their own match pool. */
    mockGetServerSession.mockResolvedValue({ user: { id: "user-1" } });
    mockAffiliationFindFirst.mockResolvedValue(null);
    mockAffiliationCreate.mockResolvedValue({
      id: "aff-new",
      userId: "user-1",
      institution: "MIT",
      department: null,
      selectAll: false,
      createdAt: new Date("2025-07-01"),
    } as never);
    mockUserFindMany.mockResolvedValue([] as never);

    await POST(makeRequest({ institution: "MIT" }));

    expect(mockUserFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id: { not: "user-1" },
        }),
      }),
    );
  });

  it("handles zero matching users gracefully", async () => {
    /** When no users match the criteria, entries created is 0. */
    mockGetServerSession.mockResolvedValue({ user: { id: "user-1" } });
    mockAffiliationFindFirst.mockResolvedValue(null);
    mockAffiliationCreate.mockResolvedValue({
      id: "aff-new",
      userId: "user-1",
      institution: "Obscure University",
      department: null,
      selectAll: false,
      createdAt: new Date("2025-07-01"),
    } as never);
    mockUserFindMany.mockResolvedValue([] as never);

    const res = await POST(makeRequest({ institution: "Obscure University" }));
    expect(res.status).toBe(201);
    const data = await res.json();
    expect(data.entriesCreated).toBe(0);
    // createMany should not be called when there are no matching users
    expect(mockEntryCreateMany).not.toHaveBeenCalled();
  });

  it("trims institution and department whitespace", async () => {
    /** Leading/trailing whitespace is trimmed from institution and department. */
    mockGetServerSession.mockResolvedValue({ user: { id: "user-1" } });
    mockAffiliationFindFirst.mockResolvedValue(null);
    mockAffiliationCreate.mockResolvedValue({
      id: "aff-new",
      userId: "user-1",
      institution: "MIT",
      department: "Biology",
      selectAll: false,
      createdAt: new Date("2025-07-01"),
    } as never);
    mockUserFindMany.mockResolvedValue([] as never);

    await POST(makeRequest({ institution: "  MIT  ", department: "  Biology  " }));

    expect(mockAffiliationCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        institution: "MIT",
        department: "Biology",
      }),
    });
  });

  it("uses case-insensitive matching for institution", async () => {
    /** Institution matching should be case-insensitive per Prisma convention. */
    mockGetServerSession.mockResolvedValue({ user: { id: "user-1" } });
    mockAffiliationFindFirst.mockResolvedValue(null);
    mockAffiliationCreate.mockResolvedValue({
      id: "aff-new",
      userId: "user-1",
      institution: "mit",
      department: null,
      selectAll: false,
      createdAt: new Date("2025-07-01"),
    } as never);
    mockUserFindMany.mockResolvedValue([] as never);

    await POST(makeRequest({ institution: "mit" }));

    expect(mockUserFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          institution: { equals: "mit", mode: "insensitive" },
        }),
      }),
    );
  });
});
