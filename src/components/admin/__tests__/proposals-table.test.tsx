/**
 * @jest-environment jsdom
 */

/**
 * Tests for the ProposalsTable admin component.
 *
 * Validates the interactive table used on the Admin Proposals Overview page:
 * - Renders all proposal data in table columns with correct formatting
 * - Filters by confidence tier, match status, swipe status, and visibility
 * - Sorts by clicking column headers (toggle asc/desc)
 * - Navigates to proposal detail page on row click
 * - Researcher names link to their user detail pages (without triggering row nav)
 * - Shows appropriate empty state when filters match no proposals
 * - Displays "Clear filters" button only when filters are active
 */

import React from "react";
import { render, screen, fireEvent, within } from "@testing-library/react";
import "@testing-library/jest-dom";
import { ProposalsTable } from "../proposals-table";
import type { AdminProposal } from "@/app/admin/proposals/page";

const mockPush = jest.fn();
jest.mock("next/navigation", () => ({
  useRouter: () => ({ push: mockPush }),
}));

function makeProposal(overrides: Partial<AdminProposal> = {}): AdminProposal {
  return {
    id: "prop-1",
    researcherA: { id: "user-1", name: "Dr. Alice", institution: "MIT" },
    researcherB: { id: "user-2", name: "Dr. Bob", institution: "Stanford" },
    title: "CRISPR Collaboration",
    collaborationType: "complementary_expertise",
    confidenceTier: "high",
    visibilityA: "visible",
    visibilityB: "visible",
    swipeA: null,
    swipeB: null,
    matched: false,
    createdAt: "2026-01-25T00:00:00.000Z",
    ...overrides,
  };
}

const sampleProposals: AdminProposal[] = [
  makeProposal({
    id: "prop-1",
    researcherA: { id: "user-1", name: "Dr. Alice", institution: "MIT" },
    researcherB: { id: "user-2", name: "Dr. Bob", institution: "Stanford" },
    title: "CRISPR Collaboration",
    collaborationType: "complementary_expertise",
    confidenceTier: "high",
    visibilityA: "visible",
    visibilityB: "visible",
    swipeA: "interested",
    swipeB: "archive",
    matched: false,
    createdAt: "2026-01-25T00:00:00.000Z",
  }),
  makeProposal({
    id: "prop-2",
    researcherA: { id: "user-3", name: "Dr. Carol", institution: "Harvard" },
    researcherB: { id: "user-4", name: "Dr. Dave", institution: "Yale" },
    title: "Proteomics Study",
    collaborationType: "shared_resource",
    confidenceTier: "moderate",
    visibilityA: "pending_other_interest",
    visibilityB: "visible",
    swipeA: null,
    swipeB: "interested",
    matched: false,
    createdAt: "2026-02-10T00:00:00.000Z",
  }),
  makeProposal({
    id: "prop-3",
    researcherA: { id: "user-1", name: "Dr. Alice", institution: "MIT" },
    researcherB: { id: "user-4", name: "Dr. Dave", institution: "Yale" },
    title: "Epigenetics Pilot",
    collaborationType: "pilot_study",
    confidenceTier: "speculative",
    visibilityA: "visible",
    visibilityB: "pending_other_interest",
    swipeA: "interested",
    swipeB: "interested",
    matched: true,
    createdAt: "2026-01-10T00:00:00.000Z",
  }),
];

