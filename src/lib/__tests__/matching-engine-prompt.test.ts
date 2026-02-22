/**
 * Tests for the matching engine prompt builder and output validator.
 *
 * Validates that:
 * - Abstracts are selected and ordered by author position and recency
 * - The per-pair prompt context is correctly assembled for both researchers
 * - Existing proposals are included for de-duplication
 * - LLM output is correctly parsed as a JSON array
 * - Individual proposals are validated against the required schema
 * - Invalid proposals are filtered out while valid ones are kept
 * - Retry prompts are generated for JSON parse failures
 * - Edge cases (empty inputs, malformed JSON, code fences) are handled
 */

import {
  type MatchingInput,
  type MatchingPublication,
  type ProposalOutput,
  type ResearcherContext,
  selectAbstractsForMatching,
  buildMatchingUserMessage,
  getMatchingSystemMessage,
  parseMatchingOutput,
  validateProposal,
  filterValidProposals,
  buildMatchingRetryMessage,
  MATCHING_MODEL_CONFIG,
} from "../matching-engine-prompt";

// --- Test fixtures ---

/** Creates a minimal valid publication for testing. */
function makePub(
  overrides: Partial<MatchingPublication> = {},
): MatchingPublication {
  return {
    title: "Test Publication",
    journal: "Nature",
    year: 2024,
    authorPosition: "last",
    abstract: "This paper describes important findings about protein X.",
    ...overrides,
  };
}

/** Creates a researcher context with realistic data for testing. */
function makeResearcher(
  overrides: Partial<ResearcherContext> = {},
): ResearcherContext {
  return {
    name: "Jane Doe",
    institution: "Stanford University",
    department: "Department of Genetics",
    researchSummary:
      "The Doe lab studies CRISPR-based gene editing approaches for hematological malignancies. Using genome-wide knockout screens in AML cell lines, the lab identifies genetic determinants of drug resistance.",
    techniques: ["CRISPR-Cas9 knockout screens", "single-cell RNA sequencing", "ChIP-seq"],
    experimentalModels: ["AML cell lines", "primary erythroid cells"],
    diseaseAreas: ["acute myeloid leukemia", "sickle cell disease"],
    keyTargets: ["BCL2", "BCL11A", "fetal hemoglobin"],
    keywords: ["drug resistance", "functional genomics"],
    grantTitles: ["CRISPR-Based Approaches for Treating Sickle Cell Disease"],
    userSubmittedTexts: [
      {
        label: "Current Focus",
        content: "Expanding base editing approaches for hemoglobinopathies.",
      },
    ],
    publications: [
      makePub({
        title: "CRISPR screening identifies drug resistance genes in AML",
        journal: "Nature",
        year: 2024,
        authorPosition: "last",
        abstract:
          "We performed genome-wide CRISPR-Cas9 knockout screens in AML cell lines to identify genes conferring resistance to targeted therapies.",
      }),
      makePub({
        title: "Single-cell RNA-seq reveals heterogeneity in leukemic blasts",
        journal: "Cell",
        year: 2023,
        authorPosition: "last",
        abstract:
          "Using single-cell transcriptomics, we characterized heterogeneity of AML blasts and identified distinct subpopulations.",
      }),
      makePub({
        title: "Epigenetic regulation of fetal hemoglobin",
        journal: "Blood",
        year: 2022,
        authorPosition: "first",
        abstract:
          "We investigated epigenetic mechanisms controlling fetal hemoglobin expression using ChIP-seq and ATAC-seq.",
      }),
    ],
    ...overrides,
  };
}

/** Creates a second researcher to form a pair. */
function makeResearcherB(
  overrides: Partial<ResearcherContext> = {},
): ResearcherContext {
  return {
    name: "John Smith",
    institution: "UCSD",
    department: "Department of Chemistry",
    researchSummary:
      "The Smith lab develops computational drug design tools using AutoDock and molecular dynamics simulations to model protein-ligand interactions.",
    techniques: ["molecular docking", "molecular dynamics", "pharmacophore modeling"],
    experimentalModels: ["PDB structures", "GPCR homology models"],
    diseaseAreas: ["osteoarthritis", "GPCR pharmacology"],
    keyTargets: ["H1R", "AutoDock-GPU"],
    keywords: ["structure-based drug design", "virtual screening"],
    grantTitles: ["Computational Approaches to GPCR Drug Design"],
    userSubmittedTexts: [],
    publications: [
      makePub({
        title: "AutoDock-GPU: high-performance molecular docking",
        journal: "JCTC",
        year: 2024,
        authorPosition: "last",
        abstract:
          "We present AutoDock-GPU, a GPU-accelerated molecular docking platform for high-throughput virtual screening.",
      }),
    ],
    ...overrides,
  };
}

