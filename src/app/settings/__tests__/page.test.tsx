/**
 * @jest-environment jsdom
 */

/**
 * Tests for the settings page (/settings).
 *
 * Validates: loading state, settings fetch and display, email visibility
 * radio selection, toggle interactions, save/discard flow, match notification
 * confirmation modal, and master notification switch behavior.
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
jest.mock("next/navigation", () => ({
  useRouter: () => ({
    push: mockPush,
  }),
}));

let mockSessionStatus = "authenticated";
jest.mock("next-auth/react", () => ({
  useSession: () => ({ status: mockSessionStatus }),
}));

import SettingsPage from "../page";

/** Default settings response from GET /api/settings. */
const DEFAULT_SETTINGS = {
  emailVisibility: "mutual_matches",
  allowIncomingProposals: false,
  emailNotificationsEnabled: true,
  notifyMatches: true,
  notifyNewProposals: true,
  notifyProfileRefresh: true,
};

/** Mock fetch to return settings data. */
function mockFetchSuccess(settings = DEFAULT_SETTINGS) {
  global.fetch = jest.fn().mockResolvedValue({
    ok: true,
    status: 200,
    json: () => Promise.resolve(settings),
  });
}

/** Mock fetch to simulate a network error. */
function mockFetchError() {
  global.fetch = jest
    .fn()
    .mockRejectedValue(new Error("Network error"));
}

/** Mock fetch with PUT that succeeds, returning the provided body merged with defaults. */
function mockFetchWithPut(putResponse = DEFAULT_SETTINGS) {
  global.fetch = jest.fn().mockImplementation((_url: string, options?: RequestInit) => {
    if (options?.method === "PUT") {
      return Promise.resolve({
        ok: true,
        status: 200,
        json: () => Promise.resolve(putResponse),
      });
    }
    // GET request
    return Promise.resolve({
      ok: true,
      status: 200,
      json: () => Promise.resolve(DEFAULT_SETTINGS),
    });
  });
}

