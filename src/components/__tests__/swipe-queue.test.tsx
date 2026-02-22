/**
 * @jest-environment jsdom
 */

/**
 * Tests for the SwipeQueue component.
 *
 * Validates: loading state, empty states (with/without match pool),
 * summary card rendering with all required fields (collaborator info,
 * collaboration type, one-line summary, confidence tier, updated badge),
 * queue navigation, error handling, and detail expansion.
 *
 * Spec reference: specs/swipe-interface.md
 */

import React from "react";
import {
  render,
  screen,
  waitFor,
  fireEvent,
  act,
} from "@testing-library/react";
import "@testing-library/jest-dom";
import { SwipeQueue, ProposalDetailView } from "../swipe-queue";
import type { ProposalCard, ProposalDetailData } from "../swipe-queue";

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

/** Sample detail data matching the /api/proposals/[id] response shape. */
function makeDetailData(
  overrides: Partial<ProposalDetailData> = {}
): ProposalDetailData {
  return {
    id: "proposal-1",
    title: "CRISPR + Proteomics Collaboration",
    collaborationType: "Methodological Enhancement",
    oneLineSummary: "Your CRISPR expertise...",
    confidenceTier: "high",
    isUpdated: false,
    createdAt: "2025-07-01T00:00:00.000Z",
    scientificQuestion:
      "Can CRISPR screens identify novel drug targets in breast cancer?",
    detailedRationale:
      "Combining CRISPR screening with quantitative proteomics offers a powerful approach to identifying previously unknown therapeutic targets.",
    yourContributions:
      "Lab A contributes CRISPR screening expertise and validated sgRNA libraries.",
    theirContributions:
      "Lab B contributes mass spectrometry platform and phosphoproteomics workflows.",
    yourBenefits:
      "Lab A gains proteomics-validated targets for downstream functional studies.",
    theirBenefits:
      "Lab B gains access to functional genomics screens for target prioritization.",
    proposedFirstExperiment:
      "Pilot CRISPR screen on 100 kinase targets with proteomics readout in MCF7 breast cancer cells.",
    anchoringPublications: [
      {
        id: "pub-1",
        pmid: "12345678",
        title: "Genome-wide CRISPR screen reveals kinase dependencies",
        journal: "Nature",
        year: 2024,
        authorPosition: "last",
      },
      {
        id: "pub-2",
        pmid: null,
        title: "Novel mass spec method without PMID",
        journal: "Proteomics",
        year: 2023,
        authorPosition: "first",
      },
    ],
    collaborator: {
      id: "user-zzz",
      name: "Dr. Zara Scientist",
      institution: "Stanford University",
      department: "Department of Chemistry",
      profile: {
        researchSummary:
          "Zara develops novel proteomics methods for cancer research.",
        techniques: ["mass spectrometry", "phosphoproteomics"],
        experimentalModels: ["patient-derived xenografts", "cell lines"],
        diseaseAreas: ["lung cancer", "breast cancer"],
        keyTargets: ["EGFR", "HER2"],
        grantTitles: [
          "NSF grant on proteomics",
          "NIH R01 on cancer biomarkers",
        ],
      },
      publications: [
        {
          id: "zara-pub-1",
          pmid: "87654321",
          title: "Quantitative phosphoproteomics in NSCLC",
          journal: "Science",
          year: 2025,
          authorPosition: "first",
        },
        {
          id: "zara-pub-2",
          pmid: "87654322",
          title: "TMT labeling for proteomics",
          journal: "Nature Methods",
          year: 2024,
          authorPosition: "last",
        },
      ],
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

/**
 * Mock fetch to return queue data on first call and detail data on second.
 * This supports testing the "See details" flow where the SwipeQueue first
 * fetches the queue list, then fetches detail data for a specific proposal.
 */
function mockFetchWithDetail(
  proposals: ProposalCard[],
  detail: ProposalDetailData
) {
  global.fetch = jest.fn().mockImplementation((url: string) => {
    if (typeof url === "string" && url.includes("/api/proposals/")) {
      // Detail fetch for a specific proposal
      return Promise.resolve({
        ok: true,
        json: async () => detail,
      });
    }
    // Queue fetch
    return Promise.resolve({
      ok: true,
      json: async () => ({ proposals, totalCount: proposals.length }),
    });
  });
}

describe("SwipeQueue", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockUseSession.mockReturnValue({
      data: {
        user: {
          id: "user-aaa",
          name: "Alice",
          orcid: "0000-0001-0000-0001",
        },
        expires: "",
      },
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
        screen.getByText("Add colleagues to your network")
      ).toBeInTheDocument();
    });
    expect(
      screen.getByText(
        "Add colleagues to your network to start seeing collaboration proposals."
      )
    ).toBeInTheDocument();
  });

  it("shows generating state for users with match pool but no proposals", async () => {
    /** Users with a match pool but no proposals yet see a "generating" message. */
    mockFetchWith([]);
    render(<SwipeQueue hasMatchPool={true} />);

    await waitFor(() => {
      expect(
        screen.getByText("Generating proposals for you")
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
    expect(screen.getByText(/Stanford University/)).toBeInTheDocument();
    expect(
      screen.getByText(/Department of Chemistry/)
    ).toBeInTheDocument();
  });

  it("renders collaboration type label", async () => {
    /** Collaboration type helps users quickly categorize the proposal. */
    mockFetchWith([makeProposal()]);
    render(<SwipeQueue hasMatchPool={true} />);

    await waitFor(() => {
      expect(
        screen.getByText("Methodological Enhancement")
      ).toBeInTheDocument();
    });
  });

  it("renders tailored one-line summary", async () => {
    /** The one-line summary is the main content of the card, tailored to the user's perspective. */
    mockFetchWith([makeProposal()]);
    render(<SwipeQueue hasMatchPool={true} />);

    await waitFor(() => {
      expect(
        screen.getByText(
          /Your CRISPR expertise combined with their proteomics/
        )
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
      makeProposal({
        id: "p2",
        collaborator: {
          id: "u2",
          name: "Bob",
          institution: "MIT",
          department: null,
        },
      }),
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

  it("shows Interested and Archive swipe action buttons", async () => {
    /** Swipe actions replace the old navigation buttons per spec. */
    mockFetchWith([makeProposal()]);
    render(<SwipeQueue hasMatchPool={true} />);

    await waitFor(() => {
      expect(screen.getByText("Dr. Zara Scientist")).toBeInTheDocument();
    });

    expect(screen.getByText("Interested")).toBeInTheDocument();
    expect(screen.getByText("Archive")).toBeInTheDocument();
  });

  it("removes card from queue after archive swipe", async () => {
    /** Archiving a proposal removes it from the queue and shows the next card
     *  or empty state. */
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

    // First call is queue fetch, subsequent calls are swipe POST
    let callCount = 0;
    global.fetch = jest.fn().mockImplementation((_url: string, opts?: RequestInit) => {
      callCount++;
      if (opts?.method === "POST") {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            swipe: { id: "s1", direction: "archive", viewedDetail: false, timeSpentMs: null },
            matched: false,
          }),
        });
      }
      return Promise.resolve({
        ok: true,
        json: async () => ({ proposals, totalCount: proposals.length }),
      });
    });

    render(<SwipeQueue hasMatchPool={true} />);

    await waitFor(() => {
      expect(screen.getByText("Dr. Zara Scientist")).toBeInTheDocument();
    });
    expect(screen.getByText("1 of 2 proposals")).toBeInTheDocument();

    await act(async () => {
      fireEvent.click(screen.getByText("Archive"));
    });

    // After archiving, the card is removed and we see the remaining card
    await waitFor(() => {
      expect(screen.getByText("Dr. Bob Expert")).toBeInTheDocument();
    });
    expect(screen.getByText("1 of 1 proposal")).toBeInTheDocument();
  });

  it("shows match banner when interested swipe creates a match", async () => {
    /** When both users are interested, a match banner appears briefly. */
    global.fetch = jest.fn().mockImplementation((_url: string, opts?: RequestInit) => {
      if (opts?.method === "POST") {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            swipe: { id: "s1", direction: "interested", viewedDetail: false, timeSpentMs: null },
            matched: true,
            matchId: "match-1",
          }),
        });
      }
      return Promise.resolve({
        ok: true,
        json: async () => ({
          proposals: [makeProposal()],
          totalCount: 1,
        }),
      });
    });

    render(<SwipeQueue hasMatchPool={true} />);

    await waitFor(() => {
      expect(screen.getByText("Dr. Zara Scientist")).toBeInTheDocument();
    });

    await act(async () => {
      fireEvent.click(screen.getByText("Interested"));
    });

    // Match banner should appear
    await waitFor(() => {
      expect(
        screen.getByText(/Match! You and Dr. Zara Scientist are both interested/)
      ).toBeInTheDocument();
    });
  });

  it("shows 'all caught up' empty state after swiping all proposals", async () => {
    /** After the user swipes on all proposals, they see the "all caught up" message. */
    global.fetch = jest.fn().mockImplementation((_url: string, opts?: RequestInit) => {
      if (opts?.method === "POST") {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            swipe: { id: "s1", direction: "archive", viewedDetail: false, timeSpentMs: null },
            matched: false,
          }),
        });
      }
      return Promise.resolve({
        ok: true,
        json: async () => ({
          proposals: [makeProposal()],
          totalCount: 1,
        }),
      });
    });

    render(<SwipeQueue hasMatchPool={true} />);

    await waitFor(() => {
      expect(screen.getByText("Dr. Zara Scientist")).toBeInTheDocument();
    });

    await act(async () => {
      fireEvent.click(screen.getByText("Archive"));
    });

    // Should show "all caught up" empty state
    await waitFor(() => {
      expect(screen.getByText("All caught up")).toBeInTheDocument();
    });
  });

  it("sends correct swipe data including viewedDetail and timeSpentMs", async () => {
    /** The swipe API call should include analytics data: viewedDetail and timeSpentMs. */
    const fetchSpy = jest.fn().mockImplementation((_url: string, opts?: RequestInit) => {
      if (opts?.method === "POST") {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            swipe: { id: "s1", direction: "interested", viewedDetail: true, timeSpentMs: 5000 },
            matched: false,
          }),
        });
      }
      return Promise.resolve({
        ok: true,
        json: async () => ({
          proposals: [makeProposal()],
          totalCount: 1,
        }),
      });
    });
    global.fetch = fetchSpy;

    render(<SwipeQueue hasMatchPool={true} />);

    await waitFor(() => {
      expect(screen.getByText("Dr. Zara Scientist")).toBeInTheDocument();
    });

    await act(async () => {
      fireEvent.click(screen.getByText("Interested"));
    });

    // Find the POST call (not the initial GET)
    const postCall = fetchSpy.mock.calls.find(
      ([, opts]: [string, RequestInit | undefined]) => opts?.method === "POST"
    );
    expect(postCall).toBeDefined();
    const body = JSON.parse(postCall![1]!.body as string);
    expect(body.direction).toBe("interested");
    expect(body.viewedDetail).toBe(false); // detail was not expanded
    expect(typeof body.timeSpentMs).toBe("number");
  });

  it("shows error state with retry button on fetch failure", async () => {
    /** Network errors should be shown with a retry option. */
    global.fetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 500,
    });
    render(<SwipeQueue hasMatchPool={true} />);

    await waitFor(() => {
      expect(
        screen.getByText("Failed to load proposals")
      ).toBeInTheDocument();
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
    mockFetchWith([
      makeProposal({ title: "CRISPR + Proteomics Collaboration" }),
    ]);
    render(<SwipeQueue hasMatchPool={true} />);

    await waitFor(() => {
      expect(
        screen.getByText("CRISPR + Proteomics Collaboration")
      ).toBeInTheDocument();
    });
  });

  // --- Detail Expansion Tests ---

  it("shows 'See details' button on summary card", async () => {
    /** Per spec, every summary card has a "See details" button. */
    mockFetchWith([makeProposal()]);
    render(<SwipeQueue hasMatchPool={true} />);

    await waitFor(() => {
      expect(screen.getByText("See details")).toBeInTheDocument();
    });
  });

  it("shows detail view when 'See details' is clicked", async () => {
    /** Clicking "See details" fetches and displays the full proposal detail. */
    const detail = makeDetailData();
    mockFetchWithDetail([makeProposal()], detail);
    render(<SwipeQueue hasMatchPool={true} />);

    await waitFor(() => {
      expect(screen.getByText("See details")).toBeInTheDocument();
    });

    await act(async () => {
      fireEvent.click(screen.getByText("See details"));
    });

    // Button should change to "Hide details"
    expect(screen.getByText("Hide details")).toBeInTheDocument();

    // Wait for detail to load and display
    await waitFor(() => {
      expect(screen.getByText("Scientific Question")).toBeInTheDocument();
    });
  });

  it("collapses detail view when 'Hide details' is clicked", async () => {
    /** Users can collapse the detail view to return to summary-only view. */
    const detail = makeDetailData();
    mockFetchWithDetail([makeProposal()], detail);
    render(<SwipeQueue hasMatchPool={true} />);

    await waitFor(() => {
      expect(screen.getByText("See details")).toBeInTheDocument();
    });

    // Expand
    await act(async () => {
      fireEvent.click(screen.getByText("See details"));
    });

    await waitFor(() => {
      expect(screen.getByText("Scientific Question")).toBeInTheDocument();
    });

    // Collapse
    await act(async () => {
      fireEvent.click(screen.getByText("Hide details"));
    });

    expect(screen.getByText("See details")).toBeInTheDocument();
    expect(screen.queryByText("Scientific Question")).not.toBeInTheDocument();
  });

  it("collapses detail view when swiping to next card", async () => {
    /** When swiping on a card, the detail view should collapse and the next card is shown. */
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

    global.fetch = jest.fn().mockImplementation((_url: string, opts?: RequestInit) => {
      if (opts?.method === "POST") {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            swipe: { id: "s1", direction: "archive", viewedDetail: true, timeSpentMs: null },
            matched: false,
          }),
        });
      }
      // For detail fetches (contains /api/proposals/ with an ID)
      if (typeof _url === "string" && /\/api\/proposals\/p\d+$/.test(_url)) {
        return Promise.resolve({
          ok: true,
          json: async () => makeDetailData(),
        });
      }
      // Queue fetch
      return Promise.resolve({
        ok: true,
        json: async () => ({ proposals, totalCount: proposals.length }),
      });
    });

    render(<SwipeQueue hasMatchPool={true} />);

    await waitFor(() => {
      expect(screen.getByText("See details")).toBeInTheDocument();
    });

    // Expand detail on first card
    await act(async () => {
      fireEvent.click(screen.getByText("See details"));
    });

    await waitFor(() => {
      expect(screen.getByText("Scientific Question")).toBeInTheDocument();
    });

    // Swipe to archive the card (advances to next)
    await act(async () => {
      fireEvent.click(screen.getByText("Archive"));
    });

    // Detail should be collapsed, next card should be shown
    await waitFor(() => {
      expect(screen.getByText("Dr. Bob Expert")).toBeInTheDocument();
    });
    expect(screen.getByText("See details")).toBeInTheDocument();
    expect(screen.queryByText("Scientific Question")).not.toBeInTheDocument();
  });
});

