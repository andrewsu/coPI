/**
 * Tests for the ORCID API client.
 *
 * Validates correct parsing of ORCID v3.0 API responses for:
 * - Person data (name, email, lab website URL)
 * - Employment data (institution, department)
 * - Fundings (grant titles)
 * - Works (publications with PMIDs, DOIs, PMCIDs)
 *
 * These tests ensure CoPI correctly extracts researcher identity and
 * publication information from ORCID's public and member APIs.
 */

import {
  fetchOrcidPerson,
  fetchOrcidEmployments,
  fetchOrcidProfile,
  fetchOrcidFundings,
  fetchOrcidGrantTitles,
  fetchOrcidWorks,
} from "../orcid";

// Mock global fetch
const mockFetch = jest.fn();
global.fetch = mockFetch;

beforeEach(() => {
  mockFetch.mockReset();
  // Default to production (non-sandbox) mode
  process.env.ORCID_SANDBOX = "false";
});

describe("fetchOrcidPerson", () => {
  // Tests extraction of name, email, and lab website from ORCID's /person endpoint.
  // Name is assembled from given-names, family-name, or credit-name.
  // Email selection prioritizes primary+verified > verified > any.
  // Lab website is extracted from researcher-urls, preferring URLs with lab-related names.

  it("extracts name and primary verified email", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        name: {
          "given-names": { value: "Jane" },
          "family-name": { value: "Doe" },
          "credit-name": null,
        },
        emails: {
          email: [
            { email: "other@example.com", primary: false, verified: true },
            { email: "jane@university.edu", primary: true, verified: true },
          ],
        },
      }),
    });

    const result = await fetchOrcidPerson("0000-0001-2345-6789");
    expect(result).toEqual({
      givenName: "Jane",
      familyName: "Doe",
      creditName: null,
      email: "jane@university.edu",
      labWebsiteUrl: null,
    });
  });

  it("falls back to verified email when no primary verified", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        name: {
          "given-names": { value: "John" },
          "family-name": { value: "Smith" },
          "credit-name": null,
        },
        emails: {
          email: [
            { email: "john@lab.org", primary: false, verified: true },
          ],
        },
      }),
    });

    const result = await fetchOrcidPerson("0000-0001-0000-0001");
    expect(result.email).toBe("john@lab.org");
  });

  it("returns null email when no emails available", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        name: {
          "given-names": { value: "Alex" },
          "family-name": { value: "Chen" },
          "credit-name": null,
        },
        emails: { email: [] },
      }),
    });

    const result = await fetchOrcidPerson("0000-0001-0000-0002");
    expect(result.email).toBeNull();
  });

  it("returns null name fields when name is not available", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        name: null,
        emails: { email: [] },
      }),
    });

    const result = await fetchOrcidPerson("0000-0001-0000-0003");
    expect(result.givenName).toBeNull();
    expect(result.familyName).toBeNull();
    expect(result.creditName).toBeNull();
  });

  it("extracts credit name when present", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        name: {
          "given-names": { value: "Robert" },
          "family-name": { value: "Johnson" },
          "credit-name": { value: "R.J. Johnson" },
        },
        emails: { email: [] },
      }),
    });

    const result = await fetchOrcidPerson("0000-0001-0000-0004");
    expect(result.creditName).toBe("R.J. Johnson");
  });

  it("throws on API error", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 404,
      statusText: "Not Found",
    });

    await expect(fetchOrcidPerson("invalid")).rejects.toThrow(
      "ORCID person API error: 404 Not Found"
    );
  });

  it("uses member API URL when access token is provided", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        name: { "given-names": { value: "Test" }, "family-name": { value: "User" }, "credit-name": null },
        emails: { email: [] },
      }),
    });

    await fetchOrcidPerson("0000-0001-0000-0005", "test-token");

    expect(mockFetch).toHaveBeenCalledWith(
      "https://api.orcid.org/v3.0/0000-0001-0000-0005/person",
      {
        headers: {
          Accept: "application/json",
          Authorization: "Bearer test-token",
        },
      }
    );
  });

  it("uses public API URL when no access token", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        name: { "given-names": { value: "Test" }, "family-name": { value: "User" }, "credit-name": null },
        emails: { email: [] },
      }),
    });

    await fetchOrcidPerson("0000-0001-0000-0006");

    expect(mockFetch).toHaveBeenCalledWith(
      "https://pub.orcid.org/v3.0/0000-0001-0000-0006/person",
      {
        headers: {
          Accept: "application/json",
        },
      }
    );
  });

  it("uses sandbox URLs when ORCID_SANDBOX is true", async () => {
    process.env.ORCID_SANDBOX = "true";

    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        name: { "given-names": { value: "Test" }, "family-name": { value: "User" }, "credit-name": null },
        emails: { email: [] },
      }),
    });

    await fetchOrcidPerson("0000-0001-0000-0007", "test-token");

    expect(mockFetch).toHaveBeenCalledWith(
      "https://api.sandbox.orcid.org/v3.0/0000-0001-0000-0007/person",
      expect.any(Object)
    );
  });

  // Lab website URL extraction from researcher-urls in the /person response.
  // This is needed for the profile pipeline (spec Step 1).

  it("extracts lab website URL from researcher-urls by keyword match", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        name: {
          "given-names": { value: "Jane" },
          "family-name": { value: "Doe" },
          "credit-name": null,
        },
        emails: { email: [] },
        "researcher-urls": {
          "researcher-url": [
            {
              "url-name": "Google Scholar",
              url: { value: "https://scholar.google.com/citations?user=abc123" },
            },
            {
              "url-name": "Lab Website",
              url: { value: "https://doelab.example.edu" },
            },
          ],
        },
      }),
    });

    const result = await fetchOrcidPerson("0000-0001-0000-0010");
    expect(result.labWebsiteUrl).toBe("https://doelab.example.edu");
  });

  it("falls back to first URL when no lab keyword match", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        name: {
          "given-names": { value: "Bob" },
          "family-name": { value: "Chen" },
          "credit-name": null,
        },
        emails: { email: [] },
        "researcher-urls": {
          "researcher-url": [
            {
              "url-name": "Twitter",
              url: { value: "https://twitter.com/bobchen" },
            },
            {
              "url-name": "GitHub",
              url: { value: "https://github.com/bobchen" },
            },
          ],
        },
      }),
    });

    const result = await fetchOrcidPerson("0000-0001-0000-0011");
    expect(result.labWebsiteUrl).toBe("https://twitter.com/bobchen");
  });

  it("returns null labWebsiteUrl when no researcher-urls", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        name: {
          "given-names": { value: "No" },
          "family-name": { value: "URLs" },
          "credit-name": null,
        },
        emails: { email: [] },
      }),
    });

    const result = await fetchOrcidPerson("0000-0001-0000-0012");
    expect(result.labWebsiteUrl).toBeNull();
  });

  it("matches various lab keyword patterns (research, group, homepage)", async () => {
    // Test that "research" keyword is matched
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        name: {
          "given-names": { value: "A" },
          "family-name": { value: "B" },
          "credit-name": null,
        },
        emails: { email: [] },
        "researcher-urls": {
          "researcher-url": [
            { "url-name": "LinkedIn", url: { value: "https://linkedin.com/in/ab" } },
            { "url-name": "Research Group Page", url: { value: "https://research.example.edu" } },
          ],
        },
      }),
    });

    const result = await fetchOrcidPerson("0000-0001-0000-0013");
    expect(result.labWebsiteUrl).toBe("https://research.example.edu");
  });
});