/** Creates a complete matching input fixture. */
function makeMatchingInput(
  overrides: Partial<MatchingInput> = {},
): MatchingInput {
  return {
    researcherA: makeResearcher(),
    researcherB: makeResearcherB(),
    existingProposals: [],
    ...overrides,
  };
}

/** Creates a valid proposal output matching the LLM's expected JSON format. */
function makeValidProposal(
  overrides: Partial<ProposalOutput> = {},
): ProposalOutput {
  return {
    title: "Computational Optimization of Drug Resistance Targets in AML",
    collaboration_type: "methodological enhancement",
    scientific_question:
      "Can structure-based drug design identify compounds that overcome CRISPR-identified resistance mutations in AML?",
    one_line_summary_a:
      "Smith's AutoDock-GPU platform could computationally screen compounds targeting your CRISPR-identified resistance genes in AML.",
    one_line_summary_b:
      "Doe's CRISPR resistance screens provide validated protein targets ideal for your structure-based drug design pipeline.",
    detailed_rationale:
      "Doe's CRISPR screens have identified specific genes conferring drug resistance in AML. Smith's AutoDock platform can model these protein targets and screen compound libraries. Together, they could identify compounds that overcome resistance mechanisms, combining biological target validation with computational drug design.",
    lab_a_contributions:
      "CRISPR-identified resistance gene targets, AML cell lines for compound validation, drug sensitivity assays",
    lab_b_contributions:
      "AutoDock-GPU docking platform, virtual screening infrastructure, pharmacophore models for resistance targets",
    lab_a_benefits:
      "Computationally prioritized compounds targeting resistance mechanisms, reducing experimental screening burden",
    lab_b_benefits:
      "Biologically validated targets from CRISPR screens, expanding the drug design pipeline to oncology applications",
    proposed_first_experiment:
      "Doe Lab provides crystal structures or homology models for 3-5 top resistance targets from CRISPR screens. Smith Lab performs docking of an FDA-approved compound library against these targets. Key readout: ranked compound lists with predicted binding affinities. Doe Lab validates top 10 compounds in AML drug sensitivity assays.",
    anchoring_publication_pmids: ["12345678"],
    confidence_tier: "high",
    reasoning:
      "Good match: complementary capabilities, specific targets from CRISPR screens, concrete first experiment with clear readouts.",
    ...overrides,
  };
}

// --- Tests ---

