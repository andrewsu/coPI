/**
 * @jest-environment jsdom
 */

/**
 * Tests for the Admin Proposal Detail page (/admin/proposals/[id]).
 *
 * Validates the server component renders all proposal data sections correctly:
 * - Header with title, collaboration type, confidence badge, researcher cards
 * - Scientific question, one-line summaries for both researchers
 * - Detailed rationale, contributions/benefits side-by-side, first experiment
 * - Anchoring publications table with PMID/DOI links
 * - LLM information (model, confidence, reasoning)
 * - Visibility states and profile versions for both researchers
 * - Swipe records table with user links, direction, analytics
 * - Match record with notification status
 * - Empty states for swipes, publications, and match
 * - 404 when proposal does not exist
 *
 * The page is an async server component that queries Prisma directly.
 * We mock Prisma and render the returned JSX.
 */

import React from "react";
import { render, screen, within } from "@testing-library/react";
import "@testing-library/jest-dom";

// --- Mocks ---

const mockNotFound = jest.fn();
jest.mock("next/navigation", () => ({
  notFound: () => {
    mockNotFound();
    throw new Error("NEXT_NOT_FOUND");
  },
}));

jest.mock("@/lib/prisma", () => ({
  prisma: {
    collaborationProposal: { findUnique: jest.fn() },
    publication: { findMany: jest.fn() },
  },
}));

import { prisma } from "@/lib/prisma";
import AdminProposalDetailPage from "../page";

const mockFindUnique = jest.mocked(prisma.collaborationProposal.findUnique);
const mockPublicationFindMany = jest.mocked(prisma.publication.findMany);

function makeParams(id: string) {
  return Promise.resolve({ id });
}

/** Full mock proposal with all relations populated. */
function mockFullProposal(overrides: Record<string, unknown> = {}) {
  return {
    id: "prop-1",
    researcherAId: "user-1",
    researcherBId: "user-2",
    title: "CRISPR-Based Cancer Diagnostics",
    collaborationType: "complementary_expertise",
    scientificQuestion: "Can CRISPR-Cas12a detection improve early cancer biomarker identification?",
    oneLineSummaryA: "Combine your CRISPR toolkit with Dr. Bob's imaging platform for novel diagnostics",
    oneLineSummaryB: "Leverage Dr. Alice's gene editing to enhance your imaging pipeline",
    detailedRationale: "Both labs bring unique and complementary techniques that together enable a novel diagnostic approach.",
    labAContributions: "Alice provides CRISPR-Cas12a collateral cleavage assays and sgRNA library design",
    labBContributions: "Bob provides super-resolution imaging and single-molecule detection capabilities",
    labABenefits: "Access to imaging data for validating CRISPR diagnostic sensitivity",
    labBBenefits: "Access to CRISPR tools for targeted detection of specific cancer biomarkers",
    proposedFirstExperiment: "CRISPR screen on HeLa cell lines using Cas12a with fluorescent reporters, imaged via STORM microscopy",
    anchoringPublicationIds: ["pub-1", "pub-2"],
    confidenceTier: "high",
    llmReasoning: "Both researchers work on complementary aspects of cancer biology with highly specific techniques.",
    llmModel: "claude-opus-4-20250514",
    visibilityA: "visible",
    visibilityB: "pending_other_interest",
    profileVersionA: 3,
    profileVersionB: 1,
    isUpdated: false,
    createdAt: new Date("2026-01-25T14:30:00.000Z"),
    researcherA: {
      id: "user-1",
      name: "Dr. Alice",
      institution: "MIT",
      department: "Biology",
    },
    researcherB: {
      id: "user-2",
      name: "Dr. Bob",
      institution: "Stanford",
      department: "Chemistry",
    },
    swipes: [
      {
        id: "swipe-1",
        user: { id: "user-1", name: "Dr. Alice" },
        direction: "interested",
        viewedDetail: true,
        timeSpentMs: 15000,
        createdAt: new Date("2026-01-26T10:00:00.000Z"),
      },
      {
        id: "swipe-2",
        user: { id: "user-2", name: "Dr. Bob" },
        direction: "archive",
        viewedDetail: false,
        timeSpentMs: 3000,
        createdAt: new Date("2026-01-27T08:00:00.000Z"),
      },
    ],
    matches: [],
    ...overrides,
  };
}