describe("fetchOrcidEmployments", () => {
  // Tests extraction of institution and department from ORCID's /employments endpoint.
  // Selection priority: active (no end date) over ended, more recent start date first.
  // This data populates the User.institution and User.department fields.

  it("selects active employment with latest start date", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        "affiliation-group": [
          {
            summaries: [
              {
                "employment-summary": {
                  organization: { name: "Old University" },
                  "department-name": "Biology",
                  "start-date": { year: { value: "2010" } },
                  "end-date": { year: { value: "2018" } },
                },
              },
            ],
          },
          {
            summaries: [
              {
                "employment-summary": {
                  organization: { name: "Current University" },
                  "department-name": "Molecular Medicine",
                  "start-date": { year: { value: "2020" } },
                  "end-date": null,
                },
              },
            ],
          },
          {
            summaries: [
              {
                "employment-summary": {
                  organization: { name: "Previous Active" },
                  "department-name": "Chemistry",
                  "start-date": { year: { value: "2015" } },
                  "end-date": null,
                },
              },
            ],
          },
        ],
      }),
    });

    const result = await fetchOrcidEmployments("0000-0001-2345-6789");
    expect(result).toEqual({
      institution: "Current University",
      department: "Molecular Medicine",
    });
  });

  it("falls back to most recent ended employment when no active", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        "affiliation-group": [
          {
            summaries: [
              {
                "employment-summary": {
                  organization: { name: "Old Place" },
                  "department-name": "Dept A",
                  "start-date": { year: { value: "2005" } },
                  "end-date": { year: { value: "2010" } },
                },
              },
            ],
          },
          {
            summaries: [
              {
                "employment-summary": {
                  organization: { name: "Recent Place" },
                  "department-name": "Dept B",
                  "start-date": { year: { value: "2015" } },
                  "end-date": { year: { value: "2022" } },
                },
              },
            ],
          },
        ],
      }),
    });

    const result = await fetchOrcidEmployments("0000-0001-0000-0001");
    expect(result).toEqual({
      institution: "Recent Place",
      department: "Dept B",
    });
  });

  it("returns nulls when no employments available", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        "affiliation-group": [],
      }),
    });

    const result = await fetchOrcidEmployments("0000-0001-0000-0002");
    expect(result).toEqual({
      institution: null,
      department: null,
    });
  });

  it("handles missing department name", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        "affiliation-group": [
          {
            summaries: [
              {
                "employment-summary": {
                  organization: { name: "University X" },
                  "department-name": null,
                  "start-date": { year: { value: "2020" } },
                  "end-date": null,
                },
              },
            ],
          },
        ],
      }),
    });

    const result = await fetchOrcidEmployments("0000-0001-0000-0003");
    expect(result).toEqual({
      institution: "University X",
      department: null,
    });
  });

  it("throws on API error", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 500,
      statusText: "Internal Server Error",
    });

    await expect(fetchOrcidEmployments("invalid")).rejects.toThrow(
      "ORCID employments API error: 500 Internal Server Error"
    );
  });
});

