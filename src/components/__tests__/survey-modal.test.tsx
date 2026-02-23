/**
 * @jest-environment jsdom
 */

/**
 * Tests for the SurveyModal component.
 *
 * Validates: modal rendering with question and all failure mode options,
 * multi-select checkbox behavior, "Other" free text input visibility,
 * submit button disabled state when no options selected, successful
 * submission with correct API call, skip (close) behavior, and error
 * handling on API failure.
 *
 * The survey modal appears after every Nth archive action to collect
 * feedback on proposal quality for aggregate analysis.
 *
 * Spec reference: specs/swipe-interface.md, "Periodic Survey" section.
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
import { SurveyModal, FAILURE_MODE_OPTIONS } from "../survey-modal";

describe("SurveyModal", () => {
  let onClose: jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();
    onClose = jest.fn();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("renders the survey question and all failure mode options", () => {
    /** The modal must show the question and all seven predefined options. */
    render(<SurveyModal onClose={onClose} />);

    expect(screen.getByText("Quick feedback")).toBeInTheDocument();
    expect(
      screen.getByText(
        /What's the most common issue you've seen in recent proposals/
      )
    ).toBeInTheDocument();

    // All failure mode options should be visible as checkbox labels
    for (const option of FAILURE_MODE_OPTIONS) {
      expect(screen.getByText(option.label)).toBeInTheDocument();
    }
  });

  it("renders as a modal dialog with proper ARIA attributes", () => {
    /** The survey should be accessible as a modal dialog. */
    render(<SurveyModal onClose={onClose} />);

    const dialog = screen.getByRole("dialog");
    expect(dialog).toHaveAttribute("aria-modal", "true");
    expect(dialog).toHaveAttribute("aria-label", "Proposal quality survey");
  });

  it("has Submit button disabled when no options are selected", () => {
    /** Users must select at least one option before submitting. */
    render(<SurveyModal onClose={onClose} />);

    const submitButton = screen.getByText("Submit");
    expect(submitButton).toBeDisabled();
  });

  it("enables Submit button when at least one option is selected", () => {
    /** Selecting any option should enable the Submit button. */
    render(<SurveyModal onClose={onClose} />);

    fireEvent.click(screen.getByText("Too generic / not specific enough"));
    expect(screen.getByText("Submit")).not.toBeDisabled();
  });

  it("supports multi-select — multiple options can be checked", () => {
    /** The spec requires multi-select: users can choose multiple failure modes. */
    render(<SurveyModal onClose={onClose} />);

    fireEvent.click(screen.getByText("Scientifically nonsensical"));
    fireEvent.click(screen.getByText("Lack of synergy between labs"));
    fireEvent.click(screen.getByText("Too generic / not specific enough"));

    const checkboxes = screen.getAllByRole("checkbox");
    const checked = checkboxes.filter(
      (cb) => (cb as HTMLInputElement).checked
    );
    expect(checked.length).toBe(3);
  });

  it("deselects an option when clicked again", () => {
    /** Clicking a checked option should uncheck it (toggle behavior). */
    render(<SurveyModal onClose={onClose} />);

    fireEvent.click(screen.getByText("Too generic / not specific enough"));
    expect(screen.getByText("Submit")).not.toBeDisabled();

    // Click again to deselect
    fireEvent.click(screen.getByText("Too generic / not specific enough"));
    expect(screen.getByText("Submit")).toBeDisabled();
  });

  it("shows free text input when 'Other' is selected", () => {
    /** The "Other" option should reveal a free text textarea. */
    render(<SurveyModal onClose={onClose} />);

    // Free text not visible initially
    expect(
      screen.queryByPlaceholderText("Tell us more (optional)...")
    ).not.toBeInTheDocument();

    fireEvent.click(screen.getByText("Other"));

    // Free text should now be visible
    expect(
      screen.getByPlaceholderText("Tell us more (optional)...")
    ).toBeInTheDocument();
  });

  it("hides free text input when 'Other' is deselected", () => {
    /** Deselecting "Other" should hide the free text field. */
    render(<SurveyModal onClose={onClose} />);

    fireEvent.click(screen.getByText("Other"));
    expect(
      screen.getByPlaceholderText("Tell us more (optional)...")
    ).toBeInTheDocument();

    fireEvent.click(screen.getByText("Other"));
    expect(
      screen.queryByPlaceholderText("Tell us more (optional)...")
    ).not.toBeInTheDocument();
  });

  it("calls onClose when Skip is clicked", () => {
    /** Users can skip the survey without submitting any data. */
    render(<SurveyModal onClose={onClose} />);

    fireEvent.click(screen.getByText("Skip"));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("submits selected failure modes and calls onClose on success", async () => {
    /** A successful submission sends the selected modes to the API
     *  and closes the modal. */
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        id: "survey-1",
        failureModes: ["too_generic", "lack_of_synergy"],
        freeText: null,
      }),
    });

    render(<SurveyModal onClose={onClose} />);

    fireEvent.click(screen.getByText("Too generic / not specific enough"));
    fireEvent.click(screen.getByText("Lack of synergy between labs"));

    await act(async () => {
      fireEvent.click(screen.getByText("Submit"));
    });

    await waitFor(() => {
      expect(onClose).toHaveBeenCalledTimes(1);
    });

    // Verify the fetch call
    expect(global.fetch).toHaveBeenCalledWith("/api/survey", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: expect.any(String),
    });

    const callBody = JSON.parse(
      (global.fetch as jest.Mock).mock.calls[0][1].body
    );
    expect(callBody.failureModes).toEqual(
      expect.arrayContaining(["too_generic", "lack_of_synergy"])
    );
    expect(callBody.freeText).toBeUndefined();
  });

  it("includes freeText in submission when 'Other' is selected with text", async () => {
    /** When 'Other' is selected and free text is provided, both are sent. */
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        id: "survey-2",
        failureModes: ["other"],
        freeText: "Need more computational collaborations",
      }),
    });

    render(<SurveyModal onClose={onClose} />);

    fireEvent.click(screen.getByText("Other"));
    fireEvent.change(
      screen.getByPlaceholderText("Tell us more (optional)..."),
      { target: { value: "Need more computational collaborations" } }
    );

    await act(async () => {
      fireEvent.click(screen.getByText("Submit"));
    });

    await waitFor(() => {
      expect(onClose).toHaveBeenCalledTimes(1);
    });

    const callBody = JSON.parse(
      (global.fetch as jest.Mock).mock.calls[0][1].body
    );
    expect(callBody.failureModes).toEqual(["other"]);
    expect(callBody.freeText).toBe("Need more computational collaborations");
  });

  it("shows error message on API failure", async () => {
    /** If the API call fails, an error message should appear. */
    global.fetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 500,
    });

    render(<SurveyModal onClose={onClose} />);

    fireEvent.click(screen.getByText("Too generic / not specific enough"));

    await act(async () => {
      fireEvent.click(screen.getByText("Submit"));
    });

    await waitFor(() => {
      expect(
        screen.getByText("Failed to submit survey")
      ).toBeInTheDocument();
    });

    // Modal should NOT close on error — user can retry or skip
    expect(onClose).not.toHaveBeenCalled();
  });

  it("does not send freeText when 'Other' is selected but text is empty", async () => {
    /** Selecting "Other" without typing anything should not send freeText. */
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        id: "survey-3",
        failureModes: ["other"],
        freeText: null,
      }),
    });

    render(<SurveyModal onClose={onClose} />);

    fireEvent.click(screen.getByText("Other"));
    // Don't type anything in the textarea

    await act(async () => {
      fireEvent.click(screen.getByText("Submit"));
    });

    await waitFor(() => {
      expect(onClose).toHaveBeenCalledTimes(1);
    });

    const callBody = JSON.parse(
      (global.fetch as jest.Mock).mock.calls[0][1].body
    );
    expect(callBody.failureModes).toEqual(["other"]);
    expect(callBody.freeText).toBeUndefined();
  });
});
