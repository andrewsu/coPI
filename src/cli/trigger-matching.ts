/**
 * CLI command to trigger matching for all eligible pairs.
 *
 * Calls triggerScheduledMatchingRun() which finds all pairs that
 * haven't been evaluated at current profile versions and enqueues
 * a run_matching job for each. The worker picks these up from the
 * shared PostgreSQL job queue.
 *
 * Usage:
 *   npx tsx src/cli/trigger-matching.ts
 *
 * In production (Docker):
 *   docker compose -f docker-compose.prod.yml exec worker npx tsx src/cli/trigger-matching.ts
 */

import { prisma } from "@/lib/prisma";
import { triggerScheduledMatchingRun } from "@/services/matching-triggers";

async function main(): Promise<void> {
  if (!process.env.DATABASE_URL) {
    console.error("Error: DATABASE_URL environment variable is not set.");
    process.exit(1);
  }

  console.log("[TriggerMatching] Finding eligible pairs...");

  const count = await triggerScheduledMatchingRun(prisma);

  if (count === 0) {
    console.log("[TriggerMatching] No eligible pairs found. Nothing enqueued.");
  } else {
    console.log(
      `[TriggerMatching] Enqueued ${count} matching job(s). ` +
        `The worker will process them automatically.`,
    );
  }

  await prisma.$disconnect();
  process.exit(0);
}

main().catch((err: unknown) => {
  console.error("[TriggerMatching] Fatal error:", err);
  process.exit(1);
});