describe("fetchOrcidProfile", () => {
  // Tests the combined profile fetch that assembles name, email, institution,
  // department, and lab website from separate ORCID API endpoints.
  // Validates name assembly priority: credit name > given+family > orcid fallback.

  it("assembles complete profile including lab website", async () => {
    // Person endpoint
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        name: {
          "given-names": { value: "Jane" },
          "family-name": { value: "Doe" },
          "credit-name": { value: "J. Doe" },
        },
        emails: {
          email: [
            { email: "jane@uni.edu", primary: true, verified: true },
          ],
        },
        "researcher-urls": {
          "researcher-url": [
            { "url-name": "Lab Website", url: { value: "https://doelab.edu" } },
          ],
        },
      }),
    });
    // Employments endpoint
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        "affiliation-group": [
          {
            summaries: [
              {
                "employment-summary": {
                  organization: { name: "MIT" },
                  "department-name": "CSAIL",
                  "start-date": { year: { value: "2020" } },
                  "end-date": null,
                },
              },
            ],
          },
        ],
      }),
    });

    const result = await fetchOrcidProfile("0000-0001-2345-6789");
    expect(result).toEqual({
      orcid: "0000-0001-2345-6789",
      name: "J. Doe",
      email: "jane@uni.edu",
      institution: "MIT",
      department: "CSAIL",
      labWebsiteUrl: "https://doelab.edu",
    });
  });

  it("uses given + family name when no credit name", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        name: {
          "given-names": { value: "John" },
          "family-name": { value: "Smith" },
          "credit-name": null,
        },
        emails: { email: [] },
      }),
    });
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ "affiliation-group": [] }),
    });

    const result = await fetchOrcidProfile("0000-0001-0000-0001");
    expect(result.name).toBe("John Smith");
  });

  it("falls back to ORCID as name when no name data", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        name: null,
        emails: { email: [] },
      }),
    });
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ "affiliation-group": [] }),
    });

    const result = await fetchOrcidProfile("0000-0001-0000-0002");
    expect(result.name).toBe("0000-0001-0000-0002");
  });

  it("returns null for missing email, institution, and lab website", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        name: {
          "given-names": { value: "Alex" },
          "family-name": { value: "Kim" },
          "credit-name": null,
        },
        emails: { email: [] },
      }),
    });
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ "affiliation-group": [] }),
    });

    const result = await fetchOrcidProfile("0000-0001-0000-0003");
    expect(result.email).toBeNull();
    expect(result.institution).toBeNull();
    expect(result.department).toBeNull();
    expect(result.labWebsiteUrl).toBeNull();
  });
});

