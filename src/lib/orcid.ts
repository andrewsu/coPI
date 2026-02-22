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
 * Fetches a researcher's name and email from the ORCID /person endpoint.
 */
export async function fetchOrcidPerson(
  orcid: string,
  accessToken?: string
): Promise<{
  email: string | null;
  givenName: string | null;
  familyName: string | null;
  creditName: string | null;
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

  return { email: primaryEmail, givenName, familyName, creditName };
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
 * Fetches a complete ORCID profile: name, email, institution, department.
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
  };
}