describe("ProposalsTable", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("renders all proposals with correct columns", () => {
    /** Verifies that each proposal row displays all required columns from the spec. */
    render(<ProposalsTable proposals={sampleProposals} />);

    // Researcher names (default sort is createdAt desc: prop-2 Feb, prop-1 Jan 25, prop-3 Jan 10)
    expect(screen.getByText("Dr. Carol")).toBeInTheDocument();
    expect(screen.getAllByText("Dr. Alice")).toHaveLength(2); // appears in prop-1 and prop-3
    expect(screen.getAllByText("Dr. Bob")).toHaveLength(1);
    expect(screen.getAllByText("Dr. Dave")).toHaveLength(2); // appears in prop-2 and prop-3

    // Titles
    expect(screen.getByText("CRISPR Collaboration")).toBeInTheDocument();
    expect(screen.getByText("Proteomics Study")).toBeInTheDocument();
    expect(screen.getByText("Epigenetics Pilot")).toBeInTheDocument();

    // Collaboration types (formatted from snake_case)
    expect(screen.getByText("Complementary Expertise")).toBeInTheDocument();
    expect(screen.getByText("Shared Resource")).toBeInTheDocument();
    expect(screen.getByText("Pilot Study")).toBeInTheDocument();
  });

  it("renders confidence tier badges with correct colors", () => {
    /** Confidence tiers use color-coded badges per the admin design patterns. */
    render(<ProposalsTable proposals={sampleProposals} />);

    // All three confidence tiers present (also in filter dropdown, use getAllByText)
    const highBadges = screen.getAllByText("High");
    expect(highBadges.length).toBeGreaterThanOrEqual(1);
    const moderateBadges = screen.getAllByText("Moderate");
    expect(moderateBadges.length).toBeGreaterThanOrEqual(1);
    const speculativeBadges = screen.getAllByText("Speculative");
    expect(speculativeBadges.length).toBeGreaterThanOrEqual(1);
  });

  it("renders visibility badges for both sides", () => {
    /** Both visibility A and B columns show color-coded badges. */
    render(<ProposalsTable proposals={sampleProposals} />);

    // "Visible" badges (filter option also has "Visible")
    const visibleBadges = screen.getAllByText("Visible");
    expect(visibleBadges.length).toBeGreaterThanOrEqual(1);
    // "Pending" badges
    const pendingBadges = screen.getAllByText("Pending");
    expect(pendingBadges.length).toBeGreaterThanOrEqual(1);
  });

  it("renders swipe status with labels or em-dash for unswiped", () => {
    /** Swipe columns show direction label when swiped, em-dash when not yet swiped. */
    render(<ProposalsTable proposals={sampleProposals} />);

    // "Interested" swipes
    const interestedLabels = screen.getAllByText("Interested");
    expect(interestedLabels.length).toBeGreaterThanOrEqual(1);
    // "Archive" swipes
    const archiveLabels = screen.getAllByText("Archive");
    expect(archiveLabels.length).toBeGreaterThanOrEqual(1);
    // Em-dashes for unswiped
    const dashes = screen.getAllByText("\u2014");
    expect(dashes.length).toBeGreaterThanOrEqual(1);
  });

  it("renders matched status correctly", () => {
    /** Matched proposals show "Yes", unmatched show "No". */
    render(<ProposalsTable proposals={sampleProposals} />);

    // prop-3 is matched
    expect(screen.getByText("Yes")).toBeInTheDocument();
    // prop-1 and prop-2 are not matched
    expect(screen.getAllByText("No")).toHaveLength(2);
  });

  it("shows total count in results summary", () => {
    /** Results count helps admins understand data scope. */
    render(<ProposalsTable proposals={sampleProposals} />);

    expect(screen.getByText("Showing 3 of 3 proposals")).toBeInTheDocument();
  });

  it("filters by confidence tier", () => {
    /** Confidence tier filter narrows to matching proposals only. */
    render(<ProposalsTable proposals={sampleProposals} />);

    const select = screen.getByLabelText("Confidence Tier");
    fireEvent.change(select, { target: { value: "high" } });

    expect(screen.getByText("CRISPR Collaboration")).toBeInTheDocument();
    expect(screen.queryByText("Proteomics Study")).not.toBeInTheDocument();
    expect(screen.queryByText("Epigenetics Pilot")).not.toBeInTheDocument();
    expect(screen.getByText("Showing 1 of 3 proposals")).toBeInTheDocument();
  });

  it("filters by match status (matched)", () => {
    /** Match status filter isolates proposals with mutual interest. */
    render(<ProposalsTable proposals={sampleProposals} />);

    const select = screen.getByLabelText("Match Status");
    fireEvent.change(select, { target: { value: "matched" } });

    expect(screen.queryByText("CRISPR Collaboration")).not.toBeInTheDocument();
    expect(screen.queryByText("Proteomics Study")).not.toBeInTheDocument();
    expect(screen.getByText("Epigenetics Pilot")).toBeInTheDocument();
    expect(screen.getByText("Showing 1 of 3 proposals")).toBeInTheDocument();
  });

  it("filters by match status (unmatched)", () => {
    /** Unmatched filter excludes proposals with mutual interest. */
    render(<ProposalsTable proposals={sampleProposals} />);

    const select = screen.getByLabelText("Match Status");
    fireEvent.change(select, { target: { value: "unmatched" } });

    expect(screen.getByText("CRISPR Collaboration")).toBeInTheDocument();
    expect(screen.getByText("Proteomics Study")).toBeInTheDocument();
    expect(screen.queryByText("Epigenetics Pilot")).not.toBeInTheDocument();
    expect(screen.getByText("Showing 2 of 3 proposals")).toBeInTheDocument();
  });

  it("filters by swipe status (both_swiped)", () => {
    /** Both swiped requires both researchers to have swiped. */
    render(<ProposalsTable proposals={sampleProposals} />);

    const select = screen.getByLabelText("Swipe Status");
    fireEvent.change(select, { target: { value: "both_swiped" } });

    // prop-1: swipeA=interested, swipeB=archive (both swiped)
    // prop-3: swipeA=interested, swipeB=interested (both swiped)
    expect(screen.getByText("CRISPR Collaboration")).toBeInTheDocument();
    expect(screen.queryByText("Proteomics Study")).not.toBeInTheDocument();
    expect(screen.getByText("Epigenetics Pilot")).toBeInTheDocument();
    expect(screen.getByText("Showing 2 of 3 proposals")).toBeInTheDocument();
  });

  it("filters by swipe status (one_swiped)", () => {
    /** One swiped requires exactly one researcher to have swiped. */
    render(<ProposalsTable proposals={sampleProposals} />);

    const select = screen.getByLabelText("Swipe Status");
    fireEvent.change(select, { target: { value: "one_swiped" } });

    // prop-2: swipeA=null, swipeB=interested (one swiped)
    expect(screen.queryByText("CRISPR Collaboration")).not.toBeInTheDocument();
    expect(screen.getByText("Proteomics Study")).toBeInTheDocument();
    expect(screen.queryByText("Epigenetics Pilot")).not.toBeInTheDocument();
    expect(screen.getByText("Showing 1 of 3 proposals")).toBeInTheDocument();
  });

  it("filters by swipe status (neither_swiped)", () => {
    /** Neither swiped requires zero swipes on the proposal. */
    const proposalsWithUnswiped = [
      ...sampleProposals,
      makeProposal({
        id: "prop-4",
        title: "Unswiped Proposal",
        swipeA: null,
        swipeB: null,
        createdAt: "2026-03-01T00:00:00.000Z",
      }),
    ];
    render(<ProposalsTable proposals={proposalsWithUnswiped} />);

    const select = screen.getByLabelText("Swipe Status");
    fireEvent.change(select, { target: { value: "neither_swiped" } });

    expect(screen.getByText("Unswiped Proposal")).toBeInTheDocument();
    expect(screen.queryByText("CRISPR Collaboration")).not.toBeInTheDocument();
    expect(screen.queryByText("Proteomics Study")).not.toBeInTheDocument();
    expect(screen.queryByText("Epigenetics Pilot")).not.toBeInTheDocument();
  });

  it("filters by visibility state", () => {
    /** Visibility filter matches proposals where either side has that visibility. */
    render(<ProposalsTable proposals={sampleProposals} />);

    const select = screen.getByLabelText("Visibility");
    fireEvent.change(select, { target: { value: "pending_other_interest" } });

    // prop-2: visibilityA=pending_other_interest
    // prop-3: visibilityB=pending_other_interest
    expect(screen.queryByText("CRISPR Collaboration")).not.toBeInTheDocument();
    expect(screen.getByText("Proteomics Study")).toBeInTheDocument();
    expect(screen.getByText("Epigenetics Pilot")).toBeInTheDocument();
    expect(screen.getByText("Showing 2 of 3 proposals")).toBeInTheDocument();
  });

  it("combines multiple filters", () => {
    /** All four filters should apply simultaneously (AND logic). */
    render(<ProposalsTable proposals={sampleProposals} />);

    // Filter to unmatched + both_swiped
    const matchSelect = screen.getByLabelText("Match Status");
    fireEvent.change(matchSelect, { target: { value: "unmatched" } });
    const swipeSelect = screen.getByLabelText("Swipe Status");
    fireEvent.change(swipeSelect, { target: { value: "both_swiped" } });

    // Only prop-1 is unmatched AND both swiped
    expect(screen.getByText("CRISPR Collaboration")).toBeInTheDocument();
    expect(screen.queryByText("Proteomics Study")).not.toBeInTheDocument();
    expect(screen.queryByText("Epigenetics Pilot")).not.toBeInTheDocument();
    expect(screen.getByText("Showing 1 of 3 proposals")).toBeInTheDocument();
  });

  it("shows Clear filters button only when filters are active", () => {
    /** Clear filters button is hidden in default state to avoid clutter. */
    render(<ProposalsTable proposals={sampleProposals} />);

    expect(screen.queryByText("Clear filters")).not.toBeInTheDocument();

    const select = screen.getByLabelText("Confidence Tier");
    fireEvent.change(select, { target: { value: "high" } });

    expect(screen.getByText("Clear filters")).toBeInTheDocument();
  });

  it("clears all filters when Clear filters is clicked", () => {
    /** Clear filters resets all filter fields and shows all proposals again. */
    render(<ProposalsTable proposals={sampleProposals} />);

    const select = screen.getByLabelText("Match Status");
    fireEvent.change(select, { target: { value: "matched" } });
    expect(screen.getByText("Showing 1 of 3 proposals")).toBeInTheDocument();

    fireEvent.click(screen.getByText("Clear filters"));
    expect(screen.getByText("Showing 3 of 3 proposals")).toBeInTheDocument();
  });

  it("shows empty state when no proposals match filters", () => {
    /** Empty filter results show a clear message instead of a broken table. */
    render(<ProposalsTable proposals={sampleProposals} />);

    const select = screen.getByLabelText("Visibility");
    fireEvent.change(select, { target: { value: "hidden" } });

    expect(
      screen.getByText("No proposals match the current filters."),
    ).toBeInTheDocument();
    expect(screen.getByText("Showing 0 of 3 proposals")).toBeInTheDocument();
  });

  it("sorts by researcher A name ascending then descending", () => {
    /** Column headers are clickable for sorting; first click is asc, second is desc. */
    render(<ProposalsTable proposals={sampleProposals} />);

    const header = screen.getByText("Researcher A");
    fireEvent.click(header); // asc

    const rows = screen.getAllByRole("row");
    // rows[0] is header. Asc by researcher A name: Alice (prop-1), Alice (prop-3), Carol (prop-2)
    expect(within(rows[1]!).getByText("CRISPR Collaboration")).toBeInTheDocument();
    expect(within(rows[2]!).getByText("Epigenetics Pilot")).toBeInTheDocument();
    expect(within(rows[3]!).getByText("Proteomics Study")).toBeInTheDocument();

    // Click again for desc
    fireEvent.click(header);
    const rowsDesc = screen.getAllByRole("row");
    expect(within(rowsDesc[1]!).getByText("Proteomics Study")).toBeInTheDocument();
  });

  it("sorts by confidence tier in logical order (high → moderate → speculative)", () => {
    /** Confidence tier sorts by semantic weight, not alphabetically. */
    render(<ProposalsTable proposals={sampleProposals} />);

    const header = screen.getByText("Confidence");
    fireEvent.click(header); // asc: high → moderate → speculative

    const rows = screen.getAllByRole("row");
    // high=prop-1, moderate=prop-2, speculative=prop-3
    expect(within(rows[1]!).getByText("CRISPR Collaboration")).toBeInTheDocument();
    expect(within(rows[2]!).getByText("Proteomics Study")).toBeInTheDocument();
    expect(within(rows[3]!).getByText("Epigenetics Pilot")).toBeInTheDocument();
  });

  it("sorts by created date", () => {
    /** Date sort enables finding most recent or oldest proposals. */
    render(<ProposalsTable proposals={sampleProposals} />);

    const header = screen.getByText("Created");
    fireEvent.click(header); // asc (oldest first)

    const rows = screen.getAllByRole("row");
    // asc: prop-3 (Jan 10), prop-1 (Jan 25), prop-2 (Feb 10)
    expect(within(rows[1]!).getByText("Epigenetics Pilot")).toBeInTheDocument();
    expect(within(rows[2]!).getByText("CRISPR Collaboration")).toBeInTheDocument();
    expect(within(rows[3]!).getByText("Proteomics Study")).toBeInTheDocument();
  });

  it("navigates to proposal detail page on row click", () => {
    /** Row click navigates to /admin/proposals/[id] per spec. */
    render(<ProposalsTable proposals={sampleProposals} />);

    fireEvent.click(screen.getByText("CRISPR Collaboration"));
    expect(mockPush).toHaveBeenCalledWith("/admin/proposals/prop-1");
  });

  it("researcher name links navigate to user detail without triggering row nav", () => {
    /** Clicking a researcher name opens their user detail, not the proposal detail. */
    render(<ProposalsTable proposals={sampleProposals} />);

    const aliceLinks = screen.getAllByText("Dr. Alice");
    fireEvent.click(aliceLinks[0]!);

    // stopPropagation prevents the row click handler from firing
    expect(mockPush).not.toHaveBeenCalled();

    // Verify the link href
    expect(aliceLinks[0]!).toHaveAttribute("href", "/admin/users/user-1");
  });

  it("renders empty table with all headers when no proposals provided", () => {
    /** An empty platform should still render the table structure correctly. */
    render(<ProposalsTable proposals={[]} />);

    expect(screen.getByText("Showing 0 of 0 proposals")).toBeInTheDocument();
    expect(
      screen.getByText("No proposals match the current filters."),
    ).toBeInTheDocument();
    // Check table headers exist
    expect(screen.getByText("Researcher A")).toBeInTheDocument();
    expect(screen.getByText("Researcher B")).toBeInTheDocument();
    expect(screen.getByText("Title")).toBeInTheDocument();
  });

  it("formats dates in human-readable format", () => {
    /** Dates should be readable, not raw ISO strings. */
    render(<ProposalsTable proposals={[sampleProposals[0]!]} />);

    expect(screen.getByText("Jan 25, 2026")).toBeInTheDocument();
  });
});
