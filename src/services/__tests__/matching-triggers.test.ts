/**
 * Tests for the matching triggers service.
 *
 * Validates that each trigger function correctly enqueues run_matching jobs
 * on the job queue with properly ordered researcher IDs:
 *
 * - triggerMatchingForNewPair: enqueues one job for a single new pair
 * - triggerMatchingForNewPairs: enqueues one job per target user (batch)
 * - triggerMatchingForProfileUpdate: finds all match pool entries involving
 *   the user, deduplicates pairs, and enqueues one job per unique pair
 * - triggerScheduledMatchingRun: delegates to computeEligiblePairs for
 *   global pair discovery and enqueues one job per eligible pair
 *
 * The job queue and dependencies are mocked — no real queue processing,
 * database queries, or LLM calls are made.
 */

import type { PrismaClient } from "@prisma/client";
import {
  triggerMatchingForNewPair,
  triggerMatchingForNewPairs,
  triggerMatchingForProfileUpdate,
  triggerScheduledMatchingRun,
} from "../matching-triggers";

// Mock the job queue module to intercept enqueue calls
jest.mock("@/lib/job-queue");
jest.mock("@/services/eligible-pairs");

import { getJobQueue } from "@/lib/job-queue";
import { computeEligiblePairs } from "@/services/eligible-pairs";

const mockGetJobQueue = getJobQueue as jest.MockedFunction<typeof getJobQueue>;
const mockComputeEligiblePairs = computeEligiblePairs as jest.MockedFunction<
  typeof computeEligiblePairs
>;

// Shared mock queue instance
const mockEnqueue = jest.fn<Promise<string>, [unknown]>();
const mockQueue = {
  enqueue: mockEnqueue,
} as unknown as ReturnType<typeof getJobQueue>;

