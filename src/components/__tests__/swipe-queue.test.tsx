/**
 * @jest-environment jsdom
 */

/**
 * Tests for the SwipeQueue component.
 *
 * Validates: loading state, empty states (with/without match pool),
 * summary card rendering with all required fields (collaborator info,
 * collaboration type, one-line summary, confidence tier, updated badge),
 * queue navigation, and error handling.
 *
 * Spec reference: specs/swipe-interface.md
 */

import React from "react";
import { render, screen, waitFor, fireEvent, act } from "@testing-library/react";
import "@testing-library/jest-dom";
import { SwipeQueue } from "../swipe-queue";
import type { ProposalCard } from "../swipe-queue";

// Mock next-auth/react
jest.mock("next-auth/react", () => ({
  useSession: jest.fn(),
}));

import { useSession } from "next-auth/react";
const mockUseSession = jest.mocked(useSession);

/** Sample proposal matching the API response shape. */
function makeProposal(overrides: Partial<ProposalCard> = {}): ProposalCard {
  return {
    id: "proposal-1",
    title: "CRISPR + Proteomics Collaboration",
    collaborationType: "Methodological Enhancement",
    oneLineSummary:
      "Your CRISPR expertise combined with their proteomics platform could identify novel drug targets in breast cancer.",
    confidenceTier: "high",
    isUpdated: false,
    createdAt: "2025-07-01T00:00:00.000Z",
    collaborator: {
      id: "user-zzz",
      name: "Dr. Zara Scientist",
      institution: "Stanford University",
      department: "Department of Chemistry",
    },
    ...overrides,
  };
}

/** Mock the global fetch to return proposal data. */
function mockFetchWith(proposals: ProposalCard[]) {
  global.fetch = jest.fn().mockResolvedValue({
    ok: true,
    json: async () => ({ proposals, totalCount: proposals.length }),
  });
}

