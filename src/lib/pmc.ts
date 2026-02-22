/**
 * PMC E-utilities client for deep mining of methods sections from open-access papers.
 *
 * Fetches full-text PMC articles via the NCBI efetch API (db=pmc) and extracts
 * the methods/materials section text. This text is stored on the Publication
 * entity as methods_text and feeds into the LLM profile synthesis pipeline
 * (spec: profile-ingestion.md, Step 5).
 *
 * Uses raw XML pattern matching + balanced tag extraction rather than DOM
 * parsing. This preserves text ordering in mixed-content elements (text
 * interspersed with inline markup like <italic>, <bold>, <xref>).
 *
 * API docs: https://www.ncbi.nlm.nih.gov/books/NBK25499/
 * Rate limits: 3 req/s without API key, 10 req/s with API key.
 */

// --- Public interfaces ---

/**
 * Result of methods section extraction for a single PMC article.
 */
export interface PmcMethodsResult {
  /** PMCID with "PMC" prefix (e.g., "PMC1234567") */
  pmcid: string;
  /** Extracted methods section plain text, or null if not found/available */
  methodsText: string | null;
}

// --- Constants ---

const EUTILS_BASE = "https://eutils.ncbi.nlm.nih.gov/entrez/eutils";

/**
 * Maximum PMCIDs per efetch request. PMC full-text articles are much larger
 * than PubMed abstract records, so we use a smaller batch size to avoid
 * excessive response sizes and memory usage.
 */
const BATCH_SIZE = 10;

/**
 * sec-type attribute values that indicate a methods section in JATS XML.
 */
const METHODS_SEC_TYPES = new Set([
  "methods",
  "materials|methods",
  "materials-methods",
  "materials and methods",
  "material|methods",
  "subjects|methods",
]);

/**
 * Title patterns that indicate a methods section.
 * Matched against the text content of the first <title> element in a section.
 */
const METHODS_TITLE_PATTERNS = [
  /^materials?\s*(and|&)\s*methods?\s*$/i,
  /^methods?\s*$/i,
  /^experimental\s*(procedures?|methods?|section|details?)?\s*$/i,
  /^star[\s\u2605]\s*methods?\s*$/i,
  /^online\s*methods?\s*$/i,
  /^study\s*design(\s*(and|&)\s*methods?)?\s*$/i,
  /^patients?\s*(and|&)\s*methods?\s*$/i,
  /^subjects?\s*(and|&)\s*methods?\s*$/i,
];

// --- Main fetch function ---

/**
 * Batch-fetches PMC full-text articles and extracts methods sections.
 *
 * For each PMCID, fetches the full-text XML from PMC and attempts to
 * extract the methods/materials section. Returns results for all
 * requested PMCIDs; articles without a methods section return null.
 *
 * @param pmcids - Array of PMCIDs (with "PMC" prefix, e.g., ["PMC1234567"])
 * @returns Array of results, one per input PMCID
 */
export async function fetchMethodsSections(
  pmcids: string[]
): Promise<PmcMethodsResult[]> {
  if (pmcids.length === 0) return [];

  const results: PmcMethodsResult[] = [];

  for (let i = 0; i < pmcids.length; i += BATCH_SIZE) {
    const batch = pmcids.slice(i, i + BATCH_SIZE);
    const batchResults = await fetchBatch(batch);
    results.push(...batchResults);
  }

  return results;
}

// --- Internal fetch helpers ---

/**
 * Fetches a single batch of PMCIDs from the PMC efetch API.
 */
async function fetchBatch(pmcids: string[]): Promise<PmcMethodsResult[]> {
  const url = buildEfetchUrl(pmcids);

  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(
      `PMC efetch API error: ${response.status} ${response.statusText}`
    );
  }

  const xml = await response.text();
  return parsePmcXml(xml, pmcids);
}

/**
 * Builds the PMC efetch URL.
 *
 * PMC efetch expects numeric IDs without the "PMC" prefix.
 * Includes tool, email, and API key per NCBI API guidelines.
 */
export function buildEfetchUrl(pmcids: string[]): string {
  const numericIds = pmcids.map(stripPmcPrefix);

  const params = new URLSearchParams({
    db: "pmc",
    id: numericIds.join(","),
    rettype: "xml",
    tool: "copi",
  });

  const apiKey = process.env.NCBI_API_KEY;
  if (apiKey) {
    params.set("api_key", apiKey);
  }

  const email = process.env.NCBI_EMAIL;
  if (email) {
    params.set("email", email);
  }

  return `${EUTILS_BASE}/efetch.fcgi?${params.toString()}`;
}

/**
 * Strips the "PMC" prefix from a PMCID, returning just the numeric part.
 * Handles both "PMC1234567" and "pmc1234567" (case-insensitive).
 */
function stripPmcPrefix(pmcid: string): string {
  return pmcid.replace(/^PMC/i, "");
}

// --- XML parsing ---

