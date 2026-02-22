/**
 * Tests for the PMC E-utilities client (deep mining of methods sections).
 *
 * Validates correct extraction of methods/materials sections from PMC
 * full-text JATS XML, including:
 * - Methods section identification by sec-type attribute
 * - Methods section identification by title text matching
 * - Various title formats (Methods, Materials and Methods, Experimental Procedures, etc.)
 * - Text extraction with inline markup (italic, bold, xref, sub, sup)
 * - Nested subsections within methods
 * - Batch fetching and PMCID matching
 * - URL building with API key, email, and PMC prefix stripping
 * - Error handling and edge cases
 *
 * These tests ensure CoPI correctly extracts methods text from PMC
 * for the deep mining step of the profile ingestion pipeline (spec Step 5).
 * Methods text feeds into LLM profile synthesis to produce more specific
 * technique, model, and reagent annotations.
 */

import {
  fetchMethodsSections,
  parsePmcXml,
  extractMethodsText,
  buildEfetchUrl,
  extractBalancedElement,
  stripXmlTags,
} from "../pmc";

// Mock global fetch
const mockFetch = jest.fn();
global.fetch = mockFetch;

beforeEach(() => {
  mockFetch.mockReset();
  delete process.env.NCBI_API_KEY;
  delete process.env.NCBI_EMAIL;
});

// --- Test XML fixtures ---

/**
 * PMC article with sec-type="methods" attribute on the methods section.
 * This is the most common and reliable way to identify methods sections.
 */
const ARTICLE_WITH_SEC_TYPE_XML = `<?xml version="1.0" ?>
<!DOCTYPE pmc-articleset PUBLIC "-//NLM//DTD ARTICLE SET 2.0//EN" "https://dtd.nlm.nih.gov/ncbi/pmc/articleset/nlm-articleset-2.0.dtd">
<pmc-articleset>
<article article-type="research-article">
  <front>
    <article-meta>
      <article-id pub-id-type="pmc">9876543</article-id>
      <article-id pub-id-type="pmid">34567890</article-id>
      <article-id pub-id-type="doi">10.1234/example.2023</article-id>
      <title-group>
        <article-title>CRISPR Screening Identifies Novel Drug Targets</article-title>
      </title-group>
    </article-meta>
  </front>
  <body>
    <sec sec-type="intro">
      <title>Introduction</title>
      <p>Glioblastoma is the most aggressive form of brain cancer.</p>
    </sec>
    <sec sec-type="methods">
      <title>Materials and Methods</title>
      <p>All experiments were performed in accordance with institutional guidelines.</p>
      <sec>
        <title>Cell Culture</title>
        <p>U87MG and T98G glioblastoma cell lines were cultured in DMEM supplemented with 10% FBS at 37C.</p>
      </sec>
      <sec>
        <title>CRISPR Library Screening</title>
        <p>The GeCKO v2 library was used for genome-wide screening. Cells were transduced at MOI 0.3 and selected with puromycin for 7 days.</p>
      </sec>
    </sec>
    <sec sec-type="results">
      <title>Results</title>
      <p>We identified 47 novel drug targets.</p>
    </sec>
  </body>
</article>
</pmc-articleset>`;

/**
 * PMC article where the methods section has no sec-type attribute,
 * identified only by its <title> text. Tests the title-matching fallback.
 */
const ARTICLE_WITH_TITLE_METHODS_XML = `<?xml version="1.0" ?>
<pmc-articleset>
<article article-type="research-article">
  <front>
    <article-meta>
      <article-id pub-id-type="pmc">1111111</article-id>
    </article-meta>
  </front>
  <body>
    <sec>
      <title>Introduction</title>
      <p>Background information for the study.</p>
    </sec>
    <sec>
      <title>Methods</title>
      <p>RNA was extracted using TRIzol reagent.</p>
      <p>Libraries were prepared using the Illumina TruSeq kit.</p>
    </sec>
    <sec>
      <title>Results</title>
      <p>We found significant differences in gene expression.</p>
    </sec>
  </body>
</article>
</pmc-articleset>`;

