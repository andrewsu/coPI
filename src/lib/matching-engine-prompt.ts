/**
 * Matching engine prompt builder and output validator.
 *
 * Assembles the LLM prompt for generating collaboration proposals between
 * pairs of researchers. Also parses the LLM output, validates each proposal
 * against required fields, and generates retry prompts for JSON parse failures.
 *
 * The prompt design is documented in prompts/matching-engine.md. This module
 * provides the programmatic interface: assembling per-pair context, parsing
 * the structured JSON array output, validating proposals, and filtering
 * invalid ones.
 */

// --- Public interfaces ---

/** A publication record prepared for inclusion in the matching prompt. */
export interface MatchingPublication {
  title: string;
  journal: string;
  year: number;
  authorPosition: "first" | "last" | "middle";
  abstract: string;
}

/** A user-submitted text entry (labels + content, never shown to other users). */
export interface UserSubmittedText {
  label: string;
  content: string;
}

/** All profile/publication data for one researcher in a pair. */
export interface ResearcherContext {
  name: string;
  institution: string;
  department?: string;
  researchSummary: string;
  techniques: string[];
  experimentalModels: string[];
  diseaseAreas: string[];
  keyTargets: string[];
  keywords: string[];
  grantTitles: string[];
  userSubmittedTexts: UserSubmittedText[];
  /** All publications (titles shown in full list). */
  publications: MatchingPublication[];
}

/** Summary of an existing proposal for de-duplication context. */
export interface ExistingProposal {
  title: string;
  scientificQuestion: string;
}

/** Complete input for one matching engine call (one pair). */
export interface MatchingInput {
  researcherA: ResearcherContext;
  researcherB: ResearcherContext;
  existingProposals: ExistingProposal[];
}

/** A single proposal as returned by the LLM (snake_case JSON keys). */
export interface ProposalOutput {
  title: string;
  collaboration_type: string;
  scientific_question: string;
  one_line_summary_a: string;
  one_line_summary_b: string;
  detailed_rationale: string;
  lab_a_contributions: string;
  lab_b_contributions: string;
  lab_a_benefits: string;
  lab_b_benefits: string;
  proposed_first_experiment: string;
  anchoring_publication_pmids: string[];
  confidence_tier: string;
  reasoning: string;
}

/** Validation result for a single proposal. */
export interface ProposalValidationResult {
  valid: boolean;
  errors: string[];
}

/** Result of filtering proposals through validation. */
export interface FilterResult {
  valid: ProposalOutput[];
  discarded: number;
  errors: string[][];
}

/** Result of de-duplicating new proposals against existing ones. */
export interface DeduplicationResult {
  /** Proposals that are sufficiently distinct from existing ones. */
  unique: ProposalOutput[];
  /** Number of proposals removed as duplicates. */
  duplicates: number;
}

// --- Constants ---

const MAX_ABSTRACTS_PER_RESEARCHER = 10;
const MAX_PROPOSALS_PER_CALL = 3;
const VALID_CONFIDENCE_TIERS = ["high", "moderate", "speculative"];

/** All fields that must be present and non-empty strings in a proposal. */
const REQUIRED_STRING_FIELDS: (keyof ProposalOutput)[] = [
  "title",
  "collaboration_type",
  "scientific_question",
  "one_line_summary_a",
  "one_line_summary_b",
  "detailed_rationale",
  "lab_a_contributions",
  "lab_b_contributions",
  "lab_a_benefits",
  "lab_b_benefits",
  "proposed_first_experiment",
  "confidence_tier",
  "reasoning",
];

/** Model configuration for matching engine calls. */
export const MATCHING_MODEL_CONFIG = {
  model: "claude-opus-4-20250514",
  maxTokens: 4096,
  temperature: 0.5,
} as const;

// --- System prompt ---

