/**
 * Profile pipeline orchestration service.
 *
 * Coordinates the full profile ingestion pipeline:
 *   ORCID (profile, grants, works) → PubMed (abstracts) → PMC (methods) →
 *   LLM synthesis → database storage.
 *
 * Implements rate-limited NCBI API calls with inter-call delays, DOI-to-PMID
 * resolution for DOI-only ORCID works, and proper handling of sparse ORCID
 * profiles and synthesis failures.
 *
 * See specs/profile-ingestion.md for the full pipeline specification.
 */

import type { PrismaClient, AuthorPosition } from "@prisma/client";
import type Anthropic from "@anthropic-ai/sdk";
import { createHash } from "crypto";

import {
  fetchOrcidProfile,
  fetchOrcidGrantTitles,
  fetchOrcidWorks,
} from "@/lib/orcid";
import {
  fetchPubMedAbstracts,
  determineAuthorPosition,
  type PubMedArticle,
} from "@/lib/pubmed";
import { fetchMethodsSections } from "@/lib/pmc";
import {
  convertPmidsToPmcids,
  convertDoisToPmids,
} from "@/lib/ncbi-id-converter";
import type {
  SynthesisInput,
  SynthesisPublication,
  UserSubmittedText,
} from "@/lib/profile-synthesis-prompt";
import {
  synthesizeProfile,
  type ProfileSynthesisResult,
} from "./profile-synthesis";

// --- Public types ---

export interface PipelineOptions {
  /** Whether to fetch methods sections from PMC for open-access papers. Default: true. */
  deepMining?: boolean;
  /** ORCID OAuth access token for member API access. */
  accessToken?: string;
}

export interface PipelineResult {
  userId: string;
  /** True if a new profile was created; false if an existing one was updated. */
  profileCreated: boolean;
  /** Number of Publication records stored in the database. */
  publicationsStored: number;
  /** Result from the LLM synthesis step (includes validation details). */
  synthesis: ProfileSynthesisResult;
  /** Warnings generated during pipeline execution (e.g., sparse ORCID). */
  warnings: string[];
  /** The profile_version after this pipeline run. */
  profileVersion: number;
}

// --- Constants ---

/**
 * Batch size for PMC methods fetching at the pipeline level.
 * Matches the PMC client's internal batch size to ensure exactly one
 * HTTP request per pipeline-level batch, allowing us to add rate-limiting
 * delays between requests.
 */
const PMC_PIPELINE_BATCH_SIZE = 10;

// --- Rate limiting ---

/**
 * Returns the minimum delay in milliseconds between consecutive NCBI API calls.
 * NCBI allows 3 req/s without an API key (333ms between requests) and
 * 10 req/s with an API key (100ms). We add a safety margin.
 */
export function getNcbiDelayMs(): number {
  return process.env.NCBI_API_KEY ? 110 : 350;
}

