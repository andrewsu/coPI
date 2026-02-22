/**
 * Matching engine service — LLM call lifecycle for generating
 * collaboration proposals.
 *
 * Takes an assembled pair context (from matching-context.ts) and calls
 * Claude to produce validated collaboration proposals. Handles prompt
 * assembly, API calls, JSON parsing, validation, and retry on parse
 * failure. Follows the same service pattern as profile-synthesis.ts.
 *
 * The prompt text and validation rules are managed by the prompt builder
 * module (src/lib/matching-engine-prompt.ts). This service is responsible
 * for the LLM API call lifecycle only.
 */

import type Anthropic from "@anthropic-ai/sdk";
import type { PrismaClient, ConfidenceTier } from "@prisma/client";
import type { PairContext } from "@/services/matching-context";
import {
  type ProposalOutput,
  buildMatchingUserMessage,
  getMatchingSystemMessage,
  parseMatchingOutput,
  filterValidProposals,
  deduplicateProposals,
  buildMatchingRetryMessage,
  MATCHING_MODEL_CONFIG,
} from "@/lib/matching-engine-prompt";

// --- Public types ---

/** Result of a proposal generation attempt for one pair. */
export interface ProposalGenerationResult {
  /** Valid proposals that passed validation and de-duplication. Empty if none generated or all invalid/duplicate. */
  proposals: ProposalOutput[];
  /** Number of proposals discarded due to validation failure. */
  discarded: number;
  /** Number of proposals removed as duplicates of existing proposals. */
  deduplicated: number;
  /** Number of LLM calls made (1 or 2). */
  attempts: number;
  /** Whether a retry was attempted. */
  retried: boolean;
  /** The model used for generation. */
  model: string;
  /** Raw proposal count before validation filtering. */
  rawCount: number;
}

/** Options for proposal generation. */
export interface GenerationOptions {
  /** Maximum number of attempts (default: 2 — initial + one retry on parse failure). */
  maxAttempts?: number;
  /** Maximum API call retries per LLM invocation on transient errors (default: 3). */
  apiMaxRetries?: number;
  /** Base delay in ms for API retry exponential backoff (default: 1000). Set to 0 in tests. */
  apiRetryBaseDelayMs?: number;
}

/** Result of storing proposals for a pair. */
export interface StoredProposalsSummary {
  /** Number of proposals stored in the database. */
  stored: number;
  /** Number of PMIDs that could not be resolved to Publication UUIDs. */
  unresolvedPmids: number;
}

// --- Service ---

/**
 * Generates collaboration proposals for a single researcher pair by calling Claude.
 *
 * Flow:
 * 1. Build system and user messages from the assembled pair context.
 * 2. Call Claude with the matching engine model configuration.
 * 3. Parse the JSON array output.
 * 4. If parsing fails, retry once with stricter formatting instructions.
 * 5. Validate each proposal and discard invalid ones (keep valid).
 * 6. Return the valid proposals with metadata about the generation attempt.
 *
 * Per spec (matching-engine.md):
 * - "LLM returns malformed JSON → Retry once with stricter formatting instructions"
 * - "LLM returns proposals missing required fields → Discard invalid proposals, keep valid ones"
 * - Individual invalid proposals within a valid array are discarded, not retried.
 *
 * @param client - Anthropic SDK client instance (injected for testability).
 * @param pairContext - The assembled context for the pair (from matching-context.ts).
 * @param options - Optional generation configuration.
 * @returns ProposalGenerationResult with validated proposals and metadata.
 * @throws If the LLM call itself fails (network error, auth error, rate limit, etc.).
 */