const SYSTEM_PROMPT = `You are a scientific collaboration proposal engine for a research platform. You analyze pairs of researcher profiles and propose specific, synergistic collaborations with concrete first experiments.

## Core Instructions

1. Identify collaboration opportunities that are SPECIFIC and SYNERGISTIC for both parties.
2. Each lab must bring something the other doesn't have.
3. Each lab must benefit non-generically.
4. A concrete first experiment is REQUIRED, scoped to days-to-weeks of effort.
5. Return an empty array [] if no quality proposal exists — silence is better than noise.
6. If existing proposals are provided, propose something DISTINCT or return nothing.
7. Maximum 3 proposals per pair per call.
8. Do NOT quote or directly reference user-submitted text — frame proposals using publicly available information even if user-submitted text informed the match.

## Anti-Genericity Rules (CRITICAL)

- If either lab's contribution could be described as a generic service (e.g., "computational analysis", "structural studies", "mouse behavioral testing") without reference to the specific scientific question, the proposal is too generic. Do not generate it.
- Each lab's contribution must reference specific techniques, models, reagents, or expertise from their profile. Saying "Lab A's expertise in X" is not sufficient — say what specifically they would do and with what.
- The proposed first experiment must name specific assays, specific computational methods, specific reagents, or specific datasets. "We would analyze the data" is not a first experiment.
- If you cannot articulate what makes this collaboration better than either lab hiring a postdoc to do the other's part, do not generate the proposal.

## Output Schema

Return ONLY a valid JSON array — no markdown fencing, no commentary outside the JSON.

Each element must follow this schema:

{
  "title": "Short descriptive name",
  "collaboration_type": "e.g., mechanistic extension, methodological enhancement, translational application",
  "scientific_question": "The core question this collaboration addresses",
  "one_line_summary_a": "What researcher A sees in swipe card — emphasizes what B brings and why it matters to A",
  "one_line_summary_b": "What researcher B sees in swipe card — emphasizes what A brings and why it matters to B",
  "detailed_rationale": "2-3 paragraphs, shared between both parties",
  "lab_a_contributions": "What lab A brings — specific techniques, reagents, models",
  "lab_b_contributions": "What lab B brings — specific techniques, reagents, models",
  "lab_a_benefits": "What lab A gets out of this collaboration specifically",
  "lab_b_benefits": "What lab B gets out of this collaboration specifically",
  "proposed_first_experiment": "Concrete pilot: who provides what, what assays/methods, key readouts, interpretation",
  "anchoring_publication_pmids": ["12345678"],
  "confidence_tier": "high | moderate | speculative",
  "reasoning": "Internal reasoning about why this is a good match and clears the quality bar"
}

Return an empty array [] if no quality proposals exist for this pair.

## Confidence Tiers

- **high**: Clear complementarity, specific anchoring, concrete first experiment, both sides benefit non-generically.
- **moderate**: Good synergy but first experiment is less defined, or one side's benefit is less clear.
- **speculative**: Interesting angle but requires more development, or depends on assumptions about unpublished work.

## Examples

### Good Example 1: Computational Optimization of H1R Inverse Agonists

{
  "title": "Computational Optimization of H1R Inverse Agonists for Osteoarthritis",
  "collaboration_type": "mechanistic extension",
  "scientific_question": "What structural features of cyproheptadine are required for FoxO activation in chondrocytes?",
  "one_line_summary_a": "Forli's AutoDock suite and structure-based drug design expertise could model the cyproheptadine-H1R interaction to identify which binding determinants drive your FoxO activation phenotype, guiding design of more selective chondroprotective compounds.",
  "one_line_summary_b": "Lotz's recent JCI paper identified cyproheptadine as an H1R inverse agonist that activates FoxO transcription factors in chondrocytes — an ideal system for your docking and pharmacophore modeling pipeline to dissect structure-activity relationships.",
  "detailed_rationale": "Lotz's recent JCI paper identifies cyproheptadine as a promising osteoarthritis therapeutic that activates FoxO transcription factors and reduces both structural damage and pain via H1R inverse agonism. However, cyproheptadine's FoxO-activating mechanism may work through H1R-dependent signaling effects distinct from classic antihistamine activity, and the structural basis for this selectivity is unknown. Forli's AutoDock-GPU platform and structure-based drug design expertise could model the cyproheptadine-H1R interaction, identify key binding determinants that correlate with FoxO activation versus antihistamine activity, and generate pharmacophore models for virtual screening of compound libraries with enhanced therapeutic windows.",
  "lab_a_contributions": "Cyproheptadine structure-activity relationship data, panel of H1R ligands with FoxO activity measurements, functional chondrocyte assays for validating computational predictions",
  "lab_b_contributions": "AutoDock-GPU docking platform, pharmacophore modeling pipeline, virtual screening infrastructure, computational chemistry expertise in GPCR-ligand interactions",
  "lab_a_benefits": "Structural rationale for the FoxO activation mechanism, computationally guided prioritization of derivative compounds, stronger mechanistic narrative for therapeutic development",
  "lab_b_benefits": "Novel GPCR pharmacology application for the AutoDock platform — modeling a functional selectivity question (FoxO activation vs antihistamine activity) at a therapeutically relevant receptor",
  "proposed_first_experiment": "Lotz Lab provides a panel of 10-15 H1R ligands with quantified FoxO activation data in chondrocytes. Forli Lab performs docking studies of all compounds against the H1R crystal structure and builds pharmacophore models. Key readouts: predicted binding modes and interaction fingerprints correlated with FoxO activation potency. If structure-activity relationships emerge from the docking, this provides the basis for rational design of optimized compounds and a joint R01.",
  "anchoring_publication_pmids": ["38471293"],
  "confidence_tier": "high",
  "reasoning": "Strong match: (1) Anchored to a specific recent finding with a clear mechanistic gap. (2) Complementary capabilities — Lotz has the biological system and activity data, Forli has the computational platform. (3) Neither side is doing generic work — Forli is specifically modeling functional selectivity at H1R, not just 'doing docking.' (4) First experiment is concrete and low-investment: provide compounds, run docking, look for correlations. (5) Clear path to paper and R01."
}

### Good Example 2: ISR Pathway Integration with Ribosome Targeting

{
  "title": "Synergistic Neuroprotection via Atypical Tetracyclines and ISR Activators",
  "collaboration_type": "mechanistic extension",
  "scientific_question": "Do atypical tetracyclines and ISR activators provide additive or synergistic neuroprotection against ferroptosis?",
  "one_line_summary_a": "Wiseman's HRI activators (parogrelil, MBX-2982) could synergize with your atypical tetracyclines through complementary proteostasis pathways — a combination strategy that neither lab could test alone.",
  "one_line_summary_b": "Petrascheck's bioRxiv preprint identifies atypical tetracyclines that provide neuroprotection via ISR-independent cytosolic ribosome targeting — a mechanistically distinct pathway from your HRI-mediated ISR activation, creating a natural combination experiment.",
  "detailed_rationale": "Petrascheck distinguishes two mechanistically distinct classes of tetracyclines: standard variants that activate the integrated stress response (ISR) via mitochondrial ribosome targeting, and atypical variants (4-epiminocycline, 12-aminominocycline) that directly target cytosolic ribosomes to provide neuroprotection against ferroptosis without ISR activation. Wiseman's deep expertise in ISR kinases (HRI, GCN2, PERK) and his recently published HRI activators create a natural combination experiment: can ISR-dependent and ISR-independent neuroprotective pathways be combined for enhanced protection? This question is only answerable by bringing together both labs' specific compounds and assays.",
  "lab_a_contributions": "Atypical tetracyclines (4-epiminocycline, 12-aminominocycline), neuronal ferroptosis assays, C. elegans lifespan models, translation attenuation readouts",
  "lab_b_contributions": "HRI activators (parogrelil, MBX-2982), ISR pathway reporters, ISR kinase expertise for mechanistic interpretation of combination effects",
  "lab_a_benefits": "Mechanistic context for the ISR-independence of atypical tetracyclines through direct comparison with ISR activators, potential combination therapeutic strategy",
  "lab_b_benefits": "Novel combination partner for HRI activators with a distinct mechanism, expanding the therapeutic applicability of ISR modulation to ferroptotic neurodegeneration",
  "proposed_first_experiment": "Petrascheck Lab provides atypical tetracyclines and neuronal ferroptosis assay protocol. Wiseman Lab provides HRI activators. Both labs run combination treatments in neuronal ferroptosis assays. Key readouts: neuronal survival with single agents vs combinations, combination indices (CI) to assess synergy vs additivity. If synergistic, this supports a joint grant exploring dual-pathway neuroprotection.",
  "anchoring_publication_pmids": [],
  "confidence_tier": "high",
  "reasoning": "Strong match: (1) Each lab has specific compounds the other doesn't — this literally cannot be done without both labs. (2) The mechanistic distinction (ISR-dependent vs ISR-independent) creates a clear scientific question. (3) First experiment is straightforward: mix compounds, measure survival, calculate combination indices. (4) Both labs benefit — Petrascheck gets mechanistic context, Wiseman gets a new combination partner."
}

### Good Example 3: Cryo-ET Visualization of Mitochondrial Remodeling

{
  "title": "Cryo-ET Visualization of HRI-Induced Mitochondrial Remodeling",
  "collaboration_type": "methodological enhancement",
  "scientific_question": "How does HRI activation remodel mitochondrial membrane ultrastructure in MFN2-deficient cells?",
  "one_line_summary_a": "Grotjahn's cryo-ET and Surface Morphometrics pipeline could directly visualize the mitochondrial elongation your HRI activators produce in MFN2-deficient cells, providing structural evidence for the protective mechanism at nanometer resolution.",
  "one_line_summary_b": "Wiseman's HRI activators induce a striking mitochondrial remodeling phenotype in patient fibroblasts — an ideal specimen for your cryo-ET pipeline to characterize membrane reorganization during pharmacological organelle rescue.",
  "detailed_rationale": "Wiseman's recent PNAS paper shows that HRI-activating compounds restore mitochondrial function in MFN2-deficient cells, promoting mitochondrial elongation. However, the ultrastructural basis for this remodeling is unknown — are cristae reorganizing? Is membrane thickness changing? Is network connectivity being restored? Grotjahn's cryo-electron tomography expertise, combined with her Surface Morphometrics quantification pipeline, is uniquely suited to answer these questions at nanometer resolution. The MFN2-deficient fibroblasts provide a clean system where mitochondrial morphology is disrupted at baseline and rescued by drug treatment, making before/after comparisons straightforward.",
  "lab_a_contributions": "MFN2-deficient patient fibroblasts, HRI activator compounds (parogrelil, MBX-2982), treatment protocols, functional rescue data for correlation with structural findings",
  "lab_b_contributions": "Cryo-FIB-SEM sample preparation, cryo-electron tomography data collection, Surface Morphometrics pipeline for automated membrane quantification",
  "lab_a_benefits": "Structural evidence for the mechanism of mitochondrial rescue — moves the story from fluorescence-level observation to nanometer-resolution ultrastructural characterization, significantly strengthening the therapeutic narrative",
  "lab_b_benefits": "A compelling biological system with a clear drug-induced phenotype, ideal for demonstrating cryo-ET's power for pharmacological studies — a new application domain for the Surface Morphometrics pipeline",
  "proposed_first_experiment": "Wiseman Lab prepares MFN2-deficient fibroblasts treated with vehicle or HRI activator (48h treatment with parogrelil). Grotjahn Lab performs cryo-FIB-SEM and cryo-ET on both conditions. Key readouts: cristae morphology, inner/outer membrane thickness, mitochondrial network connectivity metrics via Surface Morphometrics. If ultrastructural improvements correlate with the functional rescue Wiseman has documented, this provides the mechanistic basis for a joint paper and R01.",
  "anchoring_publication_pmids": ["38471293"],
  "confidence_tier": "high",
  "reasoning": "Strong match: (1) Specific phenotype needing structural characterization, not generic overlap. (2) Grotjahn has the exact technical capability and quantification pipeline. (3) Self-contained first experiment — treated vs untreated cells, clear readout. (4) Both labs benefit non-generically. (5) Low-medium investment. (6) Clear path to paper and R01."
}

### Bad Example 1: One Side is Generic Service Work

Rejected: "Su Lab's knowledge graph mining could identify new drug targets for Bhatt Lab's kinase inhibitor program."

Rejection reason: Su Lab's contribution is generic — "knowledge graph mining" could be applied to any drug target program. No specific knowledge graph, dataset, or analytical approach is identified that makes this collaboration better than Bhatt Lab hiring any computational biologist. What specific knowledge graph? What specific analytical method? What specific aspect of the kinase inhibitor program would benefit from graph-based analysis?

### Bad Example 2: Obvious Overlap, No Complementarity

Rejected: "Both labs study Alzheimer's disease using mouse models and could combine their datasets for greater statistical power."

Rejection reason: Shared interest is not synergy. Neither lab brings a capability the other lacks. "Combining datasets" is not a first experiment — it's a vague aspiration with no specific analytical question, no specific readout, and no reason it requires both labs.

### Bad Example 3: No Concrete First Experiment

Rejected: "Bhatt's chemical biology expertise and Wiseman's ISR signaling knowledge could lead to novel therapeutic strategies for neurodegeneration."

Rejection reason: No specific question, no specific experiment, no specific reagents or models named. This is an abstract statement of potential, not a collaboration proposal. What specific compound? What specific assay? What would you measure?`;

