/**
 * @jest-environment jsdom
 */

/**
 * Tests for the submitted texts management page (/profile/submitted-texts).
 *
 * Validates the full CRUD flow for user-submitted texts: loading state,
 * displaying existing texts, adding new texts, editing existing texts,
 * deleting texts, max entry enforcement, save/discard flow, and error
 * handling. Uses mocked fetch to simulate API interactions.
 */

import React from "react";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";
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

import SubmittedTextsPage from "../page";

const EXISTING_TEXTS = [
  {
    label: "R01 specific aims",
    content: "Our lab studies the role of p53 in tumor suppression through CRISPR screening.",
    submitted_at: "2025-01-15T00:00:00.000Z",
  },
  {
    label: "Current interests",
    content: "We are interested in developing new approaches to cancer immunotherapy.",
    submitted_at: "2025-02-01T00:00:00.000Z",
  },
];

function mockFetchTexts(texts = EXISTING_TEXTS) {
  global.fetch = jest.fn().mockResolvedValue({
    ok: true,
    status: 200,
    json: () => Promise.resolve({ texts }),
  });
}

function mockFetchEmpty() {
  global.fetch = jest.fn().mockResolvedValue({
    ok: true,
    status: 200,
    json: () => Promise.resolve({ texts: [] }),
  });
}

function mockFetchNotFound() {
  global.fetch = jest.fn().mockResolvedValue({
    ok: false,
    status: 404,
    json: () => Promise.resolve({ error: "Profile not found" }),
  });
}

function mockFetchError() {
  global.fetch = jest.fn().mockRejectedValue(new Error("Network error"));
}

