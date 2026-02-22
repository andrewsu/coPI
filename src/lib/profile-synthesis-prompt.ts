/**
 * Profile synthesis prompt builder and output validator.
 *
 * Assembles the LLM prompt for generating structured researcher profiles
 * from publications, grants, methods sections, and user-submitted texts.
 * Also validates the LLM output against the required schema.
 *
 * The prompt text is stored in prompts/profile-synthesis.md. This module
 * provides the programmatic interface for assembling input context,
 * validating output, and generating retry prompts.
 */

// --- Public interfaces ---

/** A publication record prepared for inclusion in the synthesis prompt. */
export interface SynthesisPublication {
  title: string;
  journal: string;
  year: number;
  authorPosition: "first" | "last" | "middle";
  abstract: string;
  methodsText?: string;
}

/** A user-submitted text entry. */
export interface UserSubmittedText {
  label: string;
  content: string;
}

/** All inputs needed to assemble the synthesis prompt. */
export interface SynthesisInput {
  name: string;
  affiliation: string;
  labWebsite?: string;
  grantTitles: string[];
  publications: SynthesisPublication[];
  userSubmittedTexts: UserSubmittedText[];
}

/** The structured output expected from the LLM. */
export interface SynthesisOutput {
  research_summary: string;
  techniques: string[];
  experimental_models: string[];
  disease_areas: string[];
  key_targets: string[];
  keywords: string[];
}

/** A validation error with the field name and description. */
export interface ValidationError {
  field: string;
  message: string;
}

/** Result of validating a SynthesisOutput. */
export interface ValidationResult {
  valid: boolean;
  errors: ValidationError[];
  summaryWordCount: number;
  techniquesCount: number;
  diseaseAreasCount: number;
  keyTargetsCount: number;
}

// --- Constants ---

const SUMMARY_MIN_WORDS = 150;
const SUMMARY_MAX_WORDS = 250;
const MIN_TECHNIQUES = 3;
const MIN_DISEASE_AREAS = 1;
const MIN_KEY_TARGETS = 1;
const MAX_PUBLICATIONS = 30;
const MAX_METHODS_WORDS = 2000;

/** Model configuration for synthesis calls. */
export const SYNTHESIS_MODEL_CONFIG = {
  model: "claude-opus-4-20250514",
  maxTokens: 2000,
  temperature: 0.3,
} as const;

// --- System prompt ---

const SYSTEM_PROMPT = `You are a scientific profile synthesizer for a research collaboration platform. Your job is to analyze a researcher's publications, grants, and self-described priorities to generate a structured research profile that will be used to identify specific, synergistic collaboration opportunities with other researchers.

You must produce profiles that are SPECIFIC enough to enable targeted matching — generic descriptions are useless. "Studies cancer biology" tells us nothing; "Uses CRISPR-Cas9 screening in pancreatic ductal adenocarcinoma organoids to identify synthetic lethal interactions with KRAS-G12D" tells us exactly what collaborations would be valuable.`;

// --- Prompt assembly ---

/**
 * Selects and orders publications for synthesis input.
 *
 * Takes all available publications, filters to research articles,
 * prioritizes by author position (last > first > middle) and recency,
 * and returns up to MAX_PUBLICATIONS entries.
 */
export function selectPublicationsForSynthesis(
  publications: SynthesisPublication[],
): SynthesisPublication[] {
  const positionPriority: Record<string, number> = {
    last: 0,
    first: 1,
    middle: 2,
  };

  const sorted = [...publications].sort((a, b) => {
    // Sort by author position priority first (last > first > middle)
    const posDiff =
      (positionPriority[a.authorPosition] ?? 2) -
      (positionPriority[b.authorPosition] ?? 2);
    if (posDiff !== 0) return posDiff;
    // Then by year descending (most recent first)
    return b.year - a.year;
  });

  return sorted.slice(0, MAX_PUBLICATIONS);
}

/**
 * Truncates a methods text to MAX_METHODS_WORDS words.
 */
function truncateMethodsText(text: string): string {
  const words = text.split(/\s+/);
  if (words.length <= MAX_METHODS_WORDS) return text;
  return words.slice(0, MAX_METHODS_WORDS).join(" ") + " [truncated]";
}

/**
 * Builds the user message for the synthesis prompt from the given inputs.
 *
 * Formats all researcher data into the structured template that the LLM
 * expects, following the format defined in prompts/profile-synthesis.md.
 */
