/**
 * Tests for the PubMed API client.
 *
 * Validates correct parsing of PubMed efetch XML responses including:
 * - Single and batch article fetching
 * - Structured and unstructured abstracts
 * - Article ID extraction (PMID, PMCID, DOI)
 * - Author list parsing and position determination
 * - Article type classification
 * - Date extraction (standard Year and MedlineDate formats)
 * - NCBI API key inclusion
 * - Error handling and edge cases
 *
 * These tests ensure CoPI correctly extracts publication metadata from
 * PubMed's E-utilities API for the profile ingestion pipeline (spec Step 4).
 */

import {
  fetchPubMedAbstracts,
  parsePubMedXml,
  determineAuthorPosition,
  PubMedAuthor,
} from "../pubmed";

// Mock global fetch
const mockFetch = jest.fn();
global.fetch = mockFetch;

beforeEach(() => {
  mockFetch.mockReset();
  delete process.env.NCBI_API_KEY;
});

// --- Test XML fixtures ---

/**
 * Minimal valid PubMed XML with a single research article.
 * Used as the baseline for most parsing tests.
 */
const SINGLE_ARTICLE_XML = `<?xml version="1.0" ?>
<!DOCTYPE PubmedArticleSet PUBLIC "-//NLM//DTD PubMedArticle, 1st January 2024//EN" "https://dtd.nlm.nih.gov/ncbi/pubmed/out/pubmed_240101.dtd">
<PubmedArticleSet>
  <PubmedArticle>
    <MedlineCitation>
      <PMID Version="1">12345678</PMID>
      <Article>
        <Journal>
          <ISOAbbreviation>Nature</ISOAbbreviation>
          <Title>Nature</Title>
          <JournalIssue>
            <PubDate>
              <Year>2023</Year>
            </PubDate>
          </JournalIssue>
        </Journal>
        <ArticleTitle>CRISPR screens reveal new cancer drug targets</ArticleTitle>
        <Abstract>
          <AbstractText>We performed genome-wide CRISPR screens in multiple cancer cell lines to identify novel therapeutic targets.</AbstractText>
        </Abstract>
        <AuthorList>
          <Author>
            <LastName>Smith</LastName>
            <ForeName>John A</ForeName>
            <Initials>JA</Initials>
          </Author>
          <Author>
            <LastName>Chen</LastName>
            <ForeName>Wei</ForeName>
            <Initials>W</Initials>
          </Author>
          <Author>
            <LastName>Johnson</LastName>
            <ForeName>Robert B</ForeName>
            <Initials>RB</Initials>
          </Author>
        </AuthorList>
        <PublicationTypeList>
          <PublicationType UI="D016428">Journal Article</PublicationType>
          <PublicationType UI="D052061">Research Support, N.I.H., Extramural</PublicationType>
        </PublicationTypeList>
      </Article>
    </MedlineCitation>
    <PubmedData>
      <ArticleIdList>
        <ArticleId IdType="pubmed">12345678</ArticleId>
        <ArticleId IdType="pmc">PMC9876543</ArticleId>
        <ArticleId IdType="doi">10.1038/s41586-023-00001-1</ArticleId>
      </ArticleIdList>
    </PubmedData>
  </PubmedArticle>
</PubmedArticleSet>`;

/**
 * PubMed XML with a structured abstract (labeled sections).
 * Common in clinical and methods-heavy journals.
 */
const STRUCTURED_ABSTRACT_XML = `<?xml version="1.0" ?>
<PubmedArticleSet>
  <PubmedArticle>
    <MedlineCitation>
      <PMID Version="1">23456789</PMID>
      <Article>
        <Journal>
          <Title>The Lancet</Title>
          <JournalIssue>
            <PubDate>
              <Year>2024</Year>
            </PubDate>
          </JournalIssue>
        </Journal>
        <ArticleTitle>Randomized trial of drug X in patients with disease Y</ArticleTitle>
        <Abstract>
          <AbstractText Label="BACKGROUND">Disease Y has limited treatment options.</AbstractText>
          <AbstractText Label="METHODS">We conducted a randomized double-blind placebo-controlled trial.</AbstractText>
          <AbstractText Label="RESULTS">Drug X reduced symptoms by 45% (p &lt; 0.001).</AbstractText>
          <AbstractText Label="CONCLUSIONS">Drug X is effective for disease Y.</AbstractText>
        </Abstract>
        <AuthorList>
          <Author>
            <LastName>Williams</LastName>
            <ForeName>Sarah</ForeName>
            <Initials>S</Initials>
          </Author>
        </AuthorList>
        <PublicationTypeList>
          <PublicationType UI="D016449">Randomized Controlled Trial</PublicationType>
          <PublicationType UI="D016428">Journal Article</PublicationType>
        </PublicationTypeList>
      </Article>
    </MedlineCitation>
    <PubmedData>
      <ArticleIdList>
        <ArticleId IdType="pubmed">23456789</ArticleId>
        <ArticleId IdType="doi">10.1016/S0140-6736(24)00001-1</ArticleId>
      </ArticleIdList>
    </PubmedData>
  </PubmedArticle>
</PubmedArticleSet>`;

