/**
 * Standalone worker process entry point.
 *
 * Creates an in-memory job queue, registers the job processor, and
 * starts polling for jobs. Handles SIGTERM/SIGINT for graceful shutdown.
 *
 * In the pilot deployment, this runs as a separate Docker container
 * alongside the Next.js app. For the in-memory queue, jobs must be
 * enqueued within this same process (e.g., via an API or direct call).
 * A future SQS-backed implementation would allow cross-process job
 * submission.
 *
 * Run with: npm run worker (or: tsx src/worker/index.ts)
 */

import { InMemoryJobQueue } from "@/lib/job-queue";
import { createJobProcessor } from "@/worker/handlers";
import { prisma } from "@/lib/prisma";
import { anthropic } from "@/lib/anthropic";

async function main(): Promise<void> {
  console.log("[Worker] Starting job queue worker...");

  const queue = new InMemoryJobQueue({ pollIntervalMs: 2000 });
  const processor = createJobProcessor({ prisma, anthropic });

  queue.start(processor);
  console.log("[Worker] Worker started. Polling for jobs...");

  const shutdown = async (signal: string): Promise<void> => {
    console.log(`[Worker] Received ${signal}. Shutting down gracefully...`);
    await queue.stop();
    await prisma.$disconnect();
    console.log("[Worker] Worker stopped.");
    process.exit(0);
  };

  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("SIGINT", () => void shutdown("SIGINT"));
}

main().catch((err: unknown) => {
  console.error("[Worker] Fatal error:", err);
  process.exit(1);
});