// --- Prompt assembly ---

/**
 * Selects and orders abstracts for matching input.
 *
 * Picks up to 10 publications with non-empty abstracts, prioritized by
 * author position (last > first > middle) and then by recency (most recent
 * first). Per the spec, article-type filtering (excluding reviews, editorials,
 * etc.) should happen at ingestion time since Publication records lack an
 * article-type field.
 */
export function selectAbstractsForMatching(
  publications: MatchingPublication[],
): MatchingPublication[] {
  const positionPriority: Record<string, number> = {
    last: 0,
    first: 1,
    middle: 2,
  };

  // Filter to publications with non-empty abstracts
  const withAbstracts = publications.filter(
    (p) => p.abstract && p.abstract.trim().length > 0,
  );

  const sorted = [...withAbstracts].sort((a, b) => {
    const posDiff =
      (positionPriority[a.authorPosition] ?? 2) -
      (positionPriority[b.authorPosition] ?? 2);
    if (posDiff !== 0) return posDiff;
    return b.year - a.year;
  });

  return sorted.slice(0, MAX_ABSTRACTS_PER_RESEARCHER);
}

/**
 * Formats all publications as a title list (compact, all included).
 * Sorted by recency (most recent first).
 */
function formatPublicationTitleList(
  publications: MatchingPublication[],
): string {
  const sorted = [...publications].sort((a, b) => b.year - a.year);
  return sorted
    .map(
      (p, i) =>
        `${i + 1}. ${p.title} (${p.journal}, ${p.year}) [${p.authorPosition} author]`,
    )
    .join("\n");
}