/**
 * XML with multiple articles, including a review.
 * Used to test batch parsing and article type classification.
 */
const MULTI_ARTICLE_XML = `<?xml version="1.0" ?>
<PubmedArticleSet>
  <PubmedArticle>
    <MedlineCitation>
      <PMID Version="1">11111111</PMID>
      <Article>
        <Journal>
          <Title>Cell</Title>
          <JournalIssue>
            <PubDate>
              <Year>2024</Year>
            </PubDate>
          </JournalIssue>
        </Journal>
        <ArticleTitle>Single-cell atlas of the developing brain</ArticleTitle>
        <Abstract>
          <AbstractText>We generated a comprehensive single-cell transcriptomic atlas.</AbstractText>
        </Abstract>
        <AuthorList>
          <Author>
            <LastName>Park</LastName>
            <ForeName>Min-Ji</ForeName>
            <Initials>MJ</Initials>
          </Author>
          <Author>
            <LastName>Lee</LastName>
            <ForeName>Sung-Ho</ForeName>
            <Initials>SH</Initials>
          </Author>
        </AuthorList>
        <PublicationTypeList>
          <PublicationType UI="D016428">Journal Article</PublicationType>
        </PublicationTypeList>
      </Article>
    </MedlineCitation>
    <PubmedData>
      <ArticleIdList>
        <ArticleId IdType="pubmed">11111111</ArticleId>
        <ArticleId IdType="pmc">PMC1111111</ArticleId>
        <ArticleId IdType="doi">10.1016/j.cell.2024.01.001</ArticleId>
      </ArticleIdList>
    </PubmedData>
  </PubmedArticle>
  <PubmedArticle>
    <MedlineCitation>
      <PMID Version="1">22222222</PMID>
      <Article>
        <Journal>
          <Title>Nature Reviews Drug Discovery</Title>
          <JournalIssue>
            <PubDate>
              <Year>2023</Year>
            </PubDate>
          </JournalIssue>
        </Journal>
        <ArticleTitle>Review: Emerging targets in oncology</ArticleTitle>
        <Abstract>
          <AbstractText>This review covers emerging therapeutic targets in oncology.</AbstractText>
        </Abstract>
        <AuthorList>
          <Author>
            <LastName>Brown</LastName>
            <ForeName>Emily</ForeName>
            <Initials>E</Initials>
          </Author>
        </AuthorList>
        <PublicationTypeList>
          <PublicationType UI="D016454">Review</PublicationType>
          <PublicationType UI="D016428">Journal Article</PublicationType>
        </PublicationTypeList>
      </Article>
    </MedlineCitation>
    <PubmedData>
      <ArticleIdList>
        <ArticleId IdType="pubmed">22222222</ArticleId>
        <ArticleId IdType="doi">10.1038/s41573-023-00001-1</ArticleId>
      </ArticleIdList>
    </PubmedData>
  </PubmedArticle>
</PubmedArticleSet>`;

/**
 * XML with MedlineDate format instead of separate Year element.
 * Used when PubMed doesn't have a precise publication date.
 */
const MEDLINE_DATE_XML = `<?xml version="1.0" ?>
<PubmedArticleSet>
  <PubmedArticle>
    <MedlineCitation>
      <PMID Version="1">33333333</PMID>
      <Article>
        <Journal>
          <Title>Some Journal</Title>
          <JournalIssue>
            <PubDate>
              <MedlineDate>2022 Jan-Mar</MedlineDate>
            </PubDate>
          </JournalIssue>
        </Journal>
        <ArticleTitle>A study with a MedlineDate</ArticleTitle>
        <Abstract>
          <AbstractText>Abstract text here.</AbstractText>
        </Abstract>
        <AuthorList>
          <Author>
            <LastName>Garcia</LastName>
            <ForeName>Maria</ForeName>
            <Initials>M</Initials>
          </Author>
        </AuthorList>
        <PublicationTypeList>
          <PublicationType UI="D016428">Journal Article</PublicationType>
        </PublicationTypeList>
      </Article>
    </MedlineCitation>
    <PubmedData>
      <ArticleIdList>
        <ArticleId IdType="pubmed">33333333</ArticleId>
      </ArticleIdList>
    </PubmedData>
  </PubmedArticle>
</PubmedArticleSet>`;

