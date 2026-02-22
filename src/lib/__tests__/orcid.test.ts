/**
 * Tests for the ORCID API client.
 *
 * Validates correct parsing of ORCID v3.0 API responses for person data
 * (name, email) and employment data (institution, department).
 * These tests ensure CoPI correctly extracts researcher identity information
 * needed to create User records during the OAuth signup flow.
 */

import {
  fetchOrcidPerson,
  fetchOrcidEmployments,
  fetchOrcidProfile,
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
  // Tests extraction of name and email from ORCID's /person endpoint.
  // Name is assembled from given-names, family-name, or credit-name.
  // Email selection prioritizes primary+verified > verified > any.

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
  // and department from separate ORCID API endpoints.
  // Validates name assembly priority: credit name > given+family > orcid fallback.

  it("assembles complete profile with credit name preferred", async () => {
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

  it("returns null for missing email and institution", async () => {
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
  });
});
