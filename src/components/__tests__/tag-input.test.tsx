/**
 * @jest-environment jsdom
 */

/**
 * Tests for the TagInput shared component.
 *
 * Validates the core chip/tag editing behavior used by both the onboarding
 * review page and the profile edit page. Tests cover adding items via
 * button and Enter key, removing items, case-insensitive duplicate
 * prevention, and minimum item count validation display.
 */

import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import "@testing-library/jest-dom";
import { TagInput } from "../tag-input";

describe("TagInput", () => {
  const defaultProps = {
    label: "Techniques",
    items: ["RNA-seq", "CRISPR"],
    onChange: jest.fn(),
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("renders the label and all existing items as chips", () => {
    /** Verifies items are displayed as removable chips with the correct label. */
    render(<TagInput {...defaultProps} />);

    expect(screen.getByText("Techniques")).toBeInTheDocument();
    expect(screen.getByText("RNA-seq")).toBeInTheDocument();
    expect(screen.getByText("CRISPR")).toBeInTheDocument();
  });

  it("renders help text when provided", () => {
    /** Help text gives users context about what to enter. */
    render(<TagInput {...defaultProps} helpText="Add specific methodologies" />);
    expect(screen.getByText("Add specific methodologies")).toBeInTheDocument();
  });

  it("adds a new item when the Add button is clicked", () => {
    /** Clicking Add with non-empty input should call onChange with the new item appended. */
    const onChange = jest.fn();
    render(<TagInput {...defaultProps} onChange={onChange} />);

    const input = screen.getByPlaceholderText("Type and press Enter to add");
    fireEvent.change(input, { target: { value: "Mass spectrometry" } });
    fireEvent.click(screen.getByText("Add"));

    expect(onChange).toHaveBeenCalledWith(["RNA-seq", "CRISPR", "Mass spectrometry"]);
  });

  it("adds a new item when Enter key is pressed", () => {
    /** Enter key is a keyboard shortcut for the Add button. */
    const onChange = jest.fn();
    render(<TagInput {...defaultProps} onChange={onChange} />);

    const input = screen.getByPlaceholderText("Type and press Enter to add");
    fireEvent.change(input, { target: { value: "Mass spectrometry" } });
    fireEvent.keyDown(input, { key: "Enter" });

    expect(onChange).toHaveBeenCalledWith(["RNA-seq", "CRISPR", "Mass spectrometry"]);
  });

  it("prevents adding duplicate items (case-insensitive)", () => {
    /** Duplicate entries would clutter the profile. Case-insensitive check prevents 'rna-seq' and 'RNA-seq'. */
    const onChange = jest.fn();
    render(<TagInput {...defaultProps} onChange={onChange} />);

    const input = screen.getByPlaceholderText("Type and press Enter to add");
    fireEvent.change(input, { target: { value: "rna-seq" } });
    fireEvent.click(screen.getByText("Add"));

    expect(onChange).not.toHaveBeenCalled();
  });

  it("prevents adding empty or whitespace-only items", () => {
    /** Empty items should not be added to the list. */
    const onChange = jest.fn();
    render(<TagInput {...defaultProps} onChange={onChange} />);

    const input = screen.getByPlaceholderText("Type and press Enter to add");
    fireEvent.change(input, { target: { value: "   " } });
    fireEvent.click(screen.getByText("Add"));

    expect(onChange).not.toHaveBeenCalled();
  });

  it("removes an item when its remove button is clicked", () => {
    /** Each chip has an X button to remove it from the list. */
    const onChange = jest.fn();
    render(<TagInput {...defaultProps} onChange={onChange} />);

    const removeButtons = screen.getAllByRole("button", { name: /Remove/ });
    fireEvent.click(removeButtons[0]!);

    expect(onChange).toHaveBeenCalledWith(["CRISPR"]);
  });

  it("shows minimum items warning when below threshold", () => {
    /** When minItems is set and the list is too short, a red warning appears. */
    render(<TagInput {...defaultProps} items={["RNA-seq"]} minItems={3} onChange={jest.fn()} />);

    expect(screen.getByText("At least 3 required (currently 1)")).toBeInTheDocument();
  });

  it("does not show minimum items warning when at or above threshold", () => {
    /** No warning when the minimum is satisfied. */
    render(
      <TagInput
        {...defaultProps}
        items={["RNA-seq", "CRISPR", "Mass spec"]}
        minItems={3}
        onChange={jest.fn()}
      />,
    );

    expect(screen.queryByText(/At least/)).not.toBeInTheDocument();
  });

  it("does not show minimum items warning when minItems is not set", () => {
    /** Fields without a minimum (like keywords) should never show the warning. */
    render(<TagInput {...defaultProps} items={[]} onChange={jest.fn()} />);

    expect(screen.queryByText(/At least/)).not.toBeInTheDocument();
  });

  it("disables the Add button when input is empty", () => {
    /** Visual feedback: Add button is disabled until user types something. */
    render(<TagInput {...defaultProps} />);

    const addButton = screen.getByText("Add");
    expect(addButton).toBeDisabled();
  });

  it("trims whitespace from input before adding", () => {
    /** Leading/trailing whitespace should be stripped from added items. */
    const onChange = jest.fn();
    render(<TagInput {...defaultProps} onChange={onChange} />);

    const input = screen.getByPlaceholderText("Type and press Enter to add");
    fireEvent.change(input, { target: { value: "  Mass spec  " } });
    fireEvent.click(screen.getByText("Add"));

    expect(onChange).toHaveBeenCalledWith(["RNA-seq", "CRISPR", "Mass spec"]);
  });

  it("clears input field after successfully adding an item", () => {
    /** Input should be cleared after a successful add so user can immediately type the next item. */
    const onChange = jest.fn();
    render(<TagInput {...defaultProps} onChange={onChange} />);

    const input = screen.getByPlaceholderText("Type and press Enter to add") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "Mass spec" } });
    fireEvent.click(screen.getByText("Add"));

    // After re-render with the same items (since we don't actually update state in this test),
    // the input value should be cleared
    expect(input.value).toBe("");
  });
});
