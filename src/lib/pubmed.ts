/**
 * PubMed/NCBI E-utilities API client for fetching publication abstracts.
 *
 * Uses the NCBI efetch API to batch-fetch PubMed records as XML,
 * then parses them into structured PubMedArticle objects.
 *
 * API docs: https://www.ncbi.nlm.nih.gov/books/NBK25499/
 * Rate limits: 3 req/s without API key, 10 req/s with API key.
 */

import { XMLParser } from "fast-xml-parser";

// --- Public interfaces ---

export interface PubMedAuthor {
  lastName: string;
  foreName: string;
  initials: string;
}

export interface PubMedArticle {
  pmid: string;
  pmcid: string | null;
  doi: string | null;
  title: string;
  abstract: string;
  journal: string;
  year: number;
  articleType: string;
  authors: PubMedAuthor[];
}

// --- Constants ---

const EUTILS_BASE = "https://eutils.ncbi.nlm.nih.gov/entrez/eutils";

/**
 * Maximum PMIDs per efetch request. NCBI recommends batches of ~200
 * for the efetch endpoint.
 */
const BATCH_SIZE = 200;

// --- XML parser configuration ---

/**
 * Configured XML parser for PubMed efetch responses.
 * - isArray: forces certain elements to always be arrays even when
 *   PubMed returns a single child (e.g., one author, one abstract section).
 * - ignoreAttributes: false — we need IdType attributes on ArticleId elements.
 * - attributeNamePrefix: empty — cleaner access to attributes.
 */
function createParser(): XMLParser {
  return new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: "",
    isArray: (name) => {
      // These elements can appear 0-N times; force them to always be arrays
      // so parsing code doesn't need to handle single-element vs array cases.
      return [
        "PubmedArticle",
        "AbstractText",
        "Author",
        "PublicationType",
        "ArticleId",
      ].includes(name);
    },
  });
}

// --- Main fetch function ---

/**
 * Batch-fetches PubMed article metadata for a list of PMIDs.
 *
 * Splits large PMID lists into batches of BATCH_SIZE and fetches
 * them sequentially to respect NCBI rate limits. Appends the NCBI
 * API key if configured via NCBI_API_KEY env var.
 *
 * Articles that fail to parse are skipped with a console warning
 * rather than failing the entire batch.
 *
 * @param pmids - Array of PubMed IDs to fetch
 * @returns Array of parsed PubMedArticle objects (may be fewer than input if some fail)
 */
export async function fetchPubMedAbstracts(
  pmids: string[]
): Promise<PubMedArticle[]> {
  if (pmids.length === 0) return [];

  const results: PubMedArticle[] = [];

  // Process in batches to respect NCBI guidelines
  for (let i = 0; i < pmids.length; i += BATCH_SIZE) {
    const batch = pmids.slice(i, i + BATCH_SIZE);
    const batchResults = await fetchBatch(batch);
    results.push(...batchResults);
  }

  return results;
}

// --- Internal helpers ---

/**
 * Fetches a single batch of PMIDs from the efetch API.
 */
async function fetchBatch(pmids: string[]): Promise<PubMedArticle[]> {
  const url = buildEfetchUrl(pmids);

  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(
      `PubMed efetch API error: ${response.status} ${response.statusText}`
    );
  }

  const xml = await response.text();
  return parsePubMedXml(xml);
}

/**
 * Builds the efetch URL with PMID list and optional API key.
 */
function buildEfetchUrl(pmids: string[]): string {
  const params = new URLSearchParams({
    db: "pubmed",
    id: pmids.join(","),
    rettype: "xml",
    retmode: "xml",
  });

  const apiKey = process.env.NCBI_API_KEY;
  if (apiKey) {
    params.set("api_key", apiKey);
  }

  return `${EUTILS_BASE}/efetch.fcgi?${params.toString()}`;
}

/**
 * Parses PubMed efetch XML into an array of PubMedArticle objects.
 *
 * Handles the standard PubmedArticleSet structure including:
 * - Structured abstracts (multiple AbstractText with labels)
 * - Multiple article IDs (PMID, PMCID, DOI)
 * - Author lists with first/last/middle position determination
 * - Various date formats (Year element, MedlineDate)
 * - Publication type classification
 */
export function parsePubMedXml(xml: string): PubMedArticle[] {
  const parser = createParser();
  const parsed = parser.parse(xml);

  const articleSet = parsed?.PubmedArticleSet;
  if (!articleSet) return [];

  const articles: unknown[] = articleSet.PubmedArticle ?? [];
  const results: PubMedArticle[] = [];

  for (const article of articles) {
    try {
      const parsed = parseOneArticle(article as PubMedRawArticle);
      if (parsed) results.push(parsed);
    } catch (err) {
      // Skip malformed articles rather than failing the entire batch
      const pmid = extractPmidFromRaw(article);
      console.warn(`Failed to parse PubMed article${pmid ? ` (PMID: ${pmid})` : ""}:`, err);
    }
  }

  return results;
}

