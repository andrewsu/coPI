/**
 * @jest-environment jsdom
 *
 * Tests for UnclaimedInviteModal — the user-facing invite template shown
 * when a user swipes "interested" on a proposal involving a seeded-but-unclaimed
 * researcher.
 *
 * Per specs/notifications.md: "The user who swiped interested is shown:
 * 'Dr. [B] hasn't joined yet. Want to invite them?' with a pre-filled email
 * template they can copy/send directly."
 *
 * Validates: modal rendering, email template content, copy-to-clipboard,
 * close button, and template builder functions.
 */

import React from "react";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom";
import {
  UnclaimedInviteModal,
  buildInviteSubject,
  buildInviteBody,
  type InviteModalData,
} from "@/components/unclaimed-invite-modal";

const sampleData: InviteModalData = {
  collaboratorName: "Dr. Jane Smith",
  proposalTitle: "Cross-lab CRISPR screens for neurodegeneration",
  oneLineSummary: "Combine your CRISPR expertise with their neuronal models",
  inviterName: "Dr. John Doe",
  claimUrl: "http://localhost:3000/login",
};

describe("UnclaimedInviteModal", () => {
  /** The modal must render and show the collaborator's name in the heading. */
  it("renders with collaborator name in the heading", () => {
    render(<UnclaimedInviteModal data={sampleData} onClose={jest.fn()} />);

    expect(
      screen.getByText(/Dr. Jane Smith hasn't joined CoPI yet/i)
    ).toBeInTheDocument();
  });

  /** The modal must show the invite prompt per spec. */
  it("shows the invite prompt text", () => {
    render(<UnclaimedInviteModal data={sampleData} onClose={jest.fn()} />);

    expect(
      screen.getByText(/Want to invite them\? Copy the message below/i)
    ).toBeInTheDocument();
  });

  /** The email template must include the subject line. */
  it("displays the email subject line", () => {
    render(<UnclaimedInviteModal data={sampleData} onClose={jest.fn()} />);

    expect(
      screen.getByText(/Cross-lab CRISPR screens for neurodegeneration/)
    ).toBeInTheDocument();
  });

  /** The email body must contain the collaboration one-line summary. */
  it("includes the one-line summary in the email body", () => {
    render(<UnclaimedInviteModal data={sampleData} onClose={jest.fn()} />);

    const body = screen.getByTestId("invite-email-body");
    expect(body.textContent).toContain(
      "Combine your CRISPR expertise with their neuronal models"
    );
  });

  /** The email body must include the claim URL. */
  it("includes the claim URL in the email body", () => {
    render(<UnclaimedInviteModal data={sampleData} onClose={jest.fn()} />);

    const body = screen.getByTestId("invite-email-body");
    expect(body.textContent).toContain("http://localhost:3000/login");
  });

  /** The email body must be signed with the inviter's name. */
  it("includes the inviter name in the email sign-off", () => {
    render(<UnclaimedInviteModal data={sampleData} onClose={jest.fn()} />);

    const body = screen.getByTestId("invite-email-body");
    expect(body.textContent).toContain("Dr. John Doe");
  });

  /** Clicking close should call the onClose callback. */
  it("calls onClose when close button is clicked", () => {
    const onClose = jest.fn();
    render(<UnclaimedInviteModal data={sampleData} onClose={onClose} />);

    fireEvent.click(screen.getByText("Close"));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  /** The copy button should write to clipboard and show "Copied!" feedback. */
  it("copies email template to clipboard and shows confirmation", async () => {
    const writeText = jest.fn().mockResolvedValue(undefined);
    Object.assign(navigator, {
      clipboard: { writeText },
    });

    render(<UnclaimedInviteModal data={sampleData} onClose={jest.fn()} />);

    fireEvent.click(screen.getByTestId("copy-invite-button"));

    // Wait for clipboard write AND state update ("Copied!" text)
    await waitFor(() => {
      expect(screen.getByText("Copied!")).toBeInTheDocument();
    });

    // Verify the copied text includes subject and body
    expect(writeText).toHaveBeenCalledTimes(1);
    const copiedText = writeText.mock.calls[0][0] as string;
    expect(copiedText).toContain("Subject:");
    expect(copiedText).toContain("Dr. Jane Smith");
    expect(copiedText).toContain("http://localhost:3000/login");
  });

  /** The modal overlay should have the expected test ID. */
  it("has the expected test ID for integration testing", () => {
    render(<UnclaimedInviteModal data={sampleData} onClose={jest.fn()} />);

    expect(screen.getByTestId("unclaimed-invite-modal")).toBeInTheDocument();
  });
});

describe("buildInviteSubject", () => {
  /** The subject line should include the proposal title. */
  it("includes the proposal title", () => {
    const subject = buildInviteSubject(sampleData);
    expect(subject).toContain(
      "Cross-lab CRISPR screens for neurodegeneration"
    );
    expect(subject).toContain("CoPI");
  });
});

describe("buildInviteBody", () => {
  /** The email body should address the collaborator by name. */
  it("addresses the collaborator by name", () => {
    const body = buildInviteBody(sampleData);
    expect(body).toContain("Hi Dr. Jane Smith");
  });

  /** The body should include the one-line summary in quotes. */
  it("includes the one-line summary", () => {
    const body = buildInviteBody(sampleData);
    expect(body).toContain(
      '"Combine your CRISPR expertise with their neuronal models"'
    );
  });

  /** The body should include the claim URL. */
  it("includes the claim URL", () => {
    const body = buildInviteBody(sampleData);
    expect(body).toContain("http://localhost:3000/login");
  });

  /** The body should be signed by the inviter. */
  it("is signed by the inviter", () => {
    const body = buildInviteBody(sampleData);
    expect(body).toContain("Dr. John Doe");
  });

  /** The body should mention CoPI. */
  it("mentions CoPI", () => {
    const body = buildInviteBody(sampleData);
    expect(body).toContain("CoPI");
    expect(body).toContain("copi.science");
  });
});