/**
 * PMC article with no methods section at all (e.g., a review article).
 * The client should return null methodsText.
 */
const ARTICLE_NO_METHODS_XML = `<?xml version="1.0" ?>
<pmc-articleset>
<article article-type="review-article">
  <front>
    <article-meta>
      <article-id pub-id-type="pmc">2222222</article-id>
    </article-meta>
  </front>
  <body>
    <sec>
      <title>Introduction</title>
      <p>This review covers recent advances in immunotherapy.</p>
    </sec>
    <sec>
      <title>Current Landscape</title>
      <p>Multiple checkpoint inhibitors are now approved.</p>
    </sec>
    <sec>
      <title>Future Directions</title>
      <p>Combination therapies show promise.</p>
    </sec>
  </body>
</article>
</pmc-articleset>`;

/**
 * Response with two articles. Tests batch parsing and PMCID matching.
 */
const MULTI_ARTICLE_XML = `<?xml version="1.0" ?>
<pmc-articleset>
<article article-type="research-article">
  <front>
    <article-meta>
      <article-id pub-id-type="pmc">3333333</article-id>
    </article-meta>
  </front>
  <body>
    <sec sec-type="methods">
      <title>Methods</title>
      <p>Mice were treated with compound A at 10 mg/kg daily.</p>
    </sec>
  </body>
</article>
<article article-type="research-article">
  <front>
    <article-meta>
      <article-id pub-id-type="pmc">4444444</article-id>
    </article-meta>
  </front>
  <body>
    <sec sec-type="methods">
      <title>Experimental Procedures</title>
      <p>Protein lysates were analyzed by Western blot using anti-EGFR antibody.</p>
    </sec>
  </body>
</article>
</pmc-articleset>`;

/**
 * Article with inline markup in the methods section (italic, bold, xref,
 * sub, sup). Tests that text content is preserved even with mixed content.
 */
const ARTICLE_WITH_INLINE_MARKUP_XML = `<?xml version="1.0" ?>
<pmc-articleset>
<article article-type="research-article">
  <front>
    <article-meta>
      <article-id pub-id-type="pmc">5555555</article-id>
    </article-meta>
  </front>
  <body>
    <sec sec-type="methods">
      <title>Materials and Methods</title>
      <p>Cells were cultured in <italic>DMEM</italic> supplemented with 10% <bold>FBS</bold> (Gibco) at 37<sup>o</sup>C in 5% CO<sub>2</sub>.</p>
      <p>Statistical analysis was performed using <italic>R</italic> version 4.3 (<xref ref-type="bibr" rid="ref1">Smith et al., 2023</xref>).</p>
    </sec>
  </body>
</article>
</pmc-articleset>`;

/**
 * Article with "Experimental Procedures" as the title variant.
 * Common in Cell Press journals (Cell, Molecular Cell, etc.).
 */
const ARTICLE_EXPERIMENTAL_PROCEDURES_XML = `<?xml version="1.0" ?>
<pmc-articleset>
<article article-type="research-article">
  <front>
    <article-meta>
      <article-id pub-id-type="pmc">6666666</article-id>
    </article-meta>
  </front>
  <body>
    <sec>
      <title>Experimental Procedures</title>
      <p>Flow cytometry was performed on a BD LSRFortessa.</p>
      <sec>
        <title>Antibodies</title>
        <p>Anti-CD3 (clone OKT3), anti-CD4 (clone RPA-T4) were used.</p>
      </sec>
    </sec>
  </body>
</article>
</pmc-articleset>`;

/**
 * Article with sec-type="materials|methods" (pipe-separated variant).
 * Some journals use this format in their JATS XML.
 */
const ARTICLE_MATERIALS_PIPE_METHODS_XML = `<?xml version="1.0" ?>
<pmc-articleset>
<article article-type="research-article">
  <front>
    <article-meta>
      <article-id pub-id-type="pmc">7777777</article-id>
    </article-meta>
  </front>
  <body>
    <sec sec-type="materials|methods">
      <title>Materials and Methods</title>
      <p>DNA was extracted using the Qiagen DNeasy Blood &amp; Tissue Kit.</p>
    </sec>
  </body>
</article>
</pmc-articleset>`;

