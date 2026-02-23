/**
 * @jest-environment jsdom
 */

/**
 * Tests for the UsersTable admin component.
 *
 * Validates the interactive table used on the Admin Users Overview page:
 * - Renders all user data in table columns with correct formatting
 * - Filters by profile status, institution text, and claimed/unclaimed
 * - Sorts by clicking column headers (toggle asc/desc)
 * - Navigates to user detail page on row click
 * - Shows ORCID as external link to orcid.org
 * - Shows appropriate empty state when filters match no users
 * - Displays "Clear filters" button only when filters are active
 */

import React from "react";
import { render, screen, fireEvent, within } from "@testing-library/react";
import "@testing-library/jest-dom";
import { UsersTable } from "../users-table";
import type { AdminUser } from "@/app/admin/users/page";

const mockPush = jest.fn();
jest.mock("next/navigation", () => ({
  useRouter: () => ({ push: mockPush }),
}));

function makeUser(overrides: Partial<AdminUser> = {}): AdminUser {
  return {
    id: "user-1",
    name: "Dr. Alice",
    institution: "MIT",
    department: "Biology",
    orcid: "0000-0001-2345-6789",
    profileStatus: "complete",
    publicationCount: 25,
    matchPoolSize: 10,
    proposalsGenerated: 5,
    createdAt: "2026-01-15T00:00:00.000Z",
    claimedAt: "2026-01-15T00:00:00.000Z",
    ...overrides,
  };
}

const sampleUsers: AdminUser[] = [
  makeUser({
    id: "user-1",
    name: "Dr. Alice",
    institution: "MIT",
    department: "Biology",
    publicationCount: 25,
    matchPoolSize: 10,
    proposalsGenerated: 5,
    createdAt: "2026-01-15T00:00:00.000Z",
    claimedAt: "2026-01-15T00:00:00.000Z",
  }),
  makeUser({
    id: "user-2",
    name: "Dr. Bob",
    institution: "Stanford",
    department: null,
    orcid: "0000-0002-3456-7890",
    profileStatus: "no_profile",
    publicationCount: 0,
    matchPoolSize: 0,
    proposalsGenerated: 0,
    createdAt: "2026-02-01T00:00:00.000Z",
    claimedAt: null,
  }),
  makeUser({
    id: "user-3",
    name: "Dr. Carol",
    institution: "MIT",
    department: "Chemistry",
    orcid: "0000-0003-4567-8901",
    profileStatus: "pending_update",
    publicationCount: 42,
    matchPoolSize: 15,
    proposalsGenerated: 12,
    createdAt: "2025-12-01T00:00:00.000Z",
    claimedAt: "2025-12-01T00:00:00.000Z",
  }),
];

