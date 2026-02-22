/**
 * Tests for the profile synthesis service.
 *
 * Validates the end-to-end LLM call lifecycle:
 * - First attempt succeeds with valid output → returns immediately.
 * - First attempt produces invalid output → retries with error feedback.
 * - Both attempts fail validation → returns best output with valid=false.
 * - Parse failure on first attempt → retries with parse error message.
 * - Both attempts fail to parse → returns null output.
 * - Retry parse failure → falls back to first attempt's parseable output.
 * - Response with no text blocks → throws.
 * - extractTextContent correctly handles single and multi-block responses.
 *
 * The Anthropic client is fully mocked — no real API calls are made.
 */

import type Anthropic from "@anthropic-ai/sdk";
import {
  synthesizeProfile,
  extractTextContent,
} from "../profile-synthesis";
import type {
  SynthesisInput,
  SynthesisOutput,
} from "@/lib/profile-synthesis-prompt";

// --- Test fixtures ---

/** A minimal valid synthesis input for testing. */
function makeTestInput(
  overrides: Partial<SynthesisInput> = {},
): SynthesisInput {
  return {
    name: "Jane Doe",
    affiliation: "Stanford University, Department of Genetics",
    grantTitles: ["CRISPR-Based Approaches for Treating Sickle Cell Disease"],
    publications: [
      {
        title: "CRISPR screening identifies drug resistance genes in AML",
        journal: "Nature",
        year: 2024,
        authorPosition: "last",
        abstract:
          "We performed genome-wide CRISPR-Cas9 knockout screens in AML cell lines.",
      },
    ],
    userSubmittedTexts: [],
    ...overrides,
  };
}

/**
 * Generates a valid 160-word research summary.
 * This ensures the summary passes the 150-250 word validation requirement.
 */
function makeValidSummary(): string {
  return (
    "The Doe laboratory integrates functional genomics and gene editing approaches to study hematological malignancies and hemoglobinopathies. " +
    "Using genome-wide CRISPR-Cas9 knockout screens in acute myeloid leukemia cell lines, the lab identifies genetic determinants of drug resistance " +
    "to targeted therapies, providing mechanistic insight into treatment failure. Complementary single-cell RNA sequencing approaches reveal the " +
    "transcriptomic heterogeneity of leukemic blast populations, identifying distinct subpopulations that may differentially respond to therapy. " +
    "In parallel, the lab investigates epigenetic regulation of fetal hemoglobin expression in sickle cell disease through ChIP-seq and ATAC-seq " +
    "profiling of primary erythroid cells, aiming to identify druggable targets for hemoglobin switching. The research program bridges basic chromatin " +
    "biology with translational gene editing strategies, leveraging high-throughput screening platforms to prioritize therapeutic targets. " +
    "Recent work has expanded to include novel genome editing modalities for therapeutic applications in hemoglobinopathies, reflecting the lab's " +
    "commitment to developing clinically relevant genetic tools for blood disorders. The integration of computational analysis with experimental " +
    "validation enables systematic target discovery across multiple disease contexts."
  );
}

/** A valid LLM synthesis output object. */
function makeValidOutput(
  overrides: Partial<SynthesisOutput> = {},
): SynthesisOutput {
  return {
    research_summary: makeValidSummary(),
    techniques: [
      "CRISPR-Cas9 knockout screens",
      "single-cell RNA sequencing",
      "ChIP-seq",
      "ATAC-seq",
      "flow cytometry",
    ],
    experimental_models: [
      "AML cell lines",
      "primary erythroid cells",
      "K562 cells",
    ],
    disease_areas: ["acute myeloid leukemia", "sickle cell disease"],
    key_targets: ["BCL2", "fetal hemoglobin (HbF)", "BCL11A"],
    keywords: ["drug resistance", "functional genomics", "gene therapy"],
    ...overrides,
  };
}

/**
 * Creates a mock Claude API response wrapping the given text content.
 * Simulates the structure returned by client.messages.create().
 * Uses `as unknown as` to avoid needing to mock every SDK type field.
 */