/**
 * Formats selected abstracts for inclusion in the prompt.
 */
function formatSelectedAbstracts(
  abstracts: MatchingPublication[],
): string {
  return abstracts
    .map((p) => `- "${p.title}" (${p.year})\n  ${p.abstract}`)
    .join("\n\n");
}

/**
 * Builds the context block for a single researcher.
 */
function buildResearcherBlock(
  label: string,
  researcher: ResearcherContext,
): string {
  const sections: string[] = [];

  sections.push(`=== ${label} ===`);
  sections.push(`Name: ${researcher.name}`);
  sections.push(`Institution: ${researcher.institution}`);
  if (researcher.department) {
    sections.push(`Department: ${researcher.department}`);
  }

  sections.push("");
  sections.push("Research Summary:");
  sections.push(researcher.researchSummary);

  sections.push("");
  sections.push(`Techniques: ${researcher.techniques.join(", ") || "(none)"}`);
  sections.push(
    `Experimental Models: ${researcher.experimentalModels.join(", ") || "(none)"}`,
  );
  sections.push(
    `Disease Areas: ${researcher.diseaseAreas.join(", ") || "(none)"}`,
  );
  sections.push(
    `Key Targets: ${researcher.keyTargets.join(", ") || "(none)"}`,
  );
  sections.push(`Keywords: ${researcher.keywords.join(", ") || "(none)"}`);

  if (researcher.grantTitles.length > 0) {
    sections.push("");
    sections.push("Grant Titles:");
    for (const grant of researcher.grantTitles) {
      sections.push(`- ${grant}`);
    }
  }

  if (researcher.userSubmittedTexts.length > 0) {
    sections.push("");
    sections.push("User-Submitted Priorities:");
    for (const text of researcher.userSubmittedTexts) {
      sections.push(`- ${text.label}: ${text.content}`);
    }
  }

  if (researcher.publications.length > 0) {
    sections.push("");
    sections.push("Publication Titles (all, most recent first):");
    sections.push(formatPublicationTitleList(researcher.publications));

    const selectedAbstracts = selectAbstractsForMatching(
      researcher.publications,
    );
    if (selectedAbstracts.length > 0) {
      sections.push("");
      sections.push(
        `Selected Abstracts (${selectedAbstracts.length} of ${researcher.publications.length}, prioritized by author position and recency):`,
      );
      sections.push(formatSelectedAbstracts(selectedAbstracts));
    }
  }

  return sections.join("\n");
}

