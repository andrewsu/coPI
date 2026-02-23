/**
 * @jest-environment jsdom
 */

/**
 * Tests for the Admin User Detail page (/admin/users/[id]).
 *
 * Validates the server component renders all user data sections correctly:
 * - Header with user info, ORCID link, status badges, dates
 * - Profile section with research summary, array fields as tags, grants, version
 * - Publications table with PMID/DOI links and methods extraction flag
 * - Match pool section: their selections, affiliation selections, reverse lookup
 * - Proposals table with swipe/match status and links to detail
 * - Empty states for each section when data is absent
 * - 404 when user does not exist
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
    user: { findUnique: jest.fn() },
    collaborationProposal: { findMany: jest.fn() },
  },
}));

import { prisma } from "@/lib/prisma";
import AdminUserDetailPage from "../page";

const mockFindUnique = jest.mocked(prisma.user.findUnique);
const mockProposalFindMany = jest.mocked(prisma.collaborationProposal.findMany);

function makeParams(id: string) {
  return Promise.resolve({ id });
}

/** Full mock user with all relations populated. */
function mockFullUser() {
  return {
    id: "user-1",
    name: "Dr. Alice",
    email: "alice@mit.edu",
    institution: "MIT",
    department: "Biology",
    orcid: "0000-0001-2345-6789",
    isAdmin: false,
    createdAt: new Date("2026-01-15T00:00:00.000Z"),
    claimedAt: new Date("2026-01-15T00:00:00.000Z"),
    deletedAt: null,
    profile: {
      id: "profile-1",
      researchSummary: "Alice studies gene regulation using CRISPR.",
      techniques: ["CRISPR", "RNA-seq", "ChIP-seq"],
      experimentalModels: ["mouse", "HeLa cells"],
      diseaseAreas: ["cancer"],
      keyTargets: ["TP53", "BRCA1"],
      keywords: ["epigenetics", "transcription"],
      grantTitles: ["NIH R01 - Gene Regulation"],
      profileVersion: 2,
      profileGeneratedAt: new Date("2026-01-16T14:30:00.000Z"),
      pendingProfile: null,
      pendingProfileCreatedAt: null,
    },
    publications: [
      {
        id: "pub-1",
        pmid: "12345678",
        pmcid: "PMC1234567",
        doi: "10.1234/test",
        title: "Gene Regulation Paper",
        journal: "Nature",
        year: 2025,
        authorPosition: "last",
        methodsText: "We used CRISPR...",
        createdAt: new Date("2026-01-16"),
      },
      {
        id: "pub-2",
        pmid: null,
        pmcid: null,
        doi: "10.5678/other",
        title: "Another Paper",
        journal: "Science",
        year: 2024,
        authorPosition: "first",
        methodsText: null,
        createdAt: new Date("2026-01-16"),
      },
    ],
    matchPoolSelections: [
      {
        id: "mpe-1",
        source: "individual_select",
        targetUser: { id: "user-2", name: "Dr. Bob", institution: "Stanford" },
        createdAt: new Date("2026-01-20"),
      },
    ],
    matchPoolTargets: [
      {
        id: "mpe-2",
        source: "affiliation_select",
        user: { id: "user-3", name: "Dr. Carol", institution: "MIT" },
        createdAt: new Date("2026-01-21"),
      },
    ],
    affiliationSelections: [
      {
        id: "aff-1",
        institution: "Stanford",
        department: null,
        selectAll: false,
        createdAt: new Date("2026-01-20"),
      },
    ],
  };
}

/** Mock proposals involving the user. */
function mockProposals() {
  return [
    {
      id: "prop-1",
      researcherAId: "user-1",
      researcherBId: "user-2",
      title: "CRISPR Collab",
      confidenceTier: "high",
      collaborationType: "complementary_expertise",
      visibilityA: "visible",
      visibilityB: "pending_other_interest",
      createdAt: new Date("2026-01-25"),
      researcherA: { id: "user-1", name: "Dr. Alice", institution: "MIT" },
      researcherB: { id: "user-2", name: "Dr. Bob", institution: "Stanford" },
      swipes: [
        { userId: "user-1", direction: "interested" },
      ],
      matches: [{ id: "match-1", matchedAt: new Date("2026-01-27") }],
    },
    {
      id: "prop-2",
      researcherAId: "user-1",
      researcherBId: "user-3",
      title: "Epigenetics Study",
      confidenceTier: "speculative",
      collaborationType: "shared_disease_area",
      visibilityA: "hidden",
      visibilityB: "visible",
      createdAt: new Date("2026-01-22"),
      researcherA: { id: "user-1", name: "Dr. Alice", institution: "MIT" },
      researcherB: { id: "user-3", name: "Dr. Carol", institution: "MIT" },
      swipes: [],
      matches: [],
    },
  ];
}

