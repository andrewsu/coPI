/**
 * Job queue abstraction for async task processing.
 *
 * Provides job type definitions, the queue interface, and an
 * in-memory FIFO implementation for tests. The production singleton
 * (getJobQueue) returns a PostgresJobQueue backed by the shared
 * Prisma database, so jobs enqueued by the app are visible to the
 * worker running in a separate container.
 */

// --- Job payload types (from spec) ---

/** Profile generation job — runs the full profile ingestion pipeline. */
export interface GenerateProfileJob {
  type: "generate_profile";
  userId: string;
  orcid: string;
  accessToken?: string;
}

/** Matching evaluation job — generates proposals for one researcher pair. */
export interface RunMatchingJob {
  type: "run_matching";
  researcherAId: string;
  researcherBId: string;
}

/** Email sending job — sends a notification email. */
export interface SendEmailJob {
  type: "send_email";
  templateId: string;
  to: string;
  data: Record<string, unknown>;
}

/** Monthly refresh job — checks for new publications for a user. */
export interface MonthlyRefreshJob {
  type: "monthly_refresh";
  userId: string;
}

/** Match pool expansion job — adds new user to existing affiliation/all-users selections. */
export interface ExpandMatchPoolJob {
  type: "expand_match_pool";
  userId: string;
}

/** Union of all job payload types. */
export type JobPayload =
  | GenerateProfileJob
  | RunMatchingJob
  | SendEmailJob
  | MonthlyRefreshJob
  | ExpandMatchPoolJob;

/** The discriminant for job payloads. */
export type JobType = JobPayload["type"];

// --- Queue types ---

/** A job with metadata assigned by the queue. */
export interface QueuedJob {
  id: string;
  payload: JobPayload;
  enqueuedAt: Date;
  attempts: number;
  maxAttempts: number;
  lastError?: string;
  /** Earliest time this job should be processed (set by exponential backoff on retry). */
  retryAfter?: Date;
}

/** Lifecycle status of a queued job. */
export type JobStatus =
  | "pending"
  | "processing"
  | "completed"
  | "failed"
  | "dead";

/** Function signature for job processing. */
export type JobHandler = (job: QueuedJob) => Promise<void>;

/** Options for enqueuing a job. */
export interface EnqueueOptions {
  /** Maximum processing attempts before dead-lettering (default: 3). */
  maxAttempts?: number;
  /** Priority level — higher values are processed first (default: 0). */
  priority?: number;
}

/** Named priority levels for job scheduling. */
export const JobPriority = {
  BACKGROUND: -10,
  NORMAL: 0,
  INTERACTIVE: 10,
} as const;

// --- Deduplication ---

import { createHash } from "crypto";

/**
 * Computes a dedup hash for a job payload, or null if the job type
 * should not be deduplicated (e.g. send_email, monthly_refresh).
 */
export function computePayloadHash(payload: JobPayload): string | null {
  switch (payload.type) {
    case "run_matching": {
      const ids = [payload.researcherAId, payload.researcherBId].sort();
      return createHash("sha256")
        .update(`run_matching:${ids[0]}:${ids[1]}`)
        .digest("hex");
    }
    case "generate_profile":
      return createHash("sha256")
        .update(`generate_profile:${payload.userId}`)
        .digest("hex");
    case "expand_match_pool":
      return createHash("sha256")
        .update(`expand_match_pool:${payload.userId}`)
        .digest("hex");
    case "send_email":
    case "monthly_refresh":
      return null;
  }
}

// --- Queue interface ---

/** Abstract job queue. Implementations may use in-memory storage, SQS, etc. */
export interface JobQueue {
  /** Add a job to the queue. Returns the assigned job ID. */
  enqueue(payload: JobPayload, options?: EnqueueOptions): Promise<string>;

  /** Start processing jobs with the given handler. */
  start(handler: JobHandler): void;

  /** Stop processing gracefully. Waits for the current job to finish. */
  stop(): Promise<void>;

  /** Number of jobs waiting to be processed. */
  pendingCount(): number | Promise<number>;

  /** Look up a job by ID (if tracked). Returns null if not found. */
  getJob(
    id: string,
  ): (QueuedJob & { status: JobStatus }) | null | Promise<(QueuedJob & { status: JobStatus }) | null>;
}

// --- In-memory implementation ---

interface TrackedJob extends QueuedJob {
  status: JobStatus;
  priority: number;
  payloadHash: string | null;
}