/**
 * Builds the user message for a matching engine call.
 *
 * Assembles the per-pair context including both researcher profiles,
 * publication titles, selected abstracts, and any existing proposals
 * for de-duplication.
 */
export function buildMatchingUserMessage(input: MatchingInput): string {
  const sections: string[] = [];

  sections.push(
    "Analyze the following pair of researchers and propose up to 3 specific, synergistic collaboration proposals. Return a JSON array following the schema in your instructions. Return an empty array [] if no quality proposals exist.",
  );
  sections.push("");

  sections.push(buildResearcherBlock("Researcher A", input.researcherA));
  sections.push("");
  sections.push(buildResearcherBlock("Researcher B", input.researcherB));

  if (input.existingProposals.length > 0) {
    sections.push("");
    sections.push("=== Existing Proposals for This Pair ===");
    sections.push(
      "These proposals already exist. Propose something DISTINCT or return nothing.",
    );
    for (const proposal of input.existingProposals) {
      sections.push(`- Title: ${proposal.title}`);
      sections.push(`  Question: ${proposal.scientificQuestion}`);
    }
  }

  return sections.join("\n");
}

/**
 * Returns the system message for the matching engine prompt.
 *
 * Contains the role, core instructions, anti-genericity rules, output schema,
 * confidence tier definitions, and few-shot examples (3 good, 3 bad).
 * This is static and benefits from prompt caching across pair evaluations.
 */
