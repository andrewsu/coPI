/**
 * NCBI ID Converter API client for translating between PMID, PMCID, and DOI.
 *
 * Used in the profile ingestion pipeline (Step 5) to identify which
 * publications have PMC full-text available for deep mining. Also resolves
 * DOI-only ORCID works to PMIDs for abstract fetching.
 *
 * API docs: https://www.ncbi.nlm.nih.gov/pmc/tools/id-converter-api/
 * Rate limits: follows general NCBI rate limits (3 req/s without key, 10 req/s with key).
 */

// --- Public interfaces ---

/**
 * Result of an ID conversion for a single identifier.
 * Contains all available IDs for the record, or an error message
 * if the conversion failed (e.g., not open access, unknown ID).
 */
export interface IdConversionRecord {
  pmid: string | null;
  pmcid: string | null;
  doi: string | null;
  /** Error message if the ID could not be converted (e.g., "not open access") */
  errmsg: string | null;
}

/**
 * The full response from the ID converter API.
 */
export interface IdConversionResponse {
  records: IdConversionRecord[];
}

// --- Constants ---

const IDCONV_BASE = "https://www.ncbi.nlm.nih.gov/pmc/utils/idconv/v1.0";

/**
 * Maximum IDs per request. The ID converter API accepts comma-separated
 * lists. We batch at 200 to be consistent with E-utilities limits and
 * avoid overly long URLs.
 */
const BATCH_SIZE = 200;

// --- Main functions ---

/**
 * Converts a list of PMIDs to their corresponding PMCIDs and DOIs.
 *
 * Returns records for all input PMIDs. Records without a PMCID mapping
 * (e.g., papers not in PMC) will have pmcid: null and an errmsg.
 *
 * @param pmids - Array of PubMed IDs to convert
 * @returns Array of conversion records (one per input PMID, order may differ)
 */
export async function convertPmidsToPmcids(
  pmids: string[]
): Promise<IdConversionRecord[]> {
  return convertIds(pmids);
}

/**
 * Converts a list of DOIs to their corresponding PMIDs and PMCIDs.
 *
 * Useful for ORCID works that only have DOIs and need PMIDs for
 * PubMed abstract fetching (spec: "Publications Without PMIDs" edge case).
 *
 * @param dois - Array of DOIs to convert
 * @returns Array of conversion records (one per input DOI, order may differ)
 */
export async function convertDoisToPmids(
  dois: string[]
): Promise<IdConversionRecord[]> {
  return convertIds(dois);
}

/**
 * Converts a mixed list of identifiers (PMIDs, PMCIDs, or DOIs) to
 * all available ID forms.
 *
 * The NCBI ID Converter auto-detects the input ID type based on format:
 * - PMIDs: numeric strings (e.g., "12345678")
 * - PMCIDs: "PMC" prefix (e.g., "PMC1234567")
 * - DOIs: contain "/" (e.g., "10.1038/s41586-023-00001-1")
 *
 * @param ids - Array of identifiers to convert
 * @returns Array of conversion records
 */
export async function convertIds(
  ids: string[]
): Promise<IdConversionRecord[]> {
  if (ids.length === 0) return [];

  const results: IdConversionRecord[] = [];

  for (let i = 0; i < ids.length; i += BATCH_SIZE) {
    const batch = ids.slice(i, i + BATCH_SIZE);
    const batchResults = await fetchConversionBatch(batch);
    results.push(...batchResults);
  }

  return results;
}

// --- Internal helpers ---

/**
 * Fetches a single batch of IDs from the ID converter API.
 */
async function fetchConversionBatch(
  ids: string[]
): Promise<IdConversionRecord[]> {
  const url = buildIdconvUrl(ids);

  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(
      `NCBI ID Converter API error: ${response.status} ${response.statusText}`
    );
  }

  const json = await response.json();
  return parseIdConversionResponse(json);
}

/**
 * Builds the ID converter URL with the given IDs.
 *
 * Includes the NCBI API key if configured, and a tool identifier
 * per NCBI's API usage guidelines.
 */
function buildIdconvUrl(ids: string[]): string {
  const params = new URLSearchParams({
    ids: ids.join(","),
    format: "json",
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

  return `${IDCONV_BASE}/?${params.toString()}`;
}

/**
 * Parses the JSON response from the ID converter API.
 *
 * The API returns a `records` array where each record contains
 * available IDs (pmid, pmcid, doi) or an errmsg if conversion failed.
 *
 * Example successful record:
 *   { "pmid": "12345678", "pmcid": "PMC7654321", "doi": "10.1234/example" }
 *
 * Example failed record:
 *   { "pmid": "87654321", "errmsg": "not open access" }
 */
export function parseIdConversionResponse(
  json: unknown
): IdConversionRecord[] {
  const response = json as RawIdConversionResponse;

  if (!response || !response.records) {
    return [];
  }

  return response.records.map((raw) => ({
    pmid: raw.pmid ?? null,
    pmcid: raw.pmcid ?? null,
    doi: raw.doi ?? null,
    errmsg: raw.errmsg ?? null,
  }));
}

// --- Internal types for API response ---

interface RawIdConversionResponse {
  status?: string;
  responseDate?: string;
  request?: string;
  records?: RawIdConversionRecord[];
}

interface RawIdConversionRecord {
  pmid?: string;
  pmcid?: string;
  doi?: string;
  errmsg?: string;
  versions?: unknown[];
  live?: boolean | string;
  status?: string;
}
