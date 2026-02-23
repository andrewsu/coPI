/**
 * @jest-environment jsdom
 */

/**
 * Tests for the StatsDashboard admin component.
 *
 * Validates the interactive dashboard used on the Admin Matching Stats page:
 * - Summary cards display total users (claimed/seeded), proposals, matches, generation rate
 * - Funnel visualization shows counts and conversion rates at each stage
 * - Matching results table renders all records with correct formatting
 * - Outcome filter narrows matching results to the specified outcome type
 * - Date sort toggles ascending/descending on column header click
 * - Researcher names link to their user detail pages
 * - Empty states render correctly when no matching results exist
 * - Clear filters button appears only when filter is active
 */

import React from "react";
import { render, screen, fireEvent, within } from "@testing-library/react";
import "@testing-library/jest-dom";
import { StatsDashboard } from "../stats-dashboard";
import type {
  StatsData,
  FunnelData,
  AdminMatchingResult,
} from "@/app/admin/stats/page";

const mockPush = jest.fn();
jest.mock("next/navigation", () => ({
  useRouter: () => ({ push: mockPush }),
}));

const sampleSummary: StatsData = {
  totalUsers: 15,
  claimedUsers: 10,
  seededUsers: 5,
  totalProposals: 30,
  totalMatches: 8,
  generationRate: 0.6,
};

const sampleFunnel: FunnelData = {
  pairsEvaluated: 20,
  proposalsGenerated: 30,
  proposalsWithInterestedSwipe: 18,
  mutualMatches: 8,
};

const sampleResults: AdminMatchingResult[] = [
  {
    id: "mr-1",
    researcherA: { id: "user-1", name: "Dr. Alice", institution: "MIT" },
    researcherB: { id: "user-2", name: "Dr. Bob", institution: "Stanford" },
    outcome: "proposals_generated",
    profileVersionA: 1,
    profileVersionB: 2,
    evaluatedAt: "2026-01-20T00:00:00.000Z",
  },
  {
    id: "mr-2",
    researcherA: { id: "user-1", name: "Dr. Alice", institution: "MIT" },
    researcherB: { id: "user-3", name: "Dr. Carol", institution: "Harvard" },
    outcome: "no_proposal",
    profileVersionA: 1,
    profileVersionB: 1,
    evaluatedAt: "2026-02-15T00:00:00.000Z",
  },
  {
    id: "mr-3",
    researcherA: { id: "user-3", name: "Dr. Carol", institution: "Harvard" },
    researcherB: { id: "user-2", name: "Dr. Bob", institution: "Stanford" },
    outcome: "proposals_generated",
    profileVersionA: 2,
    profileVersionB: 2,
    evaluatedAt: "2026-01-05T00:00:00.000Z",
  },
];

