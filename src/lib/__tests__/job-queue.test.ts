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
} from "../job-queue";

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
    queue = new InMemoryJobQueue({ maxAttempts: 3, pollIntervalMs: 10 });
  });

  afterEach(async () => {
    await queue.stop();
    queue._reset();
  });

  const makePayload = (type: string = "run_matching"): JobPayload => ({
    type: "run_matching",
    researcherAId: `a-${type}`,
    researcherBId: `b-${type}`,
  });

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
});

describe("getJobQueue", () => {
  it("returns the same instance on repeated calls", () => {
    const q1 = getJobQueue();
    const q2 = getJobQueue();
    expect(q1).toBe(q2);
  });

  it("returns an InMemoryJobQueue instance", () => {
    const q = getJobQueue();
    expect(q).toBeInstanceOf(InMemoryJobQueue);
  });
});
