/**
 * @jest-environment jsdom
 */

/**
 * Tests for the profile edit page (/profile/edit).
 *
 * Validates the main-app profile editing flow: loading profile data,
 * rendering editable fields, saving changes via PUT /api/profile,
 * handling validation errors, success feedback, and navigation.
 *
 * This page is distinct from the onboarding review page — it's accessible
 * from the main app after onboarding and provides "Save Changes" / "Discard"
 * navigation instead of the onboarding "Looks Good" / "Save & Continue" flow.
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

// Mock TagInput to simplify page-level tests (TagInput has its own test suite)
jest.mock("@/components/tag-input", () => ({
  TagInput: ({ label, items, onChange, minItems, helpText }: {
    label: string;
    items: string[];
    onChange: (items: string[]) => void;
    minItems?: number;
    helpText?: string;
  }) => (
    <div data-testid={`tag-input-${label.toLowerCase().replace(/\s+/g, "-")}`}>
      <span>{label}</span>
      {helpText && <span>{helpText}</span>}
      <span data-testid={`${label.toLowerCase().replace(/\s+/g, "-")}-count`}>
        {items.length} items
      </span>
      {minItems && items.length < minItems && (
        <span>At least {minItems} required</span>
      )}
      <button
        data-testid={`${label.toLowerCase().replace(/\s+/g, "-")}-add`}
        onClick={() => onChange([...items, "new-item"])}
      >
        Mock Add
      </button>
    </div>
  ),
}));

import ProfileEditPage from "../page";

/** Helper: generates a word string of exact length for summary validation. */
function wordsOf(count: number): string {
  return Array.from({ length: count }, (_, i) => `word${i}`).join(" ");
}

/** A valid profile response from GET /api/profile. */
const VALID_PROFILE = {
  researchSummary: wordsOf(180),
  techniques: ["RNA-seq", "CRISPR screening", "Mass spectrometry"],
  experimentalModels: ["Mouse", "HeLa cells"],
  diseaseAreas: ["Cancer biology"],
  keyTargets: ["p53"],
  keywords: ["transcriptomics"],
  grantTitles: ["NIH R01 Grant"],
  profileVersion: 2,
  profileGeneratedAt: "2025-01-01T00:00:00.000Z",
};