describe("ProposalDetailView", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("shows loading state while fetching", () => {
    /** Users see a loading indicator while detail data is being fetched. */
    global.fetch = jest.fn().mockReturnValue(new Promise(() => {})); // never resolves
    render(<ProposalDetailView proposalId="proposal-1" />);

    expect(screen.getByText("Loading details...")).toBeInTheDocument();
  });

  it("shows error state on fetch failure", async () => {
    /** Network errors should be displayed to the user. */
    global.fetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 500,
    });
    render(<ProposalDetailView proposalId="proposal-1" />);

    await waitFor(() => {
      expect(
        screen.getByText("Failed to load proposal details")
      ).toBeInTheDocument();
    });
  });

  it("renders scientific question in styled callout", async () => {
    /** The scientific question is the central focus of the detail view. */
    const detail = makeDetailData();
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => detail,
    });
    render(<ProposalDetailView proposalId="proposal-1" />);

    await waitFor(() => {
      expect(screen.getByText("Scientific Question")).toBeInTheDocument();
    });
    expect(
      screen.getByText(
        "Can CRISPR screens identify novel drug targets in breast cancer?"
      )
    ).toBeInTheDocument();
  });

  it("renders detailed rationale", async () => {
    /** The rationale explains why this collaboration makes sense. */
    const detail = makeDetailData();
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => detail,
    });
    render(<ProposalDetailView proposalId="proposal-1" />);

    await waitFor(() => {
      expect(screen.getByText("Rationale")).toBeInTheDocument();
    });
    expect(
      screen.getByText(/Combining CRISPR screening with quantitative/)
    ).toBeInTheDocument();
  });

  it("renders contributions mapped to user perspective", async () => {
    /** Contributions are shown as "What you bring" / "What they bring". */
    const detail = makeDetailData();
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => detail,
    });
    render(<ProposalDetailView proposalId="proposal-1" />);

    await waitFor(() => {
      expect(screen.getByText("What you bring")).toBeInTheDocument();
    });
    expect(screen.getByText("What they bring")).toBeInTheDocument();
    expect(
      screen.getByText(/Lab A contributes CRISPR screening/)
    ).toBeInTheDocument();
    expect(
      screen.getByText(/Lab B contributes mass spectrometry/)
    ).toBeInTheDocument();
  });

  it("renders benefits mapped to user perspective", async () => {
    /** Benefits are shown as "What you gain" / "What they gain". */
    const detail = makeDetailData();
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => detail,
    });
    render(<ProposalDetailView proposalId="proposal-1" />);

    await waitFor(() => {
      expect(screen.getByText("What you gain")).toBeInTheDocument();
    });
    expect(screen.getByText("What they gain")).toBeInTheDocument();
    expect(
      screen.getByText(/Lab A gains proteomics-validated targets/)
    ).toBeInTheDocument();
    expect(
      screen.getByText(/Lab B gains access to functional genomics/)
    ).toBeInTheDocument();
  });

  it("renders proposed first experiment", async () => {
    /** The first experiment section describes a concrete pilot study. */
    const detail = makeDetailData();
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => detail,
    });
    render(<ProposalDetailView proposalId="proposal-1" />);

    await waitFor(() => {
      expect(
        screen.getByText("Proposed First Experiment")
      ).toBeInTheDocument();
    });
    expect(
      screen.getByText(/Pilot CRISPR screen on 100 kinase targets/)
    ).toBeInTheDocument();
  });

  it("renders anchoring publications with PubMed links", async () => {
    /** Publications with PMIDs should link to PubMed; those without should
     *  render as plain text. */
    const detail = makeDetailData();
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => detail,
    });
    render(<ProposalDetailView proposalId="proposal-1" />);

    await waitFor(() => {
      expect(screen.getByText("Key Publications")).toBeInTheDocument();
    });

    // Publication with PMID should be a link
    const pubWithLink = screen.getByText(
      "Genome-wide CRISPR screen reveals kinase dependencies"
    );
    expect(pubWithLink.tagName).toBe("A");
    expect(pubWithLink).toHaveAttribute(
      "href",
      "https://pubmed.ncbi.nlm.nih.gov/12345678/"
    );

    // Publication without PMID should be plain text
    const pubWithoutLink = screen.getByText(
      "Novel mass spec method without PMID"
    );
    expect(pubWithoutLink.tagName).toBe("SPAN");
  });

  it("hides Key Publications section when no anchoring publications", async () => {
    /** If there are no anchoring publications, the section should not render. */
    const detail = makeDetailData({ anchoringPublications: [] });
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => detail,
    });
    render(<ProposalDetailView proposalId="proposal-1" />);

    await waitFor(() => {
      expect(screen.getByText("Rationale")).toBeInTheDocument();
    });
    expect(screen.queryByText("Key Publications")).not.toBeInTheDocument();
  });

  it("renders collaborator profile with research summary and tags", async () => {
    /** The collaborator's public profile helps users understand the potential partner. */
    const detail = makeDetailData();
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => detail,
    });
    render(<ProposalDetailView proposalId="proposal-1" />);

    await waitFor(() => {
      expect(
        screen.getByText("About Dr. Zara Scientist")
      ).toBeInTheDocument();
    });

    // Research summary
    expect(
      screen.getByText(
        "Zara develops novel proteomics methods for cancer research."
      )
    ).toBeInTheDocument();

    // Techniques as tags
    expect(screen.getByText("mass spectrometry")).toBeInTheDocument();
    expect(screen.getByText("phosphoproteomics")).toBeInTheDocument();

    // Experimental models
    expect(screen.getByText("patient-derived xenografts")).toBeInTheDocument();

    // Disease areas
    expect(screen.getByText("lung cancer")).toBeInTheDocument();

    // Key targets
    expect(screen.getByText("EGFR")).toBeInTheDocument();

    // Grants
    expect(screen.getByText("NSF grant on proteomics")).toBeInTheDocument();
  });

  it("renders collaborator publications with PubMed links", async () => {
    /** The collaborator's publications help validate their expertise. */
    const detail = makeDetailData();
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => detail,
    });
    render(<ProposalDetailView proposalId="proposal-1" />);

    await waitFor(() => {
      expect(
        screen.getByText("About Dr. Zara Scientist")
      ).toBeInTheDocument();
    });

    const pub = screen.getByText("Quantitative phosphoproteomics in NSCLC");
    expect(pub.tagName).toBe("A");
    expect(pub).toHaveAttribute(
      "href",
      "https://pubmed.ncbi.nlm.nih.gov/87654321/"
    );
  });

  it("shows fallback when collaborator has no profile", async () => {
    /** If the collaborator's profile is null (e.g., account deleted),
     *  show an appropriate message. */
    const detail = makeDetailData({
      collaborator: {
        id: "user-zzz",
        name: "Dr. Zara Scientist",
        institution: "Stanford University",
        department: null,
        profile: null,
        publications: [],
      },
    });
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => detail,
    });
    render(<ProposalDetailView proposalId="proposal-1" />);

    await waitFor(() => {
      expect(
        screen.getByText("About Dr. Zara Scientist")
      ).toBeInTheDocument();
    });
    expect(
      screen.getByText("Profile information is not available.")
    ).toBeInTheDocument();
  });

  it("fetches detail from the correct API endpoint", async () => {
    /** The component should request /api/proposals/[id] for the given proposal ID. */
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => makeDetailData(),
    });
    render(<ProposalDetailView proposalId="my-proposal-id" />);

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith(
        "/api/proposals/my-proposal-id"
      );
    });
  });
});