describe("fetchOrcidFundings", () => {
  // Tests extraction of grant/funding data from ORCID's /fundings endpoint.
  // The profile pipeline uses this to populate ResearcherProfile.grantTitles,
  // which informs the LLM synthesis of the research summary.

  it("extracts funding entries with all fields", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        group: [
          {
            "funding-summary": [
              {
                title: { title: { value: "R01 Grant: CRISPR mechanisms" } },
                type: "GRANT",
                organization: { name: "National Institutes of Health" },
                "start-date": { year: { value: "2020" } },
                "end-date": { year: { value: "2025" } },
              },
            ],
          },
          {
            "funding-summary": [
              {
                title: { title: { value: "NSF CAREER: Machine Learning" } },
                type: "GRANT",
                organization: { name: "National Science Foundation" },
                "start-date": { year: { value: "2019" } },
                "end-date": null,
              },
            ],
          },
        ],
      }),
    });

    const result = await fetchOrcidFundings("0000-0001-2345-6789");
    expect(result).toEqual([
      {
        title: "R01 Grant: CRISPR mechanisms",
        type: "grant",
        organization: "National Institutes of Health",
        startYear: 2020,
        endYear: 2025,
      },
      {
        title: "NSF CAREER: Machine Learning",
        type: "grant",
        organization: "National Science Foundation",
        startYear: 2019,
        endYear: null,
      },
    ]);
  });

  it("returns empty array when no fundings", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ group: [] }),
    });

    const result = await fetchOrcidFundings("0000-0001-0000-0001");
    expect(result).toEqual([]);
  });

  it("skips entries without a title", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        group: [
          {
            "funding-summary": [
              {
                title: { title: { value: "Valid Grant" } },
                type: "GRANT",
                organization: { name: "NIH" },
                "start-date": null,
                "end-date": null,
              },
            ],
          },
          {
            // Missing title entirely
            "funding-summary": [
              {
                title: {},
                type: "CONTRACT",
                organization: { name: "DOD" },
                "start-date": null,
                "end-date": null,
              },
            ],
          },
        ],
      }),
    });

    const result = await fetchOrcidFundings("0000-0001-0000-0002");
    expect(result).toHaveLength(1);
    expect(result[0]!.title).toBe("Valid Grant");
  });

  it("handles missing optional fields gracefully", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        group: [
          {
            "funding-summary": [
              {
                title: { title: { value: "Minimal Grant" } },
                // No type, organization, or dates
              },
            ],
          },
        ],
      }),
    });

    const result = await fetchOrcidFundings("0000-0001-0000-0003");
    expect(result).toEqual([
      {
        title: "Minimal Grant",
        type: null,
        organization: null,
        startYear: null,
        endYear: null,
      },
    ]);
  });

  it("takes the first funding-summary in each group (preferred source)", async () => {
    // Each group can have multiple summaries from different sources.
    // We take the first as the preferred/primary source.
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        group: [
          {
            "funding-summary": [
              {
                title: { title: { value: "Preferred Source Title" } },
                type: "GRANT",
                organization: { name: "NIH" },
                "start-date": { year: { value: "2021" } },
                "end-date": null,
              },
              {
                title: { title: { value: "Alternative Source Title" } },
                type: "GRANT",
                organization: { name: "NIH" },
                "start-date": { year: { value: "2021" } },
                "end-date": null,
              },
            ],
          },
        ],
      }),
    });

    const result = await fetchOrcidFundings("0000-0001-0000-0004");
    expect(result).toHaveLength(1);
    expect(result[0]!.title).toBe("Preferred Source Title");
  });

  it("throws on API error", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 403,
      statusText: "Forbidden",
    });

    await expect(fetchOrcidFundings("invalid")).rejects.toThrow(
      "ORCID fundings API error: 403 Forbidden"
    );
  });

  it("calls the correct /fundings endpoint URL", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ group: [] }),
    });

    await fetchOrcidFundings("0000-0001-0000-0005", "my-token");

    expect(mockFetch).toHaveBeenCalledWith(
      "https://api.orcid.org/v3.0/0000-0001-0000-0005/fundings",
      {
        headers: {
          Accept: "application/json",
          Authorization: "Bearer my-token",
        },
      }
    );
  });

  it("uses public API when no access token", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ group: [] }),
    });

    await fetchOrcidFundings("0000-0001-0000-0006");

    expect(mockFetch).toHaveBeenCalledWith(
      "https://pub.orcid.org/v3.0/0000-0001-0000-0006/fundings",
      {
        headers: {
          Accept: "application/json",
        },
      }
    );
  });

  it("lowercases funding type", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        group: [
          {
            "funding-summary": [
              {
                title: { title: { value: "Test Grant" } },
                type: "CONTRACT",
                organization: { name: "DOD" },
                "start-date": null,
                "end-date": null,
              },
            ],
          },
        ],
      }),
    });

    const result = await fetchOrcidFundings("0000-0001-0000-0007");
    expect(result[0]!.type).toBe("contract");
  });
});