describe("Settings page", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockSessionStatus = "authenticated";
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("shows loading state while session or settings are loading", () => {
    /** Loading spinner displayed while waiting for session and API data. */
    mockSessionStatus = "loading";
    mockFetchSuccess();

    render(<SettingsPage />);
    expect(screen.getByText("Loading settings...")).toBeInTheDocument();
  });

  it("shows error state when settings fetch fails", async () => {
    /** Network errors display error message with back-to-home button. */
    mockFetchError();

    await act(async () => {
      render(<SettingsPage />);
    });

    await waitFor(() => {
      expect(screen.getByText("Network error")).toBeInTheDocument();
    });
    expect(screen.getByText("Back to home")).toBeInTheDocument();
  });

  it("renders settings form after successful fetch", async () => {
    /** All settings sections are displayed: email visibility, incoming proposals, notifications. */
    mockFetchSuccess();

    await act(async () => {
      render(<SettingsPage />);
    });

    await waitFor(() => {
      expect(screen.getByText("Settings")).toBeInTheDocument();
    });

    expect(screen.getByText("Email Visibility")).toBeInTheDocument();
    expect(screen.getByText("Allow Incoming Proposals")).toBeInTheDocument();
    expect(screen.getByText("Email Notifications")).toBeInTheDocument();
    expect(screen.getByText("Profile & Data")).toBeInTheDocument();
  });

  it("renders email visibility options with correct default selected", async () => {
    /** Default 'mutual_matches' radio button is checked on load. */
    mockFetchSuccess();

    await act(async () => {
      render(<SettingsPage />);
    });

    await waitFor(() => {
      expect(screen.getByText("Mutual matches only")).toBeInTheDocument();
    });

    const radios = screen.getAllByRole("radio");
    const mutualMatchesRadio = radios.find(
      (r) => (r as HTMLInputElement).value === "mutual_matches",
    ) as HTMLInputElement;
    expect(mutualMatchesRadio.checked).toBe(true);
  });

  it("marks form dirty when changing email visibility", async () => {
    /** Changing email visibility enables the Save button. */
    mockFetchWithPut({ ...DEFAULT_SETTINGS, emailVisibility: "never" });

    await act(async () => {
      render(<SettingsPage />);
    });

    await waitFor(() => {
      expect(screen.getByText("Email Visibility")).toBeInTheDocument();
    });

    const saveButton = screen.getByText("Save Settings");
    expect(saveButton).toBeDisabled();

    // Click "Never" radio
    const neverRadio = screen.getAllByRole("radio").find(
      (r) => (r as HTMLInputElement).value === "never",
    );
    expect(neverRadio).toBeDefined();
    fireEvent.click(neverRadio!);

    expect(saveButton).not.toBeDisabled();
  });

  it("shows Discard Changes when form is dirty", async () => {
    /** When form has unsaved changes, the back button becomes 'Discard Changes'. */
    mockFetchWithPut();

    await act(async () => {
      render(<SettingsPage />);
    });

    await waitFor(() => {
      expect(screen.getByText("Back")).toBeInTheDocument();
    });

    // Make a change
    const neverRadio = screen.getAllByRole("radio").find(
      (r) => (r as HTMLInputElement).value === "never",
    );
    expect(neverRadio).toBeDefined();
    fireEvent.click(neverRadio!);

    expect(screen.getByText("Discard Changes")).toBeInTheDocument();
  });

  it("saves settings on Save button click", async () => {
    /** Clicking Save sends PUT request with current settings and shows success message. */
    const updatedSettings = { ...DEFAULT_SETTINGS, emailVisibility: "never" };
    mockFetchWithPut(updatedSettings);

    await act(async () => {
      render(<SettingsPage />);
    });

    await waitFor(() => {
      expect(screen.getByText("Email Visibility")).toBeInTheDocument();
    });

    // Change email visibility
    const neverRadio = screen.getAllByRole("radio").find(
      (r) => (r as HTMLInputElement).value === "never",
    );
    expect(neverRadio).toBeDefined();
    fireEvent.click(neverRadio!);

    // Click save
    const saveButton = screen.getByText("Save Settings");
    await act(async () => {
      fireEvent.click(saveButton);
    });

    await waitFor(() => {
      expect(screen.getByText("Settings saved successfully.")).toBeInTheDocument();
    });

    // Verify PUT was called
    expect(global.fetch).toHaveBeenCalledWith("/api/settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: expect.any(String),
    });
  });

  it("shows confirmation modal when turning off match notifications", async () => {
    /** Per spec, disabling match notifications requires user confirmation. */
    mockFetchWithPut();

    await act(async () => {
      render(<SettingsPage />);
    });

    await waitFor(() => {
      expect(screen.getByText("Match notifications")).toBeInTheDocument();
    });

    // Find and click the match notifications toggle (should be the 3rd switch — after master and before new proposals)
    const switches = screen.getAllByRole("switch");
    // switches[0] = incoming proposals, [1] = master email, [2] = match notifications, [3] = new proposals, [4] = profile refresh
    const matchSwitch = switches[2]!;
    fireEvent.click(matchSwitch);

    // Confirmation modal should appear
    await waitFor(() => {
      expect(
        screen.getByText("Disable match notifications?"),
      ).toBeInTheDocument();
      expect(
        screen.getByText(
          /You won't be notified when someone wants to collaborate with you/,
        ),
      ).toBeInTheDocument();
    });
  });

  it("cancels match notification disable when Cancel is clicked", async () => {
    /** Clicking Cancel in the confirmation modal keeps match notifications enabled. */
    mockFetchWithPut();

    await act(async () => {
      render(<SettingsPage />);
    });

    await waitFor(() => {
      expect(screen.getByText("Match notifications")).toBeInTheDocument();
    });

    const switches = screen.getAllByRole("switch");
    const matchSwitch = switches[2]!;
    fireEvent.click(matchSwitch);

    await waitFor(() => {
      expect(
        screen.getByText("Disable match notifications?"),
      ).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText("Cancel"));

    // Modal should close
    expect(
      screen.queryByText("Disable match notifications?"),
    ).not.toBeInTheDocument();
  });

  it("confirms match notification disable when Turn Off is clicked", async () => {
    /** Clicking Turn Off in the confirmation modal disables match notifications. */
    mockFetchWithPut();

    await act(async () => {
      render(<SettingsPage />);
    });

    await waitFor(() => {
      expect(screen.getByText("Match notifications")).toBeInTheDocument();
    });

    const switches = screen.getAllByRole("switch");
    const matchSwitch = switches[2]!;
    fireEvent.click(matchSwitch);

    await waitFor(() => {
      expect(screen.getByText("Disable match notifications?")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText("Turn Off"));

    // Modal should close and form should be dirty
    expect(
      screen.queryByText("Disable match notifications?"),
    ).not.toBeInTheDocument();
    expect(screen.getByText("Save Settings")).not.toBeDisabled();
  });

  it("dims notification sub-toggles when master switch is off", async () => {
    /** Individual notification toggles are visually dimmed when the master switch is off. */
    mockFetchSuccess({
      ...DEFAULT_SETTINGS,
      emailNotificationsEnabled: false,
    });

    await act(async () => {
      render(<SettingsPage />);
    });

    await waitFor(() => {
      expect(screen.getByText("Email Notifications")).toBeInTheDocument();
    });

    // Sub-toggles should be disabled
    const switches = screen.getAllByRole("switch");
    // switches[0] = incoming proposals, [1] = master, [2] = match, [3] = new proposals, [4] = profile refresh
    expect(switches[2]).toBeDisabled();
    expect(switches[3]).toBeDisabled();
    expect(switches[4]).toBeDisabled();
  });

  it("renders links to profile management pages", async () => {
    /** Settings page includes navigation links to submitted texts and profile edit pages. */
    mockFetchSuccess();

    await act(async () => {
      render(<SettingsPage />);
    });

    await waitFor(() => {
      expect(screen.getByText("Profile & Data")).toBeInTheDocument();
    });

    expect(screen.getByText("Manage research texts")).toBeInTheDocument();
    expect(screen.getByText("Edit profile & refresh")).toBeInTheDocument();
  });

  it("navigates home when back button is clicked with no changes", async () => {
    /** Back button navigates to home when there are no unsaved changes. */
    mockFetchSuccess();

    await act(async () => {
      render(<SettingsPage />);
    });

    await waitFor(() => {
      expect(screen.getByText("Settings")).toBeInTheDocument();
    });

    // Click the "Back" button at the bottom
    const backButtons = screen.getAllByText("Back");
    const bottomBack = backButtons[backButtons.length - 1]!;
    fireEvent.click(bottomBack);

    expect(mockPush).toHaveBeenCalledWith("/");
  });
});
