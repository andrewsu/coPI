/**
 * ORCID API client for fetching researcher profile data.
 *
 * Supports both the member API (with access token, /read-limited scope)
 * and public API (no auth, public visibility items only).
 *
 * ORCID API docs: https://info.orcid.org/documentation/api-tutorials/
 */

export interface OrcidProfile {
  orcid: string;
  name: string;
  email: string | null;
  institution: string | null;
  department: string | null;
  labWebsiteUrl: string | null;
}

/**
 * A single work (publication) extracted from ORCID's /works endpoint.
 * Contains identifiers needed for PubMed/PMC abstract fetching.
 */
export interface OrcidWork {
  title: string;
  pmid: string | null;
  pmcid: string | null;
  doi: string | null;
  type: string | null;
  year: number | null;
  journal: string | null;
}

/**
 * A single funding entry extracted from ORCID's /fundings endpoint.
 */
export interface OrcidFunding {
  title: string;
  type: string | null;
  organization: string | null;
  startYear: number | null;
  endYear: number | null;
}

interface OrcidPersonName {
  "given-names": { value: string } | null;
  "family-name": { value: string } | null;
  "credit-name": { value: string } | null;
}

interface OrcidEmail {
  email: string;
  primary: boolean;
  verified: boolean;
}

interface OrcidEmploymentSummary {
  "employment-summary": {
    organization: {
      name: string;
    };
    "department-name": string | null;
    "start-date": { year: { value: string } } | null;
    "end-date": { year: { value: string } } | null;
  };
}

function getApiBaseUrl(accessToken: string | undefined, sandbox: boolean): string {
  if (sandbox) {
    return accessToken
      ? "https://api.sandbox.orcid.org"
      : "https://pub.sandbox.orcid.org";
  }
  return accessToken
    ? "https://api.orcid.org"
    : "https://pub.orcid.org";
}

function isSandbox(): boolean {
  return process.env.ORCID_SANDBOX === "true";
}

function buildHeaders(accessToken?: string): Record<string, string> {
  const headers: Record<string, string> = {
    Accept: "application/json",
  };
  if (accessToken) {
    headers["Authorization"] = `Bearer ${accessToken}`;
  }
  return headers;
}

/**
 * Fetches a researcher's name, email, and lab website from the ORCID /person endpoint.
 */
export async function fetchOrcidPerson(
  orcid: string,
  accessToken?: string
): Promise<{
  email: string | null;
  givenName: string | null;
  familyName: string | null;
  creditName: string | null;
  labWebsiteUrl: string | null;
}> {
  const apiBase = getApiBaseUrl(accessToken, isSandbox());
  const headers = buildHeaders(accessToken);

  const response = await fetch(`${apiBase}/v3.0/${orcid}/person`, { headers });
  if (!response.ok) {
    throw new Error(`ORCID person API error: ${response.status} ${response.statusText}`);
  }

  const data = await response.json();
  const name: OrcidPersonName | undefined = data?.name;

  const givenName = name?.["given-names"]?.value ?? null;
  const familyName = name?.["family-name"]?.value ?? null;
  const creditName = name?.["credit-name"]?.value ?? null;

  // Get primary verified email, falling back to any verified, then any email
  const emails: OrcidEmail[] = data?.emails?.email ?? [];
  const primaryEmail =
    emails.find((e) => e.primary && e.verified)?.email ??
    emails.find((e) => e.verified)?.email ??
    emails[0]?.email ??
    null;

  // Extract lab website from researcher-urls.
  // Prefer URLs with lab/website/homepage in the name, fall back to first URL.
  const researcherUrls: { "url-name": string | null; url: { value: string } }[] =
    data?.["researcher-urls"]?.["researcher-url"] ?? [];
  const labWebsiteUrl = pickLabWebsiteUrl(researcherUrls);

  return { email: primaryEmail, givenName, familyName, creditName, labWebsiteUrl };
}

/**
 * Fetches a researcher's current employment (institution, department)
 * from the ORCID /employments endpoint.
 *
 * Selects the most recent active employment (no end date),
 * falling back to the most recent ended employment.
 */
