/**
 * Tests for the NCBI ID Converter API client.
 *
 * Validates correct parsing of NCBI ID Converter JSON responses including:
 * - PMID to PMCID conversion (primary use case for deep mining)
 * - DOI to PMID conversion (fallback for DOI-only ORCID works)
 * - Mixed ID type conversion
 * - Batch splitting for large ID lists
 * - NCBI API key inclusion
 * - Handling of records without PMCIDs (non-open-access papers)
 * - Error handling for API failures and malformed responses
 *
 * These tests ensure CoPI correctly identifies which publications have
 * PMC full-text available, enabling the deep mining step of the profile
 * ingestion pipeline (spec Step 5).
 */

import {
  convertPmidsToPmcids,
  convertDoisToPmids,
  convertIds,
  parseIdConversionResponse,
} from "../ncbi-id-converter";

// Mock global fetch
const mockFetch = jest.fn();
global.fetch = mockFetch;

beforeEach(() => {
  mockFetch.mockReset();
  delete process.env.NCBI_API_KEY;
  delete process.env.NCBI_EMAIL;
});

// --- Test JSON fixtures ---

/**
 * Successful conversion of a single PMID to PMCID.
 * Represents a paper available in PMC (open access).
 */
const SINGLE_PMID_RESPONSE = {
  status: "ok",
  responseDate: "2024-01-15 12:00:00",
  request: "ids=12345678;format=json",
  records: [
    {
      pmid: "12345678",
      pmcid: "PMC7654321",
      doi: "10.1038/s41586-023-00001-1",
      versions: [
        {
          pmid: "12345678",
          pmcid: "PMC7654321.1",
          current: "true",
        },
      ],
      live: true,
      status: "ok",
    },
  ],
};

/**
 * Multiple PMIDs where one has a PMCID and one does not.
 * The second record has an errmsg indicating the paper is not in PMC.
 */
const MIXED_RESULTS_RESPONSE = {
  status: "ok",
  responseDate: "2024-01-15 12:00:00",
  request: "ids=12345678,87654321;format=json",
  records: [
    {
      pmid: "12345678",
      pmcid: "PMC7654321",
      doi: "10.1038/s41586-023-00001-1",
      versions: [],
      live: true,
      status: "ok",
    },
    {
      pmid: "87654321",
      status: "error",
      errmsg: "not open access",
    },
  ],
};

/**
 * DOI conversion response. DOIs are resolved to PMIDs and PMCIDs.
 */
const DOI_CONVERSION_RESPONSE = {
  status: "ok",
  responseDate: "2024-01-15 12:00:00",
  request: "ids=10.1038/s41586-023-00001-1;format=json",
  records: [
    {
      pmid: "12345678",
      pmcid: "PMC7654321",
      doi: "10.1038/s41586-023-00001-1",
      versions: [],
      live: true,
      status: "ok",
    },
  ],
};

/**
 * Multiple successful conversions in a single batch.
 */
const MULTI_SUCCESS_RESPONSE = {
  status: "ok",
  responseDate: "2024-01-15 12:00:00",
  request: "ids=11111111,22222222,33333333;format=json",
  records: [
    {
      pmid: "11111111",
      pmcid: "PMC1111111",
      doi: "10.1016/j.cell.2024.01.001",
      versions: [],
      live: true,
      status: "ok",
    },
    {
      pmid: "22222222",
      pmcid: "PMC2222222",
      doi: "10.1126/science.abc1234",
      versions: [],
      live: true,
      status: "ok",
    },
    {
      pmid: "33333333",
      pmcid: "PMC3333333",
      doi: "10.1038/s41586-024-00001-1",
      versions: [],
      live: true,
      status: "ok",
    },
  ],
};

/**
 * Response where all records have errors (no papers in PMC).
 */