/**
 * Parses a single PubmedArticle XML node into a PubMedArticle.
 */
function parseOneArticle(raw: PubMedRawArticle): PubMedArticle | null {
  const citation = raw?.MedlineCitation;
  const article = citation?.Article;
  const pubmedData = raw?.PubmedData;

  if (!citation || !article) return null;

  const pmid = String(citation.PMID?.["#text"] ?? citation.PMID ?? "");
  if (!pmid) return null;

  const title = extractTitle(article);
  const abstract = extractAbstract(article);
  const journal = extractJournal(article);
  const year = extractYear(article);
  const authors = extractAuthors(article);
  const articleType = classifyArticleType(article);

  // Extract PMCID and DOI from ArticleIdList in PubmedData
  const articleIds: RawArticleId[] =
    pubmedData?.ArticleIdList?.ArticleId ?? [];
  const pmcid = extractArticleId(articleIds, "pmc");
  const doi = extractArticleId(articleIds, "doi");

  return {
    pmid,
    pmcid,
    doi,
    title,
    abstract,
    journal,
    year,
    articleType,
    authors,
  };
}

/**
 * Extracts the article title, handling both simple text and mixed-content
 * titles (which may contain italic/sup/sub markup).
 */
function extractTitle(article: RawArticle): string {
  const rawTitle = article.ArticleTitle;
  if (!rawTitle) return "";
  if (typeof rawTitle === "string") return rawTitle;
  // Mixed content (e.g., title with <i> tags) — extract text content
  if (typeof rawTitle === "object" && "#text" in rawTitle) {
    return String(rawTitle["#text"]);
  }
  return String(rawTitle);
}

/**
 * Extracts and assembles the abstract text.
 *
 * PubMed abstracts can be:
 * - Simple: a single AbstractText element
 * - Structured: multiple AbstractText elements with Label attributes
 *   (e.g., "BACKGROUND", "METHODS", "RESULTS", "CONCLUSIONS")
 *
 * For structured abstracts, we join sections with their labels.
 */
function extractAbstract(article: RawArticle): string {
  const abstractObj = article.Abstract;
  if (!abstractObj) return "";

  const sections: RawAbstractText[] = abstractObj.AbstractText ?? [];
  if (sections.length === 0) return "";

  const parts: string[] = [];
  for (const section of sections) {
    let text: string;
    let label: string | undefined;

    if (typeof section === "string") {
      text = section;
    } else if (typeof section === "object") {
      text = String(section["#text"] ?? "");
      label = section.Label;
    } else {
      text = String(section);
    }

    if (!text) continue;

    if (label) {
      parts.push(`${label}: ${text}`);
    } else {
      parts.push(text);
    }
  }

  return parts.join("\n");
}

/**
 * Extracts the journal name, preferring the full title over the ISO abbreviation.
 */
function extractJournal(article: RawArticle): string {
  const journal = article.Journal;
  if (!journal) return "";
  return journal.Title ?? journal.ISOAbbreviation ?? "";
}

/**
 * Extracts the publication year from the Journal's PubDate.
 *
 * Handles two PubMed date formats:
 * 1. Standard: <Year>2023</Year>
 * 2. MedlineDate: <MedlineDate>2023 Jan-Mar</MedlineDate>
 *    (used when exact date is unavailable; we extract the year)
 */
function extractYear(article: RawArticle): number {
  const pubDate = article.Journal?.JournalIssue?.PubDate;
  if (!pubDate) return 0;

  // Standard year field
  if (pubDate.Year) {
    const year = parseInt(String(pubDate.Year), 10);
    if (!isNaN(year)) return year;
  }

  // Fallback: MedlineDate (e.g., "2023 Jan-Mar" or "2022-2023")
  if (pubDate.MedlineDate) {
    const match = String(pubDate.MedlineDate).match(/(\d{4})/);
    if (match) return parseInt(match[1]!, 10);
  }

  return 0;
}

/**
 * Extracts the author list from the article.
 *
 * Skips collective/group authors (which have CollectiveName
 * instead of LastName/ForeName).
 */
function extractAuthors(article: RawArticle): PubMedAuthor[] {
  const authorList = article.AuthorList?.Author ?? [];
  const authors: PubMedAuthor[] = [];

  for (const author of authorList) {
    // Skip collective/group authors
    if (!author.LastName) continue;

    authors.push({
      lastName: String(author.LastName),
      foreName: String(author.ForeName ?? ""),
      initials: String(author.Initials ?? ""),
    });
  }

  return authors;
}

