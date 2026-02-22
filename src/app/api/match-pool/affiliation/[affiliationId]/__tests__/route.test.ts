/**
 * Tests for DELETE /api/match-pool/affiliation/[affiliationId] — Remove affiliation selection.
 *
 * Validates: authentication, ownership verification, 404 for non-existent selections,
 * cascade deletion of MatchPoolEntry rows with the matching source, deletion of the
 * AffiliationSelection record itself, and re-creation of entries for remaining
 * overlapping affiliation selections.
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
      findUnique: jest.fn(),
      findMany: jest.fn(),
      delete: jest.fn(),
    },
    matchPoolEntry: {
      deleteMany: jest.fn(),
      createMany: jest.fn(),
    },
    user: {
      findMany: jest.fn(),
    },
  },
}));

import { getServerSession } from "next-auth";
import { prisma } from "@/lib/prisma";

const mockGetServerSession = jest.mocked(getServerSession);
const mockAffiliationFindUnique = jest.mocked(
  prisma.affiliationSelection.findUnique,
);
const mockAffiliationFindMany = jest.mocked(
  prisma.affiliationSelection.findMany,
);
const mockAffiliationDelete = jest.mocked(prisma.affiliationSelection.delete);
const mockEntryDeleteMany = jest.mocked(prisma.matchPoolEntry.deleteMany);
const mockEntryCreateMany = jest.mocked(prisma.matchPoolEntry.createMany);
const mockUserFindMany = jest.mocked(prisma.user.findMany);

const { DELETE } = require("../route");

/** Builds a params object matching Next.js 15 dynamic route convention (Promise). */
function makeParams(affiliationId: string) {
  return { params: Promise.resolve({ affiliationId }) };
}

describe("DELETE /api/match-pool/affiliation/[affiliationId]", () => {
  beforeEach(() => jest.clearAllMocks());

  it("returns 401 when not authenticated", async () => {
    /** Unauthenticated users must be rejected. */
    mockGetServerSession.mockResolvedValue(null);
    const res = await DELETE({}, makeParams("aff-1"));
    expect(res.status).toBe(401);
  });

  it("returns 404 when affiliation selection does not exist", async () => {
    /** Non-existent selection IDs return 404. */
    mockGetServerSession.mockResolvedValue({ user: { id: "user-1" } });
    mockAffiliationFindUnique.mockResolvedValue(null);

    const res = await DELETE({}, makeParams("nonexistent"));
    expect(res.status).toBe(404);
  });

  it("returns 404 when selection belongs to another user", async () => {
    /** Users cannot delete another user's affiliation selection. */
    mockGetServerSession.mockResolvedValue({ user: { id: "user-1" } });
    mockAffiliationFindUnique.mockResolvedValue({
      id: "aff-1",
      userId: "user-2",
      selectAll: false,
      institution: "MIT",
      department: null,
    } as never);

    const res = await DELETE({}, makeParams("aff-1"));
    expect(res.status).toBe(404);
    expect(mockEntryDeleteMany).not.toHaveBeenCalled();
    expect(mockAffiliationDelete).not.toHaveBeenCalled();
  });

  it("deletes affiliation_select entries and selection, returns 204", async () => {
    /** Successful deletion removes entries with source=affiliation_select and the selection itself. */
    mockGetServerSession.mockResolvedValue({ user: { id: "user-1" } });
    mockAffiliationFindUnique.mockResolvedValue({
      id: "aff-1",
      userId: "user-1",
      selectAll: false,
      institution: "MIT",
      department: null,
    } as never);
    mockEntryDeleteMany.mockResolvedValue({ count: 5 } as never);
    mockAffiliationDelete.mockResolvedValue({} as never);
    mockAffiliationFindMany.mockResolvedValue([] as never);

    const res = await DELETE({}, makeParams("aff-1"));
    expect(res.status).toBe(204);

    // Should delete entries with source=affiliation_select
    expect(mockEntryDeleteMany).toHaveBeenCalledWith({
      where: {
        userId: "user-1",
        source: "affiliation_select",
      },
    });

    // Should delete the AffiliationSelection record
    expect(mockAffiliationDelete).toHaveBeenCalledWith({
      where: { id: "aff-1" },
    });
  });

  it("deletes all_users entries when removing a selectAll selection", async () => {
    /** Removing an all-users selection deletes entries with source=all_users. */
    mockGetServerSession.mockResolvedValue({ user: { id: "user-1" } });
    mockAffiliationFindUnique.mockResolvedValue({
      id: "aff-all",
      userId: "user-1",
      selectAll: true,
      institution: null,
      department: null,
    } as never);
    mockEntryDeleteMany.mockResolvedValue({ count: 10 } as never);
    mockAffiliationDelete.mockResolvedValue({} as never);
    mockAffiliationFindMany.mockResolvedValue([] as never);

    const res = await DELETE({}, makeParams("aff-all"));
    expect(res.status).toBe(204);

    expect(mockEntryDeleteMany).toHaveBeenCalledWith({
      where: {
        userId: "user-1",
        source: "all_users",
      },
    });
  });

  it("re-creates entries for remaining overlapping affiliation selections", async () => {
    /** When deleting one of multiple affiliation selections, entries from remaining selections are re-created. */
    mockGetServerSession.mockResolvedValue({ user: { id: "user-1" } });
    mockAffiliationFindUnique.mockResolvedValue({
      id: "aff-1",
      userId: "user-1",
      selectAll: false,
      institution: "MIT",
      department: null,
    } as never);
    mockEntryDeleteMany.mockResolvedValue({ count: 3 } as never);
    mockAffiliationDelete.mockResolvedValue({} as never);

    // Simulate a remaining affiliation selection for Stanford
    mockAffiliationFindMany.mockResolvedValue([
      {
        id: "aff-2",
        userId: "user-1",
        institution: "Stanford",
        department: null,
        selectAll: false,
      },
    ] as never);
    mockUserFindMany.mockResolvedValue([{ id: "user-3" }] as never);
    mockEntryCreateMany.mockResolvedValue({ count: 1 } as never);

    await DELETE({}, makeParams("aff-1"));

    // Should re-create entries for the remaining Stanford selection
    expect(mockEntryCreateMany).toHaveBeenCalledWith({
      data: [
        {
          userId: "user-1",
          targetUserId: "user-3",
          source: "affiliation_select",
        },
      ],
      skipDuplicates: true,
    });
  });

  it("looks up the selection by the correct affiliationId param", async () => {
    /** Verifies the dynamic route param is correctly extracted. */
    mockGetServerSession.mockResolvedValue({ user: { id: "user-1" } });
    mockAffiliationFindUnique.mockResolvedValue(null);

    await DELETE({}, makeParams("specific-aff-id"));

    expect(mockAffiliationFindUnique).toHaveBeenCalledWith({
      where: { id: "specific-aff-id" },
      select: { id: true, userId: true, selectAll: true, institution: true, department: true },
    });
  });
});