export async function generateProposalsForPair(
  client: Anthropic,
  pairContext: PairContext,
  options: GenerationOptions = {},
): Promise<ProposalGenerationResult> {
  const maxAttempts = options.maxAttempts ?? 2;
  const apiMaxRetries = options.apiMaxRetries ?? 3;
  const apiRetryBaseDelayMs = options.apiRetryBaseDelayMs ?? 1000;
  const systemMessage = getMatchingSystemMessage();
  const userMessage = buildMatchingUserMessage(pairContext.input);

  const messages: Anthropic.MessageParam[] = [
    { role: "user", content: userMessage },
  ];

  // --- First attempt ---
  // callClaudeWithRetry handles transient API errors (rate limits, server errors)
  // with exponential backoff per spec: "LLM call fails → Retry with exponential
  // backoff, max 3 attempts"
  const firstResponse = await callClaudeWithRetry(
    client,
    systemMessage,
    messages,
    apiMaxRetries,
    apiRetryBaseDelayMs,
  );
  const firstText = extractTextContent(firstResponse);

  const existingProposals = pairContext.input.existingProposals;

  let proposals: ProposalOutput[];
  try {
    proposals = parseMatchingOutput(firstText);
  } catch {
    // Parse failed on first attempt — retry if allowed
    if (maxAttempts > 1) {
      const retryPrompt = buildMatchingRetryMessage();
      messages.push({ role: "assistant", content: firstText });
      messages.push({ role: "user", content: retryPrompt });

      const retryResponse = await callClaudeWithRetry(
        client,
        systemMessage,
        messages,
        apiMaxRetries,
        apiRetryBaseDelayMs,
      );
      const retryText = extractTextContent(retryResponse);

      try {
        proposals = parseMatchingOutput(retryText);
      } catch {
        // Both parse attempts failed — no salvageable output
        return {
          proposals: [],
          discarded: 0,
          deduplicated: 0,
          attempts: 2,
          retried: true,
          model: MATCHING_MODEL_CONFIG.model,
          rawCount: 0,
        };
      }

      // Parse succeeded on retry — validate, then deduplicate
      const filterResult = filterValidProposals(proposals);
      const dedupResult = deduplicateProposals(
        filterResult.valid,
        existingProposals,
      );
      return {
        proposals: dedupResult.unique,
        discarded: filterResult.discarded,
        deduplicated: dedupResult.duplicates,
        attempts: 2,
        retried: true,
        model: MATCHING_MODEL_CONFIG.model,
        rawCount: proposals.length,
      };
    }

    // Single attempt allowed and it failed parsing
    return {
      proposals: [],
      discarded: 0,
      deduplicated: 0,
      attempts: 1,
      retried: false,
      model: MATCHING_MODEL_CONFIG.model,
      rawCount: 0,
    };
  }

  // Parse succeeded on first attempt — validate, then deduplicate
  const filterResult = filterValidProposals(proposals);
  const dedupResult = deduplicateProposals(
    filterResult.valid,
    existingProposals,
  );
  return {
    proposals: dedupResult.unique,
    discarded: filterResult.discarded,
    deduplicated: dedupResult.duplicates,
    attempts: 1,
    retried: false,
    model: MATCHING_MODEL_CONFIG.model,
    rawCount: proposals.length,
  };
}

/**
 * Stores validated proposals in the database as CollaborationProposal records
 * and creates a MatchingResult tracking record for the pair.
 *
 * Resolves anchoring_publication_pmids from the LLM output to internal
 * Publication UUIDs by looking up PMIDs for both researchers.
 *
 * Per spec: "Store valid proposals with visibility states per the eligibility
 * rules" and "Record a MatchingResult with outcome and current profile_versions."
 *
 * @param prisma - Prisma client instance.
 * @param pairContext - The pair metadata (IDs, visibility, profile versions).
 * @param generationResult - The validated proposals from generateProposalsForPair.
 * @returns Summary of what was stored.
 */
export async function storeProposalsAndResult(
  prisma: PrismaClient,
  pairContext: PairContext,
  generationResult: ProposalGenerationResult,
): Promise<StoredProposalsSummary> {
  const { pair } = pairContext;
  const { proposals } = generationResult;

  // Determine the matching outcome for the MatchingResult record
  const outcome =
    proposals.length > 0 ? "proposals_generated" : "no_proposal";

  // Resolve PMIDs to Publication UUIDs for anchoring publications
  let unresolvedPmids = 0;
  const pmidToUuid = new Map<string, string>();

  // Collect all PMIDs from all proposals
  const allPmids = new Set<string>();
  for (const proposal of proposals) {
    for (const pmid of proposal.anchoring_publication_pmids) {
      if (pmid && pmid.trim().length > 0) {
        allPmids.add(pmid.trim());
      }
    }
  }

  // Batch lookup: find Publication UUIDs for PMIDs belonging to either researcher
  if (allPmids.size > 0) {
    const publications = await prisma.publication.findMany({
      where: {
        pmid: { in: Array.from(allPmids) },
        userId: { in: [pair.researcherAId, pair.researcherBId] },
      },
      select: {
        id: true,
        pmid: true,
      },
    });

    for (const pub of publications) {
      if (pub.pmid) {
        pmidToUuid.set(pub.pmid, pub.id);
      }
    }
  }

  // Create CollaborationProposal records and MatchingResult in a transaction
  await prisma.$transaction(async (tx) => {
    // Create proposals
    for (const proposal of proposals) {
      const anchoringIds: string[] = [];
      for (const pmid of proposal.anchoring_publication_pmids) {
        const uuid = pmidToUuid.get(pmid.trim());
        if (uuid) {
          anchoringIds.push(uuid);
        } else if (pmid.trim().length > 0) {
          unresolvedPmids++;
        }
      }

      await tx.collaborationProposal.create({
        data: {
          researcherAId: pair.researcherAId,
          researcherBId: pair.researcherBId,
          title: proposal.title,
          collaborationType: proposal.collaboration_type,
          scientificQuestion: proposal.scientific_question,
          oneLineSummaryA: proposal.one_line_summary_a,
          oneLineSummaryB: proposal.one_line_summary_b,
          detailedRationale: proposal.detailed_rationale,
          labAContributions: proposal.lab_a_contributions,
          labBContributions: proposal.lab_b_contributions,
          labABenefits: proposal.lab_a_benefits,
          labBBenefits: proposal.lab_b_benefits,
          proposedFirstExperiment: proposal.proposed_first_experiment,
          anchoringPublicationIds: anchoringIds,
          confidenceTier: proposal.confidence_tier as ConfidenceTier,
          llmReasoning: proposal.reasoning,
          llmModel: generationResult.model,
          visibilityA: pair.visibilityA,
          visibilityB: pair.visibilityB,
          profileVersionA: pair.profileVersionA,
          profileVersionB: pair.profileVersionB,
        },
      });
    }

    // Create MatchingResult tracking record
    await tx.matchingResult.create({
      data: {
        researcherAId: pair.researcherAId,
        researcherBId: pair.researcherBId,
        outcome,
        profileVersionA: pair.profileVersionA,
        profileVersionB: pair.profileVersionB,
      },
    });
  });

  return {
    stored: proposals.length,
    unresolvedPmids,
  };
}