const ALL_ERRORS_RESPONSE = {
  status: "ok",
  responseDate: "2024-01-15 12:00:00",
  request: "ids=99999991,99999992;format=json",
  records: [
    {
      pmid: "99999991",
      status: "error",
      errmsg: "not open access",
    },
    {
      pmid: "99999992",
      status: "error",
      errmsg: "not open access",
    },
  ],
};

// --- parseIdConversionResponse tests ---

describe("parseIdConversionResponse", () => {
  // Tests the JSON parsing layer that converts raw API responses into
  // structured IdConversionRecord objects. This is the core of the
  // ID converter client.

  it("parses a single successful conversion", () => {
    const results = parseIdConversionResponse(SINGLE_PMID_RESPONSE);

    expect(results).toHaveLength(1);
    const record = results[0]!;

    expect(record.pmid).toBe("12345678");
    expect(record.pmcid).toBe("PMC7654321");
    expect(record.doi).toBe("10.1038/s41586-023-00001-1");
    expect(record.errmsg).toBeNull();
  });

  it("parses mixed results (some with PMCID, some without)", () => {
    // This is the common case: some papers are open access (have PMCID),
    // others are not. The deep mining step only processes papers with PMCIDs.
    const results = parseIdConversionResponse(MIXED_RESULTS_RESPONSE);

    expect(results).toHaveLength(2);

    // First record: has PMCID (open access)
    expect(results[0]!.pmid).toBe("12345678");
    expect(results[0]!.pmcid).toBe("PMC7654321");
    expect(results[0]!.errmsg).toBeNull();

    // Second record: no PMCID (not in PMC)
    expect(results[1]!.pmid).toBe("87654321");
    expect(results[1]!.pmcid).toBeNull();
    expect(results[1]!.errmsg).toBe("not open access");
  });

  it("parses DOI conversion results", () => {
    // DOI → PMID resolution for ORCID works that lack PMIDs.
    const results = parseIdConversionResponse(DOI_CONVERSION_RESPONSE);

    expect(results).toHaveLength(1);
    expect(results[0]!.pmid).toBe("12345678");
    expect(results[0]!.pmcid).toBe("PMC7654321");
    expect(results[0]!.doi).toBe("10.1038/s41586-023-00001-1");
  });

  it("parses multiple successful conversions", () => {
    const results = parseIdConversionResponse(MULTI_SUCCESS_RESPONSE);

    expect(results).toHaveLength(3);
    expect(results[0]!.pmcid).toBe("PMC1111111");
    expect(results[1]!.pmcid).toBe("PMC2222222");
    expect(results[2]!.pmcid).toBe("PMC3333333");
  });

  it("parses response where all records have errors", () => {
    // When no papers are in PMC, all records will have errmsg.
    // The deep mining step should handle this gracefully (no papers to mine).
    const results = parseIdConversionResponse(ALL_ERRORS_RESPONSE);

    expect(results).toHaveLength(2);
    expect(results[0]!.pmcid).toBeNull();
    expect(results[0]!.errmsg).toBe("not open access");
    expect(results[1]!.pmcid).toBeNull();
    expect(results[1]!.errmsg).toBe("not open access");
  });

  it("handles empty records array", () => {
    const results = parseIdConversionResponse({
      status: "ok",
      records: [],
    });
    expect(results).toEqual([]);
  });

  it("handles missing records field", () => {
    const results = parseIdConversionResponse({ status: "ok" });
    expect(results).toEqual([]);
  });

  it("handles null input", () => {
    expect(parseIdConversionResponse(null)).toEqual([]);
  });

  it("handles undefined input", () => {
    expect(parseIdConversionResponse(undefined)).toEqual([]);
  });

  it("normalizes missing fields to null", () => {
    // A record with only pmid and errmsg (no pmcid or doi)
    const results = parseIdConversionResponse({
      status: "ok",
      records: [{ pmid: "12345678" }],
    });

    expect(results).toHaveLength(1);
    expect(results[0]!.pmid).toBe("12345678");
    expect(results[0]!.pmcid).toBeNull();
    expect(results[0]!.doi).toBeNull();
    expect(results[0]!.errmsg).toBeNull();
  });
});

