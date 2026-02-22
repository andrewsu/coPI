/**
 * Context assembly service for the matching engine.
 *
 * Fetches researcher profiles, publications, and existing proposals from the
 * database and assembles them into the MatchingInput format expected by the
 * matching engine prompt builder.
 *
 * This bridges the gap between eligible pair computation (which outputs pairs
 * of researcher IDs) and the LLM prompt builder (which needs full researcher
 * context). The abstract selection logic is handled downstream by the prompt
 * builder's selectAbstractsForMatching() function.
 *
 * See specs/matching-engine.md "Input Context Per Pair" for the format.
 */

import type { PrismaClient, AuthorPosition } from "@prisma/client";
import type {
  MatchingInput,
  ResearcherContext,
  MatchingPublication,
  ExistingProposal,
  UserSubmittedText,
} from "@/lib/matching-engine-prompt";
import type { EligiblePair } from "@/services/eligible-pairs";

// --- Public types ---

/** Result of context assembly for a single pair. */
export interface PairContext {
  /** The eligible pair metadata (IDs, visibility, profile versions). */
  pair: EligiblePair;
  /** The assembled matching input ready for the LLM prompt builder. */
  input: MatchingInput;
}

/** Error details when context assembly fails for a pair. */
export interface PairContextError {
  pair: EligiblePair;
  error: string;
}

/** Result of batch context assembly. */
export interface BatchContextResult {
  /** Successfully assembled contexts. */
  contexts: PairContext[];
  /** Pairs that failed assembly (e.g., missing profile or user). */
  errors: PairContextError[];
}

// --- Service ---

/**
 * Assembles the full matching context for a single pair of researchers.
 *
 * Fetches both researchers' profiles, publications, and any existing
 * collaboration proposals. Converts everything into the MatchingInput
 * format expected by buildMatchingUserMessage().
 *
 * @param prisma - Prisma client instance (injected for testability).
 * @param researcherAId - UUID of researcher A (lower by sort convention).
 * @param researcherBId - UUID of researcher B (higher by sort convention).
 * @returns The assembled MatchingInput, or null if either researcher
 *          is missing their profile or user record.
 */
export async function assembleContextForPair(
  prisma: PrismaClient,
  researcherAId: string,
  researcherBId: string,
): Promise<MatchingInput | null> {
  // Fetch both researchers' data in parallel — user + profile + publications
  const [researcherA, researcherB, existingProposals] = await Promise.all([
    fetchResearcherData(prisma, researcherAId),
    fetchResearcherData(prisma, researcherBId),
    fetchExistingProposals(prisma, researcherAId, researcherBId),
  ]);

  // Both researchers must have profiles for matching
  if (!researcherA || !researcherB) {
    return null;
  }

  return {
    researcherA,
    researcherB,
    existingProposals,
  };
}

/**
 * Assembles matching context for multiple eligible pairs in batch.
 *
 * Processes pairs sequentially to avoid overwhelming the database with
 * concurrent queries. Returns both successful contexts and error details
 * for pairs that failed assembly.
 *
 * @param prisma - Prisma client instance (injected for testability).
 * @param pairs - Array of eligible pairs from computeEligiblePairs().
 * @returns Batch result with successful contexts and error details.
 */
export async function assembleContextForPairs(
  prisma: PrismaClient,
  pairs: EligiblePair[],
): Promise<BatchContextResult> {
  const contexts: PairContext[] = [];
  const errors: PairContextError[] = [];

  for (const pair of pairs) {
    try {
      const input = await assembleContextForPair(
        prisma,
        pair.researcherAId,
        pair.researcherBId,
      );

      if (input) {
        contexts.push({ pair, input });
      } else {
        errors.push({
          pair,
          error: "One or both researchers missing profile or user record",
        });
      }
    } catch (err) {
      errors.push({
        pair,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return { contexts, errors };
}

// --- Internal helpers ---

/**
 * Fetches all data needed for one researcher's context: user record,
 * profile, and publications.
 *
 * Returns null if the user doesn't exist or has no profile.
 */
async function fetchResearcherData(
  prisma: PrismaClient,
  userId: string,
): Promise<ResearcherContext | null> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      name: true,
      institution: true,
      department: true,
      profile: {
        select: {
          researchSummary: true,
          techniques: true,
          experimentalModels: true,
          diseaseAreas: true,
          keyTargets: true,
          keywords: true,
          grantTitles: true,
          userSubmittedTexts: true,
        },
      },
    },
  });

  if (!user || !user.profile) {
    return null;
  }

  const publications = await prisma.publication.findMany({
    where: { userId },
    select: {
      title: true,
      journal: true,
      year: true,
      authorPosition: true,
      abstract: true,
    },
    orderBy: { year: "desc" },
  });

  return {
    name: user.name,
    institution: user.institution,
    department: user.department ?? undefined,
    researchSummary: user.profile.researchSummary,
    techniques: user.profile.techniques,
    experimentalModels: user.profile.experimentalModels,
    diseaseAreas: user.profile.diseaseAreas,
    keyTargets: user.profile.keyTargets,
    keywords: user.profile.keywords,
    grantTitles: user.profile.grantTitles,
    userSubmittedTexts: parseUserSubmittedTexts(user.profile.userSubmittedTexts),
    publications: publications.map(toMatchingPublication),
  };
}

/**
 * Fetches existing collaboration proposals for a pair (by ordered IDs)
 * to include as de-duplication context in the prompt.
 *
 * Per spec: "Include existing proposal titles and scientific questions
 * in the context" so the LLM can propose something distinct.
 */
async function fetchExistingProposals(
  prisma: PrismaClient,
  researcherAId: string,
  researcherBId: string,
): Promise<ExistingProposal[]> {
  const proposals = await prisma.collaborationProposal.findMany({
    where: {
      researcherAId,
      researcherBId,
    },
    select: {
      title: true,
      scientificQuestion: true,
    },
  });

  return proposals.map((p) => ({
    title: p.title,
    scientificQuestion: p.scientificQuestion,
  }));
}

/**
 * Converts a Prisma Publication record to the MatchingPublication format
 * expected by the prompt builder.
 */
function toMatchingPublication(pub: {
  title: string;
  journal: string;
  year: number;
  authorPosition: AuthorPosition;
  abstract: string;
}): MatchingPublication {
  return {
    title: pub.title,
    journal: pub.journal,
    year: pub.year,
    authorPosition: pub.authorPosition as "first" | "last" | "middle",
    abstract: pub.abstract,
  };
}

/**
 * Parses user-submitted texts from the JSONB field on ResearcherProfile.
 * Each entry should have {label, content} structure.
 *
 * Replicates the logic from profile-pipeline.ts to avoid a circular
 * dependency between services.
 */
export function parseUserSubmittedTexts(json: unknown): UserSubmittedText[] {
  if (!json || !Array.isArray(json)) return [];
  return json
    .filter(
      (entry: unknown): entry is Record<string, unknown> =>
        typeof entry === "object" &&
        entry !== null &&
        "label" in entry &&
        "content" in entry,
    )
    .map((entry) => ({
      label: String(entry.label),
      content: String(entry.content),
    }));
}