beforeEach(() => {
  jest.clearAllMocks();
  jest.spyOn(console, "log").mockImplementation(() => {});
  jest.spyOn(console, "error").mockImplementation(() => {});
  mockGetJobQueue.mockReturnValue(mockQueue);
  mockEnqueue.mockResolvedValue("job-1");
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("triggerMatchingForNewPair", () => {
  it("enqueues a run_matching job with correctly ordered IDs", async () => {
    // user-b > user-a alphabetically, so A should be user-a
    const jobId = await triggerMatchingForNewPair("user-b", "user-a");

    expect(jobId).toBe("job-1");
    expect(mockEnqueue).toHaveBeenCalledTimes(1);
    expect(mockEnqueue).toHaveBeenCalledWith({
      type: "run_matching",
      researcherAId: "user-a",
      researcherBId: "user-b",
    });
  });

  it("handles IDs that are already in order", async () => {
    await triggerMatchingForNewPair("aaa", "zzz");

    expect(mockEnqueue).toHaveBeenCalledWith({
      type: "run_matching",
      researcherAId: "aaa",
      researcherBId: "zzz",
    });
  });

  it("returns null when enqueue fails", async () => {
    mockEnqueue.mockRejectedValueOnce(new Error("queue full"));

    await expect(triggerMatchingForNewPair("a", "b")).rejects.toThrow(
      "queue full",
    );
  });
});

describe("triggerMatchingForNewPairs", () => {
  it("enqueues one job per target user with correctly ordered IDs", async () => {
    let jobCounter = 0;
    mockEnqueue.mockImplementation(async () => `job-${++jobCounter}`);

    const count = await triggerMatchingForNewPairs("user-m", [
      "user-a",
      "user-z",
    ]);

    expect(count).toBe(2);
    expect(mockEnqueue).toHaveBeenCalledTimes(2);
    // user-a < user-m, so user-a is researcherA
    expect(mockEnqueue).toHaveBeenCalledWith({
      type: "run_matching",
      researcherAId: "user-a",
      researcherBId: "user-m",
    });
    // user-m < user-z, so user-m is researcherA
    expect(mockEnqueue).toHaveBeenCalledWith({
      type: "run_matching",
      researcherAId: "user-m",
      researcherBId: "user-z",
    });
  });

  it("returns 0 for empty target list", async () => {
    const count = await triggerMatchingForNewPairs("user-1", []);

    expect(count).toBe(0);
    expect(mockEnqueue).not.toHaveBeenCalled();
  });
});

describe("triggerMatchingForProfileUpdate", () => {
  const mockPrisma = {
    matchPoolEntry: {
      findMany: jest.fn(),
    },
  } as unknown as PrismaClient;

  it("enqueues jobs for all unique pairs involving the user", async () => {
    // User "user-m" has two entries: selected user-a and user-z
    (mockPrisma.matchPoolEntry.findMany as jest.Mock).mockResolvedValueOnce([
      { userId: "user-m", targetUserId: "user-a" },
      { userId: "user-m", targetUserId: "user-z" },
    ]);

    let jobCounter = 0;
    mockEnqueue.mockImplementation(async () => `job-${++jobCounter}`);

    const count = await triggerMatchingForProfileUpdate(mockPrisma, "user-m");

    expect(count).toBe(2);
    expect(mockEnqueue).toHaveBeenCalledTimes(2);
  });

  it("includes pairs where user is the target (someone else selected them)", async () => {
    // user-x selected user-m (user-m is the target)
    (mockPrisma.matchPoolEntry.findMany as jest.Mock).mockResolvedValueOnce([
      { userId: "user-x", targetUserId: "user-m" },
    ]);

    await triggerMatchingForProfileUpdate(mockPrisma, "user-m");

    expect(mockEnqueue).toHaveBeenCalledWith({
      type: "run_matching",
      researcherAId: "user-m",
      researcherBId: "user-x",
    });
  });

  it("deduplicates pairs where both directions exist (mutual selection)", async () => {
    // Mutual: user-m selected user-a AND user-a selected user-m
    (mockPrisma.matchPoolEntry.findMany as jest.Mock).mockResolvedValueOnce([
      { userId: "user-m", targetUserId: "user-a" },
      { userId: "user-a", targetUserId: "user-m" },
    ]);

    const count = await triggerMatchingForProfileUpdate(mockPrisma, "user-m");

    // Only one job for the pair, not two
    expect(count).toBe(1);
    expect(mockEnqueue).toHaveBeenCalledTimes(1);
    expect(mockEnqueue).toHaveBeenCalledWith({
      type: "run_matching",
      researcherAId: "user-a",
      researcherBId: "user-m",
    });
  });

  it("returns 0 when no match pool entries exist", async () => {
    (mockPrisma.matchPoolEntry.findMany as jest.Mock).mockResolvedValueOnce([]);

    const count = await triggerMatchingForProfileUpdate(mockPrisma, "user-m");

    expect(count).toBe(0);
    expect(mockEnqueue).not.toHaveBeenCalled();
  });

  it("queries with correct OR filter for userId and targetUserId", async () => {
    (mockPrisma.matchPoolEntry.findMany as jest.Mock).mockResolvedValueOnce([]);

    await triggerMatchingForProfileUpdate(mockPrisma, "user-42");

    expect(mockPrisma.matchPoolEntry.findMany).toHaveBeenCalledWith({
      where: {
        OR: [{ userId: "user-42" }, { targetUserId: "user-42" }],
      },
      select: { userId: true, targetUserId: true },
    });
  });
});

describe("triggerScheduledMatchingRun", () => {
  const mockPrisma = {} as PrismaClient;

  it("enqueues one job per eligible pair from computeEligiblePairs", async () => {
    mockComputeEligiblePairs.mockResolvedValueOnce([
      {
        researcherAId: "aaa",
        researcherBId: "bbb",
        visibilityA: "visible",
        visibilityB: "visible",
        profileVersionA: 1,
        profileVersionB: 2,
      },
      {
        researcherAId: "ccc",
        researcherBId: "ddd",
        visibilityA: "visible",
        visibilityB: "pending_other_interest",
        profileVersionA: 3,
        profileVersionB: 1,
      },
    ]);

    let jobCounter = 0;
    mockEnqueue.mockImplementation(async () => `job-${++jobCounter}`);

    const count = await triggerScheduledMatchingRun(mockPrisma);

    expect(count).toBe(2);
    expect(mockComputeEligiblePairs).toHaveBeenCalledWith(mockPrisma);
    expect(mockEnqueue).toHaveBeenCalledWith({
      type: "run_matching",
      researcherAId: "aaa",
      researcherBId: "bbb",
    });
    expect(mockEnqueue).toHaveBeenCalledWith({
      type: "run_matching",
      researcherAId: "ccc",
      researcherBId: "ddd",
    });
  });

  it("returns 0 when no eligible pairs exist", async () => {
    mockComputeEligiblePairs.mockResolvedValueOnce([]);

    const count = await triggerScheduledMatchingRun(mockPrisma);

    expect(count).toBe(0);
    expect(mockEnqueue).not.toHaveBeenCalled();
  });

  it("calls computeEligiblePairs with no user filter (global scan)", async () => {
    mockComputeEligiblePairs.mockResolvedValueOnce([]);

    await triggerScheduledMatchingRun(mockPrisma);

    // Called with just prisma (no options / no forUserId)
    expect(mockComputeEligiblePairs).toHaveBeenCalledWith(mockPrisma);
  });
});