/**
 * Article with no <body> element. Some PMC records may lack full text.
 */
const ARTICLE_NO_BODY_XML = `<?xml version="1.0" ?>
<pmc-articleset>
<article article-type="research-article">
  <front>
    <article-meta>
      <article-id pub-id-type="pmc">8888888</article-id>
    </article-meta>
  </front>
</article>
</pmc-articleset>`;

/**
 * Article with "STAR Methods" title (common in Cell Press journals).
 */
const ARTICLE_STAR_METHODS_XML = `<?xml version="1.0" ?>
<pmc-articleset>
<article article-type="research-article">
  <front>
    <article-meta>
      <article-id pub-id-type="pmc">9999999</article-id>
    </article-meta>
  </front>
  <body>
    <sec>
      <title>Results</title>
      <p>We identified key regulators.</p>
    </sec>
    <sec>
      <title>STAR Methods</title>
      <p>Single-cell RNA sequencing was performed using the 10x Genomics Chromium platform.</p>
      <sec>
        <title>Lead Contact</title>
        <p>Further information should be directed to the lead contact.</p>
      </sec>
      <sec>
        <title>Method Details</title>
        <p>Libraries were sequenced on an Illumina NovaSeq 6000.</p>
      </sec>
    </sec>
  </body>
</article>
</pmc-articleset>`;

/**
 * Empty pmc-articleset response (no articles returned).
 */
const EMPTY_RESPONSE_XML = `<?xml version="1.0" ?>
<pmc-articleset>
</pmc-articleset>`;

// --- extractMethodsText tests ---

