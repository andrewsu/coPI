/**
 * @jest-environment jsdom
 */

/**
 * Tests for the home page (/), focused on the admin link visibility.
 *
 * Per specs/admin-dashboard.md: "The admin dashboard link is only visible
 * in the nav/header for admin users." Validates that the Admin nav link
 * appears for isAdmin=true sessions and is absent for non-admin sessions.
 *
 * The page is an async server component that queries Prisma and calls
 * getServerSession. We mock both and render the returned JSX.
 */

import React from "react";
import { render, screen } from "@testing-library/react";
import "@testing-library/jest-dom";

// --- Mocks ---

const mockRedirect = jest.fn();
jest.mock("next/navigation", () => ({
  redirect: (url: string) => {
    mockRedirect(url);
    throw new Error("NEXT_REDIRECT");
  },
}));

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

const mockGetServerSession = jest.fn();
jest.mock("next-auth", () => ({
  getServerSession: (...args: unknown[]) => mockGetServerSession(...args),
}));

jest.mock("@/lib/auth", () => ({
  authOptions: {},
}));

jest.mock("@/lib/prisma", () => ({
  prisma: {
    researcherProfile: { findUnique: jest.fn() },
    matchPoolEntry: { count: jest.fn() },
    affiliationSelection: { count: jest.fn() },
  },
}));

jest.mock("@/components/sign-out-button", () => ({
  SignOutButton: () => <button>Sign Out</button>,
}));

jest.mock("@/components/proposal-tabs", () => ({
  ProposalTabs: () => <div data-testid="proposal-tabs">ProposalTabs</div>,
}));

import { prisma } from "@/lib/prisma";
import HomePage from "../page";

const mockProfileFind = jest.mocked(prisma.researcherProfile.findUnique);
const mockPoolCount = jest.mocked(prisma.matchPoolEntry.count);

/**
 * Set up mocks so the home page renders (user has profile + match pool).
 */
function setupAuthenticated(isAdmin: boolean) {
  mockGetServerSession.mockResolvedValue({
    user: { id: "user-1", orcid: "0000-0001-2345-6789", isAdmin },
  });
  mockProfileFind.mockResolvedValue({ id: "profile-1" } as never);
  mockPoolCount.mockResolvedValue(5 as never);
}

describe("HomePage", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  // Admin users should see an "Admin" link in the nav header
  // pointing to /admin so they can access the dashboard.
  it("shows Admin link in nav for admin users", async () => {
    setupAuthenticated(true);

    const jsx = await HomePage();
    render(jsx);

    const adminLink = screen.getByRole("link", { name: "Admin" });
    expect(adminLink).toBeInTheDocument();
    expect(adminLink).toHaveAttribute("href", "/admin");
  });

  // Non-admin users must NOT see the Admin link — it would lead
  // to a 403 redirect and confuse them.
  it("does not show Admin link for non-admin users", async () => {
    setupAuthenticated(false);

    const jsx = await HomePage();
    render(jsx);

    expect(screen.queryByRole("link", { name: "Admin" })).not.toBeInTheDocument();
  });

  // Verify the standard nav links are always present regardless of admin status.
  it("always shows Profile, Match Pool, and Settings links", async () => {
    setupAuthenticated(false);

    const jsx = await HomePage();
    render(jsx);

    expect(screen.getByRole("link", { name: "Profile" })).toHaveAttribute("href", "/profile/edit");
    expect(screen.getByRole("link", { name: "Match Pool" })).toHaveAttribute("href", "/match-pool");
    expect(screen.getByRole("link", { name: "Settings" })).toHaveAttribute("href", "/settings");
  });

  // Admin link should appear alongside other nav links, not replace them.
  it("shows Admin link alongside other nav links for admin users", async () => {
    setupAuthenticated(true);

    const jsx = await HomePage();
    render(jsx);

    expect(screen.getByRole("link", { name: "Profile" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Match Pool" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Settings" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Admin" })).toBeInTheDocument();
  });
});
