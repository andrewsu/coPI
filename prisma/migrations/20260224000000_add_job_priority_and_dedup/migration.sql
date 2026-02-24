-- AlterTable
ALTER TABLE "jobs" ADD COLUMN "priority" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "jobs" ADD COLUMN "payload_hash" VARCHAR(64);

-- CreateIndex
CREATE INDEX "jobs_status_priority_enqueued_at_idx" ON "jobs"("status", "priority", "enqueued_at");

-- CreateIndex
CREATE INDEX "jobs_payload_hash_status_idx" ON "jobs"("payload_hash", "status");
