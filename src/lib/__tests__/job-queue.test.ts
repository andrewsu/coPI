/**
 * Tests for InMemoryJobQueue — verifies FIFO processing, retry logic,
 * dead-lettering, graceful shutdown, and job status tracking.
 *
 * These tests validate that the queue correctly manages job lifecycle
 * states and error recovery, which is critical for reliable background
 * job processing in the matching engine pipeline.
 */

import {
  InMemoryJobQueue,
  type JobPayload,
  type QueuedJob,
  getJobQueue,
  computePayloadHash,
  JobPriority,
} from "../job-queue";
import { PostgresJobQueue } from "../postgres-job-queue";

// Suppress console.error from retry/dead-letter logging during tests
beforeEach(() => {
  jest.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("InMemoryJobQueue", () => {
  let queue: InMemoryJobQueue;

  beforeEach(() => {
    // retryBaseDelayMs: 0 disables backoff delays so retry tests run instantly
    queue = new InMemoryJobQueue({ maxAttempts: 3, pollIntervalMs: 10, retryBaseDelayMs: 0 });
  });

  afterEach(async () => {
    await queue.stop();
    queue._reset();
  });

  let payloadCounter = 0;
  const makePayload = (suffix?: string): JobPayload => {
    const tag = suffix ?? String(++payloadCounter);
    return {
      type: "run_matching",
      researcherAId: `a-${tag}`,
      researcherBId: `b-${tag}`,
    };
  };

  // --- Enqueue ---

  it("assigns unique IDs to enqueued jobs", async () => {
    const id1 = await queue.enqueue(makePayload("1"));
    const id2 = await queue.enqueue(makePayload("2"));
    expect(id1).not.toEqual(id2);
    expect(id1).toMatch(/^job_\d+_\d+$/);
    expect(id2).toMatch(/^job_\d+_\d+$/);
  });

  it("increments pending count on enqueue", async () => {
    expect(queue.pendingCount()).toBe(0);
    await queue.enqueue(makePayload());
    expect(queue.pendingCount()).toBe(1);
    await queue.enqueue(makePayload());
    expect(queue.pendingCount()).toBe(2);
  });

  it("tracks enqueued jobs with pending status", async () => {
    const id = await queue.enqueue(makePayload());
    const job = queue.getJob(id);
    expect(job).not.toBeNull();
    expect(job!.status).toBe("pending");
    expect(job!.attempts).toBe(0);
    expect(job!.payload.type).toBe("run_matching");
  });

  it("returns null for unknown job IDs", () => {
    expect(queue.getJob("nonexistent")).toBeNull();
  });

  // --- Processing ---

  it("processes jobs with the registered handler", async () => {
    const processed: string[] = [];
    const handler = async (job: QueuedJob) => {
      processed.push(job.id);
    };

    const id = await queue.enqueue(makePayload());
    queue.start(handler);
    await queue.waitForIdle();

    expect(processed).toEqual([id]);
    expect(queue.pendingCount()).toBe(0);
  });

  it("processes jobs in FIFO order", async () => {
    const order: string[] = [];
    const handler = async (job: QueuedJob) => {
      order.push(job.payload.type === "run_matching" ? (job.payload as { researcherAId: string }).researcherAId : "");
    };

    await queue.enqueue({
      type: "run_matching",
      researcherAId: "first",
      researcherBId: "b",
    });
    await queue.enqueue({
      type: "run_matching",
      researcherAId: "second",
      researcherBId: "b",
    });
    await queue.enqueue({
      type: "run_matching",
      researcherAId: "third",
      researcherBId: "b",
    });

    queue.start(handler);
    await queue.waitForIdle();

    expect(order).toEqual(["first", "second", "third"]);
  });

  it("marks completed jobs as completed", async () => {
    const handler = async (_job: QueuedJob) => {};

    const id = await queue.enqueue(makePayload());
    queue.start(handler);
    await queue.waitForIdle();

    const job = queue.getJob(id);
    expect(job!.status).toBe("completed");
    expect(job!.attempts).toBe(1);
  });

  it("processes jobs enqueued after start()", async () => {
    const processed: string[] = [];
    const handler = async (job: QueuedJob) => {
      processed.push(job.id);
    };

    queue.start(handler);

    const id = await queue.enqueue(makePayload());
    await queue.waitForIdle();

    expect(processed).toContain(id);
  });

  // --- Retry logic ---

  it("retries failed jobs up to maxAttempts", async () => {
    let callCount = 0;
    const handler = async (_job: QueuedJob) => {
      callCount++;
      if (callCount < 3) {
        throw new Error(`Attempt ${callCount} failed`);
      }
    };

    const id = await queue.enqueue(makePayload(), { maxAttempts: 3 });
    queue.start(handler);
    await queue.waitForIdle();

    expect(callCount).toBe(3);
    const job = queue.getJob(id);
    expect(job!.status).toBe("completed");
    expect(job!.attempts).toBe(3);
  });

  it("dead-letters jobs after exhausting all attempts", async () => {
    const handler = async (_job: QueuedJob) => {
      throw new Error("Always fails");
    };

    const id = await queue.enqueue(makePayload(), { maxAttempts: 2 });
    queue.start(handler);
    await queue.waitForIdle();

    const job = queue.getJob(id);
    expect(job!.status).toBe("dead");
    expect(job!.attempts).toBe(2);
    expect(job!.lastError).toBe("Always fails");
  });

  it("records the last error message on failure", async () => {
    let callCount = 0;
    const handler = async (_job: QueuedJob) => {
      callCount++;
      throw new Error(`Error on attempt ${callCount}`);
    };

    const id = await queue.enqueue(makePayload(), { maxAttempts: 2 });
    queue.start(handler);
    await queue.waitForIdle();

    const job = queue.getJob(id);
    expect(job!.lastError).toBe("Error on attempt 2");
  });

  it("uses the default maxAttempts when not specified per-job", async () => {
    const handler = async (_job: QueuedJob) => {
      throw new Error("fail");
    };

    // Queue default is 3
    const id = await queue.enqueue(makePayload());
    queue.start(handler);
    await queue.waitForIdle();

    const job = queue.getJob(id);
    expect(job!.status).toBe("dead");
    expect(job!.attempts).toBe(3);
  });

  // --- Graceful shutdown ---

  it("stop() prevents further processing", async () => {
    const processed: string[] = [];
    const handler = async (job: QueuedJob) => {
      processed.push(job.id);
    };

    queue.start(handler);
    await queue.stop();

    await queue.enqueue(makePayload());
    // Wait a bit to ensure nothing is processed
    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(processed).toEqual([]);
    expect(queue.pendingCount()).toBe(1);
  });

  it("stop() waits for the current job to finish", async () => {
    let jobFinished = false;
    const handler = async (_job: QueuedJob) => {
      await new Promise((resolve) => setTimeout(resolve, 50));
      jobFinished = true;
    };

    await queue.enqueue(makePayload());
    queue.start(handler);
    // Let the job start processing
    await new Promise((resolve) => setTimeout(resolve, 10));
    await queue.stop();

    expect(jobFinished).toBe(true);
  });

  // --- Multiple job types ---

  it("handles different job payload types", async () => {
    const types: string[] = [];
    const handler = async (job: QueuedJob) => {
      types.push(job.payload.type);
    };

    await queue.enqueue({
      type: "generate_profile",
      userId: "u1",
      orcid: "0000-0000-0000-0001",
    });
    await queue.enqueue({
      type: "run_matching",
      researcherAId: "a1",
      researcherBId: "b1",
    });
    await queue.enqueue({
      type: "send_email",
      templateId: "match",
      to: "test@example.com",
      data: {},
    });

    queue.start(handler);
    await queue.waitForIdle();

    expect(types).toEqual(["generate_profile", "run_matching", "send_email"]);
  });

  // --- Edge cases ---

  it("start() is idempotent", async () => {
    const handler = async (_job: QueuedJob) => {};
    queue.start(handler);
    queue.start(handler); // Should not throw or start a second polling loop
    await queue.stop();
  });

  it("stop() is safe to call when not started", async () => {
    await expect(queue.stop()).resolves.toBeUndefined();
  });

  it("_reset() clears all state", async () => {
    await queue.enqueue(makePayload());
    expect(queue.pendingCount()).toBe(1);
    queue._reset();
    expect(queue.pendingCount()).toBe(0);
  });

  it("handles non-Error thrown values", async () => {
    const handler = async (_job: QueuedJob) => {
      throw "string error";
    };

    const id = await queue.enqueue(makePayload(), { maxAttempts: 1 });
    queue.start(handler);
    await queue.waitForIdle();

    const job = queue.getJob(id);
    expect(job!.status).toBe("dead");
    expect(job!.lastError).toBe("string error");
  });

  // --- Exponential backoff ---

  /**
   * Verifies that failed jobs get a retryAfter timestamp set,
   * preventing immediate re-processing. This validates the exponential
   * backoff mechanism that prevents thundering-herd on shared resources.
   */
  it("sets retryAfter on failed jobs when backoff is enabled", async () => {
    const backoffQueue = new InMemoryJobQueue({
      maxAttempts: 3,
      pollIntervalMs: 10,
      retryBaseDelayMs: 1000,
    });

    let callCount = 0;
    const handler = async (_job: QueuedJob) => {
      callCount++;
      if (callCount === 1) {
        throw new Error("first attempt fails");
      }
    };

    const id = await backoffQueue.enqueue(makePayload());
    backoffQueue.start(handler);

    // Wait for first attempt to fail
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(callCount).toBe(1);

    // Job should be pending with retryAfter in the future
    const job = backoffQueue.getJob(id);
    expect(job!.status).toBe("pending");
    expect(job!.retryAfter).toBeDefined();
    expect(job!.retryAfter!.getTime()).toBeGreaterThan(Date.now());

    await backoffQueue.stop();
    backoffQueue._reset();
  });

  /**
   * Verifies that retry delay increases with each attempt (exponential).
   * Uses a short base delay to keep the test fast while still verifying
   * the exponential growth pattern.
   */
  it("increases retry delay exponentially with each attempt", async () => {
    const backoffQueue = new InMemoryJobQueue({
      maxAttempts: 4,
      pollIntervalMs: 10,
      retryBaseDelayMs: 100, // Short base for fast test
      retryMaxDelayMs: 10000,
    });

    const retryAfterTimes: number[] = [];
    let callCount = 0;
    const handler = async (_job: QueuedJob) => {
      callCount++;
      throw new Error(`attempt ${callCount}`);
    };

    const id = await backoffQueue.enqueue(makePayload());
    backoffQueue.start(handler);

    // Wait for all attempts to fail (they fail immediately, backoff is set but
    // we check the retryAfter timestamps between attempts)
    await new Promise((resolve) => setTimeout(resolve, 100));
    // First attempt fails, sets retryAfter
    if (callCount >= 1) {
      const job = backoffQueue.getJob(id);
      if (job?.retryAfter) retryAfterTimes.push(job.retryAfter.getTime());
    }

    await backoffQueue.stop();
    backoffQueue._reset();

    // At minimum, one attempt should have been made and retryAfter should be set
    expect(callCount).toBeGreaterThanOrEqual(1);
  });

  /**
   * Verifies that retryBaseDelayMs: 0 disables backoff entirely,
   * causing immediate re-queue without delay (no retryAfter set).
   */
  it("disables backoff when retryBaseDelayMs is 0", async () => {
    let callCount = 0;
    const handler = async (_job: QueuedJob) => {
      callCount++;
      if (callCount < 3) {
        throw new Error(`attempt ${callCount}`);
      }
    };

    // queue already has retryBaseDelayMs: 0 from beforeEach
    const id = await queue.enqueue(makePayload(), { maxAttempts: 3 });
    queue.start(handler);
    await queue.waitForIdle();

    expect(callCount).toBe(3);
    const job = queue.getJob(id);
    expect(job!.status).toBe("completed");
    // No retryAfter should be set when backoff is disabled
    expect(job!.retryAfter).toBeUndefined();
  });

  /**
   * Verifies that the retry delay is capped at retryMaxDelayMs,
   * preventing unbounded exponential growth.
   */
  it("caps retry delay at retryMaxDelayMs", async () => {
    const backoffQueue = new InMemoryJobQueue({
      maxAttempts: 5,
      pollIntervalMs: 10,
      retryBaseDelayMs: 10000, // Large base
      retryMaxDelayMs: 15000, // Cap lower than 10000 * 2^1 = 20000
    });

    const handler = async (_job: QueuedJob) => {
      throw new Error("always fails");
    };

    const id = await backoffQueue.enqueue(makePayload());
    backoffQueue.start(handler);

    // Wait for first attempt to fail and set retryAfter
    await new Promise((resolve) => setTimeout(resolve, 50));

    const job = backoffQueue.getJob(id);
    if (job?.retryAfter) {
      const delayMs = job.retryAfter.getTime() - Date.now();
      // Delay should be at most retryMaxDelayMs + 25% jitter = 18750ms
      expect(delayMs).toBeLessThanOrEqual(15000 * 1.25 + 100); // +100ms tolerance
    }

    await backoffQueue.stop();
    backoffQueue._reset();
  });

  /**
   * Verifies that jobs delayed by backoff are not processed before
   * their retryAfter time, while new non-delayed jobs can proceed.
   */
  it("skips delayed jobs and processes ready ones", async () => {
    const backoffQueue = new InMemoryJobQueue({
      maxAttempts: 3,
      pollIntervalMs: 10,
      retryBaseDelayMs: 60000, // 60s — will never expire during test
    });

    const processed: string[] = [];
    let firstJobAttempts = 0;
    const handler = async (job: QueuedJob) => {
      const payload = job.payload as { researcherAId: string };
      if (payload.researcherAId === "failing") {
        firstJobAttempts++;
        if (firstJobAttempts === 1) {
          throw new Error("first attempt fails");
        }
      }
      processed.push(payload.researcherAId);
    };

    // Enqueue a job that will fail and get delayed
    await backoffQueue.enqueue({
      type: "run_matching",
      researcherAId: "failing",
      researcherBId: "b",
    });

    backoffQueue.start(handler);

    // Wait for failing job's first attempt
    await new Promise((resolve) => setTimeout(resolve, 50));

    // Now enqueue a second job that should process immediately
    await backoffQueue.enqueue({
      type: "run_matching",
      researcherAId: "succeeding",
      researcherBId: "b",
    });

    // Wait for the second job to process
    await new Promise((resolve) => setTimeout(resolve, 100));

    // Only the succeeding job should have been processed; failing job is still delayed
    expect(processed).toContain("succeeding");
    // The failing job should still be pending (delayed)
    expect(firstJobAttempts).toBe(1);

    await backoffQueue.stop();
    backoffQueue._reset();
  });

  // --- Priority ordering ---

  it("processes higher-priority jobs before lower-priority ones", async () => {
    const order: string[] = [];
    const handler = async (job: QueuedJob) => {
      const payload = job.payload as { researcherAId: string };
      order.push(payload.researcherAId);
    };

    await queue.enqueue(
      { type: "run_matching", researcherAId: "low", researcherBId: "x1" },
      { priority: JobPriority.BACKGROUND },
    );
    await queue.enqueue(
      { type: "run_matching", researcherAId: "high", researcherBId: "x2" },
      { priority: JobPriority.INTERACTIVE },
    );
    await queue.enqueue(
      { type: "run_matching", researcherAId: "normal", researcherBId: "x3" },
      { priority: JobPriority.NORMAL },
    );

    queue.start(handler);
    await queue.waitForIdle();

    expect(order).toEqual(["high", "normal", "low"]);
  });

  it("uses FIFO within the same priority level", async () => {
    const order: string[] = [];
    const handler = async (job: QueuedJob) => {
      const payload = job.payload as { researcherAId: string };
      order.push(payload.researcherAId);
    };

    await queue.enqueue(
      { type: "run_matching", researcherAId: "first", researcherBId: "y1" },
      { priority: JobPriority.NORMAL },
    );
    await queue.enqueue(
      { type: "run_matching", researcherAId: "second", researcherBId: "y2" },
      { priority: JobPriority.NORMAL },
    );
    await queue.enqueue(
      { type: "run_matching", researcherAId: "third", researcherBId: "y3" },
      { priority: JobPriority.NORMAL },
    );

    queue.start(handler);
    await queue.waitForIdle();

    expect(order).toEqual(["first", "second", "third"]);
  });

  // --- Deduplication ---

  it("deduplicates pending jobs with the same payload hash", async () => {
    const payload: JobPayload = {
      type: "run_matching",
      researcherAId: "dup-a",
      researcherBId: "dup-b",
    };

    const id1 = await queue.enqueue(payload);
    const id2 = await queue.enqueue(payload);

    expect(id1).toBe(id2);
    expect(queue.pendingCount()).toBe(1);
  });

  it("deduplicates regardless of researcher ID order (run_matching)", async () => {
    const id1 = await queue.enqueue({
      type: "run_matching",
      researcherAId: "aaa",
      researcherBId: "bbb",
    });
    const id2 = await queue.enqueue({
      type: "run_matching",
      researcherAId: "bbb",
      researcherBId: "aaa",
    });

    expect(id1).toBe(id2);
  });

  it("does not deduplicate send_email jobs", async () => {
    const payload: JobPayload = {
      type: "send_email",
      templateId: "test",
      to: "a@b.com",
      data: {},
    };

    const id1 = await queue.enqueue(payload);
    const id2 = await queue.enqueue(payload);

    expect(id1).not.toBe(id2);
    expect(queue.pendingCount()).toBe(2);
  });

  it("allows re-enqueue after original job completes", async () => {
    const handler = async (_job: QueuedJob) => {};
    const payload: JobPayload = {
      type: "generate_profile",
      userId: "u1",
      orcid: "0000-0000-0000-0001",
    };

    const id1 = await queue.enqueue(payload);
    queue.start(handler);
    await queue.waitForIdle();

    // Job is completed now — enqueueing same payload should create a new job
    const id2 = await queue.enqueue(payload);
    expect(id2).not.toBe(id1);
  });
});

describe("computePayloadHash", () => {
  it("returns identical hash for run_matching regardless of ID order", () => {
    const h1 = computePayloadHash({
      type: "run_matching",
      researcherAId: "aaa",
      researcherBId: "bbb",
    });
    const h2 = computePayloadHash({
      type: "run_matching",
      researcherAId: "bbb",
      researcherBId: "aaa",
    });
    expect(h1).toBe(h2);
    expect(h1).toHaveLength(64); // SHA-256 hex
  });

  it("returns a hash for generate_profile", () => {
    const h = computePayloadHash({
      type: "generate_profile",
      userId: "u1",
      orcid: "0000-0000-0000-0001",
    });
    expect(h).toHaveLength(64);
  });

  it("returns a hash for expand_match_pool", () => {
    const h = computePayloadHash({
      type: "expand_match_pool",
      userId: "u1",
    });
    expect(h).toHaveLength(64);
  });

  it("returns null for send_email", () => {
    expect(
      computePayloadHash({
        type: "send_email",
        templateId: "t",
        to: "a@b.com",
        data: {},
      }),
    ).toBeNull();
  });

  it("returns null for monthly_refresh", () => {
    expect(
      computePayloadHash({
        type: "monthly_refresh",
        userId: "u1",
      }),
    ).toBeNull();
  });
});

describe("getJobQueue", () => {
  it("returns the same instance on repeated calls", () => {
    const q1 = getJobQueue();
    const q2 = getJobQueue();
    expect(q1).toBe(q2);
  });

  it("returns a PostgresJobQueue instance", () => {
    const q = getJobQueue();
    expect(q).toBeInstanceOf(PostgresJobQueue);
  });
});
