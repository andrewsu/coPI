/**
 * PostgreSQL-backed job queue implementation.
 *
 * Uses the Prisma `Job` model for persistence and raw SQL with
 * `FOR UPDATE SKIP LOCKED` for atomic job claiming. This allows
 * the Next.js app and worker to run as separate processes/containers
 * sharing the same Postgres database.
 *
 * Replaces InMemoryJobQueue for production deployments where the
 * app (enqueuer) and worker (processor) are in separate containers.
 */

import type { PrismaClient, Prisma } from "@prisma/client";
import type {
  JobQueue,
  JobPayload,
  JobHandler,
  QueuedJob,
  JobStatus,
  EnqueueOptions,
} from "@/lib/job-queue";

interface ClaimedJobRow {
  id: string;
  type: string;
  payload: unknown;
  status: string;
  attempts: number;
  max_attempts: number;
  last_error: string | null;
  retry_after: Date | null;
  enqueued_at: Date;
  started_at: Date | null;
  completed_at: Date | null;
}

export class PostgresJobQueue implements JobQueue {
  private handler: JobHandler | null = null;
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private activePromise: Promise<void> | null = null;
  private running = false;
  private readonly pollIntervalMs: number;
  private readonly defaultMaxAttempts: number;
  private readonly retryBaseDelayMs: number;
  private readonly retryMaxDelayMs: number;

  constructor(
    private readonly prisma: PrismaClient,
    options?: {
      pollIntervalMs?: number;
      maxAttempts?: number;
      retryBaseDelayMs?: number;
      retryMaxDelayMs?: number;
    },
  ) {
    this.pollIntervalMs = options?.pollIntervalMs ?? 2000;
    this.defaultMaxAttempts = options?.maxAttempts ?? 3;
    this.retryBaseDelayMs = options?.retryBaseDelayMs ?? 1000;
    this.retryMaxDelayMs = options?.retryMaxDelayMs ?? 30000;
  }

  async enqueue(
    payload: JobPayload,
    options?: EnqueueOptions,
  ): Promise<string> {
    const job = await this.prisma.job.create({
      data: {
        type: payload.type,
        payload: payload as unknown as Prisma.InputJsonValue,
        status: "pending",
        maxAttempts: options?.maxAttempts ?? this.defaultMaxAttempts,
      },
    });
    return job.id;
  }

  start(handler: JobHandler): void {
    if (this.running) return;
    this.handler = handler;
    this.running = true;

    this.pollTimer = setInterval(() => {
      if (!this.activePromise) {
        this.claimAndProcess();
      }
    }, this.pollIntervalMs);

    // Immediately try to process
    this.claimAndProcess();
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

  async pendingCount(): Promise<number> {
    return this.prisma.job.count({
      where: { status: "pending" },
    });
  }

  async getJob(
    id: string,
  ): Promise<(QueuedJob & { status: JobStatus }) | null> {
    const row = await this.prisma.job.findUnique({ where: { id } });
    if (!row) return null;
    return {
      id: row.id,
      payload: row.payload as unknown as JobPayload,
      enqueuedAt: row.enqueuedAt,
      attempts: row.attempts,
      maxAttempts: row.maxAttempts,
      lastError: row.lastError ?? undefined,
      retryAfter: row.retryAfter ?? undefined,
      status: row.status as JobStatus,
    };
  }

  // --- Internal ---

  private claimAndProcess(): void {
    if (!this.handler) return;

    this.activePromise = this.claimOne()
      .then((job) => {
        if (job && this.handler) {
          return this.executeJob(job);
        }
      })
      .catch((err) => {
        console.error("[PostgresJobQueue] Error in claim/process cycle:", err);
      })
      .finally(() => {
        this.activePromise = null;
      });
  }

  /**
   * Atomically claim one pending job using FOR UPDATE SKIP LOCKED.
   * This prevents multiple workers from processing the same job.
   */
  private async claimOne(): Promise<
    (QueuedJob & { status: JobStatus }) | null
  > {
    const rows = await this.prisma.$queryRaw<ClaimedJobRow[]>`
      UPDATE jobs
      SET status = 'processing', started_at = NOW(), attempts = attempts + 1
      WHERE id = (
        SELECT id FROM jobs
        WHERE status = 'pending'
          AND (retry_after IS NULL OR retry_after <= NOW())
        ORDER BY enqueued_at ASC
        LIMIT 1
        FOR UPDATE SKIP LOCKED
      )
      RETURNING *
    `;

    if (rows.length === 0) return null;

    const row = rows[0]!;
    return {
      id: row.id,
      payload: row.payload as unknown as JobPayload,
      enqueuedAt: row.enqueued_at,
      attempts: row.attempts,
      maxAttempts: row.max_attempts,
      lastError: row.last_error ?? undefined,
      retryAfter: row.retry_after ?? undefined,
      status: row.status as JobStatus,
    };
  }

  /**
   * Computes exponential backoff delay matching InMemoryJobQueue formula:
   * min(maxDelay, baseDelay × 2^(attempt-1)) + random jitter (0–25%).
   */
  private computeRetryDelay(attempt: number): number {
    if (this.retryBaseDelayMs <= 0) return 0;
    const exponentialDelay =
      this.retryBaseDelayMs * Math.pow(2, attempt - 1);
    const cappedDelay = Math.min(exponentialDelay, this.retryMaxDelayMs);
    const jitter = Math.random() * cappedDelay * 0.25;
    return cappedDelay + jitter;
  }

  private async executeJob(
    job: QueuedJob & { status: JobStatus },
  ): Promise<void> {
    if (!this.handler) return;

    try {
      await this.handler(job);

      // Mark completed
      await this.prisma.job.update({
        where: { id: job.id },
        data: {
          status: "completed",
          completedAt: new Date(),
        },
      });
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);

      if (job.attempts < job.maxAttempts) {
        // Requeue with exponential backoff
        const delayMs = this.computeRetryDelay(job.attempts);
        const retryAfter =
          delayMs > 0 ? new Date(Date.now() + delayMs) : null;

        await this.prisma.job.update({
          where: { id: job.id },
          data: {
            status: "pending",
            lastError: errorMessage,
            retryAfter,
          },
        });

        const delayInfo =
          delayMs > 0 ? `, retrying in ${Math.round(delayMs)}ms` : "";
        console.error(
          `[PostgresJobQueue] Job ${job.id} (${job.payload.type}) failed attempt ` +
            `${job.attempts}/${job.maxAttempts}${delayInfo}: ${errorMessage}`,
        );
      } else {
        // Dead-letter
        await this.prisma.job.update({
          where: { id: job.id },
          data: {
            status: "dead",
            lastError: errorMessage,
            completedAt: new Date(),
          },
        });

        console.error(
          `[PostgresJobQueue] Job ${job.id} (${job.payload.type}) dead-lettered after ` +
            `${job.maxAttempts} attempts. Last error: ${errorMessage}`,
        );
      }
    }
  }
}