describe("StatsDashboard", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("renders all four summary cards with correct values", () => {
    /** Summary cards show total users, proposals, matches, and generation rate per spec. */
    render(
      <StatsDashboard
        summary={sampleSummary}
        funnel={sampleFunnel}
        matchingResults={sampleResults}
      />,
    );

    // Total users card — find by label, check its parent card
    const totalUsersLabel = screen.getByText("Total Users");
    const totalUsersCard = totalUsersLabel.closest("div")!;
    expect(within(totalUsersCard).getByText("15")).toBeInTheDocument();
    expect(screen.getByText("10 claimed, 5 seeded")).toBeInTheDocument();

    // Total proposals card
    const totalProposalsLabel = screen.getByText("Total Proposals");
    const totalProposalsCard = totalProposalsLabel.closest("div")!;
    expect(within(totalProposalsCard).getByText("30")).toBeInTheDocument();

    // Total matches card
    const totalMatchesLabel = screen.getByText("Total Matches");
    const totalMatchesCard = totalMatchesLabel.closest("div")!;
    expect(within(totalMatchesCard).getByText("8")).toBeInTheDocument();

    // Generation rate card (0.6 = 60.0%)
    const genRateLabel = screen.getByText("Generation Rate");
    const genRateCard = genRateLabel.closest("div")!;
    expect(within(genRateCard).getByText("60.0%")).toBeInTheDocument();
  });

  it("renders funnel with counts and conversion rates", () => {
    /** Funnel tracks conversion rates at each stage per spec: pairs → proposals → interested → matches. */
    render(
      <StatsDashboard
        summary={sampleSummary}
        funnel={sampleFunnel}
        matchingResults={sampleResults}
      />,
    );

    expect(screen.getByText("Matching Funnel")).toBeInTheDocument();

    // Funnel step labels
    expect(screen.getByText("Pairs Evaluated")).toBeInTheDocument();
    expect(
      screen.getByText("At Least One Interested Swipe"),
    ).toBeInTheDocument();
    expect(screen.getByText("Mutual Matches")).toBeInTheDocument();

    // Funnel counts (20, 30, 18, 8)
    expect(screen.getByText("20")).toBeInTheDocument();
    expect(screen.getByText("18")).toBeInTheDocument();

    // Conversion rates
    // proposals/pairs = 30/20 = 150.0%
    expect(screen.getByText("150.0%")).toBeInTheDocument();
    // interested/proposals = 18/30 = 60.0% (same as generation rate card, already checked)
    // matches/interested = 8/18 = 44.4%
    expect(screen.getByText("44.4%")).toBeInTheDocument();
  });

  it("shows N/A for funnel conversion rates when denominator is zero", () => {
    /** When no data exists at a funnel stage, rate shows N/A instead of dividing by zero. */
    const emptyFunnel: FunnelData = {
      pairsEvaluated: 0,
      proposalsGenerated: 0,
      proposalsWithInterestedSwipe: 0,
      mutualMatches: 0,
    };

    render(
      <StatsDashboard
        summary={{ ...sampleSummary, generationRate: 0 }}
        funnel={emptyFunnel}
        matchingResults={[]}
      />,
    );

    // All funnel counts should be 0
    const zeros = screen.getAllByText("0");
    expect(zeros.length).toBeGreaterThanOrEqual(4);

    // Conversion rates for steps with zero denominators
    const naLabels = screen.getAllByText("N/A");
    expect(naLabels.length).toBeGreaterThanOrEqual(3);
  });

  it("renders matching results table with all records", () => {
    /** Matching results table shows researcher names, outcome, profile versions, and date. */
    render(
      <StatsDashboard
        summary={sampleSummary}
        funnel={sampleFunnel}
        matchingResults={sampleResults}
      />,
    );

    expect(screen.getByText("Matching Results")).toBeInTheDocument();
    expect(
      screen.getByText("Showing 3 of 3 results"),
    ).toBeInTheDocument();

    // Researcher names (Dr. Alice appears twice, Dr. Bob twice, Dr. Carol twice)
    expect(screen.getAllByText("Dr. Alice")).toHaveLength(2);
    expect(screen.getAllByText("Dr. Bob")).toHaveLength(2);
    expect(screen.getAllByText("Dr. Carol")).toHaveLength(2);

    // Outcome badges
    const proposalsGenBadges = screen.getAllByText("Proposals Generated");
    // 2 in table rows + 1 in filter dropdown = at least 2
    expect(proposalsGenBadges.length).toBeGreaterThanOrEqual(2);
    const noProposalBadges = screen.getAllByText("No Proposal");
    expect(noProposalBadges.length).toBeGreaterThanOrEqual(1);

    // Profile versions
    expect(screen.getAllByText("v1").length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText("v2").length).toBeGreaterThanOrEqual(1);
  });

  it("filters matching results by outcome", () => {
    /** Outcome filter narrows matching results to the specified outcome type per spec. */
    render(
      <StatsDashboard
        summary={sampleSummary}
        funnel={sampleFunnel}
        matchingResults={sampleResults}
      />,
    );

    const select = screen.getByLabelText("Outcome");
    fireEvent.change(select, { target: { value: "proposals_generated" } });

    // Should show 2 of 3 results (mr-1 and mr-3)
    expect(
      screen.getByText("Showing 2 of 3 results"),
    ).toBeInTheDocument();

    // Dr. Carol with "No Proposal" should still appear in the table (she's also researcherA in mr-3)
    // but the no_proposal row (mr-2) should be filtered out
    // mr-2 had Alice and Carol — after filter, Alice still shows (from mr-1) and Carol still shows (from mr-3)
  });

  it("filters matching results by no_proposal outcome", () => {
    /** The no_proposal filter isolates pairs where the matching engine found no viable collaboration. */
    render(
      <StatsDashboard
        summary={sampleSummary}
        funnel={sampleFunnel}
        matchingResults={sampleResults}
      />,
    );

    const select = screen.getByLabelText("Outcome");
    fireEvent.change(select, { target: { value: "no_proposal" } });

    expect(
      screen.getByText("Showing 1 of 3 results"),
    ).toBeInTheDocument();
  });

  it("shows Clear filters button only when filter is active", () => {
    /** Clear filters button is hidden in default state to avoid clutter. */
    render(
      <StatsDashboard
        summary={sampleSummary}
        funnel={sampleFunnel}
        matchingResults={sampleResults}
      />,
    );

    expect(screen.queryByText("Clear filters")).not.toBeInTheDocument();

    const select = screen.getByLabelText("Outcome");
    fireEvent.change(select, { target: { value: "no_proposal" } });

    expect(screen.getByText("Clear filters")).toBeInTheDocument();
  });

  it("clears filter when Clear filters is clicked", () => {
    /** Clear filters resets the outcome filter and shows all results again. */
    render(
      <StatsDashboard
        summary={sampleSummary}
        funnel={sampleFunnel}
        matchingResults={sampleResults}
      />,
    );

    const select = screen.getByLabelText("Outcome");
    fireEvent.change(select, { target: { value: "no_proposal" } });
    expect(
      screen.getByText("Showing 1 of 3 results"),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByText("Clear filters"));
    expect(
      screen.getByText("Showing 3 of 3 results"),
    ).toBeInTheDocument();
  });

  it("sorts matching results by date ascending on header click", () => {
    /** Clicking the Evaluated column header toggles sort direction per spec. */
    render(
      <StatsDashboard
        summary={sampleSummary}
        funnel={sampleFunnel}
        matchingResults={sampleResults}
      />,
    );

    // Default sort is desc (newest first): mr-2 (Feb 15), mr-1 (Jan 20), mr-3 (Jan 5)
    const rows = screen.getAllByRole("row");
    // rows[0] is header, rows[1] should be mr-2
    expect(within(rows[1]!).getByText("Feb 15, 2026")).toBeInTheDocument();
    expect(within(rows[3]!).getByText("Jan 5, 2026")).toBeInTheDocument();

    // Click to toggle to asc (oldest first)
    const evaluatedHeader = screen.getByText(/^Evaluated/);
    fireEvent.click(evaluatedHeader);

    const rowsAfter = screen.getAllByRole("row");
    // Now: mr-3 (Jan 5), mr-1 (Jan 20), mr-2 (Feb 15)
    expect(within(rowsAfter[1]!).getByText("Jan 5, 2026")).toBeInTheDocument();
    expect(
      within(rowsAfter[3]!).getByText("Feb 15, 2026"),
    ).toBeInTheDocument();
  });

  it("navigates to user detail when researcher name is clicked", () => {
    /** Researcher name links allow admins to drill into user details. */
    render(
      <StatsDashboard
        summary={sampleSummary}
        funnel={sampleFunnel}
        matchingResults={sampleResults}
      />,
    );

    const aliceLinks = screen.getAllByText("Dr. Alice");
    fireEvent.click(aliceLinks[0]!);

    expect(mockPush).toHaveBeenCalledWith("/admin/users/user-1");
  });

  it("renders empty state when no matching results exist", () => {
    /** Empty state message helps admin understand there's no data rather than a broken table. */
    render(
      <StatsDashboard
        summary={{ ...sampleSummary, generationRate: 0 }}
        funnel={{ ...sampleFunnel, pairsEvaluated: 0 }}
        matchingResults={[]}
      />,
    );

    expect(screen.getByText("No matching results found.")).toBeInTheDocument();
    expect(
      screen.getByText("Showing 0 of 0 results"),
    ).toBeInTheDocument();
  });

  it("renders empty state when filters match no results", () => {
    /** Filter exclusion should show an empty state message, not a broken table. */
    const resultsWithOneOutcome: AdminMatchingResult[] = [
      {
        id: "mr-1",
        researcherA: { id: "user-1", name: "Dr. Alice", institution: "MIT" },
        researcherB: {
          id: "user-2",
          name: "Dr. Bob",
          institution: "Stanford",
        },
        outcome: "proposals_generated",
        profileVersionA: 1,
        profileVersionB: 1,
        evaluatedAt: "2026-01-20T00:00:00.000Z",
      },
    ];

    render(
      <StatsDashboard
        summary={sampleSummary}
        funnel={sampleFunnel}
        matchingResults={resultsWithOneOutcome}
      />,
    );

    const select = screen.getByLabelText("Outcome");
    fireEvent.change(select, { target: { value: "no_proposal" } });

    expect(screen.getByText("No matching results found.")).toBeInTheDocument();
    expect(
      screen.getByText("Showing 0 of 1 result"),
    ).toBeInTheDocument();
  });

  it("displays generation rate description under the rate card", () => {
    /** The generation rate card includes a description to explain what the metric means. */
    render(
      <StatsDashboard
        summary={sampleSummary}
        funnel={sampleFunnel}
        matchingResults={sampleResults}
      />,
    );

    expect(
      screen.getByText("pairs with proposals / pairs evaluated"),
    ).toBeInTheDocument();
  });

  it("renders profile versions with 'v' prefix in the table", () => {
    /** Profile versions are displayed as v1, v2, etc. for readability. */
    render(
      <StatsDashboard
        summary={sampleSummary}
        funnel={sampleFunnel}
        matchingResults={sampleResults}
      />,
    );

    expect(screen.getAllByText("v1").length).toBeGreaterThanOrEqual(2);
    expect(screen.getAllByText("v2").length).toBeGreaterThanOrEqual(2);
  });

  it("researcher name links have correct href attributes", () => {
    /** Links should have proper hrefs for accessibility and right-click/open-in-new-tab. */
    render(
      <StatsDashboard
        summary={sampleSummary}
        funnel={sampleFunnel}
        matchingResults={sampleResults}
      />,
    );

    const aliceLinks = screen.getAllByText("Dr. Alice");
    expect(aliceLinks[0]!).toHaveAttribute("href", "/admin/users/user-1");

    const bobLinks = screen.getAllByText("Dr. Bob");
    expect(bobLinks[0]!).toHaveAttribute("href", "/admin/users/user-2");
  });

  it("renders zero generation rate correctly", () => {
    /** Zero generation rate should display as 0.0%, not NaN or empty. */
    render(
      <StatsDashboard
        summary={{ ...sampleSummary, generationRate: 0 }}
        funnel={sampleFunnel}
        matchingResults={sampleResults}
      />,
    );

    expect(screen.getByText("0.0%")).toBeInTheDocument();
  });
});