export function buildUserMessage(input: SynthesisInput): string {
  const sections: string[] = [];

  sections.push(
    `Analyze the following researcher's information and generate a structured research profile.`,
  );
  sections.push("");

  // Researcher information
  sections.push("=== Researcher Information ===");
  sections.push(`Name: ${input.name}`);
  sections.push(`Affiliation: ${input.affiliation}`);
  if (input.labWebsite) {
    sections.push(`Lab Website: ${input.labWebsite}`);
  }

  // Grant titles
  if (input.grantTitles.length > 0) {
    sections.push("");
    sections.push("=== Grant Titles ===");
    for (const grant of input.grantTitles) {
      sections.push(`- ${grant}`);
    }
  }

  // Publications with abstracts
  const selected = selectPublicationsForSynthesis(input.publications);
  if (selected.length > 0) {
    sections.push("");
    sections.push(
      "=== Publications (most recent research articles, last-author prioritized) ===",
    );
    for (const pub of selected) {
      sections.push(
        `- ${pub.title} (${pub.journal}, ${pub.year}) [${pub.authorPosition} author]`,
      );
      if (pub.abstract) {
        sections.push(`  Abstract: ${pub.abstract}`);
      }
    }

    // Methods sections (separate block for publications that have them)
    const withMethods = selected.filter(
      (p) => p.methodsText && p.methodsText.trim().length > 0,
    );
    if (withMethods.length > 0) {
      sections.push("");
      sections.push("=== Methods Sections (from open-access papers) ===");
      for (const pub of withMethods) {
        sections.push(`- From "${pub.title}":`);
        sections.push(`  ${truncateMethodsText(pub.methodsText!)}`);
      }
    }
  }

  // User-submitted texts
  if (input.userSubmittedTexts.length > 0) {
    sections.push("");
    sections.push("=== Researcher-Submitted Priorities ===");
    for (const text of input.userSubmittedTexts) {
      sections.push(`- ${text.label}: ${text.content}`);
    }
  }

  sections.push("");
  sections.push("---");
  sections.push("");

  // Instructions
  sections.push(SYNTHESIS_INSTRUCTIONS);

  return sections.join("\n");
}