/** Mock anchoring publications. */
function mockPublications() {
  return [
    {
      id: "pub-1",
      pmid: "12345678",
      doi: "10.1234/crispr-test",
      title: "CRISPR-Cas12a for Cancer Detection",
      journal: "Nature Methods",
      year: 2025,
      authorPosition: "last",
    },
    {
      id: "pub-2",
      pmid: null,
      doi: "10.5678/imaging-paper",
      title: "Super-Resolution Imaging of Biomarkers",
      journal: "Science",
      year: 2024,
      authorPosition: "first",
    },
  ];
}

describe("AdminProposalDetailPage", () => {
  beforeEach(() => jest.clearAllMocks());

  it("calls notFound when proposal does not exist", async () => {
    /** Missing proposal IDs should trigger a 404 page. */
    mockFindUnique.mockResolvedValue(null);

    await expect(
      AdminProposalDetailPage({ params: makeParams("nonexistent") }),
    ).rejects.toThrow("NEXT_NOT_FOUND");
    expect(mockNotFound).toHaveBeenCalled();
  });

  it("renders the header with title, collaboration type, and confidence badge", async () => {
    /** Header shows core proposal identity: title, formatted type, and confidence tier. */
    mockFindUnique.mockResolvedValue(mockFullProposal() as never);
    mockPublicationFindMany.mockResolvedValue([] as never);

    const jsx = await AdminProposalDetailPage({ params: makeParams("prop-1") });
    render(jsx);

    expect(screen.getByText("CRISPR-Based Cancer Diagnostics")).toBeInTheDocument();
    expect(screen.getByText("Complementary Expertise")).toBeInTheDocument();
    // Confidence badge appears in both header and LLM section
    const highBadges = screen.getAllByText("high");
    expect(highBadges.length).toBeGreaterThanOrEqual(1);
  });

  it("renders researcher A and B cards with links to their admin user pages", async () => {
    /** Both researchers are displayed with links to their admin detail pages. */
    mockFindUnique.mockResolvedValue(mockFullProposal() as never);
    mockPublicationFindMany.mockResolvedValue([] as never);

    const jsx = await AdminProposalDetailPage({ params: makeParams("prop-1") });
    render(jsx);

    const aliceLinks = screen.getAllByRole("link", { name: "Dr. Alice" });
    expect(aliceLinks.some((l) => l.getAttribute("href") === "/admin/users/user-1")).toBe(true);

    const bobLinks = screen.getAllByRole("link", { name: "Dr. Bob" });
    expect(bobLinks.some((l) => l.getAttribute("href") === "/admin/users/user-2")).toBe(true);

    // Institution info
    expect(screen.getByText(/MIT/)).toBeInTheDocument();
    expect(screen.getByText(/Stanford/)).toBeInTheDocument();
  });

  it("renders the scientific question", async () => {
    /** Scientific question is displayed prominently in its own section. */
    mockFindUnique.mockResolvedValue(mockFullProposal() as never);
    mockPublicationFindMany.mockResolvedValue([] as never);

    const jsx = await AdminProposalDetailPage({ params: makeParams("prop-1") });
    render(jsx);

    expect(screen.getByText(/Can CRISPR-Cas12a detection improve/)).toBeInTheDocument();
  });

  it("renders one-line summaries for both researchers", async () => {
    /** Both A and B one-line summaries are shown, labeled with researcher names. */
    mockFindUnique.mockResolvedValue(mockFullProposal() as never);
    mockPublicationFindMany.mockResolvedValue([] as never);

    const jsx = await AdminProposalDetailPage({ params: makeParams("prop-1") });
    render(jsx);

    expect(screen.getByText(/Combine your CRISPR toolkit/)).toBeInTheDocument();
    expect(screen.getByText(/Leverage Dr\. Alice's gene editing/)).toBeInTheDocument();
  });

  it("renders detailed rationale, contributions, benefits, and first experiment", async () => {
    /** All text-heavy proposal content fields are rendered in their respective sections. */
    mockFindUnique.mockResolvedValue(mockFullProposal() as never);
    mockPublicationFindMany.mockResolvedValue([] as never);

    const jsx = await AdminProposalDetailPage({ params: makeParams("prop-1") });
    render(jsx);

    // Rationale
    expect(screen.getByText(/Both labs bring unique and complementary/)).toBeInTheDocument();

    // Contributions
    expect(screen.getByText(/Alice provides CRISPR-Cas12a collateral/)).toBeInTheDocument();
    expect(screen.getByText(/Bob provides super-resolution imaging/)).toBeInTheDocument();

    // Benefits
    expect(screen.getByText(/Access to imaging data for validating/)).toBeInTheDocument();
    expect(screen.getByText(/Access to CRISPR tools for targeted/)).toBeInTheDocument();

    // First experiment
    expect(screen.getByText(/CRISPR screen on HeLa cell lines/)).toBeInTheDocument();
  });

  it("renders anchoring publications with PMID and DOI links", async () => {
    /** Anchoring publications table shows linked identifiers for source access. */
    mockFindUnique.mockResolvedValue(mockFullProposal() as never);
    mockPublicationFindMany.mockResolvedValue(mockPublications() as never);

    const jsx = await AdminProposalDetailPage({ params: makeParams("prop-1") });
    render(jsx);

    // Publication count — find the (2) within the Anchoring Publications heading
    const pubSection = screen.getByText("Anchoring Publications").closest("h3")!;
    expect(within(pubSection).getByText("(2)")).toBeInTheDocument();

    // Publication titles
    expect(screen.getByText("CRISPR-Cas12a for Cancer Detection")).toBeInTheDocument();
    expect(screen.getByText("Super-Resolution Imaging of Biomarkers")).toBeInTheDocument();

    // PMID link
    const pmidLink = screen.getByRole("link", { name: "PMID" });
    expect(pmidLink).toHaveAttribute("href", "https://pubmed.ncbi.nlm.nih.gov/12345678/");

    // DOI links
    const doiLinks = screen.getAllByRole("link", { name: "DOI" });
    expect(doiLinks.length).toBeGreaterThanOrEqual(1);
  });

  it("shows empty state for anchoring publications when none exist", async () => {
    /** Proposals without anchoring publications show a clear empty message. */
    mockFindUnique.mockResolvedValue(
      mockFullProposal({ anchoringPublicationIds: [] }) as never,
    );

    const jsx = await AdminProposalDetailPage({ params: makeParams("prop-1") });
    render(jsx);

    expect(screen.getByText("No anchoring publications.")).toBeInTheDocument();
  });

  it("renders LLM model and reasoning", async () => {
    /** LLM section displays the model identifier and the reasoning text. */
    mockFindUnique.mockResolvedValue(mockFullProposal() as never);
    mockPublicationFindMany.mockResolvedValue([] as never);

    const jsx = await AdminProposalDetailPage({ params: makeParams("prop-1") });
    render(jsx);

    expect(screen.getByText("claude-opus-4-20250514")).toBeInTheDocument();
    expect(screen.getByText(/Both researchers work on complementary aspects/)).toBeInTheDocument();
  });

  it("renders visibility states and profile versions for both researchers", async () => {
    /** Visibility section shows each researcher's visibility state and profile version. */
    mockFindUnique.mockResolvedValue(mockFullProposal() as never);
    mockPublicationFindMany.mockResolvedValue([] as never);

    const jsx = await AdminProposalDetailPage({ params: makeParams("prop-1") });
    render(jsx);

    expect(screen.getByText("Visible")).toBeInTheDocument();
    expect(screen.getByText("Pending Other Interest")).toBeInTheDocument();
    expect(screen.getByText(/Profile version: 3/)).toBeInTheDocument();
    expect(screen.getByText(/Profile version: 1/)).toBeInTheDocument();
  });

  it("renders swipe records with user links, direction, and analytics", async () => {
    /** Swipe table shows who swiped, direction, viewed detail flag, time spent, and date. */
    mockFindUnique.mockResolvedValue(mockFullProposal() as never);
    mockPublicationFindMany.mockResolvedValue([] as never);

    const jsx = await AdminProposalDetailPage({ params: makeParams("prop-1") });
    render(jsx);

    // Swipe count
    expect(screen.getByText("(2)")).toBeInTheDocument();

    // Swipe table rows
    const rows = screen.getAllByRole("row");
    // Find Alice's swipe row
    const aliceRow = rows.find((r) =>
      within(r).queryByRole("link", { name: "Dr. Alice" }),
    );
    expect(aliceRow).toBeDefined();
    expect(within(aliceRow!).getByText("Interested")).toBeInTheDocument();
    // Viewed detail
    const yesElements = within(aliceRow!).getAllByText("Yes");
    expect(yesElements.length).toBeGreaterThanOrEqual(1);
    // Time spent (15000ms = 15s)
    expect(within(aliceRow!).getByText("15s")).toBeInTheDocument();

    // Bob's swipe row
    const bobRow = rows.find((r) =>
      within(r).queryByRole("link", { name: "Dr. Bob" }),
    );
    expect(bobRow).toBeDefined();
    expect(within(bobRow!).getByText("Archive")).toBeInTheDocument();
  });

  it("shows empty state when no swipes recorded", async () => {
    /** Proposals without swipes show a clear empty message. */
    mockFindUnique.mockResolvedValue(
      mockFullProposal({ swipes: [] }) as never,
    );
    mockPublicationFindMany.mockResolvedValue([] as never);

    const jsx = await AdminProposalDetailPage({ params: makeParams("prop-1") });
    render(jsx);

    expect(screen.getByText("No swipes recorded.")).toBeInTheDocument();
  });

  it("renders match record with notification status when matched", async () => {
    /** Matched proposals display the match date and notification delivery status. */
    mockFindUnique.mockResolvedValue(
      mockFullProposal({
        matches: [
          {
            id: "match-1",
            matchedAt: new Date("2026-01-28T16:00:00.000Z"),
            notificationSentA: true,
            notificationSentB: false,
          },
        ],
      }) as never,
    );
    mockPublicationFindMany.mockResolvedValue([] as never);

    const jsx = await AdminProposalDetailPage({ params: makeParams("prop-1") });
    render(jsx);

    // Matched badge in header
    expect(screen.getByText("Matched")).toBeInTheDocument();

    // Match section
    expect(screen.getByText("Sent")).toBeInTheDocument();
    expect(screen.getByText("Not sent")).toBeInTheDocument();
  });

  it("shows no match state when not yet matched", async () => {
    /** Proposals without a match show a clear empty message. */
    mockFindUnique.mockResolvedValue(mockFullProposal() as never);
    mockPublicationFindMany.mockResolvedValue([] as never);

    const jsx = await AdminProposalDetailPage({ params: makeParams("prop-1") });
    render(jsx);

    expect(screen.getByText("No match yet.")).toBeInTheDocument();
  });

  it("shows Updated badge when proposal has been updated", async () => {
    /** Updated proposals are flagged with a blue badge. */
    mockFindUnique.mockResolvedValue(
      mockFullProposal({ isUpdated: true }) as never,
    );
    mockPublicationFindMany.mockResolvedValue([] as never);

    const jsx = await AdminProposalDetailPage({ params: makeParams("prop-1") });
    render(jsx);

    expect(screen.getByText("Updated")).toBeInTheDocument();
  });

  it("shows back link to proposals list", async () => {
    /** Navigation back to proposals list is always available. */
    mockFindUnique.mockResolvedValue(mockFullProposal() as never);
    mockPublicationFindMany.mockResolvedValue([] as never);

    const jsx = await AdminProposalDetailPage({ params: makeParams("prop-1") });
    render(jsx);

    const backLink = screen.getByRole("link", { name: /Back to Proposals/ });
    expect(backLink).toHaveAttribute("href", "/admin/proposals");
  });

  it("renders created date in the header", async () => {
    /** Creation timestamp helps admins track when the proposal was generated. */
    mockFindUnique.mockResolvedValue(mockFullProposal() as never);
    mockPublicationFindMany.mockResolvedValue([] as never);

    const jsx = await AdminProposalDetailPage({ params: makeParams("prop-1") });
    render(jsx);

    expect(screen.getByText(/Created:/)).toBeInTheDocument();
  });

  it("renders departments in researcher cards when present", async () => {
    /** Department info is shown alongside institution for full researcher context. */
    mockFindUnique.mockResolvedValue(mockFullProposal() as never);
    mockPublicationFindMany.mockResolvedValue([] as never);

    const jsx = await AdminProposalDetailPage({ params: makeParams("prop-1") });
    render(jsx);

    expect(screen.getByText(/Biology/)).toBeInTheDocument();
    expect(screen.getByText(/Chemistry/)).toBeInTheDocument();
  });
});