describe("UsersTable", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("renders all users in the table with correct columns", () => {
    /** Verifies that each user row displays all required columns from the spec. */
    render(<UsersTable users={sampleUsers} />);

    // User names
    expect(screen.getByText("Dr. Alice")).toBeInTheDocument();
    expect(screen.getByText("Dr. Bob")).toBeInTheDocument();
    expect(screen.getByText("Dr. Carol")).toBeInTheDocument();

    // Institutions (default sort is createdAt desc: Bob Feb→Alice Jan→Carol Dec)
    const rows = screen.getAllByRole("row");
    // rows[0] is header. rows[1]=Bob, rows[2]=Alice, rows[3]=Carol
    expect(within(rows[1]!).getByText("Stanford")).toBeInTheDocument();
    expect(within(rows[2]!).getByText("MIT")).toBeInTheDocument();
    expect(within(rows[3]!).getByText("MIT")).toBeInTheDocument();

    // Profile status badges (use getAllByText since labels also appear in filter dropdown)
    const completeBadges = screen.getAllByText("Complete");
    expect(completeBadges.length).toBeGreaterThanOrEqual(1);
    const noProfileBadges = screen.getAllByText("No Profile");
    expect(noProfileBadges.length).toBeGreaterThanOrEqual(1);
    const pendingBadges = screen.getAllByText("Pending Update");
    expect(pendingBadges.length).toBeGreaterThanOrEqual(1);
  });

  it("renders ORCID as an external link to orcid.org", () => {
    /** ORCID should be a clickable link per spec. */
    render(<UsersTable users={[sampleUsers[0]!]} />);

    const link = screen.getByText("0000-0001-2345-6789");
    expect(link).toHaveAttribute(
      "href",
      "https://orcid.org/0000-0001-2345-6789",
    );
    expect(link).toHaveAttribute("target", "_blank");
  });

  it("shows em-dash for null department", () => {
    /** Users without a department should show a dash, not empty cell. */
    render(<UsersTable users={[sampleUsers[1]!]} />);

    // Dr. Bob has null department — should show em-dash
    expect(screen.getByText("\u2014")).toBeInTheDocument();
  });

  it("shows claimed status correctly", () => {
    /** Claimed users show "Yes", seeded/unclaimed users show "Seeded". */
    render(<UsersTable users={sampleUsers} />);

    // Alice and Carol are claimed, Bob is unclaimed (seeded)
    expect(screen.getAllByText("Yes")).toHaveLength(2);
    expect(screen.getByText("Seeded")).toBeInTheDocument();
  });

  it("shows total count in results summary", () => {
    /** Results count helps admins understand data scope. */
    render(<UsersTable users={sampleUsers} />);

    expect(screen.getByText("Showing 3 of 3 users")).toBeInTheDocument();
  });

  it("filters by profile status", () => {
    /** Profile status filter narrows the table to matching users only. */
    render(<UsersTable users={sampleUsers} />);

    const select = screen.getByLabelText("Profile Status");
    fireEvent.change(select, { target: { value: "complete" } });

    expect(screen.getByText("Dr. Alice")).toBeInTheDocument();
    expect(screen.queryByText("Dr. Bob")).not.toBeInTheDocument();
    expect(screen.queryByText("Dr. Carol")).not.toBeInTheDocument();
    expect(screen.getByText("Showing 1 of 3 users")).toBeInTheDocument();
  });

  it("filters by institution text search (case-insensitive)", () => {
    /** Institution filter is a case-insensitive contains search per spec. */
    render(<UsersTable users={sampleUsers} />);

    const input = screen.getByPlaceholderText("Search institution...");
    fireEvent.change(input, { target: { value: "stan" } });

    expect(screen.queryByText("Dr. Alice")).not.toBeInTheDocument();
    expect(screen.getByText("Dr. Bob")).toBeInTheDocument();
    expect(screen.queryByText("Dr. Carol")).not.toBeInTheDocument();
  });

  it("filters by claimed status", () => {
    /** Claimed filter separates OAuth-registered users from admin-seeded profiles. */
    render(<UsersTable users={sampleUsers} />);

    const select = screen.getByLabelText("Claimed");
    fireEvent.change(select, { target: { value: "unclaimed" } });

    // Only Bob is unclaimed
    expect(screen.queryByText("Dr. Alice")).not.toBeInTheDocument();
    expect(screen.getByText("Dr. Bob")).toBeInTheDocument();
    expect(screen.queryByText("Dr. Carol")).not.toBeInTheDocument();
  });

  it("combines multiple filters", () => {
    /** All three filters should apply simultaneously (AND logic). */
    render(<UsersTable users={sampleUsers} />);

    // Filter to MIT + claimed
    const institutionInput = screen.getByPlaceholderText("Search institution...");
    fireEvent.change(institutionInput, { target: { value: "MIT" } });
    const claimedSelect = screen.getByLabelText("Claimed");
    fireEvent.change(claimedSelect, { target: { value: "claimed" } });

    // Alice and Carol are MIT + claimed
    expect(screen.getByText("Dr. Alice")).toBeInTheDocument();
    expect(screen.queryByText("Dr. Bob")).not.toBeInTheDocument();
    expect(screen.getByText("Dr. Carol")).toBeInTheDocument();
    expect(screen.getByText("Showing 2 of 3 users")).toBeInTheDocument();
  });

  it("shows Clear filters button only when filters are active", () => {
    /** Clear filters button is hidden in default state to avoid clutter. */
    render(<UsersTable users={sampleUsers} />);

    expect(screen.queryByText("Clear filters")).not.toBeInTheDocument();

    const select = screen.getByLabelText("Profile Status");
    fireEvent.change(select, { target: { value: "complete" } });

    expect(screen.getByText("Clear filters")).toBeInTheDocument();
  });

  it("clears all filters when Clear filters is clicked", () => {
    /** Clear filters resets all filter fields and shows all users again. */
    render(<UsersTable users={sampleUsers} />);

    const select = screen.getByLabelText("Profile Status");
    fireEvent.change(select, { target: { value: "no_profile" } });
    expect(screen.getByText("Showing 1 of 3 users")).toBeInTheDocument();

    fireEvent.click(screen.getByText("Clear filters"));
    expect(screen.getByText("Showing 3 of 3 users")).toBeInTheDocument();
  });

  it("shows empty state when no users match filters", () => {
    /** Empty filter results show a clear message instead of a broken table. */
    render(<UsersTable users={sampleUsers} />);

    const input = screen.getByPlaceholderText("Search institution...");
    fireEvent.change(input, { target: { value: "Harvard" } });

    expect(
      screen.getByText("No users match the current filters."),
    ).toBeInTheDocument();
    expect(screen.getByText("Showing 0 of 3 users")).toBeInTheDocument();
  });

  it("sorts by name ascending then descending on column header click", () => {
    /** Column headers are clickable for sorting; first click is asc, second is desc. */
    render(<UsersTable users={sampleUsers} />);

    const nameHeader = screen.getByText("Name");
    fireEvent.click(nameHeader);

    // After asc sort by name: Alice, Bob, Carol
    const rows = screen.getAllByRole("row");
    // rows[0] is the header row
    expect(within(rows[1]!).getByText("Dr. Alice")).toBeInTheDocument();
    expect(within(rows[2]!).getByText("Dr. Bob")).toBeInTheDocument();
    expect(within(rows[3]!).getByText("Dr. Carol")).toBeInTheDocument();

    // Click again for desc
    fireEvent.click(nameHeader);
    const rowsDesc = screen.getAllByRole("row");
    expect(within(rowsDesc[1]!).getByText("Dr. Carol")).toBeInTheDocument();
    expect(within(rowsDesc[2]!).getByText("Dr. Bob")).toBeInTheDocument();
    expect(within(rowsDesc[3]!).getByText("Dr. Alice")).toBeInTheDocument();
  });

  it("sorts by publication count", () => {
    /** Numeric columns sort correctly by value, not lexicographically. */
    render(<UsersTable users={sampleUsers} />);

    const pubsHeader = screen.getByText("Pubs");
    fireEvent.click(pubsHeader); // asc

    const rows = screen.getAllByRole("row");
    // Bob (0) → Alice (25) → Carol (42)
    expect(within(rows[1]!).getByText("Dr. Bob")).toBeInTheDocument();
    expect(within(rows[2]!).getByText("Dr. Alice")).toBeInTheDocument();
    expect(within(rows[3]!).getByText("Dr. Carol")).toBeInTheDocument();
  });

  it("navigates to user detail page on row click", () => {
    /** Row click navigates to /admin/users/[id] per spec. */
    render(<UsersTable users={sampleUsers} />);

    // Click on Alice's row
    fireEvent.click(screen.getByText("Dr. Alice"));
    expect(mockPush).toHaveBeenCalledWith("/admin/users/user-1");
  });

  it("ORCID link click does not trigger row navigation", () => {
    /** Clicking the ORCID link should open orcid.org, not navigate to user detail. */
    render(<UsersTable users={sampleUsers} />);

    const link = screen.getByText("0000-0001-2345-6789");
    fireEvent.click(link);

    // stopPropagation should prevent the row click handler from firing
    expect(mockPush).not.toHaveBeenCalled();
  });

  it("renders empty table with all headers when no users provided", () => {
    /** An empty platform should still render the table structure correctly. */
    render(<UsersTable users={[]} />);

    expect(screen.getByText("Showing 0 of 0 users")).toBeInTheDocument();
    expect(
      screen.getByText("No users match the current filters."),
    ).toBeInTheDocument();
    // Check table headers exist (Name is unique, Institution also in filter label)
    expect(screen.getByText("Name")).toBeInTheDocument();
    expect(screen.getAllByText("Institution").length).toBeGreaterThanOrEqual(1);
  });

  it("formats dates in human-readable format", () => {
    /** Dates should be readable, not raw ISO strings. */
    render(<UsersTable users={[sampleUsers[0]!]} />);

    // Jan 15, 2026 in en-US
    expect(screen.getByText("Jan 15, 2026")).toBeInTheDocument();
  });
});