/**
 * Parses a PMC efetch XML response and extracts methods sections.
 *
 * Handles batch responses containing multiple articles within
 * a <pmc-articleset> wrapper. Articles not found in the response
 * get null methodsText.
 *
 * @param xml - Raw XML response from PMC efetch
 * @param requestedPmcids - PMCIDs that were requested (for tracking missing articles)
 * @returns Array of results, one per requested PMCID
 */
export function parsePmcXml(
  xml: string,
  requestedPmcids: string[]
): PmcMethodsResult[] {
  const articleXmls = extractArticleXmls(xml);
  const resultMap = new Map<string, PmcMethodsResult>();

  for (const articleXml of articleXmls) {
    try {
      const pmcid = extractPmcidFromXml(articleXml);
      if (!pmcid) continue;

      const methodsText = extractMethodsText(articleXml);
      resultMap.set(pmcid.toUpperCase(), {
        pmcid,
        methodsText: methodsText || null,
      });
    } catch (err) {
      console.warn("Failed to parse PMC article:", err);
    }
  }

  // Build results in the order of requestedPmcids, filling in nulls for missing
  const results: PmcMethodsResult[] = [];
  for (const pmcid of requestedPmcids) {
    const found = resultMap.get(pmcid.toUpperCase());
    if (found) {
      results.push(found);
    } else {
      results.push({ pmcid, methodsText: null });
    }
  }

  return results;
}

/**
 * Extracts individual <article>...</article> XML chunks from a
 * <pmc-articleset> response. Works whether or not the articles are
 * wrapped in a <pmc-articleset> element.
 */
function extractArticleXmls(xml: string): string[] {
  const articles: string[] = [];
  const openTag = "<article";

  let searchFrom = 0;
  while (searchFrom < xml.length) {
    const start = xml.indexOf(openTag, searchFrom);
    if (start === -1) break;

    // Verify this is actually an <article> tag (not e.g. <article-id>)
    const charAfter = xml[start + openTag.length];
    if (charAfter !== undefined && /[\s>\/]/.test(charAfter)) {
      const articleXml = extractBalancedElement(xml, start, "article");
      if (articleXml) {
        articles.push(articleXml);
        searchFrom = start + articleXml.length;
        continue;
      }
    }
    searchFrom = start + openTag.length;
  }

  return articles;
}

/**
 * Extracts the PMCID from a single article's XML.
 *
 * Looks for <article-id pub-id-type="pmc">NNNNNNN</article-id>
 * in the article's front matter.
 */