describe("fetchOrcidGrantTitles", () => {
  // Convenience wrapper that extracts just the title strings from fundings.
  // Used directly by the profile pipeline to populate ResearcherProfile.grantTitles.

  it("returns array of grant title strings", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        group: [
          {
            "funding-summary": [
              {
                title: { title: { value: "R01 Grant: CRISPR mechanisms" } },
                type: "GRANT",
                organization: { name: "NIH" },
                "start-date": null,
                "end-date": null,
              },
            ],
          },
          {
            "funding-summary": [
              {
                title: { title: { value: "NSF CAREER: ML for Biology" } },
                type: "GRANT",
                organization: { name: "NSF" },
                "start-date": null,
                "end-date": null,
              },
            ],
          },
        ],
      }),
    });

    const titles = await fetchOrcidGrantTitles("0000-0001-2345-6789");
    expect(titles).toEqual([
      "R01 Grant: CRISPR mechanisms",
      "NSF CAREER: ML for Biology",
    ]);
  });

  it("returns empty array when no fundings", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ group: [] }),
    });

    const titles = await fetchOrcidGrantTitles("0000-0001-0000-0001");
    expect(titles).toEqual([]);
  });
});

describe("fetchOrcidWorks", () => {
  // Tests extraction of publications from ORCID's /works endpoint.
  // The profile pipeline uses this to get PMIDs/DOIs for PubMed abstract fetching.
  // Per spec, the user curates their ORCID works list, so we trust it for disambiguation.

  it("extracts works with PMIDs, DOIs, and PMCIDs", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        group: [
          {
            "work-summary": [
              {
                title: { title: { value: "CRISPR screens reveal new cancer targets" } },
                type: "JOURNAL_ARTICLE",
                "external-ids": {
                  "external-id": [
                    { "external-id-type": "pmid", "external-id-value": "12345678", "external-id-relationship": "SELF" },
                    { "external-id-type": "doi", "external-id-value": "10.1038/s41586-023-00001-1", "external-id-relationship": "SELF" },
                    { "external-id-type": "pmc", "external-id-value": "PMC9876543", "external-id-relationship": "SELF" },
                  ],
                },
                "publication-date": { year: { value: "2023" } },
                "journal-title": { value: "Nature" },
              },
            ],
          },
          {
            "work-summary": [
              {
                title: { title: { value: "Review: Gene therapy advances" } },
                type: "JOURNAL_ARTICLE",
                "external-ids": {
                  "external-id": [
                    { "external-id-type": "pmid", "external-id-value": "87654321", "external-id-relationship": "SELF" },
                    { "external-id-type": "doi", "external-id-value": "10.1126/science.abc1234", "external-id-relationship": "SELF" },
                  ],
                },
                "publication-date": { year: { value: "2022" } },
                "journal-title": { value: "Science" },
              },
            ],
          },
        ],
      }),
    });

    const result = await fetchOrcidWorks("0000-0001-2345-6789");
    expect(result).toEqual([
      {
        title: "CRISPR screens reveal new cancer targets",
        pmid: "12345678",
        pmcid: "PMC9876543",
        doi: "10.1038/s41586-023-00001-1",
        type: "journal_article",
        year: 2023,
        journal: "Nature",
      },
      {
        title: "Review: Gene therapy advances",
        pmid: "87654321",
        pmcid: null,
        doi: "10.1126/science.abc1234",
        type: "journal_article",
        year: 2022,
        journal: "Science",
      },
    ]);
  });

  it("returns empty array when no works", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ group: [] }),
    });

    const result = await fetchOrcidWorks("0000-0001-0000-0001");
    expect(result).toEqual([]);
  });

  it("handles works with only DOI (no PMID)", async () => {
    // Per spec: "Some ORCID works may only have DOIs."
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        group: [
          {
            "work-summary": [
              {
                title: { title: { value: "DOI-only paper" } },
                type: "JOURNAL_ARTICLE",
                "external-ids": {
                  "external-id": [
                    { "external-id-type": "doi", "external-id-value": "10.1234/abc", "external-id-relationship": "SELF" },
                  ],
                },
                "publication-date": { year: { value: "2021" } },
                "journal-title": { value: "PLOS ONE" },
              },
            ],
          },
        ],
      }),
    });

    const result = await fetchOrcidWorks("0000-0001-0000-0002");
    expect(result[0]).toEqual({
      title: "DOI-only paper",
      pmid: null,
      pmcid: null,
      doi: "10.1234/abc",
      type: "journal_article",
      year: 2021,
      journal: "PLOS ONE",
    });
  });

  it("handles works with no external IDs at all", async () => {
    // Works without any identifier should still be returned so the caller
    // can count total works (e.g., for the sparse ORCID nudge at < 5 works).
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        group: [
          {
            "work-summary": [
              {
                title: { title: { value: "Book chapter without IDs" } },
                type: "BOOK_CHAPTER",
                "external-ids": { "external-id": [] },
                "publication-date": { year: { value: "2018" } },
                "journal-title": null,
              },
            ],
          },
        ],
      }),
    });

    const result = await fetchOrcidWorks("0000-0001-0000-0003");
    expect(result[0]).toEqual({
      title: "Book chapter without IDs",
      pmid: null,
      pmcid: null,
      doi: null,
      type: "book_chapter",
      year: 2018,
      journal: null,
    });
  });

  it("prefers SELF relationship for external IDs", async () => {
    // ORCID external IDs can have SELF or PART_OF relationships.
    // SELF means the ID belongs to the work itself; PART_OF means
    // it belongs to the container (e.g., journal DOI).
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        group: [
          {
            "work-summary": [
              {
                title: { title: { value: "Test Paper" } },
                type: "JOURNAL_ARTICLE",
                "external-ids": {
                  "external-id": [
                    { "external-id-type": "doi", "external-id-value": "10.9999/journal-doi", "external-id-relationship": "PART_OF" },
                    { "external-id-type": "doi", "external-id-value": "10.1234/article-doi", "external-id-relationship": "SELF" },
                  ],
                },
                "publication-date": { year: { value: "2023" } },
                "journal-title": { value: "Test Journal" },
              },
            ],
          },
        ],
      }),
    });

    const result = await fetchOrcidWorks("0000-0001-0000-0004");
    expect(result[0]!.doi).toBe("10.1234/article-doi");
  });

  it("falls back to non-SELF ID when no SELF relationship found", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        group: [
          {
            "work-summary": [
              {
                title: { title: { value: "Fallback Paper" } },
                type: "JOURNAL_ARTICLE",
                "external-ids": {
                  "external-id": [
                    { "external-id-type": "doi", "external-id-value": "10.5555/fallback" },
                  ],
                },
                "publication-date": { year: { value: "2020" } },
                "journal-title": { value: "Some Journal" },
              },
            ],
          },
        ],
      }),
    });

    const result = await fetchOrcidWorks("0000-0001-0000-0005");
    expect(result[0]!.doi).toBe("10.5555/fallback");
  });

  it("takes the first work-summary in each group (preferred source)", async () => {
    // Each group can have multiple summaries from different sources (Crossref, Scopus, etc).
    // We take the first as the preferred/primary source.
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        group: [
          {
            "work-summary": [
              {
                title: { title: { value: "Preferred Title" } },
                type: "JOURNAL_ARTICLE",
                "external-ids": {
                  "external-id": [
                    { "external-id-type": "pmid", "external-id-value": "11111111", "external-id-relationship": "SELF" },
                  ],
                },
                "publication-date": { year: { value: "2023" } },
                "journal-title": { value: "Journal A" },
              },
              {
                title: { title: { value: "Alternative Title" } },
                type: "JOURNAL_ARTICLE",
                "external-ids": {
                  "external-id": [
                    { "external-id-type": "pmid", "external-id-value": "22222222", "external-id-relationship": "SELF" },
                  ],
                },
                "publication-date": { year: { value: "2023" } },
                "journal-title": { value: "Journal A" },
              },
            ],
          },
        ],
      }),
    });

    const result = await fetchOrcidWorks("0000-0001-0000-0006");
    expect(result).toHaveLength(1);
    expect(result[0]!.title).toBe("Preferred Title");
    expect(result[0]!.pmid).toBe("11111111");
  });

  it("skips entries without a title", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        group: [
          {
            "work-summary": [
              {
                title: { title: { value: "Valid Paper" } },
                type: "JOURNAL_ARTICLE",
                "external-ids": { "external-id": [] },
                "publication-date": { year: { value: "2023" } },
                "journal-title": null,
              },
            ],
          },
          {
            "work-summary": [
              {
                title: {},
                type: "JOURNAL_ARTICLE",
                "external-ids": { "external-id": [] },
                "publication-date": { year: { value: "2022" } },
                "journal-title": null,
              },
            ],
          },
        ],
      }),
    });

    const result = await fetchOrcidWorks("0000-0001-0000-0007");
    expect(result).toHaveLength(1);
    expect(result[0]!.title).toBe("Valid Paper");
  });

  it("handles missing optional fields (year, journal)", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        group: [
          {
            "work-summary": [
              {
                title: { title: { value: "Minimal Work" } },
                // No type, external-ids, publication-date, or journal-title
              },
            ],
          },
        ],
      }),
    });

    const result = await fetchOrcidWorks("0000-0001-0000-0008");
    expect(result[0]).toEqual({
      title: "Minimal Work",
      pmid: null,
      pmcid: null,
      doi: null,
      type: null,
      year: null,
      journal: null,
    });
  });

  it("lowercases work type", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        group: [
          {
            "work-summary": [
              {
                title: { title: { value: "A Preprint" } },
                type: "PREPRINT",
                "external-ids": { "external-id": [] },
                "publication-date": { year: { value: "2024" } },
                "journal-title": { value: "bioRxiv" },
              },
            ],
          },
        ],
      }),
    });

    const result = await fetchOrcidWorks("0000-0001-0000-0009");
    expect(result[0]!.type).toBe("preprint");
  });

  it("throws on API error", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 429,
      statusText: "Too Many Requests",
    });

    await expect(fetchOrcidWorks("invalid")).rejects.toThrow(
      "ORCID works API error: 429 Too Many Requests"
    );
  });

  it("calls the correct /works endpoint URL", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ group: [] }),
    });

    await fetchOrcidWorks("0000-0001-0000-0010", "my-token");

    expect(mockFetch).toHaveBeenCalledWith(
      "https://api.orcid.org/v3.0/0000-0001-0000-0010/works",
      {
        headers: {
          Accept: "application/json",
          Authorization: "Bearer my-token",
        },
      }
    );
  });

  it("uses public API when no access token", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ group: [] }),
    });

    await fetchOrcidWorks("0000-0001-0000-0011");

    expect(mockFetch).toHaveBeenCalledWith(
      "https://pub.orcid.org/v3.0/0000-0001-0000-0011/works",
      {
        headers: {
          Accept: "application/json",
        },
      }
    );
  });

  it("handles a realistic large works response", async () => {
    // Simulates a prolific researcher with various publication types.
    // This validates the client handles mixed types and IDs correctly.
    const groups = [
      {
        "work-summary": [{
          title: { title: { value: "Research Article 1" } },
          type: "JOURNAL_ARTICLE",
          "external-ids": {
            "external-id": [
              { "external-id-type": "pmid", "external-id-value": "30000001", "external-id-relationship": "SELF" },
              { "external-id-type": "doi", "external-id-value": "10.1000/a1", "external-id-relationship": "SELF" },
            ],
          },
          "publication-date": { year: { value: "2024" } },
          "journal-title": { value: "Cell" },
        }],
      },
      {
        "work-summary": [{
          title: { title: { value: "Conference Abstract" } },
          type: "CONFERENCE_ABSTRACT",
          "external-ids": { "external-id": [] },
          "publication-date": { year: { value: "2023" } },
          "journal-title": null,
        }],
      },
      {
        "work-summary": [{
          title: { title: { value: "Preprint on bioRxiv" } },
          type: "PREPRINT",
          "external-ids": {
            "external-id": [
              { "external-id-type": "doi", "external-id-value": "10.1101/2024.01.01.000", "external-id-relationship": "SELF" },
            ],
          },
          "publication-date": { year: { value: "2024" } },
          "journal-title": { value: "bioRxiv" },
        }],
      },
    ];

    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ group: groups }),
    });

    const result = await fetchOrcidWorks("0000-0001-0000-0012");
    expect(result).toHaveLength(3);
    expect(result[0]!.pmid).toBe("30000001");
    expect(result[1]!.type).toBe("conference_abstract");
    expect(result[2]!.doi).toBe("10.1101/2024.01.01.000");
  });
});