export async function fetchOrcidEmployments(
  orcid: string,
  accessToken?: string
): Promise<{
  institution: string | null;
  department: string | null;
}> {
  const apiBase = getApiBaseUrl(accessToken, isSandbox());
  const headers = buildHeaders(accessToken);

  const response = await fetch(`${apiBase}/v3.0/${orcid}/employments`, {
    headers,
  });
  if (!response.ok) {
    throw new Error(
      `ORCID employments API error: ${response.status} ${response.statusText}`
    );
  }

  const data = await response.json();
  const groups: { summaries: OrcidEmploymentSummary[] }[] =
    data?.["affiliation-group"] ?? [];

  let bestEmployment: OrcidEmploymentSummary["employment-summary"] | null =
    null;
  let bestStartYear = -1;
  let bestIsActive = false;

  for (const group of groups) {
    for (const summary of group.summaries ?? []) {
      const employment = summary["employment-summary"];
      if (!employment) continue;

      const startYear = parseInt(
        employment["start-date"]?.year?.value ?? "0",
        10
      );
      const isActive = !employment["end-date"];

      // Prefer active over ended; among same category, prefer later start
      if (
        !bestEmployment ||
        (isActive && !bestIsActive) ||
        (isActive === bestIsActive && startYear > bestStartYear)
      ) {
        bestEmployment = employment;
        bestStartYear = startYear;
        bestIsActive = isActive;
      }
    }
  }

  if (!bestEmployment) return { institution: null, department: null };

  return {
    institution: bestEmployment.organization?.name ?? null,
    department: bestEmployment["department-name"] ?? null,
  };
}

/**
 * Fetches a complete ORCID profile: name, email, institution, department, lab website.
 * Combines data from /person and /employments endpoints.
 */
export async function fetchOrcidProfile(
  orcid: string,
  accessToken?: string
): Promise<OrcidProfile> {
  const [person, employment] = await Promise.all([
    fetchOrcidPerson(orcid, accessToken),
    fetchOrcidEmployments(orcid, accessToken),
  ]);

  // Prefer credit name, then given+family, then just orcid as fallback
  const name =
    person.creditName ??
    ([person.givenName, person.familyName].filter(Boolean).join(" ") || orcid);

  return {
    orcid,
    name,
    email: person.email,
    institution: employment.institution,
    department: employment.department,
    labWebsiteUrl: person.labWebsiteUrl,
  };
}

/**
 * Selects the most likely lab website URL from ORCID researcher-urls.
 * Prefers URLs whose name contains lab/website/homepage keywords,
 * falls back to the first URL if none match.
 */
function pickLabWebsiteUrl(
  urls: { "url-name": string | null; url: { value: string } }[]
): string | null {
  if (urls.length === 0) return null;

  const labKeywords = /\b(lab|website|homepage|group|research)\b/i;
  const labUrl = urls.find((u) => u["url-name"] && labKeywords.test(u["url-name"]));
  if (labUrl) return labUrl.url.value;

  return urls[0]!.url.value;
}

/**
 * Fetches a researcher's funding/grant entries from the ORCID /fundings endpoint.
 * Returns structured funding entries with title, type, organization, and dates.
 */
export async function fetchOrcidFundings(
  orcid: string,
  accessToken?: string
): Promise<OrcidFunding[]> {
  const apiBase = getApiBaseUrl(accessToken, isSandbox());
  const headers = buildHeaders(accessToken);

  const response = await fetch(`${apiBase}/v3.0/${orcid}/fundings`, { headers });
  if (!response.ok) {
    throw new Error(
      `ORCID fundings API error: ${response.status} ${response.statusText}`
    );
  }

  const data = await response.json();
  const groups: { "funding-summary": FundingSummary[] }[] =
    data?.group ?? [];

  const fundings: OrcidFunding[] = [];

  for (const group of groups) {
    // Each group may have multiple summaries from different sources;
    // take the first as the preferred/primary source.
    const summary = group["funding-summary"]?.[0];
    if (!summary) continue;

    const title = summary.title?.title?.value;
    if (!title) continue;

    fundings.push({
      title,
      type: summary.type?.toLowerCase() ?? null,
      organization: summary.organization?.name ?? null,
      startYear: parseOrcidYear(summary["start-date"]),
      endYear: parseOrcidYear(summary["end-date"]),
    });
  }

  return fundings;
}