// --- convertPmidsToPmcids tests ---

describe("convertPmidsToPmcids", () => {
  // Tests the primary use case: converting PMIDs to PMCIDs for the
  // deep mining step. Papers with PMCIDs have full text in PMC.

  it("converts a single PMID to its PMCID", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => SINGLE_PMID_RESPONSE,
    });

    const results = await convertPmidsToPmcids(["12345678"]);

    expect(results).toHaveLength(1);
    expect(results[0]!.pmid).toBe("12345678");
    expect(results[0]!.pmcid).toBe("PMC7654321");
  });

  it("builds correct URL without API key", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => SINGLE_PMID_RESPONSE,
    });

    await convertPmidsToPmcids(["12345678"]);

    const calledUrl = mockFetch.mock.calls[0]![0] as string;
    expect(calledUrl).toContain("ncbi.nlm.nih.gov/pmc/utils/idconv/v1.0");
    expect(calledUrl).toContain("ids=12345678");
    expect(calledUrl).toContain("format=json");
    expect(calledUrl).toContain("tool=copi");
    expect(calledUrl).not.toContain("api_key");
    expect(calledUrl).not.toContain("email");
  });

  it("includes NCBI API key when configured", async () => {
    // NCBI API key enables higher rate limits across all NCBI services.
    process.env.NCBI_API_KEY = "test-ncbi-key-456";

    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => SINGLE_PMID_RESPONSE,
    });

    await convertPmidsToPmcids(["12345678"]);

    const calledUrl = mockFetch.mock.calls[0]![0] as string;
    expect(calledUrl).toContain("api_key=test-ncbi-key-456");
  });

  it("includes email when configured", async () => {
    // NCBI recommends including tool and email parameters for tracking.
    process.env.NCBI_EMAIL = "admin@copi.science";

    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => SINGLE_PMID_RESPONSE,
    });

    await convertPmidsToPmcids(["12345678"]);

    const calledUrl = mockFetch.mock.calls[0]![0] as string;
    expect(calledUrl).toContain("email=admin%40copi.science");
  });

  it("sends multiple PMIDs as comma-separated in one request", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => MIXED_RESULTS_RESPONSE,
    });

    const results = await convertPmidsToPmcids(["12345678", "87654321"]);

    expect(results).toHaveLength(2);
    const calledUrl = mockFetch.mock.calls[0]![0] as string;
    expect(calledUrl).toMatch(/ids=12345678(%2C|,)87654321/);
  });

  it("returns empty array for empty PMID list", async () => {
    const results = await convertPmidsToPmcids([]);

    expect(results).toEqual([]);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("throws on API error", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 500,
      statusText: "Internal Server Error",
    });

    await expect(convertPmidsToPmcids(["12345678"])).rejects.toThrow(
      "NCBI ID Converter API error: 500 Internal Server Error"
    );
  });

  it("throws on rate limit (429)", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 429,
      statusText: "Too Many Requests",
    });

    await expect(convertPmidsToPmcids(["12345678"])).rejects.toThrow(
      "NCBI ID Converter API error: 429 Too Many Requests"
    );
  });

  it("splits large ID lists into batches of 200", async () => {
    // Generate 250 PMIDs to trigger batching
    const pmids = Array.from({ length: 250 }, (_, i) =>
      String(10000000 + i)
    );

    // First batch (200 PMIDs)
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => MULTI_SUCCESS_RESPONSE,
    });
    // Second batch (50 PMIDs)
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => SINGLE_PMID_RESPONSE,
    });

    await convertPmidsToPmcids(pmids);

    expect(mockFetch).toHaveBeenCalledTimes(2);

    // Verify first batch has 200 IDs
    const firstUrl = mockFetch.mock.calls[0]![0] as string;
    const firstIdsParam = new URL(firstUrl).searchParams.get("ids")!;
    expect(firstIdsParam.split(",")).toHaveLength(200);

    // Verify second batch has 50 IDs
    const secondUrl = mockFetch.mock.calls[1]![0] as string;
    const secondIdsParam = new URL(secondUrl).searchParams.get("ids")!;
    expect(secondIdsParam.split(",")).toHaveLength(50);
  });

  it("handles exactly 200 PMIDs in a single batch", async () => {
    const pmids = Array.from({ length: 200 }, (_, i) =>
      String(10000000 + i)
    );

    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => MULTI_SUCCESS_RESPONSE,
    });

    await convertPmidsToPmcids(pmids);

    // Should be exactly 1 request, not 2
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });
});