export function getMatchingSystemMessage(): string {
  return SYSTEM_PROMPT;
}

// --- Output parsing ---

/**
 * Parses the raw LLM output string into an array of ProposalOutput objects.
 *
 * Handles common LLM output quirks:
 * - JSON wrapped in markdown code fences
 * - Leading/trailing whitespace
 * - Trailing commas (removed before parsing)
 *
 * Throws if the output is not a valid JSON array.
 */
export function parseMatchingOutput(raw: string): ProposalOutput[] {
  let cleaned = raw.trim();

  // Strip markdown code fences if present
  if (cleaned.startsWith("```")) {
    cleaned = cleaned.replace(/^```(?:json)?\s*\n?/, "");
    cleaned = cleaned.replace(/\n?\s*```\s*$/, "");
  }

  // Remove trailing commas before closing brackets/braces
  cleaned = cleaned.replace(/,\s*([\]}])/g, "$1");

  let parsed: unknown;
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    throw new Error(
      `Failed to parse matching output as JSON: ${cleaned.slice(0, 200)}...`,
    );
  }

  if (!Array.isArray(parsed)) {
    throw new Error(
      "Matching output must be a JSON array (got " + typeof parsed + ")",
    );
  }

  if (parsed.length > MAX_PROPOSALS_PER_CALL) {
    // Silently truncate to max allowed — the LLM occasionally returns more
    parsed = parsed.slice(0, MAX_PROPOSALS_PER_CALL);
  }

  // Cast each element — validation happens separately via validateProposal
  return parsed as ProposalOutput[];
}