/**
 * Convenience function to extract just grant title strings from ORCID fundings.
 * Used directly by the profile pipeline to populate ResearcherProfile.grantTitles.
 */
export async function fetchOrcidGrantTitles(
  orcid: string,
  accessToken?: string
): Promise<string[]> {
  const fundings = await fetchOrcidFundings(orcid, accessToken);
  return fundings.map((f) => f.title);
}

/**
 * Fetches a researcher's publication list from the ORCID /works endpoint.
 * Extracts PMIDs, PMCIDs, and DOIs needed for PubMed/PMC abstract fetching.
 *
 * Per spec: the user has curated their ORCID works list, so we trust it
 * for author disambiguation. Works without any external ID are still returned
 * (with null identifiers) so the caller can count total works.
 */
export async function fetchOrcidWorks(
  orcid: string,
  accessToken?: string
): Promise<OrcidWork[]> {
  const apiBase = getApiBaseUrl(accessToken, isSandbox());
  const headers = buildHeaders(accessToken);

  const response = await fetch(`${apiBase}/v3.0/${orcid}/works`, { headers });
  if (!response.ok) {
    throw new Error(
      `ORCID works API error: ${response.status} ${response.statusText}`
    );
  }

  const data = await response.json();
  const groups: { "work-summary": WorkSummary[] }[] = data?.group ?? [];

  const works: OrcidWork[] = [];

  for (const group of groups) {
    // Each group represents a single work, possibly with multiple summaries
    // from different sources. Take the first as the preferred source.
    const summary = group["work-summary"]?.[0];
    if (!summary) continue;

    const title = summary.title?.title?.value;
    if (!title) continue;

    const externalIds = summary["external-ids"]?.["external-id"] ?? [];

    works.push({
      title,
      pmid: extractExternalId(externalIds, "pmid"),
      pmcid: extractExternalId(externalIds, "pmc"),
      doi: extractExternalId(externalIds, "doi"),
      type: summary.type?.toLowerCase() ?? null,
      year: parseOrcidYear(summary["publication-date"]),
      journal: summary["journal-title"]?.value ?? null,
    });
  }

  return works;
}

// --- Internal types for ORCID API response parsing ---

interface FundingSummary {
  title?: { title?: { value: string } };
  type?: string;
  organization?: { name: string };
  "start-date"?: { year?: { value: string } } | null;
  "end-date"?: { year?: { value: string } } | null;
}

interface WorkSummary {
  title?: { title?: { value: string } };
  type?: string;
  "external-ids"?: {
    "external-id"?: ExternalId[];
  };
  "publication-date"?: { year?: { value: string } } | null;
  "journal-title"?: { value: string };
}

interface ExternalId {
  "external-id-type": string;
  "external-id-value": string;
  "external-id-relationship"?: string;
}

/**
 * Extracts an external ID value by type from ORCID's external-id array.
 * Only considers IDs with "self" relationship (the work's own identifier),
 * falling back to any relationship if no "self" match found.
 */
function extractExternalId(ids: ExternalId[], type: string): string | null {
  // Prefer SELF relationship (the work's own identifier)
  const selfId = ids.find(
    (id) =>
      id["external-id-type"] === type &&
      id["external-id-relationship"]?.toUpperCase() === "SELF"
  );
  if (selfId) return selfId["external-id-value"];

  // Fall back to any relationship
  const anyId = ids.find((id) => id["external-id-type"] === type);
  return anyId?.["external-id-value"] ?? null;
}

/**
 * Parses a year from ORCID's date format ({ year: { value: "2023" } }).
 * Returns null for missing or invalid dates.
 */
function parseOrcidYear(
  date: { year?: { value: string } } | null | undefined
): number | null {
  const yearStr = date?.year?.value;
  if (!yearStr) return null;
  const year = parseInt(yearStr, 10);
  return isNaN(year) ? null : year;
}
