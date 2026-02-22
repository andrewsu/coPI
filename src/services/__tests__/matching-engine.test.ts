/**
 * Tests for the matching engine service.
 *
 * Validates the LLM call lifecycle for generating collaboration proposals:
 * - First attempt succeeds with valid proposals → returns immediately.
 * - LLM returns empty array → returns empty proposals (valid empty result).
 * - LLM returns mix of valid/invalid proposals → keeps valid, discards invalid.
 * - LLM returns malformed JSON → retries with formatting instructions, succeeds.
 * - Both attempts produce malformed JSON → returns empty proposals.
 * - Retry parse failure on second attempt → returns empty proposals.
 * - Parse failure with maxAttempts=1 → no retry, returns empty.
 * - LLM output wrapped in markdown fences → handled correctly.
 * - API errors propagate without being caught.
 * - Response with no text blocks → error propagates.
 * - Correct model config and messages sent to Claude API.
 *
 * Also validates storeProposalsAndResult:
 * - Stores proposals as CollaborationProposal records with correct field mapping.
 * - Creates MatchingResult with proposals_generated outcome.
 * - Creates MatchingResult with no_proposal outcome for empty results.
 * - Resolves anchoring PMIDs to Publication UUIDs.
 * - Handles unresolved PMIDs gracefully.
 * - Uses a database transaction for atomicity.
 *
 * The Anthropic client and Prisma client are fully mocked — no real API calls
 * or database operations are made.
 */

import type Anthropic from "@anthropic-ai/sdk";
import {
  generateProposalsForPair,
  storeProposalsAndResult,
  extractTextContent,
} from "../matching-engine";
import type { PairContext } from "@/services/matching-context";
import type { ProposalOutput } from "@/lib/matching-engine-prompt";
import { MATCHING_MODEL_CONFIG } from "@/lib/matching-engine-prompt";

// --- Test fixtures ---

/** Creates a minimal valid PairContext for testing. */
function makeTestPairContext(
  overrides: Partial<PairContext> = {},
): PairContext {
  return {
    pair: {
      researcherAId: "aaaa0000-0000-0000-0000-000000000001",
      researcherBId: "bbbb0000-0000-0000-0000-000000000002",
      visibilityA: "visible",
      visibilityB: "visible",
      profileVersionA: 1,
      profileVersionB: 1,
    },
    input: {
      researcherA: {
        name: "Alice Smith",
        institution: "MIT",
        department: "Biology",
        researchSummary: "Studies CRISPR gene editing in cancer models.",
        techniques: ["CRISPR-Cas9", "flow cytometry"],
        experimentalModels: ["AML cell lines"],
        diseaseAreas: ["acute myeloid leukemia"],
        keyTargets: ["BCL2"],
        keywords: ["gene editing"],
        grantTitles: ["CRISPR for AML Therapy"],
        userSubmittedTexts: [],
        publications: [
          {
            title: "CRISPR screens in AML",
            journal: "Nature",
            year: 2024,
            authorPosition: "last",
            abstract: "We screened AML cell lines.",
          },
        ],
      },
      researcherB: {
        name: "Bob Jones",
        institution: "Stanford",
        department: "Chemistry",
        researchSummary: "Develops small molecule kinase inhibitors.",
        techniques: ["medicinal chemistry", "kinase assays"],
        experimentalModels: ["CML cell lines"],
        diseaseAreas: ["chronic myeloid leukemia"],
        keyTargets: ["ABL1"],
        keywords: ["drug discovery"],
        grantTitles: ["Novel Kinase Inhibitors for CML"],
        userSubmittedTexts: [],
        publications: [
          {
            title: "ABL1 inhibitor optimization",
            journal: "JMedChem",
            year: 2023,
            authorPosition: "last",
            abstract: "We optimized ABL1 inhibitors.",
          },
        ],
      },
      existingProposals: [],
    },
    ...overrides,
  };
}