/**
 * XML with a collective/group author (no LastName/ForeName).
 * These should be skipped in the author list.
 */
const COLLECTIVE_AUTHOR_XML = `<?xml version="1.0" ?>
<PubmedArticleSet>
  <PubmedArticle>
    <MedlineCitation>
      <PMID Version="1">44444444</PMID>
      <Article>
        <Journal>
          <Title>The New England Journal of Medicine</Title>
          <JournalIssue>
            <PubDate>
              <Year>2023</Year>
            </PubDate>
          </JournalIssue>
        </Journal>
        <ArticleTitle>A consortium study</ArticleTitle>
        <Abstract>
          <AbstractText>Results from a large consortium.</AbstractText>
        </Abstract>
        <AuthorList>
          <Author>
            <LastName>Adams</LastName>
            <ForeName>James</ForeName>
            <Initials>J</Initials>
          </Author>
          <Author>
            <CollectiveName>The Global Health Consortium</CollectiveName>
          </Author>
          <Author>
            <LastName>Zhang</LastName>
            <ForeName>Li</ForeName>
            <Initials>L</Initials>
          </Author>
        </AuthorList>
        <PublicationTypeList>
          <PublicationType UI="D016428">Journal Article</PublicationType>
        </PublicationTypeList>
      </Article>
    </MedlineCitation>
    <PubmedData>
      <ArticleIdList>
        <ArticleId IdType="pubmed">44444444</ArticleId>
      </ArticleIdList>
    </PubmedData>
  </PubmedArticle>
</PubmedArticleSet>`;

/**
 * XML with no abstract. Some older or non-English articles
 * may lack abstracts in PubMed.
 */
const NO_ABSTRACT_XML = `<?xml version="1.0" ?>
<PubmedArticleSet>
  <PubmedArticle>
    <MedlineCitation>
      <PMID Version="1">55555555</PMID>
      <Article>
        <Journal>
          <Title>Journal of Historical Medicine</Title>
          <JournalIssue>
            <PubDate>
              <Year>2020</Year>
            </PubDate>
          </JournalIssue>
        </Journal>
        <ArticleTitle>An editorial without an abstract</ArticleTitle>
        <AuthorList>
          <Author>
            <LastName>Taylor</LastName>
            <ForeName>James</ForeName>
            <Initials>J</Initials>
          </Author>
        </AuthorList>
        <PublicationTypeList>
          <PublicationType UI="D016420">Comment</PublicationType>
          <PublicationType UI="D016428">Journal Article</PublicationType>
        </PublicationTypeList>
      </Article>
    </MedlineCitation>
    <PubmedData>
      <ArticleIdList>
        <ArticleId IdType="pubmed">55555555</ArticleId>
      </ArticleIdList>
    </PubmedData>
  </PubmedArticle>
</PubmedArticleSet>`;

// --- parsePubMedXml tests ---

