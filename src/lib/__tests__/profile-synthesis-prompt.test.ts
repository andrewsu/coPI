/**
 * Tests for the profile synthesis prompt builder and output validator.
 *
 * Validates that:
 * - The prompt is correctly assembled from researcher data
 * - Publications are selected and ordered by author position and recency
 * - LLM output is correctly parsed, cleaned, and validated
 * - Retry prompts are generated with specific error details
 * - Edge cases (empty inputs, malformed JSON, code fences) are handled
 */

import {
  type SynthesisInput,
  type SynthesisOutput,
  type SynthesisPublication,
  buildUserMessage,
  getSystemMessage,
  selectPublicationsForSynthesis,
  parseSynthesisOutput,
  validateSynthesisOutput,
  buildRetryMessage,
  countWords,
  SYNTHESIS_MODEL_CONFIG,
} from "../profile-synthesis-prompt";

// --- Test fixtures ---

/** A minimal valid synthesis input for a wet-lab researcher. */
function makeTestInput(
  overrides: Partial<SynthesisInput> = {},
): SynthesisInput {
  return {
    name: "Jane Doe",
    affiliation: "Stanford University, Department of Genetics",
    labWebsite: "https://doe-lab.stanford.edu",
    grantTitles: [
      "CRISPR-Based Approaches for Treating Sickle Cell Disease",
      "Functional Genomics of Drug Resistance in AML",
    ],
    publications: [
      {
        title: "CRISPR screening identifies drug resistance genes in AML",
        journal: "Nature",
        year: 2024,
        authorPosition: "last",
        abstract:
          "We performed genome-wide CRISPR-Cas9 knockout screens in AML cell lines to identify genes that confer resistance to targeted therapies.",
      },
      {
        title: "Single-cell RNA-seq reveals heterogeneity in leukemic blasts",
        journal: "Cell",
        year: 2023,
        authorPosition: "last",
        abstract:
          "Using single-cell transcriptomics, we characterized the cellular heterogeneity of AML blasts and identified distinct subpopulations.",
        methodsText:
          "Single-cell RNA sequencing was performed using the 10x Genomics Chromium platform. Libraries were sequenced on the Illumina NovaSeq 6000.",
      },
      {
        title: "Epigenetic regulation of fetal hemoglobin in sickle cell disease",
        journal: "Blood",
        year: 2022,
        authorPosition: "first",
        abstract:
          "We investigated the epigenetic mechanisms controlling fetal hemoglobin expression using ChIP-seq and ATAC-seq in primary erythroid cells.",
      },
    ],
    userSubmittedTexts: [
      {
        label: "Current Research Focus",
        content:
          "We are expanding our CRISPR screening platform to include base editing and prime editing approaches for therapeutic applications in hemoglobinopathies.",
      },
    ],
    ...overrides,
  };
}

/** A valid LLM output for the wet-lab researcher fixture. */
function makeValidOutput(
  overrides: Partial<SynthesisOutput> = {},
): SynthesisOutput {
  // Generate exactly 160 words for the summary
  const summary =
    "The Doe laboratory integrates functional genomics and gene editing approaches to study hematological malignancies and hemoglobinopathies. " +
    "Using genome-wide CRISPR-Cas9 knockout screens in acute myeloid leukemia cell lines, the lab identifies genetic determinants of drug resistance " +
    "to targeted therapies, providing mechanistic insight into treatment failure. Complementary single-cell RNA sequencing approaches reveal the " +
    "transcriptomic heterogeneity of leukemic blast populations, identifying distinct subpopulations that may differentially respond to therapy. " +
    "In parallel, the lab investigates epigenetic regulation of fetal hemoglobin expression in sickle cell disease through ChIP-seq and ATAC-seq " +
    "profiling of primary erythroid cells, aiming to identify druggable targets for hemoglobin switching. The research program bridges basic chromatin " +
    "biology with translational gene editing strategies, leveraging high-throughput screening platforms to prioritize therapeutic targets. " +
    "Recent work has expanded to include novel genome editing modalities for therapeutic applications in hemoglobinopathies, reflecting the lab's " +
    "commitment to developing clinically relevant genetic tools for blood disorders. The integration of computational analysis with experimental " +
    "validation enables systematic target discovery across multiple disease contexts.";

  return {
    research_summary: summary,
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
    disease_areas: [
      "acute myeloid leukemia",
      "sickle cell disease",
    ],
    key_targets: [
      "BCL2",
      "fetal hemoglobin (HbF)",
      "BCL11A",
    ],
    keywords: [
      "drug resistance",
      "functional genomics",
      "gene therapy",
    ],
    ...overrides,
  };
}