const SYNTHESIS_INSTRUCTIONS = `Generate a structured research profile following these rules:

### Research Summary (150-250 words)

Write a cohesive narrative that connects the researcher's themes, approaches, and contributions. This is NOT a list of topics — it is a synthesis that tells the story of this researcher's program.

- Weight recent publications more heavily than older ones.
- If researcher-submitted priorities are provided, treat them as reflecting current directions — they may diverge from the publication record. Incorporate their emphasis into the narrative, but do NOT quote or directly reference the submitted text.
- The summary must be justifiable entirely from publicly available information (publications, grants). Even if submitted text informed your understanding, the summary should read as if derived from the public record.
- Be specific: name techniques, model systems, molecular targets, and diseases/processes.

### Extraction Rules

For each array field below, extract specific items. Prefer precise terms over broad categories.

**Techniques:** Extract specific methodologies used in the researcher's work.
- Sequencing: RNA-seq, ChIP-seq, ATAC-seq, single-cell RNA sequencing, whole-genome sequencing, bisulfite sequencing, Hi-C, CLIP-seq
- Imaging: confocal microscopy, cryo-ET, live-cell imaging, super-resolution microscopy, light-sheet microscopy, two-photon imaging
- Biochemistry: mass spectrometry, proteomics, CRISPR screens, co-immunoprecipitation, Western blot, ELISA, kinase assays
- Computational: machine learning, deep learning, network analysis, knowledge graphs, molecular dynamics, docking, phylogenetics, natural language processing
- Molecular biology: CRISPR-Cas9 gene editing, cloning, reporter assays, site-directed mutagenesis, optogenetics
- Cell biology: flow cytometry, organoid culture, cell sorting, patch clamp electrophysiology
- Structural: X-ray crystallography, cryo-EM, NMR spectroscopy, SAXS
- In vivo: behavioral testing, metabolic phenotyping, electrophysiology, surgical models
- Clinical: clinical trials, cohort studies, electronic health record analysis, biobank analysis
- Do NOT list generic terms like "data analysis" or "experimental methods."

**Experimental Models:** Extract specific model systems.
- Organisms: species names (Mus musculus, Drosophila melanogaster, C. elegans, Danio rerio)
- Cell lines: specific names and variants (HEK293T, K562, iPSC-derived neurons, patient-derived xenografts)
- Transgenic/knockout models: strain names and genetic modifications (APP/PS1 mice, Cre-lox conditional knockouts)
- Patient samples: clinical sample types (FFPE tissue, peripheral blood mononuclear cells, cerebrospinal fluid)
- For computational labs: databases (UniProt, PDB, TCGA, UK Biobank), knowledge graphs (Wikidata, Hetionet), text corpora (PubMed, clinical notes)

**Disease Areas:** Use standardized terms.
- For disease-focused labs: specific disease names (pancreatic ductal adenocarcinoma, Charcot-Marie-Tooth disease type 2A)
- For basic science labs: list biological processes/systems (mitochondrial dynamics, translational control, circadian rhythm regulation)
- Avoid overly broad terms like "cancer" or "neurodegeneration" — be specific about which type.

**Key Targets:** Extract specific molecular entities.
- Proteins, enzymes, receptors: specific names (HRI kinase, MFN2, BRCA1, PD-L1, mTORC1)
- Transcription factors: specific names (FoxO3, NF-kB, p53, HIF-1alpha)
- Pathways: named pathways (integrated stress response, Wnt/beta-catenin signaling, MAPK/ERK cascade)
- Gene families: specific families (sirtuins, ABC transporters, claudins)
- Do NOT list vague terms like "signaling molecules" or "transcription factors" as a category.

**Keywords:** Additional terms not already captured in the above fields.
- Draw from MeSH terms, methodology descriptors, or research themes.
- This field is optional — returning an empty array is acceptable if the other fields adequately capture the researcher's profile.

### Critical Constraints

1. **Anti-plagiarism:** Do NOT quote or reference researcher-submitted text directly. The profile must appear derived entirely from publicly available sources.
2. **Specificity over breadth:** 5 specific techniques are more valuable than 15 vague ones.
3. **Computational lab handling:** For computational/bioinformatics researchers, "experimental models" means databases, datasets, knowledge graphs, and computational resources.
4. **Recency weighting:** Recent publications and grants reflect current directions more accurately than older work.
5. **Methods sections are gold:** When methods text is available, mine it for specific reagents, protocols, cell lines, and model organisms.

### Output Format

Return ONLY valid JSON matching this schema — no markdown fencing, no commentary outside the JSON:

{
  "research_summary": "150-250 word narrative connecting the researcher's themes and contributions",
  "techniques": ["specific technique 1", "specific technique 2", "..."],
  "experimental_models": ["specific model 1", "specific model 2", "..."],
  "disease_areas": ["specific area 1", "..."],
  "key_targets": ["specific target 1", "specific target 2", "..."],
  "keywords": ["keyword 1", "..."]
}`;

/**
 * Returns the system message for the synthesis prompt.
 */
export function getSystemMessage(): string {
  return SYSTEM_PROMPT;
}

// --- Output parsing ---

/**
 * Parses the raw LLM output string into a SynthesisOutput.
 *
 * Handles common LLM output quirks:
 * - JSON wrapped in markdown code fences
 * - Leading/trailing whitespace
 * - Trailing commas (removed before parsing)
 *
 * Throws if the output is not valid JSON or is missing required fields.
 */
export function parseSynthesisOutput(raw: string): SynthesisOutput {
  // Strip markdown code fences if present
  let cleaned = raw.trim();
  if (cleaned.startsWith("```")) {
    // Remove opening fence (with optional language tag)
    cleaned = cleaned.replace(/^```(?:json)?\s*\n?/, "");
    // Remove closing fence
    cleaned = cleaned.replace(/\n?\s*```\s*$/, "");
  }

  // Remove trailing commas before closing brackets/braces (common LLM mistake)
  cleaned = cleaned.replace(/,\s*([\]}])/g, "$1");

  let parsed: unknown;
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    throw new Error(
      `Failed to parse synthesis output as JSON: ${cleaned.slice(0, 200)}...`,
    );
  }

  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error("Synthesis output must be a JSON object");
  }

  const obj = parsed as Record<string, unknown>;

  // Validate required fields exist
  const requiredFields: (keyof SynthesisOutput)[] = [
    "research_summary",
    "techniques",
    "experimental_models",
    "disease_areas",
    "key_targets",
    "keywords",
  ];

  for (const field of requiredFields) {
    if (!(field in obj)) {
      throw new Error(`Missing required field: ${field}`);
    }
  }

  // Validate types
  if (typeof obj.research_summary !== "string") {
    throw new Error("research_summary must be a string");
  }

  const arrayFields: (keyof SynthesisOutput)[] = [
    "techniques",
    "experimental_models",
    "disease_areas",
    "key_targets",
    "keywords",
  ];

  for (const field of arrayFields) {
    if (!Array.isArray(obj[field])) {
      throw new Error(`${field} must be an array`);
    }
  }

  // Clean arrays: filter out empty strings and deduplicate
  const result: SynthesisOutput = {
    research_summary: (obj.research_summary as string).trim(),
    techniques: deduplicateAndClean(obj.techniques as string[]),
    experimental_models: deduplicateAndClean(
      obj.experimental_models as string[],
    ),
    disease_areas: deduplicateAndClean(obj.disease_areas as string[]),
    key_targets: deduplicateAndClean(obj.key_targets as string[]),
    keywords: deduplicateAndClean(obj.keywords as string[]),
  };

  return result;
}

