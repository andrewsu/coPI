/**
 * Job queue abstraction for async task processing.
 *
 * Provides job type definitions and a queue interface with an
 * in-memory FIFO implementation for development/pilot deployments.
 * Production deployments can swap in an SQS-backed implementation.
 *
 * See specs/tech-stack.md "Job Queue" for the specification.
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
  pendingCount(): number;

  /** Look up a job by ID (if tracked). Returns null if not found. */
  getJob(id: string): (QueuedJob & { status: JobStatus }) | null;
}

// --- In-memory implementation ---

interface TrackedJob extends QueuedJob {
  status: JobStatus;
}

/**
 * In-memory FIFO job queue for development and pilot deployments.
 *
 * Processes jobs sequentially (one at a time) in the same Node.js process.
 * Failed jobs are retried up to maxAttempts times. Jobs that exhaust all
 * attempts are dead-lettered (logged and not retried).
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

  constructor(options?: { maxAttempts?: number; pollIntervalMs?: number }) {
    this.defaultMaxAttempts = options?.maxAttempts ?? 3;
    this.pollIntervalMs = options?.pollIntervalMs ?? 1000;
  }

  async enqueue(
    payload: JobPayload,
    options?: EnqueueOptions,
  ): Promise<string> {
    const id = `job_${++this.nextId}_${Date.now()}`;
    const job: QueuedJob = {
      id,
      payload,
      enqueuedAt: new Date(),
      attempts: 0,
      maxAttempts: options?.maxAttempts ?? this.defaultMaxAttempts,
    };

    this.queue.push(job);
    this.tracked.set(id, { ...job, status: "pending" });

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

  private processNext(): void {
    if (!this.handler || this.queue.length === 0) return;

    const job = this.queue.shift();
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
        this.queue.push(job);
        if (tracked) tracked.status = "pending";
        console.error(
          `[JobQueue] Job ${job.id} (${job.payload.type}) failed attempt ` +
            `${job.attempts}/${job.maxAttempts}: ${errorMessage}`,
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

const globalForQueue = globalThis as unknown as {
  jobQueue: InMemoryJobQueue | undefined;
};

/**
 * Returns the global job queue singleton.
 *
 * Creates an InMemoryJobQueue on first access. The queue is created
 * unstarted — call start(handler) to begin processing jobs. Jobs
 * can be enqueued before starting; they accumulate and are processed
 * once a handler is registered via start().
 */
export function getJobQueue(): InMemoryJobQueue {
  if (!globalForQueue.jobQueue) {
    globalForQueue.jobQueue = new InMemoryJobQueue();
  }
  return globalForQueue.jobQueue;
}

if (process.env.NODE_ENV !== "production") {
  globalForQueue.jobQueue = globalForQueue.jobQueue;
}
