/**
 * Tests for the 403 Forbidden page.
 *
 * @jest-environment jsdom
 *
 * Validates that the forbidden page renders the correct content for
 * non-admin users who are redirected here by the middleware when they
 * attempt to access /admin/* routes. See specs/admin-dashboard.md.
 */

import { render, screen } from "@testing-library/react";
import "@testing-library/jest-dom";
import ForbiddenPage from "../page";

// Mock next/link to render a simple anchor tag
jest.mock("next/link", () => {
  return function MockLink({
    href,
    children,
    ...props
  }: {
    href: string;
    children: React.ReactNode;
    [key: string]: unknown;
  }) {
    return (
      <a href={href} {...props}>
        {children}
      </a>
    );
  };
});

describe("ForbiddenPage", () => {
  // The page must display "403" prominently so users understand
  // the HTTP error they've encountered.
  it("displays the 403 error code", () => {
    render(<ForbiddenPage />);
    expect(screen.getByText("403")).toBeInTheDocument();
  });

  // The page should explain WHY access was denied — admin-only restriction.
  it("displays an access denied message", () => {
    render(<ForbiddenPage />);
    expect(screen.getByText("Access Denied")).toBeInTheDocument();
    expect(
      screen.getByText(
        "You do not have permission to access the admin dashboard.",
      ),
    ).toBeInTheDocument();
  });

  // Users must have a way to navigate back to the main app.
  it("provides a link to the home page", () => {
    render(<ForbiddenPage />);
    const link = screen.getByRole("link", { name: /go home/i });
    expect(link).toHaveAttribute("href", "/");
  });

  // Snapshot test to catch unintended visual regressions.
  it("renders with consistent structure", () => {
    const { container } = render(<ForbiddenPage />);
    const main = container.querySelector("main");
    expect(main).toBeInTheDocument();
    expect(main).toHaveClass("min-h-screen");
  });
});