/**
 * In-memory FIFO job queue for development and pilot deployments.
 *
 * Processes jobs sequentially (one at a time) in the same Node.js process.
 * Failed jobs are retried up to maxAttempts times with exponential backoff.
 * Jobs that exhaust all attempts are dead-lettered (logged and not retried).
 *
 * Backoff formula: min(maxDelay, baseDelay × 2^(attempt-1)) + random jitter.
 * This prevents thundering-herd on shared resources (e.g., Claude API).
 *
 * Not suitable for multi-process or distributed deployments — use an
 * SQS-backed implementation for those.
 */
export class InMemoryJobQueue implements JobQueue {
  private queue: QueuedJob[] = [];
  private tracked = new Map<string, TrackedJob>();
  private handler: JobHandler | null = null;
  private running = false;
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private activePromise: Promise<void> | null = null;
  private nextId = 0;
  private readonly defaultMaxAttempts: number;
  private readonly pollIntervalMs: number;
  private readonly retryBaseDelayMs: number;
  private readonly retryMaxDelayMs: number;

  constructor(options?: {
    maxAttempts?: number;
    pollIntervalMs?: number;
    /** Base delay for exponential backoff between retries (default: 1000ms). Set to 0 to disable backoff. */
    retryBaseDelayMs?: number;
    /** Maximum delay cap for exponential backoff (default: 30000ms). */
    retryMaxDelayMs?: number;
  }) {
    this.defaultMaxAttempts = options?.maxAttempts ?? 3;
    this.pollIntervalMs = options?.pollIntervalMs ?? 1000;
    this.retryBaseDelayMs = options?.retryBaseDelayMs ?? 1000;
    this.retryMaxDelayMs = options?.retryMaxDelayMs ?? 30000;
  }

  async enqueue(
    payload: JobPayload,
    options?: EnqueueOptions,
  ): Promise<string> {
    const hash = computePayloadHash(payload);

    // Dedup: if a pending/processing job with the same hash exists, return its ID
    if (hash) {
      for (const [existingId, tracked] of this.tracked) {
        if (
          tracked.payloadHash === hash &&
          (tracked.status === "pending" || tracked.status === "processing")
        ) {
          return existingId;
        }
      }
    }

    const id = `job_${++this.nextId}_${Date.now()}`;
    const priority = options?.priority ?? 0;
    const job: QueuedJob = {
      id,
      payload,
      enqueuedAt: new Date(),
      attempts: 0,
      maxAttempts: options?.maxAttempts ?? this.defaultMaxAttempts,
    };

    this.queue.push(job);
    this.tracked.set(id, { ...job, status: "pending", priority, payloadHash: hash });

    // Trigger processing if running and idle
    if (this.running && !this.activePromise) {
      this.processNext();
    }

    return id;
  }

  start(handler: JobHandler): void {
    if (this.running) return;
    this.handler = handler;
    this.running = true;

    this.pollTimer = setInterval(() => {
      if (!this.activePromise && this.queue.length > 0) {
        this.processNext();
      }
    }, this.pollIntervalMs);

    // Process any already-enqueued jobs immediately
    if (this.queue.length > 0 && !this.activePromise) {
      this.processNext();
    }
  }

  async stop(): Promise<void> {
    this.running = false;
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
    if (this.activePromise) {
      await this.activePromise;
    }
    this.handler = null;
  }

  pendingCount(): number {
    return this.queue.length;
  }

  getJob(id: string): (QueuedJob & { status: JobStatus }) | null {
    const tracked = this.tracked.get(id);
    if (!tracked) return null;
    return { ...tracked };
  }