describe("parsePubMedXml", () => {
  // Tests the XML parsing layer that converts PubMed efetch XML into
  // structured PubMedArticle objects. This is the core of the PubMed
  // client and must handle PubMed's various XML output variations.

  it("parses a single article with all fields", () => {
    const results = parsePubMedXml(SINGLE_ARTICLE_XML);

    expect(results).toHaveLength(1);
    const article = results[0]!;

    expect(article.pmid).toBe("12345678");
    expect(article.pmcid).toBe("PMC9876543");
    expect(article.doi).toBe("10.1038/s41586-023-00001-1");
    expect(article.title).toBe("CRISPR screens reveal new cancer drug targets");
    expect(article.abstract).toContain("genome-wide CRISPR screens");
    expect(article.journal).toBe("Nature");
    expect(article.year).toBe(2023);
    expect(article.articleType).toBe("research-article");
    expect(article.authors).toHaveLength(3);
  });

  it("extracts all three authors with correct fields", () => {
    const results = parsePubMedXml(SINGLE_ARTICLE_XML);
    const authors = results[0]!.authors;

    expect(authors[0]).toEqual({
      lastName: "Smith",
      foreName: "John A",
      initials: "JA",
    });
    expect(authors[1]).toEqual({
      lastName: "Chen",
      foreName: "Wei",
      initials: "W",
    });
    expect(authors[2]).toEqual({
      lastName: "Johnson",
      foreName: "Robert B",
      initials: "RB",
    });
  });

  it("handles structured abstracts with labeled sections", () => {
    // Structured abstracts are common in clinical journals like The Lancet.
    // Sections should be joined with their labels (e.g., "BACKGROUND: ...").
    const results = parsePubMedXml(STRUCTURED_ABSTRACT_XML);
    const article = results[0]!;

    expect(article.abstract).toContain("BACKGROUND:");
    expect(article.abstract).toContain("METHODS:");
    expect(article.abstract).toContain("RESULTS:");
    expect(article.abstract).toContain("CONCLUSIONS:");
    expect(article.abstract).toContain("limited treatment options");
    expect(article.abstract).toContain("Drug X is effective");
  });

  it("parses multiple articles in a single XML response", () => {
    // PubMed efetch returns multiple articles in one PubmedArticleSet
    // when fetching batch PMIDs.
    const results = parsePubMedXml(MULTI_ARTICLE_XML);

    expect(results).toHaveLength(2);
    expect(results[0]!.pmid).toBe("11111111");
    expect(results[0]!.title).toBe("Single-cell atlas of the developing brain");
    expect(results[1]!.pmid).toBe("22222222");
    expect(results[1]!.title).toBe("Review: Emerging targets in oncology");
  });

  it("classifies reviews correctly", () => {
    // The matching engine filters out reviews for profile synthesis,
    // so correct type classification is critical.
    const results = parsePubMedXml(MULTI_ARTICLE_XML);
    expect(results[0]!.articleType).toBe("research-article");
    expect(results[1]!.articleType).toBe("review");
  });

  it("handles MedlineDate format for publication year", () => {
    // Some PubMed records use MedlineDate (e.g., "2022 Jan-Mar")
    // instead of a separate Year element. We extract the 4-digit year.
    const results = parsePubMedXml(MEDLINE_DATE_XML);
    expect(results[0]!.year).toBe(2022);
  });

  it("skips collective/group authors", () => {
    // Group authors (CollectiveName) don't have LastName/ForeName
    // and should be excluded from the author list.
    const results = parsePubMedXml(COLLECTIVE_AUTHOR_XML);
    const authors = results[0]!.authors;

    expect(authors).toHaveLength(2);
    expect(authors[0]!.lastName).toBe("Adams");
    expect(authors[1]!.lastName).toBe("Zhang");
  });

  it("handles articles without abstracts", () => {
    // Some PubMed records (editorials, letters, older papers)
    // may lack abstracts. We return an empty string rather than failing.
    const results = parsePubMedXml(NO_ABSTRACT_XML);
    expect(results[0]!.abstract).toBe("");
    expect(results[0]!.articleType).toBe("comment");
  });

  it("handles missing PMCID gracefully", () => {
    // Not all PubMed articles are in PMC (only open-access ones).
    // PMCID should be null when not present.
    const results = parsePubMedXml(STRUCTURED_ABSTRACT_XML);
    expect(results[0]!.pmcid).toBeNull();
    expect(results[0]!.doi).toBe("10.1016/S0140-6736(24)00001-1");
  });

  it("handles empty XML gracefully", () => {
    expect(parsePubMedXml("")).toEqual([]);
    expect(
      parsePubMedXml("<PubmedArticleSet></PubmedArticleSet>")
    ).toEqual([]);
  });

  it("handles XML without PubmedArticleSet", () => {
    expect(parsePubMedXml("<root><data>test</data></root>")).toEqual([]);
  });

  it("classifies clinical trial articles correctly", () => {
    const xml = STRUCTURED_ABSTRACT_XML.replace(
      "Randomized Controlled Trial",
      "Clinical Trial"
    );
    const results = parsePubMedXml(xml);
    expect(results[0]!.articleType).toBe("clinical-trial");
  });

  it("classifies meta-analysis articles correctly", () => {
    const xml = `<?xml version="1.0" ?>
<PubmedArticleSet>
  <PubmedArticle>
    <MedlineCitation>
      <PMID Version="1">66666666</PMID>
      <Article>
        <Journal>
          <Title>JAMA</Title>
          <JournalIssue>
            <PubDate><Year>2023</Year></PubDate>
          </JournalIssue>
        </Journal>
        <ArticleTitle>Meta-analysis of drug efficacy</ArticleTitle>
        <Abstract>
          <AbstractText>We performed a systematic review and meta-analysis.</AbstractText>
        </Abstract>
        <AuthorList>
          <Author>
            <LastName>Doe</LastName>
            <ForeName>Jane</ForeName>
            <Initials>J</Initials>
          </Author>
        </AuthorList>
        <PublicationTypeList>
          <PublicationType UI="D017418">Meta-Analysis</PublicationType>
          <PublicationType UI="D016454">Review</PublicationType>
          <PublicationType UI="D016428">Journal Article</PublicationType>
        </PublicationTypeList>
      </Article>
    </MedlineCitation>
    <PubmedData>
      <ArticleIdList>
        <ArticleId IdType="pubmed">66666666</ArticleId>
      </ArticleIdList>
    </PubmedData>
  </PubmedArticle>
</PubmedArticleSet>`;
    const results = parsePubMedXml(xml);
    // Meta-analysis should take priority over review in type classification
    expect(results[0]!.articleType).toBe("meta-analysis");
  });

  it("handles missing DOI gracefully", () => {
    const results = parsePubMedXml(MEDLINE_DATE_XML);
    expect(results[0]!.doi).toBeNull();
  });
});

