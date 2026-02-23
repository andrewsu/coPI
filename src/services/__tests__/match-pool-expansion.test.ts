/**
 * Tests for match pool auto-expansion service.
 *
 * WHY these tests exist:
 * When a new user joins, their match pool entries must be auto-created
 * for all existing users who have matching affiliation or all-users
 * selections. Getting this wrong either isolates new users from the
 * matching engine or pollutes pools with incorrect entries.
 */

import type { PrismaClient } from "@prisma/client";
import { expandMatchPoolsForNewUser } from "../match-pool-expansion";

function createMockDb() {
  return {
    user: {
      findUnique: jest.fn(),
    },
    affiliationSelection: {
      findMany: jest.fn(),
    },
    matchPoolEntry: {
      createMany: jest.fn().mockResolvedValue({ count: 0 }),
    },
  } as unknown as PrismaClient;
}

describe("expandMatchPoolsForNewUser", () => {
  let db: ReturnType<typeof createMockDb>;

  beforeEach(() => {
    jest.clearAllMocks();
    db = createMockDb();
    jest.spyOn(console, "log").mockImplementation(() => {});
    jest.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("creates entries for users with selectAll selections", async () => {
    /** All-users selections must include every new user regardless of affiliation. */
    (db.user.findUnique as jest.Mock).mockResolvedValue({
      id: "new-user",
      institution: "MIT",
      department: "Biology",
    });

    (db.affiliationSelection.findMany as jest.Mock).mockResolvedValue([
      {
        id: "sel-1",
        userId: "existing-user-1",
        institution: null,
        department: null,
        selectAll: true,
      },
    ]);

    (db.matchPoolEntry.createMany as jest.Mock).mockResolvedValue({ count: 1 });

    const result = await expandMatchPoolsForNewUser(db, "new-user");

    expect(result.entriesCreated).toBe(1);
    expect(result.affectedUserIds).toEqual(["existing-user-1"]);
    expect(db.matchPoolEntry.createMany).toHaveBeenCalledWith({
      data: [
        {
          userId: "existing-user-1",
          targetUserId: "new-user",
          source: "all_users",
        },
      ],
      skipDuplicates: true,
    });
  });

  it("creates entries for users with matching institution selections", async () => {
    /** Affiliation-based selections should match by institution (case-insensitive). */
    (db.user.findUnique as jest.Mock).mockResolvedValue({
      id: "new-user",
      institution: "Massachusetts Institute of Technology",
      department: "Biology",
    });

    (db.affiliationSelection.findMany as jest.Mock).mockResolvedValue([
      {
        id: "sel-1",
        userId: "existing-user-1",
        institution: "massachusetts institute of technology",
        department: null,
        selectAll: false,
      },
    ]);

    (db.matchPoolEntry.createMany as jest.Mock).mockResolvedValue({ count: 1 });

    const result = await expandMatchPoolsForNewUser(db, "new-user");

    expect(result.entriesCreated).toBe(1);
    expect(result.affectedUserIds).toEqual(["existing-user-1"]);
    expect(db.matchPoolEntry.createMany).toHaveBeenCalledWith({
      data: [
        {
          userId: "existing-user-1",
          targetUserId: "new-user",
          source: "affiliation_select",
        },
      ],
      skipDuplicates: true,
    });
  });

  it("requires department match when selection specifies a department", async () => {
    /** Institution-only match is insufficient when the selection also constrains by department. */
    (db.user.findUnique as jest.Mock).mockResolvedValue({
      id: "new-user",
      institution: "MIT",
      department: "Chemistry",
    });

    (db.affiliationSelection.findMany as jest.Mock).mockResolvedValue([
      {
        id: "sel-1",
        userId: "existing-user-1",
        institution: "MIT",
        department: "Biology",
        selectAll: false,
      },
    ]);

    const result = await expandMatchPoolsForNewUser(db, "new-user");

    expect(result.entriesCreated).toBe(0);
    expect(result.affectedUserIds).toEqual([]);
    expect(db.matchPoolEntry.createMany).not.toHaveBeenCalled();
  });

  it("matches institution+department selection when both match (case-insensitive)", async () => {
    /** Department matching must also be case-insensitive like institution. */
    (db.user.findUnique as jest.Mock).mockResolvedValue({
      id: "new-user",
      institution: "MIT",
      department: "biology",
    });

    (db.affiliationSelection.findMany as jest.Mock).mockResolvedValue([
      {
        id: "sel-1",
        userId: "existing-user-1",
        institution: "mit",
        department: "Biology",
        selectAll: false,
      },
    ]);

    (db.matchPoolEntry.createMany as jest.Mock).mockResolvedValue({ count: 1 });

    const result = await expandMatchPoolsForNewUser(db, "new-user");

    expect(result.entriesCreated).toBe(1);
    expect(result.affectedUserIds).toEqual(["existing-user-1"]);
  });

  it("skips affiliation selections when new user has no department but selection requires one", async () => {
    /** Users without a department should not match selections that require a specific department. */
    (db.user.findUnique as jest.Mock).mockResolvedValue({
      id: "new-user",
      institution: "MIT",
      department: null,
    });

    (db.affiliationSelection.findMany as jest.Mock).mockResolvedValue([
      {
        id: "sel-1",
        userId: "existing-user-1",
        institution: "MIT",
        department: "Biology",
        selectAll: false,
      },
    ]);

    const result = await expandMatchPoolsForNewUser(db, "new-user");

    expect(result.entriesCreated).toBe(0);
    expect(db.matchPoolEntry.createMany).not.toHaveBeenCalled();
  });

  it("deduplicates when a user has both selectAll and affiliation selections", async () => {
    /** A user with overlapping selection types should produce only one entry, with all_users source taking precedence. */
    (db.user.findUnique as jest.Mock).mockResolvedValue({
      id: "new-user",
      institution: "MIT",
      department: "Biology",
    });

    (db.affiliationSelection.findMany as jest.Mock).mockResolvedValue([
      {
        id: "sel-1",
        userId: "existing-user-1",
        institution: "MIT",
        department: null,
        selectAll: false,
      },
      {
        id: "sel-2",
        userId: "existing-user-1",
        institution: null,
        department: null,
        selectAll: true,
      },
    ]);

    (db.matchPoolEntry.createMany as jest.Mock).mockResolvedValue({ count: 1 });

    const result = await expandMatchPoolsForNewUser(db, "new-user");

    expect(result.entriesCreated).toBe(1);
    expect(result.affectedUserIds).toEqual(["existing-user-1"]);
    // all_users source takes precedence over affiliation_select
    expect(db.matchPoolEntry.createMany).toHaveBeenCalledWith({
      data: [
        {
          userId: "existing-user-1",
          targetUserId: "new-user",
          source: "all_users",
        },
      ],
      skipDuplicates: true,
    });
  });

  it("handles multiple users with different selection types", async () => {
    /** Real-world scenario: several users with different selection criteria all matching. */
    (db.user.findUnique as jest.Mock).mockResolvedValue({
      id: "new-user",
      institution: "MIT",
      department: "Biology",
    });

    (db.affiliationSelection.findMany as jest.Mock).mockResolvedValue([
      {
        id: "sel-1",
        userId: "user-a",
        institution: "MIT",
        department: null,
        selectAll: false,
      },
      {
        id: "sel-2",
        userId: "user-b",
        institution: null,
        department: null,
        selectAll: true,
      },
      {
        id: "sel-3",
        userId: "user-c",
        institution: "Stanford",
        department: null,
        selectAll: false,
      },
    ]);

    (db.matchPoolEntry.createMany as jest.Mock).mockResolvedValue({ count: 2 });

    const result = await expandMatchPoolsForNewUser(db, "new-user");

    // user-a matches by affiliation, user-b by selectAll, user-c doesn't match
    expect(result.affectedUserIds).toEqual(
      expect.arrayContaining(["user-a", "user-b"]),
    );
    expect(result.affectedUserIds).toHaveLength(2);
    expect(db.matchPoolEntry.createMany).toHaveBeenCalledWith({
      data: expect.arrayContaining([
        {
          userId: "user-a",
          targetUserId: "new-user",
          source: "affiliation_select",
        },
        {
          userId: "user-b",
          targetUserId: "new-user",
          source: "all_users",
        },
      ]),
      skipDuplicates: true,
    });
  });

  it("returns zero entries when user is not found", async () => {
    /** Graceful handling for race conditions where user is deleted between enqueue and processing. */
    (db.user.findUnique as jest.Mock).mockResolvedValue(null);

    const result = await expandMatchPoolsForNewUser(db, "deleted-user");

    expect(result.entriesCreated).toBe(0);
    expect(result.affectedUserIds).toEqual([]);
    expect(db.affiliationSelection.findMany).not.toHaveBeenCalled();
  });

  it("returns zero entries when no affiliation selections exist", async () => {
    /** New platform with no existing affiliation/all-users selections should be a no-op. */
    (db.user.findUnique as jest.Mock).mockResolvedValue({
      id: "new-user",
      institution: "MIT",
      department: "Biology",
    });

    (db.affiliationSelection.findMany as jest.Mock).mockResolvedValue([]);

    const result = await expandMatchPoolsForNewUser(db, "new-user");

    expect(result.entriesCreated).toBe(0);
    expect(result.affectedUserIds).toEqual([]);
    expect(db.matchPoolEntry.createMany).not.toHaveBeenCalled();
  });

  it("returns zero entries when no selections match the new user's affiliation", async () => {
    /** All selections exist but none match — should not create spurious entries. */
    (db.user.findUnique as jest.Mock).mockResolvedValue({
      id: "new-user",
      institution: "Harvard",
      department: "Physics",
    });

    (db.affiliationSelection.findMany as jest.Mock).mockResolvedValue([
      {
        id: "sel-1",
        userId: "existing-user-1",
        institution: "MIT",
        department: null,
        selectAll: false,
      },
      {
        id: "sel-2",
        userId: "existing-user-2",
        institution: "Stanford",
        department: null,
        selectAll: false,
      },
    ]);

    const result = await expandMatchPoolsForNewUser(db, "new-user");

    expect(result.entriesCreated).toBe(0);
    expect(result.affectedUserIds).toEqual([]);
    expect(db.matchPoolEntry.createMany).not.toHaveBeenCalled();
  });

  it("uses skipDuplicates to handle pre-existing individual selections", async () => {
    /** If user-a already individually selected new-user before they joined, createMany should not fail. */
    (db.user.findUnique as jest.Mock).mockResolvedValue({
      id: "new-user",
      institution: "MIT",
      department: null,
    });

    (db.affiliationSelection.findMany as jest.Mock).mockResolvedValue([
      {
        id: "sel-1",
        userId: "user-a",
        institution: null,
        department: null,
        selectAll: true,
      },
    ]);

    // createMany with skipDuplicates returns 0 when all are duplicates
    (db.matchPoolEntry.createMany as jest.Mock).mockResolvedValue({ count: 0 });

    const result = await expandMatchPoolsForNewUser(db, "new-user");

    // Service reports 0 entries created (all duplicates), but still lists affected users
    expect(result.entriesCreated).toBe(0);
    expect(result.affectedUserIds).toEqual(["user-a"]);
    expect(db.matchPoolEntry.createMany).toHaveBeenCalledWith(
      expect.objectContaining({ skipDuplicates: true }),
    );
  });
});