describe("extractMethodsText", () => {
  // Tests the core methods section extraction logic. This is the most
  // critical part of the PMC client — it must correctly identify and
  // extract methods text from diverse JATS XML structures.

  it("extracts methods by sec-type attribute", () => {
    // sec-type="methods" is the most reliable identification strategy.
    // The extracted text should include all subsection content.
    const articleXml = extractArticleXmls(ARTICLE_WITH_SEC_TYPE_XML)[0]!;
    const text = extractMethodsText(articleXml);

    expect(text).toContain("institutional guidelines");
    expect(text).toContain("U87MG and T98G");
    expect(text).toContain("GeCKO v2 library");
    expect(text).toContain("puromycin");
  });

  it("extracts methods by title text when sec-type is absent", () => {
    // When sec-type attribute is missing, fall back to matching <title> text.
    const articleXml = extractArticleXmls(ARTICLE_WITH_TITLE_METHODS_XML)[0]!;
    const text = extractMethodsText(articleXml);

    expect(text).toContain("TRIzol reagent");
    expect(text).toContain("Illumina TruSeq");
  });

  it("returns empty string when no methods section exists", () => {
    // Review articles and other non-research articles may lack methods.
    const articleXml = extractArticleXmls(ARTICLE_NO_METHODS_XML)[0]!;
    const text = extractMethodsText(articleXml);

    expect(text).toBe("");
  });

  it("returns empty string for articles without a body element", () => {
    const articleXml = extractArticleXmls(ARTICLE_NO_BODY_XML)[0]!;
    const text = extractMethodsText(articleXml);

    expect(text).toBe("");
  });

  it("handles inline markup by preserving text content", () => {
    // PMC XML uses inline elements like <italic>, <bold>, <sub>, <sup>,
    // <xref>. The text content from these should be preserved in output.
    const articleXml = extractArticleXmls(ARTICLE_WITH_INLINE_MARKUP_XML)[0]!;
    const text = extractMethodsText(articleXml);

    expect(text).toContain("DMEM");
    expect(text).toContain("FBS");
    expect(text).toContain("CO");
    expect(text).toContain("R");
    expect(text).toContain("version 4.3");
  });

  it("recognizes 'Experimental Procedures' as a methods section", () => {
    // Cell Press journals (Cell, Molecular Cell) use this title variant.
    const articleXml = extractArticleXmls(
      ARTICLE_EXPERIMENTAL_PROCEDURES_XML
    )[0]!;
    const text = extractMethodsText(articleXml);

    expect(text).toContain("BD LSRFortessa");
    expect(text).toContain("Anti-CD3");
  });

  it("recognizes sec-type='materials|methods' variant", () => {
    // Some journals use the pipe-separated sec-type format.
    const articleXml = extractArticleXmls(
      ARTICLE_MATERIALS_PIPE_METHODS_XML
    )[0]!;
    const text = extractMethodsText(articleXml);

    expect(text).toContain("Qiagen DNeasy");
  });

  it("recognizes 'STAR Methods' as a methods section", () => {
    // STAR Methods is a structured methods format used by Cell Press.
    const articleXml = extractArticleXmls(ARTICLE_STAR_METHODS_XML)[0]!;
    const text = extractMethodsText(articleXml);

    expect(text).toContain("10x Genomics Chromium");
    expect(text).toContain("Illumina NovaSeq 6000");
  });

  it("includes subsection titles in extracted text", () => {
    // Subsection titles like "Cell Culture", "Western Blot" provide
    // valuable context for the LLM about techniques used.
    const articleXml = extractArticleXmls(ARTICLE_WITH_SEC_TYPE_XML)[0]!;
    const text = extractMethodsText(articleXml);

    expect(text).toContain("Cell Culture");
    expect(text).toContain("CRISPR Library Screening");
  });

  it("does not extract Introduction or Results text", () => {
    // Only the methods section should be extracted, not other sections.
    const articleXml = extractArticleXmls(ARTICLE_WITH_SEC_TYPE_XML)[0]!;
    const text = extractMethodsText(articleXml);

    expect(text).not.toContain("aggressive form of brain cancer");
    expect(text).not.toContain("47 novel drug targets");
  });

  it("decodes XML entities in extracted text", () => {
    // XML entities like &amp; should be decoded to their character equivalents.
    const articleXml = extractArticleXmls(
      ARTICLE_MATERIALS_PIPE_METHODS_XML
    )[0]!;
    const text = extractMethodsText(articleXml);

    expect(text).toContain("Blood & Tissue Kit");
    expect(text).not.toContain("&amp;");
  });

  it("recognizes 'Materials and Methods' title", () => {
    const xml = `<article><front><article-meta><article-id pub-id-type="pmc">100</article-id></article-meta></front><body>
      <sec><title>Materials and Methods</title><p>Sample preparation was done.</p></sec>
    </body></article>`;
    const text = extractMethodsText(xml);
    expect(text).toContain("Sample preparation");
  });

  it("recognizes 'Patients and Methods' title", () => {
    const xml = `<article><front><article-meta><article-id pub-id-type="pmc">101</article-id></article-meta></front><body>
      <sec><title>Patients and Methods</title><p>Patients were enrolled from 3 centers.</p></sec>
    </body></article>`;
    const text = extractMethodsText(xml);
    expect(text).toContain("enrolled from 3 centers");
  });

  it("recognizes 'Study Design and Methods' title", () => {
    const xml = `<article><front><article-meta><article-id pub-id-type="pmc">102</article-id></article-meta></front><body>
      <sec><title>Study Design and Methods</title><p>A prospective cohort study was conducted.</p></sec>
    </body></article>`;
    const text = extractMethodsText(xml);
    expect(text).toContain("prospective cohort");
  });
});

// --- parsePmcXml tests ---

