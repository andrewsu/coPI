-- CreateEnum
CREATE TYPE "EmailVisibility" AS ENUM ('public_profile', 'mutual_matches', 'never');

-- CreateEnum
CREATE TYPE "AuthorPosition" AS ENUM ('first', 'last', 'middle');

-- CreateEnum
CREATE TYPE "MatchPoolSource" AS ENUM ('individual_select', 'affiliation_select', 'all_users');

-- CreateEnum
CREATE TYPE "ConfidenceTier" AS ENUM ('high', 'moderate', 'speculative');

-- CreateEnum
CREATE TYPE "ProposalVisibility" AS ENUM ('visible', 'pending_other_interest', 'hidden');

-- CreateEnum
CREATE TYPE "SwipeDirection" AS ENUM ('interested', 'archive');

-- CreateEnum
CREATE TYPE "MatchingOutcome" AS ENUM ('proposals_generated', 'no_proposal');

-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "institution" TEXT NOT NULL,
    "department" TEXT,
    "orcid" TEXT NOT NULL,
    "allow_incoming_proposals" BOOLEAN NOT NULL DEFAULT false,
    "email_visibility" "EmailVisibility" NOT NULL DEFAULT 'mutual_matches',
    "email_notifications_enabled" BOOLEAN NOT NULL DEFAULT true,
    "notify_matches" BOOLEAN NOT NULL DEFAULT true,
    "notify_new_proposals" BOOLEAN NOT NULL DEFAULT true,
    "notify_profile_refresh" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "researcher_profiles" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "research_summary" TEXT NOT NULL,
    "techniques" TEXT[],
    "experimental_models" TEXT[],
    "disease_areas" TEXT[],
    "key_targets" TEXT[],
    "keywords" TEXT[],
    "grant_titles" TEXT[],
    "user_submitted_texts" JSONB,
    "profile_version" INTEGER NOT NULL DEFAULT 1,
    "profile_generated_at" TIMESTAMP(3),
    "raw_abstracts_hash" TEXT,
    "pending_profile" JSONB,
    "pending_profile_created_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "researcher_profiles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "publications" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "pmid" TEXT,
    "pmcid" TEXT,
    "doi" TEXT,
    "title" TEXT NOT NULL,
    "abstract" TEXT NOT NULL,
    "journal" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "author_position" "AuthorPosition" NOT NULL,
    "methods_text" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "publications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "match_pool_entries" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "target_user_id" UUID NOT NULL,
    "source" "MatchPoolSource" NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "match_pool_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "affiliation_selections" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "institution" TEXT,
    "department" TEXT,
    "select_all" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "affiliation_selections_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "collaboration_proposals" (
    "id" UUID NOT NULL,
    "researcher_a_id" UUID NOT NULL,
    "researcher_b_id" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "collaboration_type" TEXT NOT NULL,
    "scientific_question" TEXT NOT NULL,
    "one_line_summary_a" TEXT NOT NULL,
    "one_line_summary_b" TEXT NOT NULL,
    "detailed_rationale" TEXT NOT NULL,
    "lab_a_contributions" TEXT NOT NULL,
    "lab_b_contributions" TEXT NOT NULL,
    "lab_a_benefits" TEXT NOT NULL,
    "lab_b_benefits" TEXT NOT NULL,
    "proposed_first_experiment" TEXT NOT NULL,
    "anchoring_publication_ids" UUID[],
    "confidence_tier" "ConfidenceTier" NOT NULL,
    "llm_reasoning" TEXT NOT NULL,
    "llm_model" TEXT NOT NULL,
    "visibility_a" "ProposalVisibility" NOT NULL,
    "visibility_b" "ProposalVisibility" NOT NULL,
    "profile_version_a" INTEGER NOT NULL,
    "profile_version_b" INTEGER NOT NULL,
    "is_updated" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "collaboration_proposals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "swipes" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "proposal_id" UUID NOT NULL,
    "direction" "SwipeDirection" NOT NULL,
    "viewed_detail" BOOLEAN NOT NULL DEFAULT false,
    "time_spent_ms" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "swipes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "matches" (
    "id" UUID NOT NULL,
    "proposal_id" UUID NOT NULL,
    "notification_sent_a" BOOLEAN NOT NULL DEFAULT false,
    "notification_sent_b" BOOLEAN NOT NULL DEFAULT false,
    "matched_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "matches_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "matching_results" (
    "id" UUID NOT NULL,
    "researcher_a_id" UUID NOT NULL,
    "researcher_b_id" UUID NOT NULL,
    "outcome" "MatchingOutcome" NOT NULL,
    "profile_version_a" INTEGER NOT NULL,
    "profile_version_b" INTEGER NOT NULL,
    "evaluated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "matching_results_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "survey_responses" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "failure_modes" TEXT[],
    "free_text" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "survey_responses_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "users_orcid_key" ON "users"("orcid");

-- CreateIndex
CREATE UNIQUE INDEX "researcher_profiles_user_id_key" ON "researcher_profiles"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "match_pool_entries_user_id_target_user_id_key" ON "match_pool_entries"("user_id", "target_user_id");

-- CreateIndex
CREATE UNIQUE INDEX "swipes_user_id_proposal_id_key" ON "swipes"("user_id", "proposal_id");

-- AddForeignKey
ALTER TABLE "researcher_profiles" ADD CONSTRAINT "researcher_profiles_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "publications" ADD CONSTRAINT "publications_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "match_pool_entries" ADD CONSTRAINT "match_pool_entries_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "match_pool_entries" ADD CONSTRAINT "match_pool_entries_target_user_id_fkey" FOREIGN KEY ("target_user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "affiliation_selections" ADD CONSTRAINT "affiliation_selections_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "collaboration_proposals" ADD CONSTRAINT "collaboration_proposals_researcher_a_id_fkey" FOREIGN KEY ("researcher_a_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "collaboration_proposals" ADD CONSTRAINT "collaboration_proposals_researcher_b_id_fkey" FOREIGN KEY ("researcher_b_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "swipes" ADD CONSTRAINT "swipes_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "swipes" ADD CONSTRAINT "swipes_proposal_id_fkey" FOREIGN KEY ("proposal_id") REFERENCES "collaboration_proposals"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "matches" ADD CONSTRAINT "matches_proposal_id_fkey" FOREIGN KEY ("proposal_id") REFERENCES "collaboration_proposals"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "matching_results" ADD CONSTRAINT "matching_results_researcher_a_id_fkey" FOREIGN KEY ("researcher_a_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "matching_results" ADD CONSTRAINT "matching_results_researcher_b_id_fkey" FOREIGN KEY ("researcher_b_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "survey_responses" ADD CONSTRAINT "survey_responses_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