/** Mock fetch to return profile data or error. */
function mockFetchSuccess(profile = VALID_PROFILE) {
  global.fetch = jest.fn().mockResolvedValue({
    ok: true,
    status: 200,
    json: () => Promise.resolve(profile),
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

describe("ProfileEditPage", () => {
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
    mockFetchSuccess();
    render(<ProfileEditPage />);

    expect(screen.getByText("Loading your profile...")).toBeInTheDocument();
  });

  it("shows loading state while profile is being fetched", () => {
    /** Loading indicator shown while GET /api/profile is in flight. */
    // fetch that never resolves
    global.fetch = jest.fn().mockReturnValue(new Promise(() => {}));
    render(<ProfileEditPage />);

    expect(screen.getByText("Loading your profile...")).toBeInTheDocument();
  });

  it("redirects to /onboarding when profile does not exist (404)", async () => {
    /** Users without a profile should be redirected to run the pipeline. */
    mockFetchNotFound();
    render(<ProfileEditPage />);

    await waitFor(() => {
      expect(mockReplace).toHaveBeenCalledWith("/onboarding");
    });
  });

  it("shows error state when profile fetch fails", async () => {
    /** Network errors display an error message with a back-to-home button. */
    mockFetchError();
    render(<ProfileEditPage />);

    await waitFor(() => {
      expect(screen.getByText("Network error")).toBeInTheDocument();
    });
    expect(screen.getByText("Back to home")).toBeInTheDocument();
  });

  it("renders profile data after successful fetch", async () => {
    /** All editable fields and metadata should be displayed after loading. */
    mockFetchSuccess();
    render(<ProfileEditPage />);

    await waitFor(() => {
      expect(screen.getByText("Edit Your Profile")).toBeInTheDocument();
    });

    // Research summary textarea
    const textarea = screen.getByDisplayValue(VALID_PROFILE.researchSummary);
    expect(textarea).toBeInTheDocument();

    // Profile version display
    expect(screen.getByText("Profile version 2")).toBeInTheDocument();

    // Grant titles (read-only)
    expect(screen.getByText("NIH R01 Grant")).toBeInTheDocument();

    // TagInput components rendered
    expect(screen.getByTestId("tag-input-techniques")).toBeInTheDocument();
    expect(screen.getByTestId("tag-input-experimental-models")).toBeInTheDocument();
    expect(screen.getByTestId("tag-input-disease-areas")).toBeInTheDocument();
    expect(screen.getByTestId("tag-input-key-targets")).toBeInTheDocument();
    expect(screen.getByTestId("tag-input-keywords")).toBeInTheDocument();
  });

  it("has Save Changes button disabled when no edits made", async () => {
    /** Save button should only be active when the user has made changes. */
    mockFetchSuccess();
    render(<ProfileEditPage />);

    await waitFor(() => {
      expect(screen.getByText("Edit Your Profile")).toBeInTheDocument();
    });

    const saveButton = screen.getByText("Save Changes");
    expect(saveButton).toBeDisabled();
  });

  it("enables Save Changes button after editing the research summary", async () => {
    /** Editing any field marks the form as dirty and enables saving. */
    mockFetchSuccess();
    render(<ProfileEditPage />);

    await waitFor(() => {
      expect(screen.getByText("Edit Your Profile")).toBeInTheDocument();
    });

    const textarea = screen.getByDisplayValue(VALID_PROFILE.researchSummary);
    fireEvent.change(textarea, { target: { value: wordsOf(200) } });

    const saveButton = screen.getByText("Save Changes");
    expect(saveButton).not.toBeDisabled();
  });

  it("enables Save Changes button after editing a tag field", async () => {
    /** Changes to array fields (via TagInput) also mark the form as dirty. */
    mockFetchSuccess();
    render(<ProfileEditPage />);

    await waitFor(() => {
      expect(screen.getByText("Edit Your Profile")).toBeInTheDocument();
    });

    // Click the mock "Add" button on the techniques TagInput
    fireEvent.click(screen.getByTestId("techniques-add"));

    const saveButton = screen.getByText("Save Changes");
    expect(saveButton).not.toBeDisabled();
  });

  it("shows 'Discard Changes' on back button when form is dirty", async () => {
    /** Visual feedback: back button text changes to warn about unsaved edits. */
    mockFetchSuccess();
    render(<ProfileEditPage />);

    await waitFor(() => {
      expect(screen.getByText("Edit Your Profile")).toBeInTheDocument();
    });

    // Initially shows "Back"
    expect(screen.getByText("Back")).toBeInTheDocument();

    // After editing
    const textarea = screen.getByDisplayValue(VALID_PROFILE.researchSummary);
    fireEvent.change(textarea, { target: { value: wordsOf(200) } });

    expect(screen.getByText("Discard Changes")).toBeInTheDocument();
  });

  it("saves profile and shows success message on valid save", async () => {
    /** Successful PUT returns updated profile and shows green confirmation. */
    mockFetchSuccess();
    render(<ProfileEditPage />);

    await waitFor(() => {
      expect(screen.getByText("Edit Your Profile")).toBeInTheDocument();
    });

    // Edit summary
    const textarea = screen.getByDisplayValue(VALID_PROFILE.researchSummary);
    fireEvent.change(textarea, { target: { value: wordsOf(200) } });

    // Mock PUT response
    const updatedProfile = { ...VALID_PROFILE, profileVersion: 3 };
    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: () => Promise.resolve(updatedProfile),
    });

    await act(async () => {
      fireEvent.click(screen.getByText("Save Changes"));
    });

    await waitFor(() => {
      expect(screen.getByText(/Profile saved successfully/)).toBeInTheDocument();
    });

    // Verify PUT was called
    expect(global.fetch).toHaveBeenCalledWith("/api/profile", expect.objectContaining({
      method: "PUT",
    }));
  });

  it("shows validation errors on 422 response", async () => {
    /** Server-side validation errors are displayed so the user can fix them. */
    mockFetchSuccess();
    render(<ProfileEditPage />);

    await waitFor(() => {
      expect(screen.getByText("Edit Your Profile")).toBeInTheDocument();
    });

    // Edit to trigger dirty
    const textarea = screen.getByDisplayValue(VALID_PROFILE.researchSummary);
    fireEvent.change(textarea, { target: { value: wordsOf(200) } });

    // Mock PUT validation failure
    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: false,
      status: 422,
      json: () => Promise.resolve({
        error: "Validation failed",
        details: ["Research summary must be at least 150 words (currently 100)."],
      }),
    });

    await act(async () => {
      fireEvent.click(screen.getByText("Save Changes"));
    });

    await waitFor(() => {
      expect(screen.getByText("Please fix the following:")).toBeInTheDocument();
      expect(screen.getByText(/Research summary must be at least 150 words/)).toBeInTheDocument();
    });
  });

  it("shows error message on save failure", async () => {
    /** Network errors during save are displayed to the user. */
    mockFetchSuccess();
    render(<ProfileEditPage />);

    await waitFor(() => {
      expect(screen.getByText("Edit Your Profile")).toBeInTheDocument();
    });

    // Edit to trigger dirty
    const textarea = screen.getByDisplayValue(VALID_PROFILE.researchSummary);
    fireEvent.change(textarea, { target: { value: wordsOf(200) } });

    // Mock PUT failure
    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: false,
      status: 500,
      json: () => Promise.resolve({ error: "Internal server error" }),
    });

    await act(async () => {
      fireEvent.click(screen.getByText("Save Changes"));
    });

    await waitFor(() => {
      expect(screen.getByText("Failed to save profile")).toBeInTheDocument();
    });
  });

  it("navigates to home when back/discard button is clicked", async () => {
    /** Back button navigates to / without saving, discarding any changes. */
    mockFetchSuccess();
    render(<ProfileEditPage />);

    await waitFor(() => {
      expect(screen.getByText("Edit Your Profile")).toBeInTheDocument();
    });

    // Click bottom "Back" button
    fireEvent.click(screen.getByText("Back"));

    expect(mockPush).toHaveBeenCalledWith("/");
  });

  it("navigates to home via the top 'Back to home' link", async () => {
    /** The top navigation link also returns to the home page. */
    mockFetchSuccess();
    render(<ProfileEditPage />);

    await waitFor(() => {
      expect(screen.getByText("Edit Your Profile")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText("Back to home"));

    expect(mockPush).toHaveBeenCalledWith("/");
  });

  it("displays word count for research summary", async () => {
    /** Shows current word count with color indicating if in valid range. */
    mockFetchSuccess();
    render(<ProfileEditPage />);

    await waitFor(() => {
      expect(screen.getByText("Edit Your Profile")).toBeInTheDocument();
    });

    // 180-word summary → "180 / 150–250 words" should be shown
    expect(screen.getByText(/180 \/ 150–250 words/)).toBeInTheDocument();
  });

  it("does not render grant titles section when there are none", async () => {
    /** Grant titles section is hidden entirely when the list is empty. */
    mockFetchSuccess({ ...VALID_PROFILE, grantTitles: [] });
    render(<ProfileEditPage />);

    await waitFor(() => {
      expect(screen.getByText("Edit Your Profile")).toBeInTheDocument();
    });

    expect(screen.queryByText("Grant Titles")).not.toBeInTheDocument();
  });

  it("resets dirty state and shows success after save", async () => {
    /** After saving, the form is no longer dirty and Save button is disabled again. */
    mockFetchSuccess();
    render(<ProfileEditPage />);

    await waitFor(() => {
      expect(screen.getByText("Edit Your Profile")).toBeInTheDocument();
    });

    // Edit
    const textarea = screen.getByDisplayValue(VALID_PROFILE.researchSummary);
    fireEvent.change(textarea, { target: { value: wordsOf(200) } });
    expect(screen.getByText("Save Changes")).not.toBeDisabled();

    // Save
    const updatedProfile = { ...VALID_PROFILE, profileVersion: 3 };
    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: () => Promise.resolve(updatedProfile),
    });

    await act(async () => {
      fireEvent.click(screen.getByText("Save Changes"));
    });

    await waitFor(() => {
      expect(screen.getByText("Save Changes")).toBeDisabled();
      expect(screen.getByText("Back")).toBeInTheDocument(); // Not "Discard Changes"
    });
  });
});