describe("SwipeQueue", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockUseSession.mockReturnValue({
      data: { user: { id: "user-aaa", name: "Alice", orcid: "0000-0001-0000-0001" }, expires: "" },
      status: "authenticated",
      update: jest.fn(),
    });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("shows loading state initially", () => {
    /** Users see a loading indicator while proposals are fetched. */
    mockUseSession.mockReturnValue({
      data: null,
      status: "loading",
      update: jest.fn(),
    });
    render(<SwipeQueue hasMatchPool={true} />);
    expect(screen.getByText("Loading proposals...")).toBeInTheDocument();
  });

  it("shows empty state for users with no match pool", async () => {
    /** Users without a match pool see a prompt to add colleagues. */
    mockFetchWith([]);
    render(<SwipeQueue hasMatchPool={false} />);

    await waitFor(() => {
      expect(
        screen.getByText("Add colleagues to your network"),
      ).toBeInTheDocument();
    });
    expect(
      screen.getByText(
        "Add colleagues to your network to start seeing collaboration proposals.",
      ),
    ).toBeInTheDocument();
  });

  it("shows generating state for users with match pool but no proposals", async () => {
    /** Users with a match pool but no proposals yet see a "generating" message. */
    mockFetchWith([]);
    render(<SwipeQueue hasMatchPool={true} />);

    await waitFor(() => {
      expect(
        screen.getByText("Generating proposals for you"),
      ).toBeInTheDocument();
    });
  });

  it("renders summary card with collaborator name and institution", async () => {
    /** The card must show the collaborator's name and institution for context. */
    mockFetchWith([makeProposal()]);
    render(<SwipeQueue hasMatchPool={true} />);

    await waitFor(() => {
      expect(screen.getByText("Dr. Zara Scientist")).toBeInTheDocument();
    });
    expect(
      screen.getByText(/Stanford University/),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/Department of Chemistry/),
    ).toBeInTheDocument();
  });

  it("renders collaboration type label", async () => {
    /** Collaboration type helps users quickly categorize the proposal. */
    mockFetchWith([makeProposal()]);
    render(<SwipeQueue hasMatchPool={true} />);

    await waitFor(() => {
      expect(
        screen.getByText("Methodological Enhancement"),
      ).toBeInTheDocument();
    });
  });

  it("renders tailored one-line summary", async () => {
    /** The one-line summary is the main content of the card, tailored to the user's perspective. */
    mockFetchWith([makeProposal()]);
    render(<SwipeQueue hasMatchPool={true} />);

    await waitFor(() => {
      expect(
        screen.getByText(/Your CRISPR expertise combined with their proteomics/),
      ).toBeInTheDocument();
    });
  });

  it("renders confidence tier indicator", async () => {
    /** Visual indicator of proposal quality helps users prioritize review. */
    mockFetchWith([makeProposal({ confidenceTier: "high" })]);
    render(<SwipeQueue hasMatchPool={true} />);

    await waitFor(() => {
      expect(screen.getByText("High confidence")).toBeInTheDocument();
    });
  });

  it("renders moderate confidence tier indicator", async () => {
    /** Moderate confidence proposals show amber indicator. */
    mockFetchWith([makeProposal({ confidenceTier: "moderate" })]);
    render(<SwipeQueue hasMatchPool={true} />);

    await waitFor(() => {
      expect(screen.getByText("Moderate confidence")).toBeInTheDocument();
    });
  });

  it("renders speculative confidence tier indicator", async () => {
    /** Speculative proposals show purple indicator. */
    mockFetchWith([makeProposal({ confidenceTier: "speculative" })]);
    render(<SwipeQueue hasMatchPool={true} />);

    await waitFor(() => {
      expect(screen.getByText("Speculative")).toBeInTheDocument();
    });
  });

  it("shows 'Updated proposal' badge when isUpdated is true", async () => {
    /** Regenerated proposals for previously archived pairs should be clearly labeled. */
    mockFetchWith([makeProposal({ isUpdated: true })]);
    render(<SwipeQueue hasMatchPool={true} />);

    await waitFor(() => {
      expect(screen.getByText("Updated proposal")).toBeInTheDocument();
    });
  });

  it("does not show 'Updated proposal' badge when isUpdated is false", async () => {
    /** Regular proposals should not display the update badge. */
    mockFetchWith([makeProposal({ isUpdated: false })]);
    render(<SwipeQueue hasMatchPool={true} />);

    await waitFor(() => {
      expect(screen.getByText("Dr. Zara Scientist")).toBeInTheDocument();
    });
    expect(screen.queryByText("Updated proposal")).not.toBeInTheDocument();
  });

  it("shows queue counter with current position", async () => {
    /** Users need to know how many proposals are in their queue. */
    mockFetchWith([
      makeProposal({ id: "p1" }),
      makeProposal({ id: "p2", collaborator: { id: "u2", name: "Bob", institution: "MIT", department: null } }),
    ]);
    render(<SwipeQueue hasMatchPool={true} />);

    await waitFor(() => {
      expect(screen.getByText("1 of 2 proposals")).toBeInTheDocument();
    });
  });

  it("shows singular 'proposal' for single item queue", async () => {
    /** Grammar: "1 of 1 proposal" not "1 of 1 proposals". */
    mockFetchWith([makeProposal()]);
    render(<SwipeQueue hasMatchPool={true} />);

    await waitFor(() => {
      expect(screen.getByText("1 of 1 proposal")).toBeInTheDocument();
    });
  });

  it("navigates to next proposal via Next button", async () => {
    /** Users can browse through the queue using navigation buttons. */
    const proposals = [
      makeProposal({ id: "p1" }),
      makeProposal({
        id: "p2",
        collaborator: {
          id: "u2",
          name: "Dr. Bob Expert",
          institution: "MIT",
          department: null,
        },
      }),
    ];
    mockFetchWith(proposals);
    render(<SwipeQueue hasMatchPool={true} />);

    await waitFor(() => {
      expect(screen.getByText("Dr. Zara Scientist")).toBeInTheDocument();
    });

    await act(async () => {
      fireEvent.click(screen.getByText("Next"));
    });

    expect(screen.getByText("Dr. Bob Expert")).toBeInTheDocument();
    expect(screen.getByText("2 of 2 proposals")).toBeInTheDocument();
  });

  it("navigates back via Previous button", async () => {
    /** Users can go back to previous cards in the queue. */
    const proposals = [
      makeProposal({ id: "p1" }),
      makeProposal({
        id: "p2",
        collaborator: {
          id: "u2",
          name: "Dr. Bob Expert",
          institution: "MIT",
          department: null,
        },
      }),
    ];
    mockFetchWith(proposals);
    render(<SwipeQueue hasMatchPool={true} />);

    await waitFor(() => {
      expect(screen.getByText("Dr. Zara Scientist")).toBeInTheDocument();
    });

    await act(async () => {
      fireEvent.click(screen.getByText("Next"));
    });
    expect(screen.getByText("Dr. Bob Expert")).toBeInTheDocument();

    await act(async () => {
      fireEvent.click(screen.getByText("Previous"));
    });
    expect(screen.getByText("Dr. Zara Scientist")).toBeInTheDocument();
    expect(screen.getByText("1 of 2 proposals")).toBeInTheDocument();
  });

  it("disables Previous button on first card", async () => {
    /** Can't go back past the first card. */
    mockFetchWith([makeProposal({ id: "p1" }), makeProposal({ id: "p2" })]);
    render(<SwipeQueue hasMatchPool={true} />);

    await waitFor(() => {
      expect(screen.getByText("Previous")).toBeInTheDocument();
    });

    expect(screen.getByText("Previous")).toBeDisabled();
  });

  it("disables Next button on last card", async () => {
    /** Can't advance past the last card. */
    mockFetchWith([makeProposal({ id: "p1" }), makeProposal({ id: "p2" })]);
    render(<SwipeQueue hasMatchPool={true} />);

    await waitFor(() => {
      expect(screen.getByText("Next")).toBeInTheDocument();
    });

    await act(async () => {
      fireEvent.click(screen.getByText("Next"));
    });

    expect(screen.getByText("Next")).toBeDisabled();
  });

  it("does not show navigation buttons for single proposal", async () => {
    /** No navigation needed when there's only one proposal. */
    mockFetchWith([makeProposal()]);
    render(<SwipeQueue hasMatchPool={true} />);

    await waitFor(() => {
      expect(screen.getByText("Dr. Zara Scientist")).toBeInTheDocument();
    });

    expect(screen.queryByText("Previous")).not.toBeInTheDocument();
    expect(screen.queryByText("Next")).not.toBeInTheDocument();
  });

  it("shows error state with retry button on fetch failure", async () => {
    /** Network errors should be shown with a retry option. */
    global.fetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 500,
    });
    render(<SwipeQueue hasMatchPool={true} />);

    await waitFor(() => {
      expect(screen.getByText("Failed to load proposals")).toBeInTheDocument();
    });
    expect(screen.getByText("Retry")).toBeInTheDocument();
  });

  it("handles collaborator without department gracefully", async () => {
    /** Some researchers don't have a department set. */
    mockFetchWith([
      makeProposal({
        collaborator: {
          id: "u2",
          name: "Dr. Bob",
          institution: "MIT",
          department: null,
        },
      }),
    ]);
    render(<SwipeQueue hasMatchPool={true} />);

    await waitFor(() => {
      expect(screen.getByText("Dr. Bob")).toBeInTheDocument();
    });
    // Should show institution without the separator dot
    expect(screen.getByText("MIT")).toBeInTheDocument();
  });

  it("renders proposal title in the card", async () => {
    /** The proposal title provides additional context about the collaboration. */
    mockFetchWith([makeProposal({ title: "CRISPR + Proteomics Collaboration" })]);
    render(<SwipeQueue hasMatchPool={true} />);

    await waitFor(() => {
      expect(
        screen.getByText("CRISPR + Proteomics Collaboration"),
      ).toBeInTheDocument();
    });
  });
});