// --- Validation ---

/**
 * Validates a single proposal against the required schema.
 *
 * Checks that all required string fields are present and non-empty,
 * that anchoring_publication_pmids is an array, and that confidence_tier
 * is one of the valid values.
 *
 * Returns a validation result; invalid proposals are discarded (not retried).
 */
export function validateProposal(
  proposal: unknown,
): ProposalValidationResult {
  const errors: string[] = [];

  if (typeof proposal !== "object" || proposal === null) {
    return { valid: false, errors: ["Proposal must be a non-null object"] };
  }

  const obj = proposal as Record<string, unknown>;

  // Check all required string fields
  for (const field of REQUIRED_STRING_FIELDS) {
    const value = obj[field];
    if (typeof value !== "string" || value.trim().length === 0) {
      errors.push(
        `Missing or empty required field: ${field}`,
      );
    }
  }

  // Check anchoring_publication_pmids is an array
  if (!Array.isArray(obj.anchoring_publication_pmids)) {
    errors.push(
      "anchoring_publication_pmids must be an array (may be empty)",
    );
  }

  // Check confidence_tier is valid
  if (
    typeof obj.confidence_tier === "string" &&
    !VALID_CONFIDENCE_TIERS.includes(obj.confidence_tier)
  ) {
    errors.push(
      `Invalid confidence_tier: "${obj.confidence_tier}" (must be high, moderate, or speculative)`,
    );
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

/**
 * Filters an array of parsed proposals, keeping valid ones and discarding invalid.
 *
 * Per the spec: "Discard proposals missing required fields, keep valid ones."
 * Returns the valid proposals, the discard count, and per-proposal error lists.
 */
export function filterValidProposals(
  proposals: ProposalOutput[],
): FilterResult {
  const valid: ProposalOutput[] = [];
  const errors: string[][] = [];
  let discarded = 0;

  for (const proposal of proposals) {
    const result = validateProposal(proposal);
    if (result.valid) {
      valid.push(proposal);
    } else {
      discarded++;
    }
    errors.push(result.errors);
  }

  return { valid, discarded, errors };
}

// --- De-duplication ---

/**
 * Default Jaccard similarity threshold for considering a new proposal
 * a duplicate of an existing one. A threshold of 0.5 means ≥50% of the
 * combined word sets must overlap.
 *
 * Tuned for scientific proposal titles and questions, which are typically
 * 5–20 words. At 0.5, two texts sharing half their vocabulary are flagged.
 */
const DEFAULT_SIMILARITY_THRESHOLD = 0.5;

/**
 * Normalizes text for similarity comparison: lowercases, removes
 * punctuation, and splits into a set of unique words.
 */
function normalizeToWordSet(text: string): Set<string> {
  const normalized = text
    .toLowerCase()
    .replace(/[^\w\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 0);
  return new Set(normalized);
}

/**
 * Computes Jaccard similarity between two text strings.
 *
 * Jaccard similarity = |intersection| / |union| of word sets.
 * Returns a value between 0 (no overlap) and 1 (identical word sets).
 *
 * Uses normalized, lowercased word sets with punctuation removed.
 * Suitable for comparing short scientific texts like proposal titles
 * and research questions where word overlap indicates topical similarity.
 *
 * Returns 1.0 if both strings are empty (both normalized to empty sets),
 * since two empty texts are trivially identical. Returns 0 if only one
 * is empty.
 */
export function computeTextSimilarity(a: string, b: string): number {
  const setA = normalizeToWordSet(a);
  const setB = normalizeToWordSet(b);

  if (setA.size === 0 && setB.size === 0) return 1.0;
  if (setA.size === 0 || setB.size === 0) return 0;

  let intersection = 0;
  for (const word of setA) {
    if (setB.has(word)) intersection++;
  }

  const union = setA.size + setB.size - intersection;
  return intersection / union;
}

/**
 * Filters out newly generated proposals that are substantially similar
 * to existing proposals for the same researcher pair.
 *
 * Per spec (matching-engine.md, "De-duplication"):
 * "Post-generation: check new proposal titles/questions against existing
 * ones. If substantially similar (LLM judgment or simple similarity check),
 * discard."
 *
 * A new proposal is considered a duplicate if EITHER:
 * - Its title has Jaccard similarity >= threshold with any existing title, OR
 * - Its scientific_question has Jaccard similarity >= threshold with any
 *   existing scientificQuestion.
 *
 * This catches cases where the LLM rephrases an existing proposal despite
 * being instructed to propose something distinct.
 *
 * @param proposals - Newly generated proposals (already validated).
 * @param existingProposals - Existing proposals for this pair.
 * @param threshold - Similarity threshold (0–1). Defaults to 0.5.
 * @returns The unique proposals and duplicate count.
 */
export function deduplicateProposals(
  proposals: ProposalOutput[],
  existingProposals: ExistingProposal[],
  threshold: number = DEFAULT_SIMILARITY_THRESHOLD,
): DeduplicationResult {
  if (existingProposals.length === 0) {
    return { unique: proposals, duplicates: 0 };
  }

  const unique: ProposalOutput[] = [];
  let duplicates = 0;

  for (const proposal of proposals) {
    let isDuplicate = false;

    for (const existing of existingProposals) {
      const titleSimilarity = computeTextSimilarity(
        proposal.title,
        existing.title,
      );
      const questionSimilarity = computeTextSimilarity(
        proposal.scientific_question,
        existing.scientificQuestion,
      );

      if (titleSimilarity >= threshold || questionSimilarity >= threshold) {
        isDuplicate = true;
        break;
      }
    }

    if (isDuplicate) {
      duplicates++;
    } else {
      unique.push(proposal);
    }
  }

  return { unique, duplicates };
}

// --- Retry prompt ---

/**
 * Builds a retry message for when JSON parsing of the LLM output fails.
 *
 * Only used when the entire response cannot be parsed as JSON.
 * Individual invalid proposals within a valid array are silently discarded
 * rather than triggering a retry.
 */
export function buildMatchingRetryMessage(): string {
  return `Your previous response could not be parsed as valid JSON. Please regenerate your response following these strict formatting rules:

1. Return ONLY a JSON array — no markdown fencing, no commentary outside the JSON.
2. The array must contain 0-3 proposal objects following the schema in your instructions.
3. If no quality proposals exist, return exactly: []
4. Ensure all strings are properly escaped (no unescaped quotes, newlines, etc.).
5. Do NOT use trailing commas.

Use the same researcher pair context from your previous message.`;
}