function delay(ms: number): Promise<void> {
  if (ms <= 0) return Promise.resolve();
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// --- Pipeline ---

/**
 * Runs the full profile ingestion pipeline for a researcher.
 *
 * Steps:
 * 1. Fetch ORCID profile, grants, and works (parallel)
 * 2. Resolve DOI-only works to PMIDs via NCBI ID Converter
 * 3. Fetch PubMed abstracts for all PMIDs
 * 4. Deep mine methods sections from PMC (if enabled)
 * 5. Store Publication records in the database
 * 6. Compute raw abstracts hash for change detection
 * 7. Retrieve existing user-submitted texts
 * 8. Assemble synthesis input and call Claude
 * 9. Store/update ResearcherProfile
 *
 * @param db - Prisma client for database operations
 * @param llm - Anthropic SDK client for LLM synthesis
 * @param userId - The User record's ID
 * @param orcid - The researcher's ORCID iD
 * @param options - Pipeline configuration
 * @throws If ORCID API calls fail or if database operations fail
 */
export async function runProfilePipeline(
  db: PrismaClient,
  llm: Anthropic,
  userId: string,
  orcid: string,
  options: PipelineOptions = {},
): Promise<PipelineResult> {
  const deepMining = options.deepMining ?? true;
  const accessToken = options.accessToken;
  const warnings: string[] = [];
  const ncbiDelayMs = getNcbiDelayMs();

  // --- Steps 1-3: Fetch ORCID data (profile, grants, works) in parallel ---
  const [orcidProfile, grantTitles, orcidWorks] = await Promise.all([
    fetchOrcidProfile(orcid, accessToken),
    fetchOrcidGrantTitles(orcid, accessToken),
    fetchOrcidWorks(orcid, accessToken),
  ]);

  // Spec: "If the ORCID works list has fewer than 5 entries, nudge the user"
  if (orcidWorks.length < 5) {
    warnings.push(
      `We found ${orcidWorks.length} publications on your ORCID profile. ` +
        `For the best collaboration matching, please ensure your ORCID is up to date at orcid.org.`,
    );
  }

  // --- Resolve identifiers ---
  const worksWithPmid = orcidWorks.filter((w) => w.pmid);
  const worksWithDoiOnly = orcidWorks.filter((w) => !w.pmid && w.doi);

  // Convert DOI-only works to PMIDs (spec: "Publications Without PMIDs")
  const doiToPmid = new Map<string, string>();
  if (worksWithDoiOnly.length > 0) {
    await delay(ncbiDelayMs);
    const records = await convertDoisToPmids(
      worksWithDoiOnly.map((w) => w.doi!),
    );
    for (const record of records) {
      if (record.pmid && record.doi) {
        doiToPmid.set(record.doi.toLowerCase(), record.pmid);
      }
    }
  }

  // Collect all PMIDs we can fetch from PubMed
  const allPmids = [
    ...worksWithPmid.map((w) => w.pmid!),
    ...Array.from(doiToPmid.values()),
  ];

  // --- Step 4: Fetch PubMed abstracts ---
  let pubmedArticles: PubMedArticle[] = [];
  if (allPmids.length > 0) {
    await delay(ncbiDelayMs);
    pubmedArticles = await fetchPubMedAbstracts(allPmids);
  }

  // --- Step 5: Deep mining (methods sections from PMC) ---
  const methodsByPmcid = new Map<string, string>();
  const pmidToPmcid = new Map<string, string>();

  if (deepMining && pubmedArticles.length > 0) {
    // Collect PMCIDs already known from PubMed data
    for (const article of pubmedArticles) {
      if (article.pmcid) {
        pmidToPmcid.set(article.pmid, article.pmcid);
      }
    }

    // Convert remaining PMIDs to PMCIDs to find more open-access papers
    const pmidsWithoutPmcid = pubmedArticles
      .filter((a) => !a.pmcid)
      .map((a) => a.pmid);

    if (pmidsWithoutPmcid.length > 0) {
      await delay(ncbiDelayMs);
      const convRecords = await convertPmidsToPmcids(pmidsWithoutPmcid);
      for (const record of convRecords) {
        if (record.pmcid && record.pmid) {
          pmidToPmcid.set(record.pmid, record.pmcid);
        }
      }
    }

    // Fetch methods sections in rate-limited batches
    const allPmcids = Array.from(new Set(pmidToPmcid.values()));
    for (let i = 0; i < allPmcids.length; i += PMC_PIPELINE_BATCH_SIZE) {
      await delay(ncbiDelayMs);
      const batch = allPmcids.slice(i, i + PMC_PIPELINE_BATCH_SIZE);
      const results = await fetchMethodsSections(batch);
      for (const result of results) {
        if (result.methodsText) {
          methodsByPmcid.set(result.pmcid.toUpperCase(), result.methodsText);
        }
      }
    }
  }

  // --- Step 6: Store publications ---
  const researcherLastName = extractLastName(orcidProfile.name);

  // Build full records from PubMed data
  const pubRecordsFromPubmed = pubmedArticles.map((article) => {
    const authorPosition = determineAuthorPosition(
      article.authors,
      researcherLastName,
    );
    const pmcid =
      pmidToPmcid.get(article.pmid) ?? article.pmcid ?? null;
    const pmcidKey = pmcid?.toUpperCase() ?? null;
    const methodsText = pmcidKey
      ? (methodsByPmcid.get(pmcidKey) ?? null)
      : null;

    return {
      userId,
      pmid: article.pmid,
      pmcid,
      doi: article.doi,
      title: article.title,
      abstract: article.abstract,
      journal: article.journal,
      year: article.year,
      authorPosition: authorPosition as AuthorPosition,
      methodsText,
    };
  });

  // Build minimal records for DOI-only works that couldn't resolve to PMIDs
  // (spec: "store with DOI only and skip abstract fetch for that paper")
  const unresolvedDoiWorks = worksWithDoiOnly.filter(
    (w) => !doiToPmid.has(w.doi!.toLowerCase()),
  );
  const pubRecordsFromDoi = unresolvedDoiWorks.map((work) => ({
    userId,
    pmid: null,
    pmcid: work.pmcid,
    doi: work.doi,
    title: work.title,
    abstract: "",
    journal: work.journal ?? "",
    year: work.year ?? 0,
    authorPosition: "middle" as AuthorPosition,
    methodsText: null,
  }));

  const allPubRecords = [...pubRecordsFromPubmed, ...pubRecordsFromDoi];

  // Full refresh: delete existing publications and store new ones
  await db.publication.deleteMany({ where: { userId } });
  if (allPubRecords.length > 0) {
    await db.publication.createMany({ data: allPubRecords });
  }

  // --- Step 7: Compute abstracts hash ---
  const rawAbstractsHash = computeAbstractsHash(pubmedArticles);

  // --- Step 8: Retrieve existing user-submitted texts ---
  const existingProfile = await db.researcherProfile.findUnique({
    where: { userId },
  });
  const userSubmittedTexts = parseUserSubmittedTexts(
    existingProfile?.userSubmittedTexts,
  );

  // --- Step 9: Assemble synthesis input and call Claude ---
  const synthesisPublications: SynthesisPublication[] = pubmedArticles.map(
    (article) => {
      const authorPosition = determineAuthorPosition(
        article.authors,
        researcherLastName,
      );
      const pmcid = pmidToPmcid.get(article.pmid) ?? article.pmcid;
      const pmcidKey = pmcid?.toUpperCase();
      const methodsText = pmcidKey
        ? methodsByPmcid.get(pmcidKey)
        : undefined;

      return {
        title: article.title,
        journal: article.journal,
        year: article.year,
        authorPosition,
        abstract: article.abstract,
        methodsText: methodsText || undefined,
      };
    },
  );

  const synthesisInput: SynthesisInput = {
    name: orcidProfile.name,
    affiliation:
      [orcidProfile.institution, orcidProfile.department]
        .filter(Boolean)
        .join(", ") || "Unknown",
    labWebsite: orcidProfile.labWebsiteUrl ?? undefined,
    grantTitles,
    publications: synthesisPublications,
    userSubmittedTexts,
  };

  const synthesisResult = await synthesizeProfile(llm, synthesisInput);

  // --- Step 10: Store/update ResearcherProfile ---
  const profileFields = buildProfileFields(
    synthesisResult,
    grantTitles,
    rawAbstractsHash,
  );

  let profileVersion: number;
  let profileCreated: boolean;

  if (existingProfile) {
    const updated = await db.researcherProfile.update({
      where: { userId },
      data: {
        ...profileFields,
        profileVersion: existingProfile.profileVersion + 1,
      },
    });
    profileVersion = updated.profileVersion;
    profileCreated = false;
  } else {
    const created = await db.researcherProfile.create({
      data: {
        userId,
        ...profileFields,
        profileVersion: 1,
      },
    });
    profileVersion = created.profileVersion;
    profileCreated = true;
  }

  return {
    userId,
    profileCreated,
    publicationsStored: allPubRecords.length,
    synthesis: synthesisResult,
    warnings,
    profileVersion,
  };
}

// --- Internal helpers ---

/**
 * Extracts the last name from a full name string for PubMed author matching.
 * Takes the last whitespace-separated token (handles "Jane Smith" → "Smith").
 */
export function extractLastName(fullName: string): string {
  const parts = fullName.trim().split(/\s+/);
  return parts[parts.length - 1] || fullName;
}

/**
 * Computes a SHA-256 hash of all abstract texts for change detection.
 * Abstracts are sorted alphabetically to produce a consistent hash
 * regardless of the order articles were fetched from PubMed.
 */
export function computeAbstractsHash(articles: PubMedArticle[]): string {
  const sorted = articles
    .map((a) => a.abstract)
    .sort()
    .join("\n");
  return createHash("sha256").update(sorted).digest("hex");
}

/**
 * Parses user-submitted texts from the JSONB field on ResearcherProfile.
 * Each entry should have {label, content} structure.
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

/**
 * Builds the ResearcherProfile field values from synthesis results.
 * If synthesis produced no output (both attempts failed), creates a minimal
 * profile with empty fields — per spec: "save what we have and flag for review."
 */
function buildProfileFields(
  synthesis: ProfileSynthesisResult,
  grantTitles: string[],
  rawAbstractsHash: string,
) {
  const output = synthesis.output;
  if (!output) {
    return {
      researchSummary: "",
      techniques: [] as string[],
      experimentalModels: [] as string[],
      diseaseAreas: [] as string[],
      keyTargets: [] as string[],
      keywords: [] as string[],
      grantTitles,
      rawAbstractsHash,
      profileGeneratedAt: new Date(),
    };
  }

  return {
    researchSummary: output.research_summary,
    techniques: output.techniques,
    experimentalModels: output.experimental_models,
    diseaseAreas: output.disease_areas,
    keyTargets: output.key_targets,
    keywords: output.keywords,
    grantTitles,
    rawAbstractsHash,
    profileGeneratedAt: new Date(),
  };
}