// --- Tests ---

describe("profile-synthesis-prompt", () => {
  describe("getSystemMessage", () => {
    it("returns the system prompt with role and specificity instructions", () => {
      const msg = getSystemMessage();
      expect(msg).toContain("scientific profile synthesizer");
      expect(msg).toContain("SPECIFIC");
      expect(msg).toContain("collaboration");
    });
  });

  describe("SYNTHESIS_MODEL_CONFIG", () => {
    /** Ensures model config matches specs: Claude Opus, low temperature, bounded output. */
    it("specifies Claude Opus with appropriate parameters", () => {
      expect(SYNTHESIS_MODEL_CONFIG.model).toMatch(/^claude-opus/);
      expect(SYNTHESIS_MODEL_CONFIG.maxTokens).toBe(2000);
      expect(SYNTHESIS_MODEL_CONFIG.temperature).toBe(0.3);
    });
  });

  describe("selectPublicationsForSynthesis", () => {
    /** Verifies that last-author papers are prioritized over first and middle. */
    it("prioritizes last-author papers over first and middle", () => {
      const pubs: SynthesisPublication[] = [
        {
          title: "Middle paper",
          journal: "J1",
          year: 2024,
          authorPosition: "middle",
          abstract: "...",
        },
        {
          title: "First paper",
          journal: "J2",
          year: 2024,
          authorPosition: "first",
          abstract: "...",
        },
        {
          title: "Last paper",
          journal: "J3",
          year: 2024,
          authorPosition: "last",
          abstract: "...",
        },
      ];

      const selected = selectPublicationsForSynthesis(pubs);
      expect(selected[0]!.title).toBe("Last paper");
      expect(selected[1]!.title).toBe("First paper");
      expect(selected[2]!.title).toBe("Middle paper");
    });

    /** Within the same author position, more recent papers should come first. */
    it("sorts by recency within same author position", () => {
      const pubs: SynthesisPublication[] = [
        {
          title: "Old last",
          journal: "J1",
          year: 2020,
          authorPosition: "last",
          abstract: "...",
        },
        {
          title: "New last",
          journal: "J2",
          year: 2024,
          authorPosition: "last",
          abstract: "...",
        },
        {
          title: "Mid last",
          journal: "J3",
          year: 2022,
          authorPosition: "last",
          abstract: "...",
        },
      ];

      const selected = selectPublicationsForSynthesis(pubs);
      expect(selected[0]!.title).toBe("New last");
      expect(selected[1]!.title).toBe("Mid last");
      expect(selected[2]!.title).toBe("Old last");
    });

    /** Ensures no more than 30 publications are returned. */
    it("caps at 30 publications", () => {
      const pubs: SynthesisPublication[] = Array.from({ length: 50 }, (_, i) => ({
        title: `Paper ${i}`,
        journal: "J",
        year: 2020 + (i % 5),
        authorPosition: "middle" as const,
        abstract: "...",
      }));

      const selected = selectPublicationsForSynthesis(pubs);
      expect(selected.length).toBe(30);
    });

    /** Empty input should return empty array. */
    it("returns empty array for empty input", () => {
      expect(selectPublicationsForSynthesis([])).toEqual([]);
    });
  });

  describe("buildUserMessage", () => {
    /** The prompt should contain all sections of researcher data. */
    it("includes all input sections in the output", () => {
      const input = makeTestInput();
      const msg = buildUserMessage(input);

      // Researcher info
      expect(msg).toContain("Jane Doe");
      expect(msg).toContain("Stanford University, Department of Genetics");
      expect(msg).toContain("https://doe-lab.stanford.edu");

      // Grant titles
      expect(msg).toContain("CRISPR-Based Approaches for Treating Sickle Cell Disease");
      expect(msg).toContain("Functional Genomics of Drug Resistance in AML");

      // Publications
      expect(msg).toContain("CRISPR screening identifies drug resistance genes in AML");
      expect(msg).toContain("(Nature, 2024)");
      expect(msg).toContain("[last author]");

      // Methods sections
      expect(msg).toContain("Methods Sections");
      expect(msg).toContain("10x Genomics Chromium platform");

      // User-submitted texts
      expect(msg).toContain("Researcher-Submitted Priorities");
      expect(msg).toContain("Current Research Focus");
      expect(msg).toContain("base editing and prime editing");

      // Instructions
      expect(msg).toContain("Research Summary (150-250 words)");
      expect(msg).toContain("Anti-plagiarism");
      expect(msg).toContain("Return ONLY valid JSON");
    });

    /** When no lab website is provided, it should be omitted from the prompt. */
    it("omits lab website when not provided", () => {
      const input = makeTestInput({ labWebsite: undefined });
      const msg = buildUserMessage(input);
      expect(msg).not.toContain("Lab Website");
    });

    /** When there are no grants, the grants section should be omitted. */
    it("omits grants section when empty", () => {
      const input = makeTestInput({ grantTitles: [] });
      const msg = buildUserMessage(input);
      expect(msg).not.toContain("=== Grant Titles ===");
    });

    /** When there are no user-submitted texts, the section should be omitted. */
    it("omits user-submitted texts section when empty", () => {
      const input = makeTestInput({ userSubmittedTexts: [] });
      const msg = buildUserMessage(input);
      expect(msg).not.toContain("Researcher-Submitted Priorities");
    });

    /** When there are no publications, neither the publications nor methods sections should appear. */
    it("omits publications and methods when empty", () => {
      const input = makeTestInput({ publications: [] });
      const msg = buildUserMessage(input);
      expect(msg).not.toContain("=== Publications");
      expect(msg).not.toContain("=== Methods Sections");
    });

    /** Methods sections should only appear for publications that have them. */
    it("only includes methods for publications that have them", () => {
      const input = makeTestInput({
        publications: [
          {
            title: "Paper without methods",
            journal: "J1",
            year: 2024,
            authorPosition: "last",
            abstract: "Abstract text.",
          },
        ],
      });
      const msg = buildUserMessage(input);
      expect(msg).toContain("Paper without methods");
      expect(msg).not.toContain("Methods Sections");
    });

    /** Long methods texts should be truncated to prevent context overflow. */
    it("truncates long methods texts", () => {
      const longMethods = Array(2500).fill("word").join(" ");
      const input = makeTestInput({
        publications: [
          {
            title: "Paper with long methods",
            journal: "J1",
            year: 2024,
            authorPosition: "last",
            abstract: "Abstract.",
            methodsText: longMethods,
          },
        ],
      });
      const msg = buildUserMessage(input);
      expect(msg).toContain("[truncated]");
      // The truncated text should have ~2000 words, not 2500
      const methodsMatch = msg.match(/From "Paper with long methods":\s+([\s\S]*?)\n\n/);
      expect(methodsMatch).not.toBeNull();
    });
  });

  describe("parseSynthesisOutput", () => {
    /** Valid JSON should be parsed successfully. */
    it("parses valid JSON output", () => {
      const output = makeValidOutput();
      const raw = JSON.stringify(output);
      const parsed = parseSynthesisOutput(raw);

      expect(parsed.research_summary).toBe(output.research_summary);
      expect(parsed.techniques).toEqual(output.techniques);
      expect(parsed.experimental_models).toEqual(output.experimental_models);
      expect(parsed.disease_areas).toEqual(output.disease_areas);
      expect(parsed.key_targets).toEqual(output.key_targets);
      expect(parsed.keywords).toEqual(output.keywords);
    });

    /** LLMs sometimes wrap JSON in markdown code fences — these should be stripped. */
    it("strips markdown code fences", () => {
      const output = makeValidOutput();
      const raw = "```json\n" + JSON.stringify(output) + "\n```";
      const parsed = parseSynthesisOutput(raw);
      expect(parsed.research_summary).toBe(output.research_summary);
    });

    /** Code fences without language tag should also be stripped. */
    it("strips code fences without language tag", () => {
      const output = makeValidOutput();
      const raw = "```\n" + JSON.stringify(output) + "\n```";
      const parsed = parseSynthesisOutput(raw);
      expect(parsed.techniques).toEqual(output.techniques);
    });

    /** LLMs sometimes produce trailing commas in JSON — these should be handled. */
    it("handles trailing commas in arrays", () => {
      const raw = `{
        "research_summary": "Test summary words.",
        "techniques": ["RNA-seq", "ChIP-seq",],
        "experimental_models": ["K562",],
        "disease_areas": ["AML",],
        "key_targets": ["BCL2",],
        "keywords": ["test",]
      }`;
      const parsed = parseSynthesisOutput(raw);
      expect(parsed.techniques).toEqual(["RNA-seq", "ChIP-seq"]);
    });

    /** Empty strings in arrays should be filtered out during parsing. */
    it("filters out empty strings from arrays", () => {
      const output = makeValidOutput({
        techniques: ["RNA-seq", "", "  ", "ChIP-seq"],
      });
      const parsed = parseSynthesisOutput(JSON.stringify(output));
      expect(parsed.techniques).toEqual(["RNA-seq", "ChIP-seq"]);
    });

    /** Duplicate entries (case-insensitive) should be deduplicated. */
    it("deduplicates array entries case-insensitively", () => {
      const output = makeValidOutput({
        techniques: ["RNA-seq", "rna-seq", "RNA-SEQ", "ChIP-seq"],
      });
      const parsed = parseSynthesisOutput(JSON.stringify(output));
      expect(parsed.techniques).toEqual(["RNA-seq", "ChIP-seq"]);
    });

    /** Non-JSON output should throw a clear error. */
    it("throws on invalid JSON", () => {
      expect(() => parseSynthesisOutput("not json")).toThrow(
        "Failed to parse synthesis output as JSON",
      );
    });

    /** Arrays are not valid top-level output. */
    it("throws on array instead of object", () => {
      expect(() => parseSynthesisOutput("[]")).toThrow(
        "Synthesis output must be a JSON object",
      );
    });

    /** Missing required fields should throw. */
    it("throws when required fields are missing", () => {
      const incomplete = JSON.stringify({
        research_summary: "test",
        techniques: [],
      });
      expect(() => parseSynthesisOutput(incomplete)).toThrow(
        "Missing required field",
      );
    });

    /** research_summary must be a string, not an array or number. */
    it("throws when research_summary is not a string", () => {
      const output = {
        research_summary: 42,
        techniques: [],
        experimental_models: [],
        disease_areas: [],
        key_targets: [],
        keywords: [],
      };
      expect(() => parseSynthesisOutput(JSON.stringify(output))).toThrow(
        "research_summary must be a string",
      );
    });

    /** Array fields must actually be arrays, not strings. */
    it("throws when array fields are not arrays", () => {
      const output = {
        research_summary: "test",
        techniques: "not an array",
        experimental_models: [],
        disease_areas: [],
        key_targets: [],
        keywords: [],
      };
      expect(() => parseSynthesisOutput(JSON.stringify(output))).toThrow(
        "techniques must be an array",
      );
    });

    /** Leading/trailing whitespace in the summary should be trimmed. */
    it("trims whitespace from research_summary", () => {
      const output = makeValidOutput({
        research_summary: "  Summary with whitespace  ",
      });
      const parsed = parseSynthesisOutput(JSON.stringify(output));
      expect(parsed.research_summary).toBe("Summary with whitespace");
    });
  });

  describe("countWords", () => {
    /** Basic word counting with simple spaces. */
    it("counts words in a simple string", () => {
      expect(countWords("one two three")).toBe(3);
    });

    /** Empty strings should have zero words. */
    it("returns 0 for empty string", () => {
      expect(countWords("")).toBe(0);
      expect(countWords("   ")).toBe(0);
    });

    /** Multiple spaces and newlines should be treated as single separators. */
    it("handles multiple whitespace characters", () => {
      expect(countWords("one  two\n\nthree\tfour")).toBe(4);
    });
  });

  describe("validateSynthesisOutput", () => {
    /** A fully valid output should pass validation. */
    it("accepts valid output", () => {
      const output = makeValidOutput();
      const result = validateSynthesisOutput(output);
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
      expect(result.summaryWordCount).toBeGreaterThanOrEqual(150);
      expect(result.summaryWordCount).toBeLessThanOrEqual(250);
    });

    /** Summary below 150 words should fail validation. */
    it("rejects summary with too few words", () => {
      const output = makeValidOutput({
        research_summary: "This is a very short summary.",
      });
      const result = validateSynthesisOutput(output);
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.field === "research_summary")).toBe(
        true,
      );
      expect(
        result.errors.some((e) => e.message.includes("at least 150")),
      ).toBe(true);
    });

    /** Summary above 250 words should fail validation. */
    it("rejects summary with too many words", () => {
      const longSummary = Array(300).fill("word").join(" ");
      const output = makeValidOutput({ research_summary: longSummary });
      const result = validateSynthesisOutput(output);
      expect(result.valid).toBe(false);
      expect(
        result.errors.some((e) => e.message.includes("at most 250")),
      ).toBe(true);
    });

    /** Fewer than 3 techniques should fail validation. */
    it("rejects fewer than 3 techniques", () => {
      const output = makeValidOutput({ techniques: ["RNA-seq", "ChIP-seq"] });
      const result = validateSynthesisOutput(output);
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.field === "techniques")).toBe(true);
      expect(result.techniquesCount).toBe(2);
    });

    /** Zero disease areas should fail validation. */
    it("rejects empty disease_areas", () => {
      const output = makeValidOutput({ disease_areas: [] });
      const result = validateSynthesisOutput(output);
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.field === "disease_areas")).toBe(true);
      expect(result.diseaseAreasCount).toBe(0);
    });

    /** Zero key targets should fail validation. */
    it("rejects empty key_targets", () => {
      const output = makeValidOutput({ key_targets: [] });
      const result = validateSynthesisOutput(output);
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.field === "key_targets")).toBe(true);
      expect(result.keyTargetsCount).toBe(0);
    });

    /** Empty keywords are acceptable — the field is optional. */
    it("accepts empty keywords array (optional field)", () => {
      const output = makeValidOutput({ keywords: [] });
      const result = validateSynthesisOutput(output);
      // Keywords should not cause validation failure
      expect(result.errors.some((e) => e.field === "keywords")).toBe(false);
    });

    /** Multiple errors can occur simultaneously. */
    it("reports multiple errors at once", () => {
      const output = makeValidOutput({
        research_summary: "Too short.",
        techniques: ["one"],
        disease_areas: [],
        key_targets: [],
      });
      const result = validateSynthesisOutput(output);
      expect(result.valid).toBe(false);
      expect(result.errors.length).toBeGreaterThanOrEqual(4);
    });
  });

  describe("buildRetryMessage", () => {
    /** The retry prompt should list all validation errors with current counts. */
    it("includes all error messages and counts", () => {
      const output = makeValidOutput({
        research_summary: "Too short.",
        techniques: ["one"],
        disease_areas: [],
        key_targets: [],
      });
      const validation = validateSynthesisOutput(output);
      const retry = buildRetryMessage(validation);

      // Should mention specific errors
      expect(retry).toContain("did not pass validation");
      expect(retry).toContain("at least 150");

      // Should include current counts
      expect(retry).toContain(`yours was ${validation.summaryWordCount} words`);
      expect(retry).toContain(`yours had ${validation.techniquesCount}`);
      expect(retry).toContain(`yours had ${validation.diseaseAreasCount}`);
      expect(retry).toContain(`yours had ${validation.keyTargetsCount}`);

      // Should instruct on output format
      expect(retry).toContain("Return ONLY valid JSON");
    });

    /** Even with no errors, the retry prompt should still include requirements. */
    it("still includes requirements section even with few errors", () => {
      const output = makeValidOutput({ techniques: ["one", "two"] });
      const validation = validateSynthesisOutput(output);
      const retry = buildRetryMessage(validation);

      expect(retry).toContain("Requirements:");
      expect(retry).toContain("research_summary MUST be 150-250 words");
    });
  });

  describe("integration: buildUserMessage → parseSynthesisOutput → validateSynthesisOutput", () => {
    /** End-to-end: building a prompt and validating a well-formed response. */
    it("produces a valid prompt and accepts a valid response", () => {
      const input = makeTestInput();
      const msg = buildUserMessage(input);

      // Prompt should be a non-trivial string
      expect(msg.length).toBeGreaterThan(500);

      // Simulate a valid LLM response
      const output = makeValidOutput();
      const parsed = parseSynthesisOutput(JSON.stringify(output));
      const validation = validateSynthesisOutput(parsed);

      expect(validation.valid).toBe(true);
    });

    /** Minimal input (no grants, no methods, no user texts) should still produce a valid prompt. */
    it("handles minimal input (no optional data)", () => {
      const input = makeTestInput({
        labWebsite: undefined,
        grantTitles: [],
        userSubmittedTexts: [],
        publications: [
          {
            title: "Only paper",
            journal: "Science",
            year: 2024,
            authorPosition: "first",
            abstract: "We studied something interesting.",
          },
        ],
      });
      const msg = buildUserMessage(input);

      // Should still produce a valid prompt with instructions
      expect(msg).toContain("Only paper");
      expect(msg).toContain("Return ONLY valid JSON");
      expect(msg).not.toContain("Grant Titles");
      expect(msg).not.toContain("Researcher-Submitted Priorities");
    });
  });
});
