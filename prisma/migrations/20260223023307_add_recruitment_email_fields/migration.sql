-- AlterTable
ALTER TABLE "users" ADD COLUMN     "claimed_at" TIMESTAMP(3),
ADD COLUMN     "last_recruitment_email_sent_at" TIMESTAMP(3),
ADD COLUMN     "recruitment_email_count" INTEGER NOT NULL DEFAULT 0;
