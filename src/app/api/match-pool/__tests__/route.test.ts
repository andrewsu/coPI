/**
 * Tests for GET /api/match-pool — Fetch the user's match pool entries.
 *
 * Validates: authentication checks, empty pool handling, correct data
 * shape with target user details, affiliation selection inclusion,
 * and pool stats (totalCount, cap).
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
      findMany: jest.fn(),
    },
    affiliationSelection: {
      findMany: jest.fn(),
    },
  },
}));

import { getServerSession } from "next-auth";
import { prisma } from "@/lib/prisma";

const mockGetServerSession = jest.mocked(getServerSession);
const mockEntryFindMany = jest.mocked(prisma.matchPoolEntry.findMany);
const mockAffiliationFindMany = jest.mocked(
  prisma.affiliationSelection.findMany,
);

const { GET } = require("../route");

/** Sample match pool entries as returned by Prisma with included targetUser. */
const SAMPLE_ENTRIES = [
  {
    id: "entry-1",
    userId: "user-1",
    targetUserId: "user-2",
    source: "individual_select",
    createdAt: new Date("2025-06-01"),
    targetUser: {
      id: "user-2",
      name: "Alice Smith",
      institution: "MIT",
      department: "Biology",
    },
  },
  {
    id: "entry-2",
    userId: "user-1",
    targetUserId: "user-3",
    source: "affiliation_select",
    createdAt: new Date("2025-06-02"),
    targetUser: {
      id: "user-3",
      name: "Bob Jones",
      institution: "Stanford",
      department: null,
    },
  },
];

const SAMPLE_AFFILIATION_SELECTIONS = [
  {
    id: "aff-1",
    userId: "user-1",
    institution: "Stanford",
    department: null,
    selectAll: false,
    createdAt: new Date("2025-06-02"),
  },
];

describe("GET /api/match-pool", () => {
  beforeEach(() => jest.clearAllMocks());

  it("returns 401 when not authenticated", async () => {
    /** Unauthenticated users must be rejected. */
    mockGetServerSession.mockResolvedValue(null);
    const res = await GET();
    expect(res.status).toBe(401);
  });

  it("returns empty entries and zero count when pool is empty", async () => {
    /** New users with no match pool entries get an empty response. */
    mockGetServerSession.mockResolvedValue({ user: { id: "user-1" } });
    mockEntryFindMany.mockResolvedValue([]);
    mockAffiliationFindMany.mockResolvedValue([]);

    const res = await GET();
    expect(res.status).toBe(200);
    const data = await res.json();

    expect(data.entries).toEqual([]);
    expect(data.affiliationSelections).toEqual([]);
    expect(data.totalCount).toBe(0);
    expect(data.cap).toBe(200);
  });

  it("returns entries with target user details and source", async () => {
    /** Each entry includes the target researcher's name, institution, department. */
    mockGetServerSession.mockResolvedValue({ user: { id: "user-1" } });
    mockEntryFindMany.mockResolvedValue(SAMPLE_ENTRIES as never);
    mockAffiliationFindMany.mockResolvedValue([]);

    const res = await GET();
    expect(res.status).toBe(200);
    const data = await res.json();

    expect(data.entries).toHaveLength(2);
    expect(data.entries[0]).toEqual(
      expect.objectContaining({
        id: "entry-1",
        source: "individual_select",
        targetUser: {
          id: "user-2",
          name: "Alice Smith",
          institution: "MIT",
          department: "Biology",
        },
      }),
    );
    expect(data.entries[1]).toEqual(
      expect.objectContaining({
        id: "entry-2",
        source: "affiliation_select",
        targetUser: {
          id: "user-3",
          name: "Bob Jones",
          institution: "Stanford",
          department: null,
        },
      }),
    );
  });

  it("includes affiliation selections in the response", async () => {
    /** Active affiliation/all-users selections are returned alongside entries. */
    mockGetServerSession.mockResolvedValue({ user: { id: "user-1" } });
    mockEntryFindMany.mockResolvedValue(SAMPLE_ENTRIES as never);
    mockAffiliationFindMany.mockResolvedValue(
      SAMPLE_AFFILIATION_SELECTIONS as never,
    );

    const res = await GET();
    expect(res.status).toBe(200);
    const data = await res.json();

    expect(data.affiliationSelections).toHaveLength(1);
    expect(data.affiliationSelections[0]).toEqual(
      expect.objectContaining({
        id: "aff-1",
        institution: "Stanford",
        department: null,
        selectAll: false,
      }),
    );
  });

  it("reports correct totalCount matching entry count", async () => {
    /** totalCount reflects the number of MatchPoolEntry rows for cap display. */
    mockGetServerSession.mockResolvedValue({ user: { id: "user-1" } });
    mockEntryFindMany.mockResolvedValue(SAMPLE_ENTRIES as never);
    mockAffiliationFindMany.mockResolvedValue([]);

    const res = await GET();
    const data = await res.json();

    expect(data.totalCount).toBe(2);
    expect(data.cap).toBe(200);
  });

  it("queries Prisma with the authenticated user's ID", async () => {
    /** Ensures we only fetch entries belonging to the current user. */
    mockGetServerSession.mockResolvedValue({ user: { id: "user-99" } });
    mockEntryFindMany.mockResolvedValue([]);
    mockAffiliationFindMany.mockResolvedValue([]);

    await GET();

    expect(mockEntryFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { userId: "user-99" },
      }),
    );
    expect(mockAffiliationFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { userId: "user-99" },
      }),
    );
  });
});