/**
 * Classifies the article type from PubMed's PublicationTypeList.
 *
 * Returns a normalized string: 'research-article', 'review', 'editorial',
 * 'letter', 'case-report', 'meta-analysis', 'clinical-trial', or 'other'.
 *
 * PubMed articles can have multiple publication types (e.g.,
 * "Journal Article" + "Research Support, N.I.H."). We pick the most
 * specific/informative type.
 */
function classifyArticleType(article: RawArticle): string {
  const types: (string | RawPublicationType)[] =
    article.PublicationTypeList?.PublicationType ?? [];

  const typeStrings = types.map((t) =>
    (typeof t === "string" ? t : String(t["#text"] ?? t)).toLowerCase()
  );

  // Check for specific types in priority order (most specific first)
  if (typeStrings.some((t) => t.includes("meta-analysis"))) return "meta-analysis";
  if (typeStrings.some((t) => t.includes("clinical trial"))) return "clinical-trial";
  if (typeStrings.some((t) => t.includes("case report"))) return "case-report";
  if (typeStrings.some((t) => t.includes("review"))) return "review";
  if (typeStrings.some((t) => t.includes("editorial"))) return "editorial";
  if (typeStrings.some((t) => t.includes("comment"))) return "comment";
  if (typeStrings.some((t) => t.includes("letter"))) return "letter";
  if (typeStrings.some((t) => t.includes("journal article"))) return "research-article";

  return "other";
}

/**
 * Extracts an article ID by type (e.g., "pmc", "doi") from PubmedData's ArticleIdList.
 */
function extractArticleId(
  articleIds: RawArticleId[],
  idType: string
): string | null {
  const match = articleIds.find(
    (id) => id?.IdType === idType
  );
  if (!match) return null;
  const value = match["#text"] ?? match;
  return typeof value === "string" ? value : String(value);
}

/**
 * Attempts to extract PMID from a raw article for error logging purposes.
 */
function extractPmidFromRaw(raw: unknown): string | null {
  try {
    const r = raw as PubMedRawArticle;
    const pmid = r?.MedlineCitation?.PMID;
    if (!pmid) return null;
    return String(typeof pmid === "object" ? pmid["#text"] : pmid);
  } catch {
    return null;
  }
}

// --- Author position determination ---

/**
 * Determines the position of a researcher in the author list of a publication.
 *
 * Matching is done by last name (case-insensitive). If the researcher's name
 * has multiple parts, we also try matching just the final part (handles
 * compound last names and name variations).
 *
 * @param authors - The publication's author list
 * @param researcherLastName - The researcher's last name (from ORCID profile)
 * @returns 'first', 'last', or 'middle'; defaults to 'middle' if not found
 */
export function determineAuthorPosition(
  authors: PubMedAuthor[],
  researcherLastName: string
): "first" | "last" | "middle" {
  if (authors.length === 0) return "middle";

  const normalizedTarget = researcherLastName.toLowerCase().trim();
  if (!normalizedTarget) return "middle";

  // Find the index of the researcher in the author list
  const index = authors.findIndex((author) => {
    const authorLast = author.lastName.toLowerCase().trim();
    if (authorLast === normalizedTarget) return true;
    // Handle compound last names: try matching the last word
    // e.g., "van der Berg" matches "Berg" or "van der Berg"
    const targetParts = normalizedTarget.split(/\s+/);
    const authorParts = authorLast.split(/\s+/);
    if (targetParts.length > 1 || authorParts.length > 1) {
      return (
        targetParts[targetParts.length - 1] ===
        authorParts[authorParts.length - 1]
      );
    }
    return false;
  });

  if (index === -1) return "middle";
  if (index === 0) return "first";
  if (index === authors.length - 1) return "last";
  return "middle";
}

// --- Internal types for PubMed XML parsing ---

interface PubMedRawArticle {
  MedlineCitation?: {
    PMID?: string | { "#text": string };
    Article?: RawArticle;
  };
  PubmedData?: {
    ArticleIdList?: {
      ArticleId?: RawArticleId[];
    };
  };
}

interface RawArticle {
  ArticleTitle?: string | { "#text": string };
  Abstract?: {
    AbstractText?: RawAbstractText[];
  };
  Journal?: {
    Title?: string;
    ISOAbbreviation?: string;
    JournalIssue?: {
      PubDate?: {
        Year?: string | number;
        MedlineDate?: string;
      };
    };
  };
  AuthorList?: {
    Author?: RawAuthor[];
  };
  PublicationTypeList?: {
    PublicationType?: (string | RawPublicationType)[];
  };
}

type RawAbstractText =
  | string
  | { "#text": string; Label?: string };

interface RawAuthor {
  LastName?: string;
  ForeName?: string;
  Initials?: string;
  CollectiveName?: string;
}

interface RawArticleId {
  "#text"?: string;
  IdType?: string;
}

interface RawPublicationType {
  "#text"?: string;
  UI?: string;
}