  /**
   * Waits until the queue has finished processing all current jobs.
   * Useful in tests to avoid race conditions.
   */
  async waitForIdle(): Promise<void> {
    while (this.activePromise || this.queue.length > 0) {
      if (this.activePromise) {
        await this.activePromise;
      }
      // Yield to the event loop so the next job can start
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
  }

  /** Exposed for testing: reset all internal state. */
  _reset(): void {
    this.queue = [];
    this.tracked.clear();
    this.nextId = 0;
    this.running = false;
    this.handler = null;
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
    this.activePromise = null;
  }

  // --- Internal ---

  /**
   * Computes the retry delay for a given attempt number using exponential backoff.
   * Formula: min(maxDelay, baseDelay × 2^(attempt-1)) + random jitter (0–25%).
   */
  private computeRetryDelay(attempt: number): number {
    if (this.retryBaseDelayMs <= 0) return 0;

    const exponentialDelay =
      this.retryBaseDelayMs * Math.pow(2, attempt - 1);
    const cappedDelay = Math.min(exponentialDelay, this.retryMaxDelayMs);
    // Add random jitter (0–25% of delay) to prevent thundering herd
    const jitter = Math.random() * cappedDelay * 0.25;
    return cappedDelay + jitter;
  }

  private processNext(): void {
    if (!this.handler || this.queue.length === 0) return;

    // Find the best ready job: highest priority first, then earliest enqueue time
    const now = Date.now();
    let bestIndex = -1;
    let bestPriority = -Infinity;
    let bestEnqueued = Infinity;

    for (let i = 0; i < this.queue.length; i++) {
      const j = this.queue[i]!;
      if (j.retryAfter && j.retryAfter.getTime() > now) continue;
      const tracked = this.tracked.get(j.id);
      const pri = tracked?.priority ?? 0;
      if (
        pri > bestPriority ||
        (pri === bestPriority && j.enqueuedAt.getTime() < bestEnqueued)
      ) {
        bestIndex = i;
        bestPriority = pri;
        bestEnqueued = j.enqueuedAt.getTime();
      }
    }
    if (bestIndex === -1) return; // All jobs are waiting for retry backoff

    const job = this.queue.splice(bestIndex, 1)[0];
    if (!job) return;

    const tracked = this.tracked.get(job.id);
    if (tracked) tracked.status = "processing";

    this.activePromise = this.executeJob(job).finally(() => {
      this.activePromise = null;
      // Chain to next job if still running
      if (this.running && this.queue.length > 0) {
        this.processNext();
      }
    });
  }

  private async executeJob(job: QueuedJob): Promise<void> {
    if (!this.handler) return;

    job.attempts++;
    const tracked = this.tracked.get(job.id);

    try {
      await this.handler(job);
      if (tracked) {
        tracked.status = "completed";
        tracked.attempts = job.attempts;
      }
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      job.lastError = errorMessage;

      if (tracked) {
        tracked.lastError = errorMessage;
        tracked.attempts = job.attempts;
      }

      if (job.attempts < job.maxAttempts) {
        // Exponential backoff: baseDelay × 2^(attempt-1), capped at maxDelay, plus jitter
        const delayMs = this.computeRetryDelay(job.attempts);
        job.retryAfter = delayMs > 0 ? new Date(Date.now() + delayMs) : undefined;
        this.queue.push(job);
        if (tracked) {
          tracked.status = "pending";
          tracked.retryAfter = job.retryAfter;
        }
        const delayInfo = delayMs > 0 ? `, retrying in ${Math.round(delayMs)}ms` : "";
        console.error(
          `[JobQueue] Job ${job.id} (${job.payload.type}) failed attempt ` +
            `${job.attempts}/${job.maxAttempts}${delayInfo}: ${errorMessage}`,
        );
      } else {
        if (tracked) tracked.status = "dead";
        console.error(
          `[JobQueue] Job ${job.id} (${job.payload.type}) dead-lettered after ` +
            `${job.maxAttempts} attempts. Last error: ${errorMessage}`,
        );
      }
    }
  }
}

// --- Singleton ---

import { PostgresJobQueue } from "@/lib/postgres-job-queue";
import { prisma } from "@/lib/prisma";

const globalForQueue = globalThis as unknown as {
  jobQueue: PostgresJobQueue | undefined;
};

/**
 * Returns the global job queue singleton.
 *
 * Creates a PostgresJobQueue backed by the shared Prisma client.
 * The queue is created unstarted — call start(handler) to begin
 * processing jobs. Jobs can be enqueued before starting; they
 * persist in the database and are processed once a worker calls start().
 *
 * Options (only used when creating the singleton for the first time):
 * - concurrency: max parallel jobs the worker processes (default: 1)
 */
export function getJobQueue(options?: { concurrency?: number }): PostgresJobQueue {
  if (!globalForQueue.jobQueue) {
    globalForQueue.jobQueue = new PostgresJobQueue(prisma, {
      concurrency: options?.concurrency,
    });
  }
  return globalForQueue.jobQueue;
}

if (process.env.NODE_ENV !== "production") {
  globalForQueue.jobQueue = globalForQueue.jobQueue;
}