/** Creates a valid ProposalOutput for testing. */
function makeValidProposal(
  overrides: Partial<ProposalOutput> = {},
): ProposalOutput {
  return {
    title: "CRISPR-Guided Kinase Inhibitor Resistance Profiling",
    collaboration_type: "mechanistic extension",
    scientific_question:
      "Which kinase domain mutations confer resistance to next-generation ABL1 inhibitors?",
    one_line_summary_a:
      "Jones's ABL1 inhibitor series could be screened against your CRISPR-engineered resistance panel.",
    one_line_summary_b:
      "Smith's CRISPR screening platform can systematically identify resistance mutations to your ABL1 inhibitors.",
    detailed_rationale:
      "Smith's CRISPR expertise paired with Jones's kinase chemistry creates a unique opportunity. " +
      "By generating saturation mutagenesis libraries of the ABL1 kinase domain and screening against " +
      "Jones's novel inhibitor series, the collaboration can pre-identify clinical resistance mutations.",
    lab_a_contributions:
      "CRISPR-Cas9 base editing library targeting ABL1 kinase domain, Ba/F3 cell selection system, next-gen sequencing pipeline for enrichment scoring",
    lab_b_contributions:
      "Panel of 5 next-generation ABL1 inhibitors with distinct binding modes, kinase activity assays, structural models of ABL1-inhibitor complexes",
    lab_a_benefits:
      "Access to a therapeutically relevant chemical series for validating the resistance profiling platform in a clinically impactful context",
    lab_b_benefits:
      "Pre-clinical resistance profiling data that can guide structure-based optimization to circumvent predicted resistance mutations",
    proposed_first_experiment:
      "Smith Lab generates a saturation mutagenesis library of ABL1 kinase domain residues 240-500 in Ba/F3 cells. " +
      "Jones Lab provides 3 lead ABL1 inhibitors. Screen: grow library under inhibitor selection for 2 weeks, " +
      "sequence enriched variants. Readout: ranked list of resistance mutations per compound, compared to imatinib control.",
    anchoring_publication_pmids: ["12345678"],
    confidence_tier: "high",
    reasoning:
      "Strong match: complementary capabilities, specific reagents, concrete first experiment.",
    ...overrides,
  };
}

/** Creates a mock Claude API response wrapping the given text content. */
function makeMockResponse(text: string): Anthropic.Message {
  return {
    id: "msg_test_matching_123",
    type: "message",
    role: "assistant",
    content: [{ type: "text", text, citations: null }],
    model: MATCHING_MODEL_CONFIG.model,
    stop_reason: "end_turn",
    stop_sequence: null,
    usage: {
      input_tokens: 5000,
      output_tokens: 2000,
      cache_creation_input_tokens: 0,
      cache_read_input_tokens: 0,
    },
  } as Anthropic.Message;
}

/**
 * Creates a mock Anthropic client with a sequence of responses.
 * Each call to messages.create() returns the next response in order.
 */
function makeMockClient(
  responses: Anthropic.Message[],
): Anthropic & { createSpy: jest.Mock } {
  const createSpy = jest.fn();
  responses.forEach((response) => {
    createSpy.mockResolvedValueOnce(response);
  });

  return {
    messages: {
      create: createSpy,
    },
    createSpy,
  } as unknown as Anthropic & { createSpy: jest.Mock };
}

/**
 * Creates a mock PrismaClient for storeProposalsAndResult tests.
 * Tracks calls to publication.findMany, collaborationProposal.create,
 * matchingResult.create, and $transaction.
 */
function makeMockPrisma() {
  const collaborationProposalCreate = jest.fn().mockResolvedValue({});
  const matchingResultCreate = jest.fn().mockResolvedValue({});
  const publicationFindMany = jest.fn().mockResolvedValue([]);

  // $transaction receives a callback and calls it with a transaction client.
  // The transaction client has the same shape as the Prisma client.
  const txClient = {
    collaborationProposal: { create: collaborationProposalCreate },
    matchingResult: { create: matchingResultCreate },
  };

  const $transaction = jest.fn().mockImplementation(async (cb: (tx: typeof txClient) => Promise<void>) => {
    await cb(txClient);
  });

  return {
    prisma: {
      publication: { findMany: publicationFindMany },
      $transaction,
    } as unknown as import("@prisma/client").PrismaClient,
    mocks: {
      collaborationProposalCreate,
      matchingResultCreate,
      publicationFindMany,
      $transaction,
    },
  };
}

// --- Tests ---