// --- convertDoisToPmids tests ---

describe("convertDoisToPmids", () => {
  // Tests the DOI → PMID resolution path. Used for ORCID works that
  // only have DOIs (spec: "Publications Without PMIDs" edge case).
  // Resolving to PMIDs enables abstract fetching from PubMed.

  it("converts a DOI to its PMID and PMCID", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => DOI_CONVERSION_RESPONSE,
    });

    const results = await convertDoisToPmids([
      "10.1038/s41586-023-00001-1",
    ]);

    expect(results).toHaveLength(1);
    expect(results[0]!.pmid).toBe("12345678");
    expect(results[0]!.pmcid).toBe("PMC7654321");
    expect(results[0]!.doi).toBe("10.1038/s41586-023-00001-1");
  });

  it("sends DOIs in the ids parameter", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => DOI_CONVERSION_RESPONSE,
    });

    await convertDoisToPmids(["10.1038/s41586-023-00001-1"]);

    const calledUrl = mockFetch.mock.calls[0]![0] as string;
    // DOIs contain slashes which get URL-encoded
    expect(calledUrl).toContain("ids=");
    expect(decodeURIComponent(calledUrl)).toContain(
      "10.1038/s41586-023-00001-1"
    );
  });

  it("returns empty array for empty DOI list", async () => {
    const results = await convertDoisToPmids([]);

    expect(results).toEqual([]);
    expect(mockFetch).not.toHaveBeenCalled();
  });
});

// --- convertIds tests ---

describe("convertIds", () => {
  // Tests the generic ID conversion function that accepts any mix of
  // PMIDs, PMCIDs, and DOIs. The NCBI API auto-detects ID types.

  it("handles mixed ID types in a single call", async () => {
    const mixedResponse = {
      status: "ok",
      records: [
        {
          pmid: "12345678",
          pmcid: "PMC7654321",
          doi: "10.1038/s41586-023-00001-1",
        },
        {
          pmid: "11111111",
          pmcid: "PMC1111111",
          doi: "10.1016/j.cell.2024.01.001",
        },
      ],
    };

    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => mixedResponse,
    });

    const results = await convertIds([
      "12345678",
      "10.1016/j.cell.2024.01.001",
    ]);

    expect(results).toHaveLength(2);
    expect(results[0]!.pmid).toBe("12345678");
    expect(results[1]!.pmid).toBe("11111111");
  });

  it("returns empty array for empty input", async () => {
    const results = await convertIds([]);

    expect(results).toEqual([]);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("aggregates results across batches", async () => {
    // Generate 210 IDs to trigger 2 batches
    const ids = Array.from({ length: 210 }, (_, i) => String(10000000 + i));

    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        status: "ok",
        records: [
          { pmid: "10000000", pmcid: "PMC1000000" },
          { pmid: "10000001", pmcid: "PMC1000001" },
        ],
      }),
    });

    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        status: "ok",
        records: [{ pmid: "10000200", pmcid: "PMC1000200" }],
      }),
    });

    const results = await convertIds(ids);

    // Results from both batches should be aggregated
    expect(results).toHaveLength(3);
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });
});