describe("parsePmcXml", () => {
  // Tests the full XML parsing flow: splitting batch responses into
  // individual articles, extracting PMCIDs, and matching results
  // back to the requested PMCIDs.

  it("parses a single article with methods", () => {
    const results = parsePmcXml(ARTICLE_WITH_SEC_TYPE_XML, ["PMC9876543"]);

    expect(results).toHaveLength(1);
    expect(results[0]!.pmcid).toBe("PMC9876543");
    expect(results[0]!.methodsText).toContain("institutional guidelines");
    expect(results[0]!.methodsText).toContain("GeCKO v2 library");
  });

  it("parses multiple articles in a batch response", () => {
    const results = parsePmcXml(MULTI_ARTICLE_XML, [
      "PMC3333333",
      "PMC4444444",
    ]);

    expect(results).toHaveLength(2);
    expect(results[0]!.pmcid).toBe("PMC3333333");
    expect(results[0]!.methodsText).toContain("compound A");
    expect(results[1]!.pmcid).toBe("PMC4444444");
    expect(results[1]!.methodsText).toContain("Western blot");
  });

  it("returns results in the order of requested PMCIDs", () => {
    // Even if the XML response has articles in a different order,
    // results should follow the requestedPmcids order.
    const results = parsePmcXml(MULTI_ARTICLE_XML, [
      "PMC4444444",
      "PMC3333333",
    ]);

    expect(results[0]!.pmcid).toBe("PMC4444444");
    expect(results[1]!.pmcid).toBe("PMC3333333");
  });

  it("returns null methodsText for missing articles", () => {
    // If a requested PMCID is not found in the response (e.g., embargoed
    // or retracted), methodsText should be null.
    const results = parsePmcXml(ARTICLE_WITH_SEC_TYPE_XML, [
      "PMC9876543",
      "PMC0000000",
    ]);

    expect(results).toHaveLength(2);
    expect(results[0]!.pmcid).toBe("PMC9876543");
    expect(results[0]!.methodsText).not.toBeNull();
    expect(results[1]!.pmcid).toBe("PMC0000000");
    expect(results[1]!.methodsText).toBeNull();
  });

  it("returns null methodsText for articles without methods section", () => {
    const results = parsePmcXml(ARTICLE_NO_METHODS_XML, ["PMC2222222"]);

    expect(results).toHaveLength(1);
    expect(results[0]!.pmcid).toBe("PMC2222222");
    expect(results[0]!.methodsText).toBeNull();
  });

  it("handles empty pmc-articleset response", () => {
    const results = parsePmcXml(EMPTY_RESPONSE_XML, ["PMC1234567"]);

    expect(results).toHaveLength(1);
    expect(results[0]!.pmcid).toBe("PMC1234567");
    expect(results[0]!.methodsText).toBeNull();
  });

  it("handles completely empty XML", () => {
    const results = parsePmcXml("", ["PMC1234567"]);

    expect(results).toHaveLength(1);
    expect(results[0]!.pmcid).toBe("PMC1234567");
    expect(results[0]!.methodsText).toBeNull();
  });

  it("handles case-insensitive PMCID matching", () => {
    // PMCIDs should be matched case-insensitively
    const results = parsePmcXml(ARTICLE_WITH_SEC_TYPE_XML, ["pmc9876543"]);

    expect(results).toHaveLength(1);
    expect(results[0]!.methodsText).toContain("institutional guidelines");
  });
});

// --- buildEfetchUrl tests ---

describe("buildEfetchUrl", () => {
  // Tests URL construction for the PMC efetch API endpoint.
  // Verifies correct parameter formatting per NCBI guidelines.

  it("builds correct URL with PMC prefix stripped", () => {
    // PMC efetch expects numeric IDs without the "PMC" prefix.
    const url = buildEfetchUrl(["PMC1234567"]);

    expect(url).toContain("eutils.ncbi.nlm.nih.gov/entrez/eutils/efetch.fcgi");
    expect(url).toContain("db=pmc");
    expect(url).toContain("id=1234567");
    expect(url).toContain("rettype=xml");
    expect(url).toContain("tool=copi");
    // Should NOT contain "PMC" in the id parameter
    expect(url).not.toMatch(/id=PMC/i);
  });

  it("joins multiple PMCIDs with commas", () => {
    const url = buildEfetchUrl(["PMC1111111", "PMC2222222", "PMC3333333"]);

    expect(url).toMatch(/id=1111111(%2C|,)2222222(%2C|,)3333333/);
  });

  it("includes API key when configured", () => {
    process.env.NCBI_API_KEY = "test-pmc-key-789";
    const url = buildEfetchUrl(["PMC1234567"]);

    expect(url).toContain("api_key=test-pmc-key-789");
  });

  it("excludes API key when not configured", () => {
    const url = buildEfetchUrl(["PMC1234567"]);

    expect(url).not.toContain("api_key");
  });

  it("includes email when configured", () => {
    process.env.NCBI_EMAIL = "admin@copi.science";
    const url = buildEfetchUrl(["PMC1234567"]);

    expect(url).toContain("email=admin%40copi.science");
  });

  it("excludes email when not configured", () => {
    const url = buildEfetchUrl(["PMC1234567"]);

    expect(url).not.toContain("email");
  });

  it("handles lowercase pmc prefix", () => {
    const url = buildEfetchUrl(["pmc1234567"]);

    expect(url).toContain("id=1234567");
  });
});

