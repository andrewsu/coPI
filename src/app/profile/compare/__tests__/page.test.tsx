/**
 * @jest-environment jsdom
 */

/**
 * Tests for the profile comparison page (/profile/compare).
 *
 * Validates: loading state, redirect when no pending profile, side-by-side
 * display of current vs candidate, changed field highlighting, accept as-is
 * action, edit mode entry, dismiss action, and error handling.
 */

import React from "react";
import {
  render,
  screen,
  fireEvent,
  waitFor,
  act,
} from "@testing-library/react";
import "@testing-library/jest-dom";

// --- Mocks ---

const mockPush = jest.fn();
const mockReplace = jest.fn();
jest.mock("next/navigation", () => ({
  useRouter: () => ({
    push: mockPush,
    replace: mockReplace,
  }),
}));

let mockSessionStatus = "authenticated";
jest.mock("next-auth/react", () => ({
  useSession: () => ({ status: mockSessionStatus }),
}));

import ProfileComparePage from "../page";

/** Helper: generates a word string of exact length. */
function wordsOf(count: number): string {
  return Array.from({ length: count }, (_, i) => `word${i}`).join(" ");
}

/** Default comparison response from GET /api/profile/pending. */
const COMPARISON_DATA = {
  current: {
    researchSummary: wordsOf(180),
    techniques: ["RNA-seq", "CRISPR screening", "Mass spectrometry"],
    experimentalModels: ["Mouse", "HeLa cells"],
    diseaseAreas: ["Cancer biology"],
    keyTargets: ["p53"],
    keywords: ["transcriptomics"],
    grantTitles: ["NIH R01 Grant"],
  },
  candidate: {
    researchSummary: wordsOf(200),
    techniques: ["scRNA-seq", "CRISPR screening", "Spatial transcriptomics", "Flow cytometry"],
    experimentalModels: ["Mouse", "iPSC-derived neurons"],
    diseaseAreas: ["Neurodegeneration", "Alzheimer's disease"],
    keyTargets: ["Tau", "APP"],
    keywords: ["single-cell", "neuroinflammation"],
    grantTitles: ["NIH R01 Grant", "NIA P30 - ADRC"],
    generatedAt: "2026-02-15T10:00:00.000Z",
  },
  changedFields: [
    "researchSummary",
    "techniques",
    "experimentalModels",
    "diseaseAreas",
    "keyTargets",
    "keywords",
    "grantTitles",
  ],
  pendingProfileCreatedAt: "2026-02-15T00:00:00.000Z",
  profileVersion: 3,
};

beforeEach(() => {
  jest.clearAllMocks();
  mockSessionStatus = "authenticated";
});

it("shows loading state initially", async () => {
  /** Page should show a loading indicator before data is fetched. */
  global.fetch = jest.fn().mockImplementation(
    () => new Promise(() => {}), // never resolves
  );

  await act(async () => {
    render(<ProfileComparePage />);
  });

  expect(screen.getByText(/loading profile comparison/i)).toBeInTheDocument();
});

it("redirects to /profile/edit when no pending profile exists", async () => {
  /** If GET /api/profile/pending returns 404, the user should be
   * redirected to the profile edit page since there's nothing to compare. */
  global.fetch = jest.fn().mockResolvedValue({
    ok: false,
    status: 404,
    json: () => Promise.resolve({ error: "No pending profile update" }),
  });

  await act(async () => {
    render(<ProfileComparePage />);
  });

  await waitFor(() => {
    expect(mockReplace).toHaveBeenCalledWith("/profile/edit");
  });
});

it("displays current and candidate profiles side-by-side", async () => {
  /** When comparison data loads, both current and candidate profile
   * fields should be visible for comparison. */
  global.fetch = jest.fn().mockResolvedValue({
    ok: true,
    status: 200,
    json: () => Promise.resolve(COMPARISON_DATA),
  });

  await act(async () => {
    render(<ProfileComparePage />);
  });

  await waitFor(() => {
    expect(screen.getByText("Review Profile Update")).toBeInTheDocument();
  });

  // Changed fields summary should be shown
  expect(screen.getByText(/changed sections/i)).toBeInTheDocument();

  // Both column labels should appear (multiple "Current" and "Updated" labels)
  expect(screen.getAllByText("Current").length).toBeGreaterThan(0);
  expect(screen.getAllByText("Updated").length).toBeGreaterThan(0);

  // Action buttons should be present
  expect(screen.getByText("Accept as-is")).toBeInTheDocument();
  expect(screen.getByText("Edit & Accept")).toBeInTheDocument();
  expect(screen.getByText("Dismiss Update")).toBeInTheDocument();
});

it("shows 'Changed' badges for modified fields", async () => {
  /** Fields that differ between current and candidate should have
   * a visible 'Changed' indicator to help users focus on differences. */
  global.fetch = jest.fn().mockResolvedValue({
    ok: true,
    status: 200,
    json: () => Promise.resolve(COMPARISON_DATA),
  });

  await act(async () => {
    render(<ProfileComparePage />);
  });

  await waitFor(() => {
    // All 7 fields are changed, each gets a "Changed" badge
    const badges = screen.getAllByText("Changed");
    expect(badges.length).toBe(7);
  });
});

