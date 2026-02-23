/**
 * Standalone worker process entry point.
 *
 * Uses the PostgreSQL-backed job queue shared with the Next.js app.
 * Both containers connect to the same database, so jobs enqueued by
 * the app are picked up by this worker via polling with atomic
 * FOR UPDATE SKIP LOCKED claims.
 *
 * Run with: npm run worker (or: tsx src/worker/index.ts)
 */

import { getJobQueue } from "@/lib/job-queue";
import { createJobProcessor } from "@/worker/handlers";
import { prisma } from "@/lib/prisma";
import { anthropic } from "@/lib/anthropic";

async function main(): Promise<void> {
  console.log("[Worker] Starting job queue worker...");

  const queue = getJobQueue();
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