// --- fetchMethodsSections tests ---

describe("fetchMethodsSections", () => {
  // Tests the full fetch flow: batching, URL building, HTTP calls,
  // and result aggregation.

  it("fetches and parses a single PMCID", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      text: async () => ARTICLE_WITH_SEC_TYPE_XML,
    });

    const results = await fetchMethodsSections(["PMC9876543"]);

    expect(results).toHaveLength(1);
    expect(results[0]!.pmcid).toBe("PMC9876543");
    expect(results[0]!.methodsText).toContain("GeCKO v2 library");
  });

  it("returns empty array for empty PMCID list", async () => {
    const results = await fetchMethodsSections([]);

    expect(results).toEqual([]);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("throws on API error", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 500,
      statusText: "Internal Server Error",
    });

    await expect(fetchMethodsSections(["PMC1234567"])).rejects.toThrow(
      "PMC efetch API error: 500 Internal Server Error"
    );
  });

  it("throws on rate limit (429)", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 429,
      statusText: "Too Many Requests",
    });

    await expect(fetchMethodsSections(["PMC1234567"])).rejects.toThrow(
      "PMC efetch API error: 429 Too Many Requests"
    );
  });

  it("splits large PMCID lists into batches of 10", async () => {
    // PMC full-text articles are large, so batches are smaller (10) than
    // PubMed abstracts (200) to keep response sizes manageable.
    const pmcids = Array.from(
      { length: 15 },
      (_, i) => `PMC${1000000 + i}`
    );

    // First batch (10 PMCIDs) — return article set with 1 match
    mockFetch.mockResolvedValueOnce({
      ok: true,
      text: async () => EMPTY_RESPONSE_XML,
    });
    // Second batch (5 PMCIDs)
    mockFetch.mockResolvedValueOnce({
      ok: true,
      text: async () => EMPTY_RESPONSE_XML,
    });

    await fetchMethodsSections(pmcids);

    expect(mockFetch).toHaveBeenCalledTimes(2);

    // Verify first batch has 10 IDs in the URL
    const firstUrl = mockFetch.mock.calls[0]![0] as string;
    const firstIds = new URL(firstUrl).searchParams.get("id")!;
    expect(firstIds.split(",")).toHaveLength(10);

    // Verify second batch has 5 IDs
    const secondUrl = mockFetch.mock.calls[1]![0] as string;
    const secondIds = new URL(secondUrl).searchParams.get("id")!;
    expect(secondIds.split(",")).toHaveLength(5);
  });

  it("handles exactly 10 PMCIDs in a single batch", async () => {
    const pmcids = Array.from(
      { length: 10 },
      (_, i) => `PMC${1000000 + i}`
    );

    mockFetch.mockResolvedValueOnce({
      ok: true,
      text: async () => EMPTY_RESPONSE_XML,
    });

    await fetchMethodsSections(pmcids);

    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it("includes API key in fetch URL when configured", async () => {
    process.env.NCBI_API_KEY = "test-fetch-key";

    mockFetch.mockResolvedValueOnce({
      ok: true,
      text: async () => ARTICLE_WITH_SEC_TYPE_XML,
    });

    await fetchMethodsSections(["PMC9876543"]);

    const calledUrl = mockFetch.mock.calls[0]![0] as string;
    expect(calledUrl).toContain("api_key=test-fetch-key");
  });
});

// --- extractBalancedElement tests ---