it("enters edit mode when 'Edit & Accept' is clicked", async () => {
  /** Clicking 'Edit & Accept' should switch to edit mode showing
   * editable fields and Cancel/Save buttons. */
  global.fetch = jest.fn().mockResolvedValue({
    ok: true,
    status: 200,
    json: () => Promise.resolve(COMPARISON_DATA),
  });

  await act(async () => {
    render(<ProfileComparePage />);
  });

  await waitFor(() => {
    expect(screen.getByText("Edit & Accept")).toBeInTheDocument();
  });

  await act(async () => {
    fireEvent.click(screen.getByText("Edit & Accept"));
  });

  // Edit mode buttons should appear
  expect(screen.getByText("Cancel Editing")).toBeInTheDocument();
  expect(screen.getByText("Save Edited Profile")).toBeInTheDocument();

  // Original accept button should be gone
  expect(screen.queryByText("Accept as-is")).not.toBeInTheDocument();
});

it("calls POST with action=accept on 'Accept as-is'", async () => {
  /** Accept as-is should POST to the pending endpoint with action=accept
   * and no field overrides, then redirect to profile edit. */
  const fetchMock = jest.fn().mockImplementation((_url: string, options?: RequestInit) => {
    if (options?.method === "POST") {
      return Promise.resolve({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ status: "accepted", profileVersion: 4 }),
      });
    }
    return Promise.resolve({
      ok: true,
      status: 200,
      json: () => Promise.resolve(COMPARISON_DATA),
    });
  });
  global.fetch = fetchMock;

  await act(async () => {
    render(<ProfileComparePage />);
  });

  await waitFor(() => {
    expect(screen.getByText("Accept as-is")).toBeInTheDocument();
  });

  await act(async () => {
    fireEvent.click(screen.getByText("Accept as-is"));
  });

  await waitFor(() => {
    // Verify POST call
    const postCall = fetchMock.mock.calls.find(
      (call: unknown[]) =>
        (call[1] as RequestInit | undefined)?.method === "POST",
    );
    expect(postCall).toBeDefined();
    const body = JSON.parse((postCall![1] as RequestInit).body as string);
    expect(body.action).toBe("accept");
    expect(body.fields).toBeUndefined();

    // Should redirect to profile edit
    expect(mockPush).toHaveBeenCalledWith("/profile/edit");
  });
});

it("calls POST with action=dismiss on 'Dismiss Update'", async () => {
  /** Dismiss should POST with action=dismiss and redirect to profile edit. */
  const fetchMock = jest.fn().mockImplementation((_url: string, options?: RequestInit) => {
    if (options?.method === "POST") {
      return Promise.resolve({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ status: "dismissed" }),
      });
    }
    return Promise.resolve({
      ok: true,
      status: 200,
      json: () => Promise.resolve(COMPARISON_DATA),
    });
  });
  global.fetch = fetchMock;

  await act(async () => {
    render(<ProfileComparePage />);
  });

  await waitFor(() => {
    expect(screen.getByText("Dismiss Update")).toBeInTheDocument();
  });

  await act(async () => {
    fireEvent.click(screen.getByText("Dismiss Update"));
  });

  await waitFor(() => {
    const postCall = fetchMock.mock.calls.find(
      (call: unknown[]) =>
        (call[1] as RequestInit | undefined)?.method === "POST",
    );
    expect(postCall).toBeDefined();
    const body = JSON.parse((postCall![1] as RequestInit).body as string);
    expect(body.action).toBe("dismiss");

    expect(mockPush).toHaveBeenCalledWith("/profile/edit");
  });
});

it("shows error message when fetch fails", async () => {
  /** Network errors should display an error message with a back button. */
  global.fetch = jest.fn().mockRejectedValue(new Error("Network error"));

  await act(async () => {
    render(<ProfileComparePage />);
  });

  await waitFor(() => {
    expect(screen.getByText("Network error")).toBeInTheDocument();
    expect(screen.getByText("Back to profile")).toBeInTheDocument();
  });
});

it("shows validation errors when accept with edits fails", async () => {
  /** If edited fields fail server-side validation, errors should
   * be displayed so the user can correct them. */
  const fetchMock = jest.fn().mockImplementation((_url: string, options?: RequestInit) => {
    if (options?.method === "POST") {
      return Promise.resolve({
        ok: false,
        status: 422,
        json: () =>
          Promise.resolve({
            error: "Validation failed",
            details: ["At least 3 techniques are required."],
          }),
      });
    }
    return Promise.resolve({
      ok: true,
      status: 200,
      json: () => Promise.resolve(COMPARISON_DATA),
    });
  });
  global.fetch = fetchMock;

  await act(async () => {
    render(<ProfileComparePage />);
  });

  await waitFor(() => {
    expect(screen.getByText("Edit & Accept")).toBeInTheDocument();
  });

  // Enter edit mode
  await act(async () => {
    fireEvent.click(screen.getByText("Edit & Accept"));
  });

  // Try to save
  await act(async () => {
    fireEvent.click(screen.getByText("Save Edited Profile"));
  });

  await waitFor(() => {
    expect(
      screen.getByText("At least 3 techniques are required."),
    ).toBeInTheDocument();
  });
});