/**
 * Filters out empty strings and removes duplicates (case-insensitive).
 */
function deduplicateAndClean(arr: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const item of arr) {
    if (typeof item !== "string") continue;
    const trimmed = item.trim();
    if (trimmed.length === 0) continue;
    const lower = trimmed.toLowerCase();
    if (seen.has(lower)) continue;
    seen.add(lower);
    result.push(trimmed);
  }
  return result;
}

// --- Validation ---

/**
 * Counts words in a string using whitespace splitting.
 */
export function countWords(text: string): number {
  return text
    .trim()
    .split(/\s+/)
    .filter((w) => w.length > 0).length;
}

/**
 * Validates a parsed SynthesisOutput against the profile requirements.
 *
 * Returns a ValidationResult with any errors found and counts for
 * use in generating retry prompts.
 */
export function validateSynthesisOutput(
  output: SynthesisOutput,
): ValidationResult {
  const errors: ValidationError[] = [];
  const summaryWordCount = countWords(output.research_summary);

  if (summaryWordCount < SUMMARY_MIN_WORDS) {
    errors.push({
      field: "research_summary",
      message: `Research summary must be at least ${SUMMARY_MIN_WORDS} words (got ${summaryWordCount})`,
    });
  }
  if (summaryWordCount > SUMMARY_MAX_WORDS) {
    errors.push({
      field: "research_summary",
      message: `Research summary must be at most ${SUMMARY_MAX_WORDS} words (got ${summaryWordCount})`,
    });
  }

  if (output.techniques.length < MIN_TECHNIQUES) {
    errors.push({
      field: "techniques",
      message: `At least ${MIN_TECHNIQUES} techniques required (got ${output.techniques.length})`,
    });
  }

  if (output.disease_areas.length < MIN_DISEASE_AREAS) {
    errors.push({
      field: "disease_areas",
      message: `At least ${MIN_DISEASE_AREAS} disease area or biological process required (got ${output.disease_areas.length})`,
    });
  }

  if (output.key_targets.length < MIN_KEY_TARGETS) {
    errors.push({
      field: "key_targets",
      message: `At least ${MIN_KEY_TARGETS} key target required (got ${output.key_targets.length})`,
    });
  }

  return {
    valid: errors.length === 0,
    errors,
    summaryWordCount,
    techniquesCount: output.techniques.length,
    diseaseAreasCount: output.disease_areas.length,
    keyTargetsCount: output.key_targets.length,
  };
}

// --- Retry prompt ---

/**
 * Builds a retry prompt for when the initial synthesis fails validation.
 *
 * Includes specific error messages and current counts to guide the LLM
 * toward a valid output on the second attempt.
 */
export function buildRetryMessage(validation: ValidationResult): string {
  const lines: string[] = [];

  lines.push(
    "Your previous profile synthesis did not pass validation. Please fix the following issues and regenerate:",
  );
  lines.push("");

  for (const error of validation.errors) {
    lines.push(`- ${error.message}`);
  }

  lines.push("");
  lines.push("Requirements:");
  lines.push(
    `- research_summary MUST be 150-250 words (yours was ${validation.summaryWordCount} words)`,
  );
  lines.push(
    `- techniques MUST have at least 3 entries (yours had ${validation.techniquesCount})`,
  );
  lines.push(
    `- disease_areas MUST have at least 1 entry — for basic science labs, list biological processes/systems instead of diseases (yours had ${validation.diseaseAreasCount})`,
  );
  lines.push(
    `- key_targets MUST be non-empty (yours had ${validation.keyTargetsCount})`,
  );
  lines.push("");
  lines.push(
    "Use the same input context provided earlier. Return ONLY valid JSON — no markdown fencing, no commentary.",
  );

  return lines.join("\n");
}