describe("matching-engine service", () => {
  describe("generateProposalsForPair", () => {
    /**
     * Happy path: Claude returns valid proposals on first attempt.
     * No retry should be needed. Proposals pass validation and are returned.
     */
    it("returns valid proposals on first attempt when LLM output is well-formed", async () => {
      const proposals = [makeValidProposal()];
      const client = makeMockClient([
        makeMockResponse(JSON.stringify(proposals)),
      ]);

      const result = await generateProposalsForPair(
        client,
        makeTestPairContext(),
      );

      expect(result.proposals).toHaveLength(1);
      expect(result.proposals[0]!.title).toBe(proposals[0]!.title);
      expect(result.discarded).toBe(0);
      expect(result.deduplicated).toBe(0);
      expect(result.attempts).toBe(1);
      expect(result.retried).toBe(false);
      expect(result.model).toBe(MATCHING_MODEL_CONFIG.model);
      expect(result.rawCount).toBe(1);
    });

    /**
     * Claude returns empty array — no quality proposals for this pair.
     * This is a valid result per spec: "Return an empty array [] if
     * no quality proposals exist for this pair."
     */
    it("returns empty proposals when LLM returns empty array", async () => {
      const client = makeMockClient([makeMockResponse("[]")]);

      const result = await generateProposalsForPair(
        client,
        makeTestPairContext(),
      );

      expect(result.proposals).toHaveLength(0);
      expect(result.discarded).toBe(0);
      expect(result.deduplicated).toBe(0);
      expect(result.attempts).toBe(1);
      expect(result.retried).toBe(false);
      expect(result.rawCount).toBe(0);
    });

    /**
     * Claude returns multiple proposals, some valid and some invalid.
     * Per spec: "Discard proposals missing required fields, keep valid ones."
     * Invalid proposals are filtered out without triggering a retry.
     */
    it("keeps valid proposals and discards invalid ones from the same response", async () => {
      const validProposal = makeValidProposal();
      const invalidProposal = {
        ...makeValidProposal(),
        title: "", // Empty title fails validation
        scientific_question: "", // Empty question fails validation
      };

      const client = makeMockClient([
        makeMockResponse(JSON.stringify([validProposal, invalidProposal])),
      ]);

      const result = await generateProposalsForPair(
        client,
        makeTestPairContext(),
      );

      expect(result.proposals).toHaveLength(1);
      expect(result.proposals[0]!.title).toBe(validProposal.title);
      expect(result.discarded).toBe(1);
      expect(result.deduplicated).toBe(0);
      expect(result.attempts).toBe(1);
      expect(result.retried).toBe(false);
      expect(result.rawCount).toBe(2);
    });

    /**
     * All proposals invalid — none pass validation.
     * Returns empty proposals with discard count, no retry.
     */
    it("returns empty proposals when all proposals fail validation", async () => {
      const invalidProposal = {
        title: "",
        collaboration_type: "",
        // Missing most required fields
      };

      const client = makeMockClient([
        makeMockResponse(JSON.stringify([invalidProposal])),
      ]);

      const result = await generateProposalsForPair(
        client,
        makeTestPairContext(),
      );

      expect(result.proposals).toHaveLength(0);
      expect(result.discarded).toBe(1);
      expect(result.rawCount).toBe(1);
    });

    /**
     * Claude returns malformed JSON on first attempt.
     * Per spec: "Retry once with stricter formatting instructions."
     * Retry succeeds with valid proposals.
     */
    it("retries on JSON parse failure and succeeds on retry", async () => {
      const validProposals = [makeValidProposal()];
      const client = makeMockClient([
        makeMockResponse("This is not valid JSON at all"),
        makeMockResponse(JSON.stringify(validProposals)),
      ]);

      const result = await generateProposalsForPair(
        client,
        makeTestPairContext(),
      );

      expect(result.proposals).toHaveLength(1);
      expect(result.proposals[0]!.title).toBe(validProposals[0]!.title);
      expect(result.deduplicated).toBe(0);
      expect(result.attempts).toBe(2);
      expect(result.retried).toBe(true);
      expect(result.rawCount).toBe(1);

      // Verify retry prompt was sent
      expect(client.createSpy).toHaveBeenCalledTimes(2);
      const retryArgs = client.createSpy.mock.calls[1][0];
      expect(retryArgs.messages).toHaveLength(3); // original + assistant + retry
      expect(retryArgs.messages[2].content).toContain(
        "could not be parsed as valid JSON",
      );
    });

    /**
     * Both attempts return malformed JSON — nothing salvageable.
     * Per spec: "LLM call fails → Retry with exponential backoff, max 3 attempts."
     * (Simplified here to 2 attempts for JSON parse failures.)
     */
    it("returns empty proposals when both parse attempts fail", async () => {
      const client = makeMockClient([
        makeMockResponse("not json {{{"),
        makeMockResponse("still not json >>>"),
      ]);

      const result = await generateProposalsForPair(
        client,
        makeTestPairContext(),
      );

      expect(result.proposals).toHaveLength(0);
      expect(result.discarded).toBe(0);
      expect(result.deduplicated).toBe(0);
      expect(result.attempts).toBe(2);
      expect(result.retried).toBe(true);
      expect(result.rawCount).toBe(0);
    });

    /**
     * maxAttempts=1: no retry when parse fails.
     * Useful for testing or when retries are disabled.
     */
    it("does not retry when maxAttempts is 1 and parse fails", async () => {
      const client = makeMockClient([
        makeMockResponse("not valid json"),
      ]);

      const result = await generateProposalsForPair(
        client,
        makeTestPairContext(),
        { maxAttempts: 1 },
      );

      expect(result.proposals).toHaveLength(0);
      expect(result.deduplicated).toBe(0);
      expect(result.attempts).toBe(1);
      expect(result.retried).toBe(false);
      expect(client.createSpy).toHaveBeenCalledTimes(1);
    });

    /**
     * LLM output wrapped in markdown code fences should be handled.
     * The parseMatchingOutput function strips fences before JSON parsing.
     */
    it("handles output wrapped in markdown code fences", async () => {
      const proposals = [makeValidProposal()];
      const fencedJson = "```json\n" + JSON.stringify(proposals) + "\n```";
      const client = makeMockClient([makeMockResponse(fencedJson)]);

      const result = await generateProposalsForPair(
        client,
        makeTestPairContext(),
      );

      expect(result.proposals).toHaveLength(1);
      expect(result.attempts).toBe(1);
      expect(result.retried).toBe(false);
    });

    /**
     * LLM returns multiple valid proposals (up to 3 per spec).
     * All should be returned if valid.
     */
    it("returns multiple valid proposals", async () => {
      const proposals = [
        makeValidProposal({ title: "Proposal 1" }),
        makeValidProposal({ title: "Proposal 2" }),
        makeValidProposal({ title: "Proposal 3" }),
      ];
      const client = makeMockClient([
        makeMockResponse(JSON.stringify(proposals)),
      ]);

      const result = await generateProposalsForPair(
        client,
        makeTestPairContext(),
      );

      expect(result.proposals).toHaveLength(3);
      expect(result.proposals.map((p) => p.title)).toEqual([
        "Proposal 1",
        "Proposal 2",
        "Proposal 3",
      ]);
      expect(result.rawCount).toBe(3);
    });

    /**
     * Verifies the service sends the correct model configuration and
     * messages to the Claude API.
     */
    it("sends correct model config and messages to Claude API", async () => {
      const proposals = [makeValidProposal()];
      const client = makeMockClient([
        makeMockResponse(JSON.stringify(proposals)),
      ]);

      const ctx = makeTestPairContext();
      await generateProposalsForPair(client, ctx);

      expect(client.createSpy).toHaveBeenCalledTimes(1);
      const callArgs = client.createSpy.mock.calls[0][0];

      // Model config matches MATCHING_MODEL_CONFIG
      expect(callArgs.model).toBe(MATCHING_MODEL_CONFIG.model);
      expect(callArgs.max_tokens).toBe(MATCHING_MODEL_CONFIG.maxTokens);
      expect(callArgs.temperature).toBe(MATCHING_MODEL_CONFIG.temperature);

      // System message contains the matching engine prompt
      expect(callArgs.system).toContain(
        "scientific collaboration proposal engine",
      );

      // User message contains researcher context
      expect(callArgs.messages).toHaveLength(1);
      expect(callArgs.messages[0].role).toBe("user");
      expect(callArgs.messages[0].content).toContain("Alice Smith");
      expect(callArgs.messages[0].content).toContain("Bob Jones");
    });

    /**
     * Network/auth errors from the Anthropic SDK should propagate
     * without being caught by the service.
     */
    it("propagates API errors from the Anthropic client", async () => {
      const createSpy = jest
        .fn()
        .mockRejectedValue(new Error("Authentication failed"));
      const client = {
        messages: { create: createSpy },
      } as unknown as Anthropic;

      await expect(
        generateProposalsForPair(client, makeTestPairContext()),
      ).rejects.toThrow("Authentication failed");
    });

    /** Rate limit errors should propagate without being caught. */
    it("propagates rate limit errors", async () => {
      const createSpy = jest
        .fn()
        .mockRejectedValue(new Error("Rate limit exceeded"));
      const client = {
        messages: { create: createSpy },
      } as unknown as Anthropic;

      await expect(
        generateProposalsForPair(client, makeTestPairContext()),
      ).rejects.toThrow("Rate limit exceeded");
    });

    /**
     * When Claude returns a response with no text blocks, the error
     * should propagate (no retry for structural response issues).
     */
    it("propagates error when response has no text content", async () => {
      const noTextResponse = makeMockResponse("");
      noTextResponse.content = [];
      const client = makeMockClient([noTextResponse]);

      await expect(
        generateProposalsForPair(client, makeTestPairContext()),
      ).rejects.toThrow("no text content blocks");
    });

    /**
     * Existing proposals are included in the user message for de-duplication.
     * The context assembly service provides them; the LLM service passes
     * them through to the prompt builder.
     */
    it("includes existing proposals in user message for de-duplication", async () => {
      const ctx = makeTestPairContext({
        input: {
          ...makeTestPairContext().input,
          existingProposals: [
            {
              title: "Existing Collaboration",
              scientificQuestion: "How does X affect Y?",
            },
          ],
        },
      });

      const proposals = [makeValidProposal()];
      const client = makeMockClient([
        makeMockResponse(JSON.stringify(proposals)),
      ]);

      await generateProposalsForPair(client, ctx);

      const callArgs = client.createSpy.mock.calls[0][0];
      expect(callArgs.messages[0].content).toContain("Existing Collaboration");
      expect(callArgs.messages[0].content).toContain("How does X affect Y?");
    });

    /**
     * Post-generation de-duplication: when the LLM generates a proposal
     * whose title is substantially similar to an existing proposal, it
     * should be filtered out. Per spec: "Post-generation: check new proposal
     * titles/questions against existing ones. If substantially similar, discard."
     */
    it("deduplicates proposals with similar titles to existing proposals", async () => {
      const ctx = makeTestPairContext({
        input: {
          ...makeTestPairContext().input,
          existingProposals: [
            {
              title: "CRISPR-Guided Kinase Inhibitor Resistance Profiling",
              scientificQuestion: "Some previous question?",
            },
          ],
        },
      });

      // LLM generates a proposal with a title very similar to the existing one
      const similarProposal = makeValidProposal({
        title: "Kinase Inhibitor Resistance Profiling Using CRISPR Guidance",
        scientific_question: "A completely different question about new things?",
      });
      const client = makeMockClient([
        makeMockResponse(JSON.stringify([similarProposal])),
      ]);

      const result = await generateProposalsForPair(client, ctx);

      expect(result.proposals).toHaveLength(0);
      expect(result.deduplicated).toBe(1);
      expect(result.discarded).toBe(0);
    });

    /**
     * Post-generation de-duplication: proposals with similar scientific
     * questions to existing ones should be filtered out, even if titles differ.
     */
    it("deduplicates proposals with similar scientific questions to existing proposals", async () => {
      const ctx = makeTestPairContext({
        input: {
          ...makeTestPairContext().input,
          existingProposals: [
            {
              title: "Some Existing Title",
              scientificQuestion:
                "Which kinase domain mutations confer resistance to next-generation ABL1 inhibitors?",
            },
          ],
        },
      });

      const similarProposal = makeValidProposal({
        title: "A Brand New Unique Title About Something Else",
        scientific_question:
          "What kinase domain mutations give resistance to ABL1 next-generation inhibitors?",
      });
      const client = makeMockClient([
        makeMockResponse(JSON.stringify([similarProposal])),
      ]);

      const result = await generateProposalsForPair(client, ctx);

      expect(result.proposals).toHaveLength(0);
      expect(result.deduplicated).toBe(1);
    });

    /**
     * Genuinely distinct proposals should pass through de-duplication
     * even when existing proposals exist for the pair.
     */
    it("keeps genuinely distinct proposals when existing proposals exist", async () => {
      const ctx = makeTestPairContext({
        input: {
          ...makeTestPairContext().input,
          existingProposals: [
            {
              title: "CRISPR-Guided Kinase Inhibitor Resistance Profiling",
              scientificQuestion:
                "Which kinase domain mutations confer resistance to ABL1 inhibitors?",
            },
          ],
        },
      });

      // LLM generates a completely different proposal
      const distinctProposal = makeValidProposal({
        title: "Cryo-ET Visualization of Mitochondrial Membrane Remodeling",
        scientific_question:
          "How does HRI activation remodel mitochondrial membrane ultrastructure?",
      });
      const client = makeMockClient([
        makeMockResponse(JSON.stringify([distinctProposal])),
      ]);

      const result = await generateProposalsForPair(client, ctx);

      expect(result.proposals).toHaveLength(1);
      expect(result.proposals[0]!.title).toBe(distinctProposal.title);
      expect(result.deduplicated).toBe(0);
    });

    /**
     * De-duplication after retry: when a parse failure triggers a retry
     * and the retry succeeds, de-duplication should still apply to the
     * retried output.
     */
    it("applies de-duplication after successful retry", async () => {
      const ctx = makeTestPairContext({
        input: {
          ...makeTestPairContext().input,
          existingProposals: [
            {
              title: "CRISPR-Guided Kinase Inhibitor Resistance Profiling",
              scientificQuestion: "Previous question?",
            },
          ],
        },
      });

      const similarProposal = makeValidProposal({
        title: "Kinase Inhibitor Resistance Profiling via CRISPR Screens",
        scientific_question: "Something completely new and different?",
      });
      const client = makeMockClient([
        makeMockResponse("not valid json"),
        makeMockResponse(JSON.stringify([similarProposal])),
      ]);

      const result = await generateProposalsForPair(client, ctx);

      expect(result.proposals).toHaveLength(0);
      expect(result.deduplicated).toBe(1);
      expect(result.retried).toBe(true);
      expect(result.attempts).toBe(2);
    });

    /**
     * Proposals with invalid confidence_tier values should be discarded.
     * Only "high", "moderate", and "speculative" are valid.
     */
    it("discards proposals with invalid confidence_tier", async () => {
      const invalidTierProposal = makeValidProposal({
        confidence_tier: "very_high", // Not a valid tier
      });

      const client = makeMockClient([
        makeMockResponse(JSON.stringify([invalidTierProposal])),
      ]);

      const result = await generateProposalsForPair(
        client,
        makeTestPairContext(),
      );

      expect(result.proposals).toHaveLength(0);
      expect(result.discarded).toBe(1);
    });
  });

  describe("storeProposalsAndResult", () => {
    /**
     * Stores proposals as CollaborationProposal records with all fields
     * correctly mapped from snake_case LLM output to camelCase Prisma fields.
     */
    it("stores proposals and creates MatchingResult with proposals_generated outcome", async () => {
      const { prisma, mocks } = makeMockPrisma();
      const pairCtx = makeTestPairContext();
      const proposal = makeValidProposal();
      const genResult = {
        proposals: [proposal],
        discarded: 0,
        deduplicated: 0,
        attempts: 1,
        retried: false,
        model: MATCHING_MODEL_CONFIG.model,
        rawCount: 1,
      };

      // No PMID resolution needed (no matching publications)
      mocks.publicationFindMany.mockResolvedValue([]);

      const result = await storeProposalsAndResult(prisma, pairCtx, genResult);

      expect(result.stored).toBe(1);

      // Verify proposal was created with correct field mapping
      expect(mocks.collaborationProposalCreate).toHaveBeenCalledTimes(1);
      const createArg = mocks.collaborationProposalCreate.mock.calls[0][0];
      expect(createArg.data.title).toBe(proposal.title);
      expect(createArg.data.collaborationType).toBe(proposal.collaboration_type);
      expect(createArg.data.scientificQuestion).toBe(proposal.scientific_question);
      expect(createArg.data.oneLineSummaryA).toBe(proposal.one_line_summary_a);
      expect(createArg.data.oneLineSummaryB).toBe(proposal.one_line_summary_b);
      expect(createArg.data.detailedRationale).toBe(proposal.detailed_rationale);
      expect(createArg.data.labAContributions).toBe(proposal.lab_a_contributions);
      expect(createArg.data.labBContributions).toBe(proposal.lab_b_contributions);
      expect(createArg.data.labABenefits).toBe(proposal.lab_a_benefits);
      expect(createArg.data.labBBenefits).toBe(proposal.lab_b_benefits);
      expect(createArg.data.proposedFirstExperiment).toBe(proposal.proposed_first_experiment);
      expect(createArg.data.confidenceTier).toBe("high");
      expect(createArg.data.llmReasoning).toBe(proposal.reasoning);
      expect(createArg.data.llmModel).toBe(MATCHING_MODEL_CONFIG.model);
      expect(createArg.data.visibilityA).toBe("visible");
      expect(createArg.data.visibilityB).toBe("visible");
      expect(createArg.data.profileVersionA).toBe(1);
      expect(createArg.data.profileVersionB).toBe(1);

      // Verify MatchingResult was created
      expect(mocks.matchingResultCreate).toHaveBeenCalledTimes(1);
      const mrArg = mocks.matchingResultCreate.mock.calls[0][0];
      expect(mrArg.data.outcome).toBe("proposals_generated");
      expect(mrArg.data.researcherAId).toBe(pairCtx.pair.researcherAId);
      expect(mrArg.data.researcherBId).toBe(pairCtx.pair.researcherBId);
    });

    /**
     * When no proposals are generated (LLM returned empty array or all invalid),
     * create a MatchingResult with no_proposal outcome. Per spec: "When the
     * engine evaluates a pair and generates nothing, record a MatchingResult
     * with outcome=no_proposal."
     */
    it("creates MatchingResult with no_proposal outcome when proposals are empty", async () => {
      const { prisma, mocks } = makeMockPrisma();
      const pairCtx = makeTestPairContext();
      const genResult = {
        proposals: [],
        discarded: 0,
        deduplicated: 0,
        attempts: 1,
        retried: false,
        model: MATCHING_MODEL_CONFIG.model,
        rawCount: 0,
      };

      const result = await storeProposalsAndResult(prisma, pairCtx, genResult);

      expect(result.stored).toBe(0);
      expect(mocks.collaborationProposalCreate).not.toHaveBeenCalled();
      expect(mocks.matchingResultCreate).toHaveBeenCalledTimes(1);
      expect(mocks.matchingResultCreate.mock.calls[0][0].data.outcome).toBe(
        "no_proposal",
      );
    });

    /**
     * Resolves anchoring_publication_pmids from the LLM output to internal
     * Publication UUIDs. The service looks up PMIDs for both researchers'
     * publications.
     */
    it("resolves anchoring PMIDs to Publication UUIDs", async () => {
      const { prisma, mocks } = makeMockPrisma();
      const proposal = makeValidProposal({
        anchoring_publication_pmids: ["12345678", "87654321"],
      });
      const pairCtx = makeTestPairContext();
      const genResult = {
        proposals: [proposal],
        discarded: 0,
        deduplicated: 0,
        attempts: 1,
        retried: false,
        model: MATCHING_MODEL_CONFIG.model,
        rawCount: 1,
      };

      // Mock PMID lookup: one resolves, one doesn't
      mocks.publicationFindMany.mockResolvedValue([
        { id: "pub-uuid-111", pmid: "12345678" },
      ]);

      const result = await storeProposalsAndResult(prisma, pairCtx, genResult);

      expect(result.stored).toBe(1);
      expect(result.unresolvedPmids).toBe(1);

      // Verify the resolved UUID is in anchoringPublicationIds
      const createArg = mocks.collaborationProposalCreate.mock.calls[0][0];
      expect(createArg.data.anchoringPublicationIds).toEqual(["pub-uuid-111"]);
    });

    /**
     * Proposals with empty anchoring_publication_pmids array should work
     * without any PMID lookup errors.
     */
    it("handles proposals with no anchoring PMIDs", async () => {
      const { prisma, mocks } = makeMockPrisma();
      const proposal = makeValidProposal({
        anchoring_publication_pmids: [],
      });
      const pairCtx = makeTestPairContext();
      const genResult = {
        proposals: [proposal],
        discarded: 0,
        deduplicated: 0,
        attempts: 1,
        retried: false,
        model: MATCHING_MODEL_CONFIG.model,
        rawCount: 1,
      };

      const result = await storeProposalsAndResult(prisma, pairCtx, genResult);

      expect(result.stored).toBe(1);
      expect(result.unresolvedPmids).toBe(0);

      const createArg = mocks.collaborationProposalCreate.mock.calls[0][0];
      expect(createArg.data.anchoringPublicationIds).toEqual([]);
    });

    /**
     * Stores multiple proposals from a single generation result.
     * Each gets its own CollaborationProposal record.
     */
    it("stores multiple proposals from one generation", async () => {
      const { prisma, mocks } = makeMockPrisma();
      const proposals = [
        makeValidProposal({ title: "Proposal 1" }),
        makeValidProposal({ title: "Proposal 2" }),
      ];
      const pairCtx = makeTestPairContext();
      const genResult = {
        proposals,
        discarded: 0,
        deduplicated: 0,
        attempts: 1,
        retried: false,
        model: MATCHING_MODEL_CONFIG.model,
        rawCount: 2,
      };

      const result = await storeProposalsAndResult(prisma, pairCtx, genResult);

      expect(result.stored).toBe(2);
      expect(mocks.collaborationProposalCreate).toHaveBeenCalledTimes(2);
      expect(
        mocks.collaborationProposalCreate.mock.calls[0][0].data.title,
      ).toBe("Proposal 1");
      expect(
        mocks.collaborationProposalCreate.mock.calls[1][0].data.title,
      ).toBe("Proposal 2");
    });

    /**
     * Visibility states from the eligible pair are correctly assigned
     * to the stored proposals (e.g., pending_other_interest for one-sided).
     */
    it("assigns visibility states from the eligible pair to proposals", async () => {
      const { prisma, mocks } = makeMockPrisma();
      const pairCtx = makeTestPairContext({
        pair: {
          ...makeTestPairContext().pair,
          visibilityA: "visible",
          visibilityB: "pending_other_interest",
        },
      });
      const genResult = {
        proposals: [makeValidProposal()],
        discarded: 0,
        deduplicated: 0,
        attempts: 1,
        retried: false,
        model: MATCHING_MODEL_CONFIG.model,
        rawCount: 1,
      };

      await storeProposalsAndResult(prisma, pairCtx, genResult);

      const createArg = mocks.collaborationProposalCreate.mock.calls[0][0];
      expect(createArg.data.visibilityA).toBe("visible");
      expect(createArg.data.visibilityB).toBe("pending_other_interest");
    });

    /**
     * The entire storage operation uses a database transaction for atomicity.
     * Both proposals and MatchingResult are created within the same transaction.
     */
    it("uses a database transaction for atomicity", async () => {
      const { prisma, mocks } = makeMockPrisma();
      const genResult = {
        proposals: [makeValidProposal()],
        discarded: 0,
        deduplicated: 0,
        attempts: 1,
        retried: false,
        model: MATCHING_MODEL_CONFIG.model,
        rawCount: 1,
      };

      await storeProposalsAndResult(prisma, makeTestPairContext(), genResult);

      expect(mocks.$transaction).toHaveBeenCalledTimes(1);
      // Both creates happen within the transaction callback
      expect(mocks.collaborationProposalCreate).toHaveBeenCalledTimes(1);
      expect(mocks.matchingResultCreate).toHaveBeenCalledTimes(1);
    });
  });

  describe("extractTextContent", () => {
    /** Single text block should be extracted directly. */
    it("extracts text from a single text block", () => {
      const response = makeMockResponse('[{"title": "test"}]');
      expect(extractTextContent(response)).toBe('[{"title": "test"}]');
    });

    /** Multiple text blocks should be concatenated. */
    it("concatenates multiple text blocks", () => {
      const response = makeMockResponse("");
      response.content = [
        {
          type: "text",
          text: '[{"title": "part1',
          citations: null,
        } as Anthropic.TextBlock,
        {
          type: "text",
          text: ' part2"}]',
          citations: null,
        } as Anthropic.TextBlock,
      ];
      expect(extractTextContent(response)).toBe(
        '[{"title": "part1 part2"}]',
      );
    });

    /** Non-text blocks (e.g., tool_use) should be ignored. */
    it("ignores non-text content blocks", () => {
      const response = makeMockResponse("[]");
      response.content = [
        {
          type: "tool_use",
          id: "tool_1",
          name: "test",
          input: {},
        } as Anthropic.ToolUseBlock,
        ...response.content,
      ];
      expect(extractTextContent(response)).toBe("[]");
    });

    /** Completely empty content array should throw. */
    it("throws when response has no content blocks", () => {
      const response = makeMockResponse("");
      response.content = [];
      expect(() => extractTextContent(response)).toThrow(
        "no text content blocks",
      );
    });

    /** Only non-text blocks should throw (no text to extract). */
    it("throws when response has only non-text blocks", () => {
      const response = makeMockResponse("");
      response.content = [
        {
          type: "tool_use",
          id: "tool_1",
          name: "test",
          input: {},
        } as Anthropic.ToolUseBlock,
      ];
      expect(() => extractTextContent(response)).toThrow(
        "no text content blocks",
      );
    });
  });
});
