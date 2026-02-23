/**
 * Seeded profile pipeline — creates User records from ORCID IDs and runs
 * the full profile pipeline without OAuth authentication.
 *
 * Per specs/auth-and-user-management.md "Admin Functions > Seed Profiles":
 *   1. Create User record with ORCID ID, name, and affiliation from ORCID public API
 *   2. Run full profile pipeline (publications, synthesis)
 *   3. Profile is visible in match pool browser for other users to select
 *   4. No OAuth session — user claims on first ORCID login
 *
 * Seeded profiles are marked with claimedAt=null and allowIncomingProposals=true
 * so other users can generate collaboration proposals involving them.
 */

import type { PrismaClient } from "@prisma/client";
import type Anthropic from "@anthropic-ai/sdk";
import { fetchOrcidProfile } from "@/lib/orcid";
import { runProfilePipeline, type PipelineResult } from "./profile-pipeline";
import { getJobQueue } from "@/lib/job-queue";

/** Validates ORCID iD format (e.g., "0000-0002-1234-5678"). Last char can be X (checksum). */
const ORCID_REGEX = /^\d{4}-\d{4}-\d{4}-\d{3}[\dX]$/;

export { ORCID_REGEX };

export interface SeedProfileOptions {
  /** Skip deep mining of PMC methods sections. Default: false (deep mining ON). */
  skipDeepMining?: boolean;
  /** Progress callback for pipeline stages. */
  onProgress?: (orcid: string, stage: string) => void;
}

export interface SeedProfileResult {
  orcid: string;
  success: boolean;
  userId?: string;
  /** Pipeline result when successful. */
  pipeline?: PipelineResult;
  /** Reason for skip or failure. */
  reason?: string;
  error?: string;
}

/**
 * Seeds a single researcher profile from an ORCID iD.
 *
 * 1. Validates ORCID format
 * 2. Checks for existing user (skip if already exists)
 * 3. Fetches profile from ORCID public API (no access token needed)
 * 4. Creates User record with claimedAt=null, allowIncomingProposals=true
 * 5. Runs full profile pipeline (publications, synthesis)
 * 6. Enqueues match pool expansion for the new user
 */
export async function seedProfile(
  prisma: PrismaClient,
  llm: Anthropic,
  orcid: string,
  options?: SeedProfileOptions,
): Promise<SeedProfileResult> {
  // Validate ORCID format
  if (!ORCID_REGEX.test(orcid)) {
    return { orcid, success: false, reason: "invalid_orcid_format" };
  }

  // Check if user already exists with this ORCID
  const existing = await prisma.user.findUnique({
    where: { orcid },
    select: { id: true },
  });
  if (existing) {
    return {
      orcid,
      success: false,
      userId: existing.id,
      reason: "already_exists",
    };
  }

  // Fetch profile from ORCID public API (no access token = public API)
  options?.onProgress?.(orcid, "fetching_orcid");
  const orcidProfile = await fetchOrcidProfile(orcid);

  // Create User record as seeded (claimedAt=null, allowIncomingProposals=true)
  const user = await prisma.user.create({
    data: {
      email: orcidProfile.email ?? `${orcid}@orcid.placeholder`,
      name: orcidProfile.name,
      institution: orcidProfile.institution ?? "Unknown",
      department: orcidProfile.department ?? null,
      orcid,
      claimedAt: null, // Marks as seeded/unclaimed
      allowIncomingProposals: true, // Allow others to generate proposals involving this user
    },
  });

  // Run full profile pipeline (no access token = uses ORCID public API)
  options?.onProgress?.(orcid, "running_pipeline");
  const pipelineResult = await runProfilePipeline(prisma, llm, user.id, orcid, {
    deepMining: options?.skipDeepMining !== true,
  });

  // Enqueue match pool expansion so existing users' affiliation/all-users
  // selections automatically include this new seeded user
  options?.onProgress?.(orcid, "expanding_match_pools");
  getJobQueue()
    .enqueue({ type: "expand_match_pool", userId: user.id })
    .catch((err) => {
      console.error(
        `[SeedProfile] Failed to enqueue expand_match_pool for ${orcid}:`,
        err,
      );
    });

  console.log(
    `[SeedProfile] Successfully seeded profile for ${orcidProfile.name} (${orcid}): ` +
      `${pipelineResult.publicationsStored} publications, ` +
      `profile v${pipelineResult.profileVersion}`,
  );

  return {
    orcid,
    success: true,
    userId: user.id,
    pipeline: pipelineResult,
  };
}

/**
 * Seeds multiple researcher profiles from a list of ORCID iDs.
 * Processes sequentially to respect ORCID/NCBI rate limits.
 * Continues on individual failures — returns results for all.
 */
export async function seedProfiles(
  prisma: PrismaClient,
  llm: Anthropic,
  orcids: string[],
  options?: SeedProfileOptions,
): Promise<SeedProfileResult[]> {
  const results: SeedProfileResult[] = [];

  for (const orcid of orcids) {
    try {
      const result = await seedProfile(prisma, llm, orcid, options);
      results.push(result);
    } catch (err) {
      results.push({
        orcid,
        success: false,
        reason: "pipeline_error",
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  const succeeded = results.filter((r) => r.success).length;
  const skipped = results.filter(
    (r) => !r.success && r.reason === "already_exists",
  ).length;
  const failed = results.filter(
    (r) => !r.success && r.reason !== "already_exists" && r.reason !== "invalid_orcid_format",
  ).length;

  console.log(
    `[SeedProfile] Batch complete: ${succeeded} seeded, ${skipped} skipped (existing), ${failed} failed ` +
      `out of ${orcids.length} ORCID IDs`,
  );

  return results;
}

/**
 * Flips pending_other_interest proposals to visible for a newly-claimed user.
 *
 * Per spec: "When a user logs in with ORCID and their ORCID ID matches a seeded profile...
 * any proposals with visibility pending_other_interest are evaluated for potential
 * visibility changes."
 *
 * When a seeded user claims their account, proposals that were generated while they
 * were unclaimed should become visible so they appear in the user's swipe queue.
 */
export async function flipPendingProposalsOnClaim(
  prisma: PrismaClient,
  userId: string,
): Promise<number> {
  // Flip proposals where user is researcher A with pending visibility
  const updatedA = await prisma.collaborationProposal.updateMany({
    where: {
      researcherAId: userId,
      visibilityA: "pending_other_interest",
    },
    data: { visibilityA: "visible" },
  });

  // Flip proposals where user is researcher B with pending visibility
  const updatedB = await prisma.collaborationProposal.updateMany({
    where: {
      researcherBId: userId,
      visibilityB: "pending_other_interest",
    },
    data: { visibilityB: "visible" },
  });

  const totalFlipped = updatedA.count + updatedB.count;
  if (totalFlipped > 0) {
    console.log(
      `[SeedProfile] Flipped ${totalFlipped} pending proposals to visible for user ${userId}`,
    );
  }

  return totalFlipped;
}