// --- fetchPubMedAbstracts tests ---

describe("fetchPubMedAbstracts", () => {
  // Tests the full fetch flow: building the URL, calling efetch,
  // and parsing the response. Validates API key inclusion, batching,
  // and error handling.

  it("fetches and parses a single PMID", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      text: async () => SINGLE_ARTICLE_XML,
    });

    const results = await fetchPubMedAbstracts(["12345678"]);

    expect(results).toHaveLength(1);
    expect(results[0]!.pmid).toBe("12345678");
    expect(results[0]!.title).toBe("CRISPR screens reveal new cancer drug targets");
  });

  it("builds correct efetch URL without API key", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      text: async () => SINGLE_ARTICLE_XML,
    });

    await fetchPubMedAbstracts(["12345678"]);

    const calledUrl = mockFetch.mock.calls[0]![0] as string;
    expect(calledUrl).toContain("eutils.ncbi.nlm.nih.gov/entrez/eutils/efetch.fcgi");
    expect(calledUrl).toContain("db=pubmed");
    expect(calledUrl).toContain("id=12345678");
    expect(calledUrl).toContain("rettype=xml");
    expect(calledUrl).toContain("retmode=xml");
    expect(calledUrl).not.toContain("api_key");
  });

  it("includes NCBI API key in URL when configured", async () => {
    // NCBI API key enables 10 req/s instead of 3 req/s.
    // The key should be appended as a query parameter.
    process.env.NCBI_API_KEY = "test-ncbi-key-123";

    mockFetch.mockResolvedValueOnce({
      ok: true,
      text: async () => SINGLE_ARTICLE_XML,
    });

    await fetchPubMedAbstracts(["12345678"]);

    const calledUrl = mockFetch.mock.calls[0]![0] as string;
    expect(calledUrl).toContain("api_key=test-ncbi-key-123");
  });

  it("sends multiple PMIDs as comma-separated in one request", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      text: async () => MULTI_ARTICLE_XML,
    });

    const results = await fetchPubMedAbstracts(["11111111", "22222222"]);

    expect(results).toHaveLength(2);
    const calledUrl = mockFetch.mock.calls[0]![0] as string;
    // URL-encoded comma: %2C or literal comma depending on URLSearchParams
    expect(calledUrl).toMatch(/id=11111111(%2C|,)22222222/);
  });

  it("returns empty array for empty PMID list", async () => {
    const results = await fetchPubMedAbstracts([]);

    expect(results).toEqual([]);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("throws on API error", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 500,
      statusText: "Internal Server Error",
    });

    await expect(fetchPubMedAbstracts(["12345678"])).rejects.toThrow(
      "PubMed efetch API error: 500 Internal Server Error"
    );
  });

  it("throws on API rate limit (429)", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 429,
      statusText: "Too Many Requests",
    });

    await expect(fetchPubMedAbstracts(["12345678"])).rejects.toThrow(
      "PubMed efetch API error: 429 Too Many Requests"
    );
  });

  it("splits large PMID lists into batches of 200", async () => {
    // Generate 250 PMIDs to trigger batching
    const pmids = Array.from({ length: 250 }, (_, i) =>
      String(10000000 + i)
    );

    // First batch (200 PMIDs)
    mockFetch.mockResolvedValueOnce({
      ok: true,
      text: async () => SINGLE_ARTICLE_XML,
    });
    // Second batch (50 PMIDs)
    mockFetch.mockResolvedValueOnce({
      ok: true,
      text: async () => SINGLE_ARTICLE_XML,
    });

    await fetchPubMedAbstracts(pmids);

    expect(mockFetch).toHaveBeenCalledTimes(2);

    // Verify first batch has 200 PMIDs
    const firstUrl = mockFetch.mock.calls[0]![0] as string;
    const firstIds = new URL(firstUrl).searchParams.get("id")!;
    expect(firstIds.split(",")).toHaveLength(200);

    // Verify second batch has 50 PMIDs
    const secondUrl = mockFetch.mock.calls[1]![0] as string;
    const secondIds = new URL(secondUrl).searchParams.get("id")!;
    expect(secondIds.split(",")).toHaveLength(50);
  });

  it("handles exactly 200 PMIDs in a single batch", async () => {
    const pmids = Array.from({ length: 200 }, (_, i) =>
      String(10000000 + i)
    );

    mockFetch.mockResolvedValueOnce({
      ok: true,
      text: async () => SINGLE_ARTICLE_XML,
    });

    await fetchPubMedAbstracts(pmids);

    // Should be exactly 1 request, not 2
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });
});