describe("extractBalancedElement", () => {
  // Tests the XML element extraction utility that handles nested elements
  // of the same tag name. Critical for correctly extracting <sec> elements
  // that contain nested <sec> subsections.

  it("extracts a simple element without nesting", () => {
    const xml = "<root><sec>content</sec></root>";
    const result = extractBalancedElement(xml, 6, "sec");

    expect(result).toBe("<sec>content</sec>");
  });

  it("extracts an element with nested elements of the same tag", () => {
    // Methods sections frequently contain nested <sec> subsections.
    const xml = "<sec><sec>inner</sec></sec>";
    const result = extractBalancedElement(xml, 0, "sec");

    expect(result).toBe("<sec><sec>inner</sec></sec>");
  });

  it("extracts with attributes on the opening tag", () => {
    const xml = '<sec sec-type="methods"><p>text</p></sec>';
    const result = extractBalancedElement(xml, 0, "sec");

    expect(result).toBe('<sec sec-type="methods"><p>text</p></sec>');
  });

  it("handles deeply nested elements", () => {
    const xml = "<sec>L1<sec>L2<sec>L3</sec></sec></sec>";
    const result = extractBalancedElement(xml, 0, "sec");

    expect(result).toBe("<sec>L1<sec>L2<sec>L3</sec></sec></sec>");
  });

  it("does not match tags with the name as a prefix", () => {
    // <section> should not be confused with <sec>.
    const xml = "<sec><section>not a sec</section></sec>";
    const result = extractBalancedElement(xml, 0, "sec");

    expect(result).toBe("<sec><section>not a sec</section></sec>");
  });

  it("handles self-closing tags", () => {
    const xml = "<sec/>";
    const result = extractBalancedElement(xml, 0, "sec");

    expect(result).toBe("<sec/>");
  });

  it("returns null for unbalanced XML", () => {
    const xml = "<sec>unclosed";
    const result = extractBalancedElement(xml, 0, "sec");

    expect(result).toBeNull();
  });

  it("returns null when tag not found at start index", () => {
    const xml = "<div>no sec here</div>";
    const result = extractBalancedElement(xml, 0, "sec");

    expect(result).toBeNull();
  });
});

// --- stripXmlTags tests ---

describe("stripXmlTags", () => {
  // Tests the tag stripping utility that converts XML sections to
  // plain text for storage as methods_text.

  it("strips simple XML tags", () => {
    const result = stripXmlTags("<p>Hello world</p>");
    expect(result).toBe("Hello world");
  });

  it("preserves paragraph breaks", () => {
    const result = stripXmlTags("<p>First paragraph.</p><p>Second paragraph.</p>");
    expect(result).toContain("First paragraph.");
    expect(result).toContain("Second paragraph.");
    // Should have some separation between paragraphs
    expect(result).toMatch(/First paragraph\.\n\nSecond paragraph\./);
  });

  it("decodes XML entities", () => {
    const result = stripXmlTags(
      "<p>A &amp; B &lt; C &gt; D &quot;E&quot; F&apos;s</p>"
    );
    expect(result).toContain('A & B < C > D "E" F\'s');
  });

  it("decodes numeric character references", () => {
    const result = stripXmlTags("<p>&#176;C and &#x2013; dash</p>");
    expect(result).toContain("°C");
    expect(result).toContain("\u2013");
  });

  it("collapses excessive whitespace", () => {
    const result = stripXmlTags("<p>  lots   of   spaces  </p>");
    expect(result).toBe("lots of spaces");
  });

  it("handles empty input", () => {
    expect(stripXmlTags("")).toBe("");
  });
});

// --- Helper to extract article XMLs (used in tests) ---

/**
 * Extracts individual <article> XML chunks from a PMC response.
 * Exposed here for testing extractMethodsText on individual articles.
 */
function extractArticleXmls(xml: string): string[] {
  const articles: string[] = [];
  const openTag = "<article";
  let searchFrom = 0;
  while (searchFrom < xml.length) {
    const start = xml.indexOf(openTag, searchFrom);
    if (start === -1) break;
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
