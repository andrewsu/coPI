/**
 * @jest-environment jsdom
 */

/**
 * Tests for the unsubscribe confirmation page.
 *
 * Validates that:
 *   - Success state shows "Successfully unsubscribed" with the notification type label
 *   - Invalid state shows the "Invalid or expired link" error message
 *   - Both states include a link to settings for further preferences management
 *   - All four notification type labels are displayed correctly
 */

import React from "react";
import { render, screen } from "@testing-library/react";
import "@testing-library/jest-dom";

// Mock next/navigation — useSearchParams returns configurable values
let mockSearchParams: Record<string, string | null> = {};

jest.mock("next/navigation", () => ({
  useSearchParams: () => ({
    get: (key: string) => mockSearchParams[key] ?? null,
  }),
}));

import UnsubscribePage from "../page";

describe("UnsubscribePage", () => {
  beforeEach(() => {
    mockSearchParams = {};
  });

  /** Success with type=matches should show a success message naming match notifications. */
  it("renders success state for matches unsubscribe", () => {
    mockSearchParams = { status: "success", type: "matches" };
    render(<UnsubscribePage />);

    expect(screen.getByText("Successfully unsubscribed")).toBeInTheDocument();
    expect(screen.getByText(/match notifications/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /account settings/ })).toHaveAttribute(
      "href",
      "/settings",
    );
  });

  /** Success with type=all should show "all email notifications". */
  it("renders success state for all notifications unsubscribe", () => {
    mockSearchParams = { status: "success", type: "all" };
    render(<UnsubscribePage />);

    expect(screen.getByText("Successfully unsubscribed")).toBeInTheDocument();
    expect(screen.getByText(/all email notifications/)).toBeInTheDocument();
  });

  /** Success with type=new_proposals should show "new proposals digest emails". */
  it("renders success state for new proposals unsubscribe", () => {
    mockSearchParams = { status: "success", type: "new_proposals" };
    render(<UnsubscribePage />);

    expect(screen.getByText(/new proposals digest emails/)).toBeInTheDocument();
  });

  /** Success with type=profile_refresh should show "profile refresh notifications". */
  it("renders success state for profile refresh unsubscribe", () => {
    mockSearchParams = { status: "success", type: "profile_refresh" };
    render(<UnsubscribePage />);

    expect(screen.getByText(/profile refresh notifications/)).toBeInTheDocument();
  });

  /** Invalid status should show the error message with instructions. */
  it("renders invalid state with error message", () => {
    mockSearchParams = { status: "invalid" };
    render(<UnsubscribePage />);

    expect(screen.getByText("Invalid or expired link")).toBeInTheDocument();
    expect(
      screen.getByText(/This unsubscribe link is no longer valid/),
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /account settings/ })).toHaveAttribute(
      "href",
      "/settings",
    );
  });

  /** Missing status defaults to invalid state (safety net). */
  it("renders invalid state when no status param", () => {
    mockSearchParams = {};
    render(<UnsubscribePage />);

    expect(screen.getByText("Invalid or expired link")).toBeInTheDocument();
  });

  /** Page always shows the CoPI branding header. */
  it("shows CoPI branding", () => {
    mockSearchParams = { status: "success", type: "matches" };
    render(<UnsubscribePage />);

    expect(screen.getByText("CoPI")).toBeInTheDocument();
  });
});