describe("AdminUserDetailPage", () => {
  beforeEach(() => jest.clearAllMocks());

  it("calls notFound when user does not exist", async () => {
    /** Missing user IDs should trigger a 404 page. */
    mockFindUnique.mockResolvedValue(null);

    await expect(
      AdminUserDetailPage({ params: makeParams("nonexistent") }),
    ).rejects.toThrow("NEXT_NOT_FOUND");
    expect(mockNotFound).toHaveBeenCalled();
  });

  it("renders the user header with name, institution, and ORCID link", async () => {
    /** Header shows core user identity and links ORCID to orcid.org. */
    mockFindUnique.mockResolvedValue(mockFullUser() as never);
    mockProposalFindMany.mockResolvedValue([] as never);

    const jsx = await AdminUserDetailPage({ params: makeParams("user-1") });
    render(jsx);

    expect(screen.getByText("Dr. Alice")).toBeInTheDocument();
    // Institution and department appear together in the header
    const allMIT = screen.getAllByText(/MIT/);
    expect(allMIT.length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText(/Biology/)).toBeInTheDocument();

    const orcidLink = screen.getByText("0000-0001-2345-6789");
    expect(orcidLink).toHaveAttribute("href", "https://orcid.org/0000-0001-2345-6789");
    expect(orcidLink).toHaveAttribute("target", "_blank");
  });

  it("shows Claimed badge for claimed users", async () => {
    /** Status badges distinguish claimed, seeded, admin, and deleted users. */
    mockFindUnique.mockResolvedValue(mockFullUser() as never);
    mockProposalFindMany.mockResolvedValue([] as never);

    const jsx = await AdminUserDetailPage({ params: makeParams("user-1") });
    render(jsx);

    expect(screen.getByText("Claimed")).toBeInTheDocument();
    expect(screen.queryByText("Seeded (Unclaimed)")).not.toBeInTheDocument();
  });

  it("shows Seeded badge for unclaimed users", async () => {
    /** Seeded profiles that haven't been claimed via OAuth show an unclaimed badge. */
    const user = mockFullUser();
    user.claimedAt = null;
    mockFindUnique.mockResolvedValue(user as never);
    mockProposalFindMany.mockResolvedValue([] as never);

    const jsx = await AdminUserDetailPage({ params: makeParams("user-1") });
    render(jsx);

    expect(screen.getByText("Seeded (Unclaimed)")).toBeInTheDocument();
    expect(screen.queryByText("Claimed")).not.toBeInTheDocument();
  });

  it("shows Admin badge for admin users", async () => {
    /** Admin users get a visible Admin badge in the header. */
    const user = mockFullUser();
    user.isAdmin = true;
    mockFindUnique.mockResolvedValue(user as never);
    mockProposalFindMany.mockResolvedValue([] as never);

    const jsx = await AdminUserDetailPage({ params: makeParams("user-1") });
    render(jsx);

    expect(screen.getByText("Admin")).toBeInTheDocument();
  });

  it("shows Deleted badge for soft-deleted users", async () => {
    /** Deleted users display a red Deleted badge with the deletion date. */
    const user = mockFullUser();
    user.deletedAt = new Date("2026-02-10T00:00:00.000Z");
    mockFindUnique.mockResolvedValue(user as never);
    mockProposalFindMany.mockResolvedValue([] as never);

    const jsx = await AdminUserDetailPage({ params: makeParams("user-1") });
    render(jsx);

    expect(screen.getByText("Deleted")).toBeInTheDocument();
  });

  it("renders profile section with all fields and tags", async () => {
    /** Profile section displays research summary, tag arrays, grants, and version metadata. */
    mockFindUnique.mockResolvedValue(mockFullUser() as never);
    mockProposalFindMany.mockResolvedValue([] as never);

    const jsx = await AdminUserDetailPage({ params: makeParams("user-1") });
    render(jsx);

    // Research summary
    expect(screen.getByText(/Alice studies gene regulation/)).toBeInTheDocument();

    // Tags
    expect(screen.getByText("CRISPR")).toBeInTheDocument();
    expect(screen.getByText("RNA-seq")).toBeInTheDocument();
    expect(screen.getByText("ChIP-seq")).toBeInTheDocument();
    expect(screen.getByText("mouse")).toBeInTheDocument();
    expect(screen.getByText("cancer")).toBeInTheDocument();
    expect(screen.getByText("TP53")).toBeInTheDocument();
    expect(screen.getByText("BRCA1")).toBeInTheDocument();
    expect(screen.getByText("epigenetics")).toBeInTheDocument();

    // Grant titles
    expect(screen.getByText("NIH R01 - Gene Regulation")).toBeInTheDocument();

    // Version info
    expect(screen.getByText("Version 2")).toBeInTheDocument();
  });

  it("shows empty profile state when no profile exists", async () => {
    /** Users without a generated profile show a clear empty message. */
    const user = mockFullUser();
    user.profile = null as never;
    mockFindUnique.mockResolvedValue(user as never);
    mockProposalFindMany.mockResolvedValue([] as never);

    const jsx = await AdminUserDetailPage({ params: makeParams("user-1") });
    render(jsx);

    expect(screen.getByText("No profile generated yet.")).toBeInTheDocument();
  });

  it("renders publications table with PMID and DOI links", async () => {
    /** Publications show linked identifiers for quick access to the source. */
    mockFindUnique.mockResolvedValue(mockFullUser() as never);
    mockProposalFindMany.mockResolvedValue([] as never);

    const jsx = await AdminUserDetailPage({ params: makeParams("user-1") });
    render(jsx);

    // Publication count
    expect(screen.getByText("(2)")).toBeInTheDocument();

    // First publication with PMID
    expect(screen.getByText("Gene Regulation Paper")).toBeInTheDocument();
    expect(screen.getByText("Nature")).toBeInTheDocument();
    const pmidLink = screen.getByRole("link", { name: "PMID" });
    expect(pmidLink).toHaveAttribute("href", "https://pubmed.ncbi.nlm.nih.gov/12345678/");

    // Second publication with DOI only
    expect(screen.getByText("Another Paper")).toBeInTheDocument();
    expect(screen.getByText("Science")).toBeInTheDocument();
  });

  it("shows methods extraction status per publication", async () => {
    /** Methods text extraction flag helps admins assess data quality. */
    mockFindUnique.mockResolvedValue(mockFullUser() as never);
    mockProposalFindMany.mockResolvedValue([] as never);

    const jsx = await AdminUserDetailPage({ params: makeParams("user-1") });
    render(jsx);

    // First pub has methods, second doesn't
    const yesCells = screen.getAllByText("Yes");
    const noCells = screen.getAllByText("No");
    expect(yesCells.length).toBeGreaterThanOrEqual(1);
    expect(noCells.length).toBeGreaterThanOrEqual(1);
  });

  it("shows empty state when no publications", async () => {
    /** Users with no publications show a clear empty message. */
    const user = mockFullUser();
    user.publications = [];
    mockFindUnique.mockResolvedValue(user as never);
    mockProposalFindMany.mockResolvedValue([] as never);

    const jsx = await AdminUserDetailPage({ params: makeParams("user-1") });
    render(jsx);

    expect(screen.getByText("No publications.")).toBeInTheDocument();
  });

  it("renders match pool selections with source badges and user links", async () => {
    /** Match pool shows who the user selected, with source type and navigation links. */
    mockFindUnique.mockResolvedValue(mockFullUser() as never);
    mockProposalFindMany.mockResolvedValue([] as never);

    const jsx = await AdminUserDetailPage({ params: makeParams("user-1") });
    render(jsx);

    // Their selection
    const bobLink = screen.getByRole("link", { name: "Dr. Bob" });
    expect(bobLink).toHaveAttribute("href", "/admin/users/user-2");
    expect(screen.getByText("Individual")).toBeInTheDocument();

    // Selected by others
    const carolLink = screen.getByRole("link", { name: "Dr. Carol" });
    expect(carolLink).toHaveAttribute("href", "/admin/users/user-3");
    expect(screen.getByText("Affiliation")).toBeInTheDocument();
  });

  it("renders affiliation selections", async () => {
    /** Affiliation selections display the criteria used for auto-matching. */
    mockFindUnique.mockResolvedValue(mockFullUser() as never);
    mockProposalFindMany.mockResolvedValue([] as never);

    const jsx = await AdminUserDetailPage({ params: makeParams("user-1") });
    render(jsx);

    expect(screen.getByText("Affiliation Selections")).toBeInTheDocument();
    // "Stanford" appears in both match pool selections table and affiliation selections
    const stanfords = screen.getAllByText("Stanford");
    expect(stanfords.length).toBeGreaterThanOrEqual(2);
  });

  it("renders proposals table with swipe and match status", async () => {
    /** Proposals section shows all proposals with context on swipe and match state. */
    mockFindUnique.mockResolvedValue(mockFullUser() as never);
    mockProposalFindMany.mockResolvedValue(mockProposals() as never);

    const jsx = await AdminUserDetailPage({ params: makeParams("user-1") });
    render(jsx);

    // Proposal titles with links
    const crispLink = screen.getByRole("link", { name: "CRISPR Collab" });
    expect(crispLink).toHaveAttribute("href", "/admin/proposals/prop-1");

    const epiLink = screen.getByRole("link", { name: "Epigenetics Study" });
    expect(epiLink).toHaveAttribute("href", "/admin/proposals/prop-2");

    // Confidence badges
    expect(screen.getByText("high")).toBeInTheDocument();
    expect(screen.getByText("speculative")).toBeInTheDocument();

    // User swipe for first proposal
    expect(screen.getByText("Interested")).toBeInTheDocument();

    // Match status
    const rows = screen.getAllByRole("row");
    // Find the row with "CRISPR Collab" — it should contain "Yes" for match
    const crispRow = rows.find((r) =>
      within(r).queryByText("CRISPR Collab"),
    );
    expect(crispRow).toBeDefined();
    expect(within(crispRow!).getByText("Yes")).toBeInTheDocument();
  });

  it("shows empty state when no proposals", async () => {
    /** Users with no proposals show a clear empty message. */
    mockFindUnique.mockResolvedValue(mockFullUser() as never);
    mockProposalFindMany.mockResolvedValue([] as never);

    const jsx = await AdminUserDetailPage({ params: makeParams("user-1") });
    render(jsx);

    expect(screen.getByText("No proposals involving this user.")).toBeInTheDocument();
  });

  it("shows back link to users list", async () => {
    /** Navigation back to users list is always available. */
    mockFindUnique.mockResolvedValue(mockFullUser() as never);
    mockProposalFindMany.mockResolvedValue([] as never);

    const jsx = await AdminUserDetailPage({ params: makeParams("user-1") });
    render(jsx);

    const backLink = screen.getByRole("link", { name: /Back to Users/ });
    expect(backLink).toHaveAttribute("href", "/admin/users");
  });

  it("renders pending profile indicator when present", async () => {
    /** Pending profile from monthly refresh is flagged for admin visibility. */
    const user = mockFullUser();
    user.profile!.pendingProfile = { researchSummary: "New version..." } as never;
    user.profile!.pendingProfileCreatedAt = new Date("2026-02-20T10:00:00.000Z");
    mockFindUnique.mockResolvedValue(user as never);
    mockProposalFindMany.mockResolvedValue([] as never);

    const jsx = await AdminUserDetailPage({ params: makeParams("user-1") });
    render(jsx);

    expect(screen.getByText(/Pending update/)).toBeInTheDocument();
  });

  it("shows empty selections state when user has no match pool entries", async () => {
    /** Users who haven't set up their match pool show clear empty messages. */
    const user = mockFullUser();
    user.matchPoolSelections = [];
    user.matchPoolTargets = [];
    user.affiliationSelections = [];
    mockFindUnique.mockResolvedValue(user as never);
    mockProposalFindMany.mockResolvedValue([] as never);

    const jsx = await AdminUserDetailPage({ params: makeParams("user-1") });
    render(jsx);

    expect(screen.getByText("No selections.")).toBeInTheDocument();
    expect(screen.getByText("No other users have selected this researcher.")).toBeInTheDocument();
  });

  it("displays email in the header metadata", async () => {
    /** Admin can see the user's email address for contact/debugging purposes. */
    mockFindUnique.mockResolvedValue(mockFullUser() as never);
    mockProposalFindMany.mockResolvedValue([] as never);

    const jsx = await AdminUserDetailPage({ params: makeParams("user-1") });
    render(jsx);

    expect(screen.getByText(/alice@mit\.edu/)).toBeInTheDocument();
  });
});