// --- determineAuthorPosition tests ---

describe("determineAuthorPosition", () => {
  // Tests author position determination for the profile pipeline.
  // The position (first/last/middle) influences how publications
  // are prioritized for profile synthesis (last-author papers get
  // higher weight as they indicate lab leadership).

  const threeAuthors: PubMedAuthor[] = [
    { lastName: "Smith", foreName: "John A", initials: "JA" },
    { lastName: "Chen", foreName: "Wei", initials: "W" },
    { lastName: "Johnson", foreName: "Robert B", initials: "RB" },
  ];

  it("identifies first author", () => {
    expect(determineAuthorPosition(threeAuthors, "Smith")).toBe("first");
  });

  it("identifies last author", () => {
    expect(determineAuthorPosition(threeAuthors, "Johnson")).toBe("last");
  });

  it("identifies middle author", () => {
    expect(determineAuthorPosition(threeAuthors, "Chen")).toBe("middle");
  });

  it("is case-insensitive", () => {
    expect(determineAuthorPosition(threeAuthors, "smith")).toBe("first");
    expect(determineAuthorPosition(threeAuthors, "JOHNSON")).toBe("last");
    expect(determineAuthorPosition(threeAuthors, "cHEN")).toBe("middle");
  });

  it("defaults to middle when researcher not found in author list", () => {
    // If the name doesn't match any author (perhaps due to name variations),
    // we default to 'middle' as the safest assumption.
    expect(determineAuthorPosition(threeAuthors, "Unknown")).toBe("middle");
  });

  it("handles empty author list", () => {
    expect(determineAuthorPosition([], "Smith")).toBe("middle");
  });

  it("handles empty researcher name", () => {
    expect(determineAuthorPosition(threeAuthors, "")).toBe("middle");
  });

  it("handles single-author papers", () => {
    // A single author is both first and last. We return 'first' since
    // index 0 is checked first.
    const singleAuthor: PubMedAuthor[] = [
      { lastName: "Solo", foreName: "Jane", initials: "J" },
    ];
    expect(determineAuthorPosition(singleAuthor, "Solo")).toBe("first");
  });

  it("handles two-author papers", () => {
    const twoAuthors: PubMedAuthor[] = [
      { lastName: "First", foreName: "Author", initials: "A" },
      { lastName: "Last", foreName: "Author", initials: "A" },
    ];
    expect(determineAuthorPosition(twoAuthors, "First")).toBe("first");
    expect(determineAuthorPosition(twoAuthors, "Last")).toBe("last");
  });

  it("handles compound last names", () => {
    // Some researchers have multi-word last names (e.g., "van der Berg").
    // We try matching the final word of the name as a fallback.
    const authorsWithCompound: PubMedAuthor[] = [
      { lastName: "van der Berg", foreName: "Anna", initials: "A" },
      { lastName: "Smith", foreName: "John", initials: "J" },
    ];
    expect(determineAuthorPosition(authorsWithCompound, "van der Berg")).toBe(
      "first"
    );
    expect(determineAuthorPosition(authorsWithCompound, "Berg")).toBe("first");
  });

  it("trims whitespace in names", () => {
    expect(determineAuthorPosition(threeAuthors, "  Smith  ")).toBe("first");
  });
});