function extractPmcidFromXml(articleXml: string): string | null {
  const pmcIdRegex =
    /<article-id[^>]+pub-id-type\s*=\s*["']pmc["'][^>]*>(\d+)<\/article-id>/i;
  const match = pmcIdRegex.exec(articleXml);
  if (match) return `PMC${match[1]}`;
  return null;
}

// --- Methods section extraction ---

/**
 * Extracts the methods/materials section text from a single PMC article's XML.
 *
 * Identification strategies (in priority order):
 * 1. <sec sec-type="methods"> or related sec-type attribute values
 * 2. <sec> with a <title> matching common methods section names
 *
 * Only examines top-level body sections to avoid matching subsections
 * (e.g., a "Statistical Methods" subsection within Results).
 *
 * @returns Plain text of the methods section, or empty string if not found
 */
export function extractMethodsText(articleXml: string): string {
  const sectionXml = findMethodsSectionXml(articleXml);
  if (!sectionXml) return "";

  return stripXmlTags(sectionXml);
}

/**
 * Finds the raw XML of the methods section within an article.
 * Searches only within the <body> element and only examines
 * top-level sections (skips over nested subsections).
 */
function findMethodsSectionXml(articleXml: string): string | null {
  // Find the body element
  const bodyStart = articleXml.indexOf("<body");
  const bodyEnd = articleXml.indexOf("</body>");
  if (bodyStart === -1 || bodyEnd === -1) return null;

  const bodyXml = articleXml.substring(bodyStart, bodyEnd + "</body>".length);

  // Iterate through top-level <sec> elements within the body
  const bodyInnerStart = bodyXml.indexOf(">") + 1;
  const secRegex = /<sec[\s>]/g;
  secRegex.lastIndex = bodyInnerStart;

  let secMatch;
  while ((secMatch = secRegex.exec(bodyXml)) !== null) {
    const sectionXml = extractBalancedElement(bodyXml, secMatch.index, "sec");
    if (!sectionXml) continue;

    // Strategy 1: Check sec-type attribute
    const secTypeMatch = sectionXml.match(
      /^<sec[^>]+sec-type\s*=\s*["']([^"']*)["']/i
    );
    if (secTypeMatch && METHODS_SEC_TYPES.has(secTypeMatch[1]!.toLowerCase())) {
      return sectionXml;
    }

    // Strategy 2: Check title text
    const titleText = extractFirstTitle(sectionXml);
    if (titleText && METHODS_TITLE_PATTERNS.some((p) => p.test(titleText))) {
      return sectionXml;
    }

    // Skip past this entire section to only examine top-level sections
    secRegex.lastIndex = secMatch.index + sectionXml.length;
  }

  return null;
}

/**
 * Extracts the text content of the first <title> element in a section,
 * before any nested <sec> elements. This gives us the section's own title
 * rather than a subsection title.
 */
function extractFirstTitle(sectionXml: string): string | null {
  const afterOpenTag = sectionXml.indexOf(">") + 1;

  // Find first nested <sec> (not <sec-meta> or similar)
  const nestedSecRegex = /<sec[\s>]/g;
  nestedSecRegex.lastIndex = afterOpenTag;
  const nestedSecMatch = nestedSecRegex.exec(sectionXml);
  const searchEnd = nestedSecMatch ? nestedSecMatch.index : sectionXml.length;

  const searchArea = sectionXml.substring(0, searchEnd);
  const titleRegex = /<title[^>]*>([\s\S]*?)<\/title>/i;
  const match = titleRegex.exec(searchArea);
  if (!match) return null;

  // Strip any inline markup from the title text
  return match[1]!.replace(/<[^>]*>/g, "").trim();
}

// --- Balanced XML element extraction ---

/**
 * Extracts a balanced XML element starting at the given index.
 *
 * Properly handles nested elements of the same tag name. For example,
 * extracting a <sec> that contains nested <sec> subsections.
 *
 * @param xml - Full XML string
 * @param startIndex - Index of the opening '<' of the element
 * @param tagName - The element tag name to balance
 * @returns The complete element including tags, or null if unbalanced
 */
export function extractBalancedElement(
  xml: string,
  startIndex: number,
  tagName: string
): string | null {
  const openTag = `<${tagName}`;
  const closeTag = `</${tagName}>`;
  let depth = 0;
  let i = startIndex;

  while (i < xml.length) {
    const nextOpen = xml.indexOf(openTag, i);
    const nextClose = xml.indexOf(closeTag, i);

    // No more tags found at all
    if (nextOpen === -1 && nextClose === -1) return null;

    // Check if opening tag comes first (or only opening tags remain)
    const openFirst =
      nextOpen !== -1 && (nextClose === -1 || nextOpen < nextClose);

    if (openFirst) {
      // Verify this is a real tag (not e.g. <section> when matching <sec>)
      const charAfterTag = xml[nextOpen + openTag.length];
      if (
        charAfterTag !== undefined &&
        /[\s>\/]/.test(charAfterTag)
      ) {
        // Check for self-closing tag (e.g., <sec/>)
        const tagEnd = xml.indexOf(">", nextOpen);
        if (tagEnd === -1) return null;

        if (xml[tagEnd - 1] === "/") {
          // Self-closing tag
          if (depth === 0) {
            // Target element is self-closing
            return xml.substring(startIndex, tagEnd + 1);
          }
          // Nested self-closing, skip
          i = tagEnd + 1;
          continue;
        }

        depth++;
        i = tagEnd + 1;
      } else {
        // Not a matching tag name, skip past
        i = nextOpen + openTag.length;
      }
    } else {
      // Closing tag found first (or only closing tags remain)
      depth--;
      if (depth === 0) {
        return xml.substring(startIndex, nextClose + closeTag.length);
      }
      if (depth < 0) return null; // More closes than opens
      i = nextClose + closeTag.length;
    }
  }

  return null;
}

// --- XML tag stripping ---

/**
 * Converts an XML section to plain text by stripping tags and normalizing whitespace.
 *
 * Preserves paragraph structure by adding newlines for block-level element
 * boundaries. Decodes common XML entities.
 */
export function stripXmlTags(xml: string): string {
  return (
    xml
      // Replace block-level closing tags with double newlines for paragraph separation
      .replace(
        /<\/(?:p|sec|title|list-item|list|table-wrap|caption|fn|def)>/gi,
        "\n\n"
      )
      // Replace <br/> and similar with newlines
      .replace(/<br\s*\/?>/gi, "\n")
      // Remove all remaining XML tags
      .replace(/<[^>]+>/g, " ")
      // Decode common XML entities
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&quot;/g, '"')
      .replace(/&apos;/g, "'")
      .replace(/&#x([0-9a-fA-F]+);/g, (_m, hex: string) =>
        String.fromCharCode(parseInt(hex, 16))
      )
      .replace(/&#(\d+);/g, (_m, dec: string) =>
        String.fromCharCode(parseInt(dec, 10))
      )
      // Normalize horizontal whitespace within lines
      .replace(/[ \t]+/g, " ")
      // Remove spaces around newlines
      .replace(/[ \t]*\n[ \t]*/g, "\n")
      // Collapse multiple newlines to double newlines (paragraph breaks)
      .replace(/\n{2,}/g, "\n\n")
      .trim()
  );
}