describe("SubmittedTextsPage", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockSessionStatus = "authenticated";
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("shows loading state while session is loading", () => {
    /** Users see a loading indicator while auth session is being checked. */
    mockSessionStatus = "loading";
    mockFetchEmpty();
    render(<SubmittedTextsPage />);
    expect(screen.getByText("Loading...")).toBeInTheDocument();
  });

  it("shows loading state while texts are being fetched", () => {
    /** Loading indicator shown while GET is in flight. */
    global.fetch = jest.fn().mockReturnValue(new Promise(() => {}));
    render(<SubmittedTextsPage />);
    expect(screen.getByText("Loading...")).toBeInTheDocument();
  });

  it("redirects to /onboarding when profile not found (404)", async () => {
    /** Users without a profile should be redirected to onboarding. */
    mockFetchNotFound();
    render(<SubmittedTextsPage />);
    await waitFor(() => {
      expect(mockReplace).toHaveBeenCalledWith("/onboarding");
    });
  });

  it("shows error state when fetch fails", async () => {
    /** Network errors are displayed with a back-to-profile button. */
    mockFetchError();
    render(<SubmittedTextsPage />);
    await waitFor(() => {
      expect(screen.getByText("Network error")).toBeInTheDocument();
    });
    expect(screen.getByText("Back to profile")).toBeInTheDocument();
  });

  it("renders existing submitted texts", async () => {
    /** All existing texts are displayed with their labels and content. */
    mockFetchTexts();
    render(<SubmittedTextsPage />);
    await waitFor(() => {
      expect(screen.getByText("R01 specific aims")).toBeInTheDocument();
    });
    expect(screen.getByText("Current interests")).toBeInTheDocument();
    expect(screen.getByText("2 of 5 texts used")).toBeInTheDocument();
  });

  it("shows empty state when no texts exist", async () => {
    /** Empty state message encourages users to add texts. */
    mockFetchEmpty();
    render(<SubmittedTextsPage />);
    await waitFor(() => {
      expect(screen.getByText(/No submitted texts yet/)).toBeInTheDocument();
    });
  });

  it("shows privacy notice", async () => {
    /** Privacy notice informs users that texts are never shared. */
    mockFetchTexts();
    render(<SubmittedTextsPage />);
    await waitFor(() => {
      expect(screen.getByText(/never shown to other/)).toBeInTheDocument();
    });
  });

  it("shows Add Text button when under max entries", async () => {
    /** Add button visible when fewer than 5 texts exist. */
    mockFetchTexts();
    render(<SubmittedTextsPage />);
    await waitFor(() => {
      expect(screen.getByText("Add Text")).toBeInTheDocument();
    });
  });

  it("hides Add Text button when at max entries", async () => {
    /** Cannot add more than 5 texts per spec. */
    const fiveTexts = Array.from({ length: 5 }, (_, i) => ({
      label: `Text ${i + 1}`,
      content: "Content here.",
      submitted_at: "2025-01-01T00:00:00.000Z",
    }));
    mockFetchTexts(fiveTexts);
    render(<SubmittedTextsPage />);
    await waitFor(() => {
      expect(screen.getByText("5 of 5 texts used")).toBeInTheDocument();
    });
    expect(screen.queryByText("Add Text")).not.toBeInTheDocument();
  });

  it("opens add form and adds a new text", async () => {
    /** Users can add a new text via the add form. */
    mockFetchEmpty();
    render(<SubmittedTextsPage />);
    await waitFor(() => {
      expect(screen.getByText("Add Text")).toBeInTheDocument();
    });

    // Click Add Text
    fireEvent.click(screen.getByText("Add Text"));

    // Fill in form
    expect(screen.getByText("New Submission")).toBeInTheDocument();
    fireEvent.change(screen.getByTestId("edit-label"), {
      target: { value: "My aims" },
    });
    fireEvent.change(screen.getByTestId("edit-content"), {
      target: { value: "We study cancer biology." },
    });

    // Confirm add
    fireEvent.click(screen.getByText("Add"));

    // Entry should appear
    expect(screen.getByText("My aims")).toBeInTheDocument();
    expect(screen.getByText("1 of 5 texts used")).toBeInTheDocument();
  });

  it("can cancel adding a new text", async () => {
    /** Cancelling the add form discards input without adding. */
    mockFetchEmpty();
    render(<SubmittedTextsPage />);
    await waitFor(() => {
      expect(screen.getByText("Add Text")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText("Add Text"));
    expect(screen.getByText("New Submission")).toBeInTheDocument();

    fireEvent.click(screen.getByText("Cancel"));
    expect(screen.queryByText("New Submission")).not.toBeInTheDocument();
  });

  it("can edit an existing text", async () => {
    /** Users can modify the label and content of an existing text. */
    mockFetchTexts();
    render(<SubmittedTextsPage />);
    await waitFor(() => {
      expect(screen.getByText("R01 specific aims")).toBeInTheDocument();
    });

    // Click edit on first entry
    fireEvent.click(screen.getByTestId("edit-button-0"));

    // Edit label
    const labelInput = screen.getByTestId("edit-label");
    fireEvent.change(labelInput, { target: { value: "Updated aims" } });

    // Save
    fireEvent.click(screen.getByText("Save"));

    // Updated label should appear
    expect(screen.getByText("Updated aims")).toBeInTheDocument();
  });

  it("can delete a text", async () => {
    /** Users can remove a submitted text. */
    mockFetchTexts();
    render(<SubmittedTextsPage />);
    await waitFor(() => {
      expect(screen.getByText("R01 specific aims")).toBeInTheDocument();
    });

    // Delete first entry
    fireEvent.click(screen.getByTestId("delete-button-0"));

    // First entry should be gone, second remains
    expect(screen.queryByText("R01 specific aims")).not.toBeInTheDocument();
    expect(screen.getByText("Current interests")).toBeInTheDocument();
    expect(screen.getByText("1 of 5 texts used")).toBeInTheDocument();
  });

  it("marks form dirty after adding a text", async () => {
    /** Adding a text enables the Save Changes button. */
    mockFetchEmpty();
    render(<SubmittedTextsPage />);
    await waitFor(() => {
      expect(screen.getByText("Add Text")).toBeInTheDocument();
    });

    // Initially Save is disabled
    expect(screen.getByText("Save Changes")).toBeDisabled();

    // Add a text
    fireEvent.click(screen.getByText("Add Text"));
    fireEvent.change(screen.getByTestId("edit-label"), {
      target: { value: "Test" },
    });
    fireEvent.change(screen.getByTestId("edit-content"), {
      target: { value: "Content" },
    });
    fireEvent.click(screen.getByText("Add"));

    // Save should now be enabled
    expect(screen.getByText("Save Changes")).not.toBeDisabled();
    // Back button should show Discard
    expect(screen.getByText("Discard Changes")).toBeInTheDocument();
  });

  it("saves changes via PUT and shows success", async () => {
    /** Saving persists changes to the server and shows success message. */
    mockFetchTexts();
    render(<SubmittedTextsPage />);
    await waitFor(() => {
      expect(screen.getByText("R01 specific aims")).toBeInTheDocument();
    });

    // Delete an entry to make dirty
    fireEvent.click(screen.getByTestId("delete-button-0"));

    // Mock PUT response
    const updatedTexts = [EXISTING_TEXTS[1]];
    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ texts: updatedTexts }),
    });

    await act(async () => {
      fireEvent.click(screen.getByText("Save Changes"));
    });

    await waitFor(() => {
      expect(screen.getByText("Changes saved successfully.")).toBeInTheDocument();
    });

    // Verify PUT was called
    expect(global.fetch).toHaveBeenCalledWith(
      "/api/profile/submitted-texts",
      expect.objectContaining({ method: "PUT" }),
    );
  });

  it("shows validation errors on 422 response", async () => {
    /** Server validation errors are displayed to the user. */
    mockFetchTexts();
    render(<SubmittedTextsPage />);
    await waitFor(() => {
      expect(screen.getByText("R01 specific aims")).toBeInTheDocument();
    });

    // Make dirty
    fireEvent.click(screen.getByTestId("delete-button-0"));

    // Mock 422
    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: false,
      status: 422,
      json: () =>
        Promise.resolve({
          error: "Validation failed",
          details: ["Entry 1: content exceeds 2000 word limit (currently 2500)."],
        }),
    });

    await act(async () => {
      fireEvent.click(screen.getByText("Save Changes"));
    });

    await waitFor(() => {
      expect(screen.getByText("Please fix the following:")).toBeInTheDocument();
    });
  });

  it("navigates back to profile edit page", async () => {
    /** Back button navigates to /profile/edit. */
    mockFetchTexts();
    render(<SubmittedTextsPage />);
    await waitFor(() => {
      expect(screen.getByText("R01 specific aims")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText("Back"));
    expect(mockPush).toHaveBeenCalledWith("/profile/edit");
  });

  it("disables edit/delete buttons while in add mode", async () => {
    /** Editing one entry disables actions on all other entries. */
    mockFetchTexts();
    render(<SubmittedTextsPage />);
    await waitFor(() => {
      expect(screen.getByText("R01 specific aims")).toBeInTheDocument();
    });

    // Enter add mode
    fireEvent.click(screen.getByText("Add Text"));

    // Edit and delete buttons on existing entries should be disabled
    expect(screen.getByTestId("edit-button-0")).toBeDisabled();
    expect(screen.getByTestId("delete-button-0")).toBeDisabled();
  });

  it("shows word count in the add/edit form", async () => {
    /** Word count helps users stay within the 2000-word limit. */
    mockFetchEmpty();
    render(<SubmittedTextsPage />);
    await waitFor(() => {
      expect(screen.getByText("Add Text")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText("Add Text"));
    fireEvent.change(screen.getByTestId("edit-content"), {
      target: { value: "one two three" },
    });

    expect(screen.getByText("3 / 2000 words")).toBeInTheDocument();
  });
});