function makeMockResponse(text: string): Anthropic.Message {
  return {
    id: "msg_test_123",
    type: "message",
    role: "assistant",
    content: [{ type: "text", text, citations: null }],
    model: "claude-opus-4-20250514",
    stop_reason: "end_turn",
    stop_sequence: null,
    usage: {
      input_tokens: 100,
      output_tokens: 200,
      cache_creation_input_tokens: 0,
      cache_read_input_tokens: 0,
    },
  } as Anthropic.Message;
}

/**
 * Creates a mock Anthropic client with the given sequence of responses.
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

// --- Tests ---

describe("profile-synthesis service", () => {
  describe("synthesizeProfile", () => {
    /** Happy path: first attempt returns valid output, no retry needed. */
    it("returns valid output on first attempt when validation passes", async () => {
      const validOutput = makeValidOutput();
      const client = makeMockClient([
        makeMockResponse(JSON.stringify(validOutput)),
      ]);

      const result = await synthesizeProfile(client, makeTestInput());

      expect(result.valid).toBe(true);
      expect(result.attempts).toBe(1);
      expect(result.retried).toBe(false);
      expect(result.output).not.toBeNull();
      expect(result.output!.research_summary).toBe(validOutput.research_summary);
      expect(result.output!.techniques).toEqual(validOutput.techniques);
      expect(result.output!.disease_areas).toEqual(validOutput.disease_areas);
      expect(result.output!.key_targets).toEqual(validOutput.key_targets);
      expect(result.validation!.valid).toBe(true);
      expect(result.model).toMatch(/^claude-opus/);
    });

    /** Verifies the service sends correct system message, model config, and user message. */
    it("sends correct parameters to the Claude API", async () => {
      const validOutput = makeValidOutput();
      const client = makeMockClient([
        makeMockResponse(JSON.stringify(validOutput)),
      ]);

      const input = makeTestInput();
      await synthesizeProfile(client, input);

      expect(client.createSpy).toHaveBeenCalledTimes(1);
      const callArgs = client.createSpy.mock.calls[0][0];

      // Model config matches SYNTHESIS_MODEL_CONFIG
      expect(callArgs.model).toMatch(/^claude-opus/);
      expect(callArgs.max_tokens).toBe(2000);
      expect(callArgs.temperature).toBe(0.3);

      // System message is the profile synthesizer prompt
      expect(callArgs.system).toContain("scientific profile synthesizer");

      // User message contains the researcher's data
      expect(callArgs.messages).toHaveLength(1);
      expect(callArgs.messages[0].role).toBe("user");
      expect(callArgs.messages[0].content).toContain("Jane Doe");
      expect(callArgs.messages[0].content).toContain("Stanford University");
    });

    /** When first attempt fails validation, retry with error feedback. */
    it("retries when first attempt fails validation and succeeds on retry", async () => {
      // First attempt: summary too short (fails validation)
      const invalidOutput = makeValidOutput({
        research_summary: "Too short summary.",
      });
      // Second attempt: valid output
      const validOutput = makeValidOutput();

      const client = makeMockClient([
        makeMockResponse(JSON.stringify(invalidOutput)),
        makeMockResponse(JSON.stringify(validOutput)),
      ]);

      const result = await synthesizeProfile(client, makeTestInput());

      expect(result.valid).toBe(true);
      expect(result.attempts).toBe(2);
      expect(result.retried).toBe(true);
      expect(result.output!.research_summary).toBe(validOutput.research_summary);

      // Verify retry prompt was sent with error details
      expect(client.createSpy).toHaveBeenCalledTimes(2);
      const retryArgs = client.createSpy.mock.calls[1][0];
      expect(retryArgs.messages).toHaveLength(3); // original + assistant + retry
      expect(retryArgs.messages[2].content).toContain("did not pass validation");
      expect(retryArgs.messages[2].content).toContain("at least 150");
    });

    /**
     * When both attempts fail validation, return the output with fewer errors.
     * Per spec: "If it fails again, save what we have and flag for review."
     */
    it("returns best output when both attempts fail validation", async () => {
      // First attempt: 4 errors (short summary, few techniques, empty disease, empty targets)
      const badOutput = makeValidOutput({
        research_summary: "Short.",
        techniques: ["one"],
        disease_areas: [],
        key_targets: [],
      });
      // Second attempt: 1 error (short summary only, but other fields ok)
      const lessInvalidOutput = makeValidOutput({
        research_summary: "Still too short but better.",
      });

      const client = makeMockClient([
        makeMockResponse(JSON.stringify(badOutput)),
        makeMockResponse(JSON.stringify(lessInvalidOutput)),
      ]);

      const result = await synthesizeProfile(client, makeTestInput());

      expect(result.valid).toBe(false);
      expect(result.attempts).toBe(2);
      expect(result.retried).toBe(true);
      // Should pick the retry output since it has fewer errors
      expect(result.output).not.toBeNull();
      expect(result.output!.research_summary).toBe(
        lessInvalidOutput.research_summary,
      );
      expect(result.validation!.errors.length).toBeLessThan(4);
    });

    /** When first attempt is worse than second, pick the second. */
    it("picks first attempt output when it has fewer errors than retry", async () => {
      // First attempt: 1 error (short summary)
      const firstOutput = makeValidOutput({
        research_summary: "Slightly too short but almost valid.",
      });
      // Second attempt: 3 errors
      const secondOutput = makeValidOutput({
        research_summary: "Even shorter.",
        techniques: ["one"],
        disease_areas: [],
      });

      const client = makeMockClient([
        makeMockResponse(JSON.stringify(firstOutput)),
        makeMockResponse(JSON.stringify(secondOutput)),
      ]);

      const result = await synthesizeProfile(client, makeTestInput());

      expect(result.valid).toBe(false);
      expect(result.output!.research_summary).toBe(
        firstOutput.research_summary,
      );
    });

    /** When first attempt produces unparseable JSON, retry with parse error feedback. */
    it("retries with parse error message when first attempt is not valid JSON", async () => {
      const validOutput = makeValidOutput();
      const client = makeMockClient([
        makeMockResponse("This is not JSON at all"),
        makeMockResponse(JSON.stringify(validOutput)),
      ]);

      const result = await synthesizeProfile(client, makeTestInput());

      expect(result.valid).toBe(true);
      expect(result.attempts).toBe(2);
      expect(result.retried).toBe(true);
      expect(result.output!.techniques).toEqual(validOutput.techniques);

      // Verify the retry prompt mentions parse error
      const retryArgs = client.createSpy.mock.calls[1][0];
      expect(retryArgs.messages[2].content).toContain(
        "could not be parsed as valid JSON",
      );
    });

    /** When both attempts produce unparseable output, return null. */
    it("returns null output when both attempts fail to parse", async () => {
      const client = makeMockClient([
        makeMockResponse("not json"),
        makeMockResponse("still not json"),
      ]);

      const result = await synthesizeProfile(client, makeTestInput());

      expect(result.output).toBeNull();
      expect(result.valid).toBe(false);
      expect(result.validation).toBeNull();
      expect(result.attempts).toBe(2);
      expect(result.retried).toBe(true);
    });

    /**
     * When retry produces unparseable output but first attempt was parseable
     * (just invalid), fall back to the first attempt's output.
     */
    it("falls back to first output when retry fails to parse", async () => {
      const invalidOutput = makeValidOutput({
        research_summary: "Too short.",
      });

      const client = makeMockClient([
        makeMockResponse(JSON.stringify(invalidOutput)),
        makeMockResponse("not json at all"),
      ]);

      const result = await synthesizeProfile(client, makeTestInput());

      expect(result.valid).toBe(false);
      expect(result.attempts).toBe(2);
      expect(result.retried).toBe(true);
      // Falls back to first attempt's parseable output
      expect(result.output).not.toBeNull();
      expect(result.output!.research_summary).toBe("Too short.");
    });

    /** When maxAttempts=1, no retry is performed even if validation fails. */
    it("does not retry when maxAttempts is 1", async () => {
      const invalidOutput = makeValidOutput({
        research_summary: "Short.",
      });
      const client = makeMockClient([
        makeMockResponse(JSON.stringify(invalidOutput)),
      ]);

      const result = await synthesizeProfile(client, makeTestInput(), {
        maxAttempts: 1,
      });

      expect(result.valid).toBe(false);
      expect(result.attempts).toBe(1);
      expect(result.retried).toBe(false);
      expect(result.output).not.toBeNull();
      expect(client.createSpy).toHaveBeenCalledTimes(1);
    });

    /** When maxAttempts=1 and parse fails, return null without retrying. */
    it("returns null without retry when maxAttempts=1 and parse fails", async () => {
      const client = makeMockClient([makeMockResponse("not json")]);

      const result = await synthesizeProfile(client, makeTestInput(), {
        maxAttempts: 1,
      });

      expect(result.output).toBeNull();
      expect(result.valid).toBe(false);
      expect(result.attempts).toBe(1);
      expect(result.retried).toBe(false);
      expect(client.createSpy).toHaveBeenCalledTimes(1);
    });

    /** LLM output wrapped in markdown fences should be handled correctly. */
    it("handles output wrapped in markdown code fences", async () => {
      const validOutput = makeValidOutput();
      const fencedJson = "```json\n" + JSON.stringify(validOutput) + "\n```";
      const client = makeMockClient([makeMockResponse(fencedJson)]);

      const result = await synthesizeProfile(client, makeTestInput());

      expect(result.valid).toBe(true);
      expect(result.output!.techniques).toEqual(validOutput.techniques);
    });

    /** Network/auth errors from the Anthropic SDK should propagate. */
    it("propagates API errors from the Anthropic client", async () => {
      const createSpy = jest
        .fn()
        .mockRejectedValue(new Error("Authentication failed"));
      const client = {
        messages: { create: createSpy },
      } as unknown as Anthropic;

      await expect(
        synthesizeProfile(client, makeTestInput()),
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
        synthesizeProfile(client, makeTestInput()),
      ).rejects.toThrow("Rate limit exceeded");
    });

    /** When Claude returns a response with no text blocks, the error should propagate. */
    it("propagates error when response has no text content", async () => {
      const noTextResponse = makeMockResponse("");
      noTextResponse.content = []; // Override to empty
      const client = makeMockClient([noTextResponse]);

      await expect(
        synthesizeProfile(client, makeTestInput()),
      ).rejects.toThrow("no text content blocks");
    });
  });

  describe("extractTextContent", () => {
    /** Single text block should be extracted directly. */
    it("extracts text from a single text block", () => {
      const response = makeMockResponse('{"key": "value"}');
      expect(extractTextContent(response)).toBe('{"key": "value"}');
    });

    /** Multiple text blocks should be concatenated. */
    it("concatenates multiple text blocks", () => {
      const response = makeMockResponse("");
      response.content = [
        { type: "text", text: '{"research_summary": "part1', citations: null } as Anthropic.TextBlock,
        { type: "text", text: ' part2"}', citations: null } as Anthropic.TextBlock,
      ];
      expect(extractTextContent(response)).toBe(
        '{"research_summary": "part1 part2"}',
      );
    });

    /** Non-text blocks (e.g., tool_use) should be ignored. */
    it("ignores non-text content blocks", () => {
      const response = makeMockResponse('{"key": "value"}');
      response.content = [
        {
          type: "tool_use",
          id: "tool_1",
          name: "test",
          input: {},
        } as Anthropic.ToolUseBlock,
        ...response.content,
      ];
      expect(extractTextContent(response)).toBe('{"key": "value"}');
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