describe("matching-engine-prompt", () => {
  describe("MATCHING_MODEL_CONFIG", () => {
    /** Ensures model config uses Claude Opus with appropriate parameters for creative proposal generation. */
    it("specifies Claude Opus with matching-appropriate parameters", () => {
      expect(MATCHING_MODEL_CONFIG.model).toMatch(/^claude-opus/);
      expect(MATCHING_MODEL_CONFIG.maxTokens).toBe(4096);
      expect(MATCHING_MODEL_CONFIG.temperature).toBe(0.5);
    });
  });

  describe("getMatchingSystemMessage", () => {
    /** The system message must contain all core components: role, anti-genericity rules, output schema, and examples. */
    it("includes role, instructions, anti-genericity rules, and examples", () => {
      const msg = getMatchingSystemMessage();

      // Role
      expect(msg).toContain("scientific collaboration proposal engine");

      // Core instructions
      expect(msg).toContain("SPECIFIC and SYNERGISTIC");
      expect(msg).toContain("empty array []");
      expect(msg).toContain("Maximum 3 proposals");
      expect(msg).toContain("Do NOT quote or directly reference user-submitted text");

      // Anti-genericity
      expect(msg).toContain("generic service");
      expect(msg).toContain("hiring a postdoc");

      // Output schema
      expect(msg).toContain("collaboration_type");
      expect(msg).toContain("proposed_first_experiment");
      expect(msg).toContain("anchoring_publication_pmids");
      expect(msg).toContain("confidence_tier");

      // Good examples
      expect(msg).toContain("Computational Optimization of H1R Inverse Agonists");
      expect(msg).toContain("Synergistic Neuroprotection via Atypical Tetracyclines");
      expect(msg).toContain("Cryo-ET Visualization of HRI-Induced Mitochondrial Remodeling");

      // Bad examples
      expect(msg).toContain("generic service");
      expect(msg).toContain("Shared interest is not synergy");
      expect(msg).toContain("abstract statement of potential");
    });

    /** Confidence tier definitions must be present so the LLM self-classifies proposals. */
    it("includes confidence tier definitions", () => {
      const msg = getMatchingSystemMessage();
      expect(msg).toContain("**high**");
      expect(msg).toContain("**moderate**");
      expect(msg).toContain("**speculative**");
    });
  });

  describe("selectAbstractsForMatching", () => {
    /** Last-author papers should be prioritized over first and middle for abstract selection. */
    it("prioritizes last-author papers over first and middle", () => {
      const pubs: MatchingPublication[] = [
        makePub({ title: "Middle", authorPosition: "middle", year: 2024 }),
        makePub({ title: "First", authorPosition: "first", year: 2024 }),
        makePub({ title: "Last", authorPosition: "last", year: 2024 }),
      ];

      const selected = selectAbstractsForMatching(pubs);
      expect(selected[0]!.title).toBe("Last");
      expect(selected[1]!.title).toBe("First");
      expect(selected[2]!.title).toBe("Middle");
    });

    /** Within the same author position, more recent papers should come first. */
    it("sorts by recency within same author position", () => {
      const pubs: MatchingPublication[] = [
        makePub({ title: "Old", authorPosition: "last", year: 2020 }),
        makePub({ title: "New", authorPosition: "last", year: 2024 }),
        makePub({ title: "Mid", authorPosition: "last", year: 2022 }),
      ];

      const selected = selectAbstractsForMatching(pubs);
      expect(selected[0]!.title).toBe("New");
      expect(selected[1]!.title).toBe("Mid");
      expect(selected[2]!.title).toBe("Old");
    });

    /** Publications without abstracts should be excluded from abstract selection. */
    it("excludes publications with empty abstracts", () => {
      const pubs: MatchingPublication[] = [
        makePub({ title: "Has abstract", abstract: "Findings about X." }),
        makePub({ title: "Empty abstract", abstract: "" }),
        makePub({ title: "Whitespace abstract", abstract: "   " }),
        makePub({ title: "Also has abstract", abstract: "More findings." }),
      ];

      const selected = selectAbstractsForMatching(pubs);
      expect(selected).toHaveLength(2);
      expect(selected.map((p) => p.title)).toEqual([
        "Has abstract",
        "Also has abstract",
      ]);
    });

    /** At most 10 abstracts should be returned regardless of input size. */
    it("caps at 10 abstracts", () => {
      const pubs = Array.from({ length: 25 }, (_, i) =>
        makePub({
          title: `Paper ${i}`,
          year: 2000 + i,
          authorPosition: "last",
          abstract: `Abstract for paper ${i}.`,
        }),
      );

      const selected = selectAbstractsForMatching(pubs);
      expect(selected).toHaveLength(10);
      // Should be the 10 most recent
      expect(selected[0]!.year).toBe(2024);
      expect(selected[9]!.year).toBe(2015);
    });

    /** Empty input should return empty array. */
    it("returns empty array for empty input", () => {
      expect(selectAbstractsForMatching([])).toEqual([]);
    });
  });

  describe("buildMatchingUserMessage", () => {
    /** The user message should contain both researchers' full context. */
    it("includes both researchers with all profile fields", () => {
      const input = makeMatchingInput();
      const msg = buildMatchingUserMessage(input);

      // Researcher A
      expect(msg).toContain("=== Researcher A ===");
      expect(msg).toContain("Jane Doe");
      expect(msg).toContain("Stanford University");
      expect(msg).toContain("Department of Genetics");
      expect(msg).toContain("CRISPR-based gene editing");
      expect(msg).toContain("CRISPR-Cas9 knockout screens");
      expect(msg).toContain("AML cell lines");
      expect(msg).toContain("acute myeloid leukemia");
      expect(msg).toContain("BCL2");
      expect(msg).toContain("drug resistance");
      expect(msg).toContain("CRISPR-Based Approaches for Treating Sickle Cell Disease");
      expect(msg).toContain("Current Focus");
      expect(msg).toContain("Expanding base editing approaches");

      // Researcher B
      expect(msg).toContain("=== Researcher B ===");
      expect(msg).toContain("John Smith");
      expect(msg).toContain("UCSD");
      expect(msg).toContain("Department of Chemistry");
      expect(msg).toContain("AutoDock-GPU");
    });

    /** Publication titles should be listed for all publications (most recent first). */
    it("includes all publication titles sorted by recency", () => {
      const input = makeMatchingInput();
      const msg = buildMatchingUserMessage(input);

      // All 3 of researcher A's pubs should appear in the title list
      expect(msg).toContain("CRISPR screening identifies drug resistance genes in AML");
      expect(msg).toContain("Single-cell RNA-seq reveals heterogeneity");
      expect(msg).toContain("Epigenetic regulation of fetal hemoglobin");

      // Researcher B's pub
      expect(msg).toContain("AutoDock-GPU: high-performance molecular docking");
    });

    /** Selected abstracts section should appear with full abstract text. */
    it("includes selected abstracts with full text", () => {
      const input = makeMatchingInput();
      const msg = buildMatchingUserMessage(input);

      expect(msg).toContain("Selected Abstracts");
      expect(msg).toContain("genome-wide CRISPR-Cas9 knockout screens");
    });

    /** When no department is set, it should be omitted from the researcher block. */
    it("omits department when not provided", () => {
      const input = makeMatchingInput({
        researcherA: makeResearcher({ department: undefined }),
      });
      const msg = buildMatchingUserMessage(input);

      // Should NOT have "Department:" for researcher A
      const resABlock = msg.split("=== Researcher B ===")[0]!;
      expect(resABlock).not.toContain("Department:");
    });

    /** When no grants are present, the grant section should be omitted. */
    it("omits grant titles section when empty", () => {
      const input = makeMatchingInput({
        researcherA: makeResearcher({ grantTitles: [] }),
      });
      const msg = buildMatchingUserMessage(input);

      const resABlock = msg.split("=== Researcher B ===")[0]!;
      expect(resABlock).not.toContain("Grant Titles:");
    });

    /** When no user-submitted texts exist, the section should be omitted. */
    it("omits user-submitted texts section when empty", () => {
      const input = makeMatchingInput({
        researcherB: makeResearcherB({ userSubmittedTexts: [] }),
      });
      const msg = buildMatchingUserMessage(input);

      // Researcher B has no user-submitted texts by default
      const resBBlock = msg.split("=== Researcher B ===")[1]!;
      expect(resBBlock).not.toContain("User-Submitted Priorities:");
    });

    /** When there are no publications, the titles and abstracts sections should be omitted. */
    it("omits publication sections when no publications", () => {
      const input = makeMatchingInput({
        researcherA: makeResearcher({ publications: [] }),
      });
      const msg = buildMatchingUserMessage(input);

      const resABlock = msg.split("=== Researcher B ===")[0]!;
      expect(resABlock).not.toContain("Publication Titles");
      expect(resABlock).not.toContain("Selected Abstracts");
    });

    /** Empty arrays for profile fields should show "(none)" instead of blank. */
    it("shows (none) for empty profile array fields", () => {
      const input = makeMatchingInput({
        researcherA: makeResearcher({
          techniques: [],
          experimentalModels: [],
          keywords: [],
        }),
      });
      const msg = buildMatchingUserMessage(input);
      expect(msg).toContain("Techniques: (none)");
      expect(msg).toContain("Experimental Models: (none)");
      expect(msg).toContain("Keywords: (none)");
    });
  });

  describe("buildMatchingUserMessage with existing proposals", () => {
    /** Existing proposals should be included for de-duplication. */
    it("includes existing proposals for de-duplication", () => {
      const input = makeMatchingInput({
        existingProposals: [
          {
            title: "Previous Collaboration Proposal",
            scientificQuestion: "Can we combine CRISPR with docking?",
          },
          {
            title: "Another Prior Proposal",
            scientificQuestion: "Do drug resistance genes have druggable structures?",
          },
        ],
      });
      const msg = buildMatchingUserMessage(input);

      expect(msg).toContain("=== Existing Proposals for This Pair ===");
      expect(msg).toContain("Propose something DISTINCT or return nothing");
      expect(msg).toContain("Previous Collaboration Proposal");
      expect(msg).toContain("Can we combine CRISPR with docking?");
      expect(msg).toContain("Another Prior Proposal");
    });

    /** When no existing proposals, the section should be omitted entirely. */
    it("omits existing proposals section when empty", () => {
      const input = makeMatchingInput({ existingProposals: [] });
      const msg = buildMatchingUserMessage(input);

      expect(msg).not.toContain("=== Existing Proposals");
    });
  });

  describe("parseMatchingOutput", () => {
    /** Valid JSON array of proposals should parse successfully. */
    it("parses valid JSON array of proposals", () => {
      const proposals = [makeValidProposal()];
      const raw = JSON.stringify(proposals);
      const parsed = parseMatchingOutput(raw);

      expect(parsed).toHaveLength(1);
      expect(parsed[0]!.title).toBe(
        "Computational Optimization of Drug Resistance Targets in AML",
      );
    });

    /** Empty array is a valid response (no quality proposals). */
    it("parses empty array (no proposals)", () => {
      const parsed = parseMatchingOutput("[]");
      expect(parsed).toEqual([]);
    });

    /** Multiple proposals should all be parsed. */
    it("parses multiple proposals", () => {
      const proposals = [
        makeValidProposal({ title: "Proposal 1" }),
        makeValidProposal({ title: "Proposal 2" }),
        makeValidProposal({ title: "Proposal 3" }),
      ];
      const parsed = parseMatchingOutput(JSON.stringify(proposals));
      expect(parsed).toHaveLength(3);
    });

    /** LLMs sometimes wrap output in markdown code fences — these should be stripped. */
    it("strips markdown code fences", () => {
      const proposals = [makeValidProposal()];
      const raw = "```json\n" + JSON.stringify(proposals) + "\n```";
      const parsed = parseMatchingOutput(raw);
      expect(parsed).toHaveLength(1);
    });

    /** Code fences without language tag should also be stripped. */
    it("strips code fences without language tag", () => {
      const proposals = [makeValidProposal()];
      const raw = "```\n" + JSON.stringify(proposals) + "\n```";
      const parsed = parseMatchingOutput(raw);
      expect(parsed).toHaveLength(1);
    });

    /** Trailing commas in JSON should be handled gracefully. */
    it("handles trailing commas", () => {
      const raw = `[
        {
          "title": "Test",
          "collaboration_type": "mechanistic extension",
          "scientific_question": "Why?",
          "one_line_summary_a": "A sees B",
          "one_line_summary_b": "B sees A",
          "detailed_rationale": "Rationale here",
          "lab_a_contributions": "A contributes",
          "lab_b_contributions": "B contributes",
          "lab_a_benefits": "A benefits",
          "lab_b_benefits": "B benefits",
          "proposed_first_experiment": "Do this experiment",
          "anchoring_publication_pmids": ["12345",],
          "confidence_tier": "high",
          "reasoning": "Good match",
        },
      ]`;
      const parsed = parseMatchingOutput(raw);
      expect(parsed).toHaveLength(1);
      expect(parsed[0]!.title).toBe("Test");
    });

    /** More than 3 proposals should be silently truncated to 3. */
    it("truncates to 3 proposals if LLM returns more", () => {
      const proposals = Array.from({ length: 5 }, (_, i) =>
        makeValidProposal({ title: `Proposal ${i + 1}` }),
      );
      const parsed = parseMatchingOutput(JSON.stringify(proposals));
      expect(parsed).toHaveLength(3);
      expect(parsed[0]!.title).toBe("Proposal 1");
      expect(parsed[2]!.title).toBe("Proposal 3");
    });

    /** Non-JSON output should throw a clear error. */
    it("throws on invalid JSON", () => {
      expect(() => parseMatchingOutput("not json at all")).toThrow(
        "Failed to parse matching output as JSON",
      );
    });

    /** A JSON object (not array) should throw. */
    it("throws on JSON object instead of array", () => {
      expect(() =>
        parseMatchingOutput(JSON.stringify({ title: "not an array" })),
      ).toThrow("Matching output must be a JSON array");
    });

    /** A JSON string should throw. */
    it("throws on JSON string", () => {
      expect(() => parseMatchingOutput('"just a string"')).toThrow(
        "Matching output must be a JSON array",
      );
    });
  });

  describe("validateProposal", () => {
    /** A fully valid proposal should pass validation. */
    it("accepts a valid proposal", () => {
      const result = validateProposal(makeValidProposal());
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    /** A proposal with empty anchoring PMIDs array should still be valid. */
    it("accepts proposal with empty anchoring_publication_pmids", () => {
      const result = validateProposal(
        makeValidProposal({ anchoring_publication_pmids: [] }),
      );
      expect(result.valid).toBe(true);
    });

    /** All three confidence tiers should be accepted. */
    it.each(["high", "moderate", "speculative"])(
      "accepts confidence_tier: %s",
      (tier) => {
        const result = validateProposal(
          makeValidProposal({ confidence_tier: tier }),
        );
        expect(result.valid).toBe(true);
      },
    );

    /** A null value should be rejected. */
    it("rejects null", () => {
      const result = validateProposal(null);
      expect(result.valid).toBe(false);
      expect(result.errors).toContain("Proposal must be a non-null object");
    });

    /** A non-object value should be rejected. */
    it("rejects non-object", () => {
      const result = validateProposal("not an object");
      expect(result.valid).toBe(false);
    });

    /** Missing required string fields should be reported. */
    it("rejects proposal with missing title", () => {
      const proposal = makeValidProposal();
      delete (proposal as unknown as Record<string, unknown>).title;
      const result = validateProposal(proposal);
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.includes("title"))).toBe(true);
    });

    /** Empty string fields should be reported. */
    it("rejects proposal with empty string fields", () => {
      const proposal = makeValidProposal({
        detailed_rationale: "",
        proposed_first_experiment: "   ",
      });
      const result = validateProposal(proposal);
      expect(result.valid).toBe(false);
      expect(
        result.errors.some((e) => e.includes("detailed_rationale")),
      ).toBe(true);
      expect(
        result.errors.some((e) => e.includes("proposed_first_experiment")),
      ).toBe(true);
    });

    /** Missing anchoring_publication_pmids array should be reported. */
    it("rejects proposal without anchoring_publication_pmids array", () => {
      const proposal = makeValidProposal();
      (proposal as unknown as Record<string, unknown>).anchoring_publication_pmids =
        "not an array";
      const result = validateProposal(proposal);
      expect(result.valid).toBe(false);
      expect(
        result.errors.some((e) =>
          e.includes("anchoring_publication_pmids must be an array"),
        ),
      ).toBe(true);
    });

    /** Invalid confidence tier should be reported. */
    it("rejects invalid confidence_tier", () => {
      const result = validateProposal(
        makeValidProposal({ confidence_tier: "unknown" }),
      );
      expect(result.valid).toBe(false);
      expect(
        result.errors.some((e) => e.includes("Invalid confidence_tier")),
      ).toBe(true);
    });

    /** Multiple errors should all be reported. */
    it("reports all errors simultaneously", () => {
      const proposal = makeValidProposal({
        title: "",
        collaboration_type: "",
        confidence_tier: "invalid",
      });
      delete (proposal as unknown as Record<string, unknown>).reasoning;
      const result = validateProposal(proposal);
      expect(result.valid).toBe(false);
      expect(result.errors.length).toBeGreaterThanOrEqual(3);
    });
  });

  describe("filterValidProposals", () => {
    /** All valid proposals should be kept. */
    it("keeps all valid proposals", () => {
      const proposals = [
        makeValidProposal({ title: "Good 1" }),
        makeValidProposal({ title: "Good 2" }),
      ];
      const result = filterValidProposals(proposals);
      expect(result.valid).toHaveLength(2);
      expect(result.discarded).toBe(0);
    });

    /** Invalid proposals should be discarded while valid ones are kept. */
    it("discards invalid proposals and keeps valid ones", () => {
      const proposals = [
        makeValidProposal({ title: "Good" }),
        makeValidProposal({ title: "" }), // invalid: empty title
        makeValidProposal({ title: "Also Good" }),
      ];
      const result = filterValidProposals(proposals);
      expect(result.valid).toHaveLength(2);
      expect(result.valid[0]!.title).toBe("Good");
      expect(result.valid[1]!.title).toBe("Also Good");
      expect(result.discarded).toBe(1);
    });

    /** All proposals invalid should result in empty valid array. */
    it("returns empty array when all proposals are invalid", () => {
      const proposals = [
        makeValidProposal({ title: "" }),
        makeValidProposal({ detailed_rationale: "" }),
      ];
      const result = filterValidProposals(proposals);
      expect(result.valid).toHaveLength(0);
      expect(result.discarded).toBe(2);
    });

    /** Empty input should return empty results. */
    it("handles empty array input", () => {
      const result = filterValidProposals([]);
      expect(result.valid).toHaveLength(0);
      expect(result.discarded).toBe(0);
    });

    /** Per-proposal error lists should be returned for debugging. */
    it("returns per-proposal error lists", () => {
      const proposals = [
        makeValidProposal({ title: "Good" }),
        makeValidProposal({ title: "" }),
      ];
      const result = filterValidProposals(proposals);
      expect(result.errors).toHaveLength(2);
      expect(result.errors[0]).toHaveLength(0); // valid proposal has no errors
      expect(result.errors[1]!.length).toBeGreaterThan(0); // invalid has errors
    });
  });

  describe("buildMatchingRetryMessage", () => {
    /** The retry prompt should contain strict JSON formatting instructions. */
    it("provides strict formatting instructions", () => {
      const retry = buildMatchingRetryMessage();
      expect(retry).toContain("could not be parsed as valid JSON");
      expect(retry).toContain("ONLY a JSON array");
      expect(retry).toContain("no markdown fencing");
      expect(retry).toContain("trailing commas");
      expect(retry).toContain("0-3 proposal objects");
      expect(retry).toContain("[]");
    });
  });

  describe("integration: build → parse → validate", () => {
    /** End-to-end: building a prompt, simulating a valid LLM response, and validating it. */
    it("full pipeline produces valid prompt and accepts valid response", () => {
      const input = makeMatchingInput();
      const systemMsg = getMatchingSystemMessage();
      const userMsg = buildMatchingUserMessage(input);

      // Prompts should be non-trivial
      expect(systemMsg.length).toBeGreaterThan(2000);
      expect(userMsg.length).toBeGreaterThan(500);

      // Simulate LLM response
      const proposals = [makeValidProposal()];
      const parsed = parseMatchingOutput(JSON.stringify(proposals));
      const filtered = filterValidProposals(parsed);

      expect(filtered.valid).toHaveLength(1);
      expect(filtered.discarded).toBe(0);
    });

    /** Empty response (no quality proposals) should be handled cleanly. */
    it("handles empty array response (no quality proposals found)", () => {
      const parsed = parseMatchingOutput("[]");
      const filtered = filterValidProposals(parsed);

      expect(filtered.valid).toHaveLength(0);
      expect(filtered.discarded).toBe(0);
    });

    /** Mixed valid and invalid proposals in a single response. */
    it("processes mixed response with some valid and some invalid proposals", () => {
      const proposals = [
        makeValidProposal({ title: "Valid Proposal" }),
        { title: "", incomplete: true }, // invalid
        makeValidProposal({ title: "Another Valid" }),
      ];
      const parsed = parseMatchingOutput(JSON.stringify(proposals));
      const filtered = filterValidProposals(parsed);

      expect(filtered.valid).toHaveLength(2);
      expect(filtered.discarded).toBe(1);
    });

    /** Context with minimal researcher data (no optional fields). */
    it("builds valid prompt with minimal researcher data", () => {
      const input = makeMatchingInput({
        researcherA: makeResearcher({
          department: undefined,
          grantTitles: [],
          userSubmittedTexts: [],
          publications: [],
          keywords: [],
        }),
        researcherB: makeResearcherB({
          department: undefined,
          grantTitles: [],
          userSubmittedTexts: [],
          publications: [],
        }),
      });
      const msg = buildMatchingUserMessage(input);

      // Should still be a valid prompt with researcher info
      expect(msg).toContain("=== Researcher A ===");
      expect(msg).toContain("=== Researcher B ===");
      expect(msg).toContain("Jane Doe");
      expect(msg).toContain("John Smith");
      expect(msg).not.toContain("Grant Titles:");
      expect(msg).not.toContain("Publication Titles");
    });
  });
});