// --- Internal helpers ---

/** Promise-based delay for exponential backoff. */
function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Determines if an error from the LLM API call is retryable (transient).
 *
 * Retryable: rate limits (429), server errors (5xx), timeouts (408),
 * overloaded (529), network/connection errors.
 * Non-retryable: authentication (401), permission (403), bad request (400).
 *
 * Works with Anthropic SDK APIError (which has a `status` property) and
 * generic network/connection errors.
 */
export function isRetryableError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;

  // Anthropic SDK APIError and subclasses expose a numeric `status` property
  const status = (error as { status?: number }).status;
  if (typeof status === "number") {
    // 408=timeout, 429=rate limit, 529=overloaded, 5xx=server errors
    return status === 408 || status === 429 || status >= 500;
  }

  // Network/connection errors have no HTTP status — always retryable
  const name = error.name;
  if (name === "APIConnectionError" || name === "APITimeoutError") {
    return true;
  }

  const msg = error.message.toLowerCase();
  return (
    msg.includes("econnrefused") ||
    msg.includes("econnreset") ||
    msg.includes("etimedout") ||
    msg.includes("fetch failed") ||
    msg.includes("socket hang up")
  );
}

/**
 * Calls the Claude API with the given messages and matching model configuration.
 */
async function callClaude(
  client: Anthropic,
  systemMessage: string,
  messages: Anthropic.MessageParam[],
): Promise<Anthropic.Message> {
  return client.messages.create({
    model: MATCHING_MODEL_CONFIG.model,
    max_tokens: MATCHING_MODEL_CONFIG.maxTokens,
    temperature: MATCHING_MODEL_CONFIG.temperature,
    system: systemMessage,
    messages,
  });
}

/**
 * Calls Claude with retry and exponential backoff for transient errors.
 *
 * Per spec (matching-engine.md): "LLM call fails → Retry with exponential
 * backoff, max 3 attempts."
 *
 * Retries only on transient errors (rate limits, server errors, network issues).
 * Non-retryable errors (auth, bad request) propagate immediately.
 *
 * Backoff schedule: base × 2^(attempt-1) with 0–25% jitter (default base: 1s).
 *
 * @param client - Anthropic SDK client instance.
 * @param systemMessage - The system prompt.
 * @param messages - The conversation messages.
 * @param maxRetries - Maximum total attempts (default: 3).
 * @param baseDelayMs - Base delay for exponential backoff (default: 1000ms). Set to 0 in tests.
 * @returns The Claude API response.
 * @throws The last error if all retries are exhausted or a non-retryable error occurs.
 */
async function callClaudeWithRetry(
  client: Anthropic,
  systemMessage: string,
  messages: Anthropic.MessageParam[],
  maxRetries: number = 3,
  baseDelayMs: number = 1000,
): Promise<Anthropic.Message> {
  let lastError: Error | undefined;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await callClaude(client, systemMessage, messages);
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));

      // Don't retry non-retryable errors or on last attempt
      if (attempt === maxRetries || !isRetryableError(err)) {
        throw lastError;
      }

      // Exponential backoff: base × 2^(attempt-1) with 0–25% jitter
      if (baseDelayMs > 0) {
        const exponentialDelay = baseDelayMs * Math.pow(2, attempt - 1);
        const jitter = Math.random() * exponentialDelay * 0.25;
        const waitMs = exponentialDelay + jitter;

        console.warn(
          `[MatchingEngine] LLM call attempt ${attempt}/${maxRetries} failed ` +
            `(${lastError.message}). Retrying in ${Math.round(waitMs)}ms...`,
        );

        await delay(waitMs);
      } else {
        console.warn(
          `[MatchingEngine] LLM call attempt ${attempt}/${maxRetries} failed ` +
            `(${lastError.message}). Retrying immediately...`,
        );
      }
    }
  }

  // Should not reach here, but TypeScript needs the throw
  throw lastError!;
}

/**
 * Extracts the text content from a Claude API response.
 *
 * Claude can return multiple content blocks (text, tool_use, etc.).
 * We concatenate all text blocks since the matching prompt expects
 * a single JSON output.
 *
 * @throws If no text content is found in the response.
 */
export function extractTextContent(response: Anthropic.Message): string {
  const textBlocks = response.content.filter(
    (block): block is Anthropic.TextBlock => block.type === "text",
  );

  if (textBlocks.length === 0) {
    throw new Error(
      "Claude response contained no text content blocks. " +
        `Stop reason: ${response.stop_reason}`,
    );
  }

  return textBlocks.map((block) => block.text).join("");
}
