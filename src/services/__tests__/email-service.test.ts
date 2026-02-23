/**
 * Tests for the email service: template rendering, SES sending, and dev-mode fallback.
 *
 * Validates that:
 *   - Each template renders correct subject lines and HTML content
 *   - Template data is properly escaped to prevent XSS
 *   - The SES send path constructs the correct SendEmailCommand
 *   - Dev mode logs instead of sending when AWS credentials are absent
 *   - Unknown template IDs throw descriptive errors
 *   - Edge cases (empty arrays, missing optional fields) are handled
 */

import { SendEmailCommand } from "@aws-sdk/client-ses";
import type { SESClient } from "@aws-sdk/client-ses";
import {
  renderMatchNotification,
  renderNewProposalsDigest,
  renderProfileRefreshCandidate,
  renderUnclaimedProfileRecruitment,
  renderTemplate,
  sendEmail,
  sendTemplatedEmail,
  escapeHtml,
  type MatchNotificationData,
  type NewProposalsDigestData,
  type ProfileRefreshCandidateData,
  type UnclaimedProfileRecruitmentData,
} from "../email-service";

// --- Fixtures ---

const matchData: MatchNotificationData = {
  recipientName: "Smith",
  matchedResearcherName: "Jones",
  matchedResearcherInstitution: "MIT",
  matchedResearcherDepartment: "Biology",
  oneLineSummary: "Combine CRISPR screening with single-cell RNA-seq",
  contactEmail: "jones@mit.edu",
  emailVisibility: "mutual_matches",
  proposalId: "prop-123",
};

const digestData: NewProposalsDigestData = {
  recipientName: "Smith",
  proposalCount: 3,
  topProposalTitle: "CRISPR meets Proteomics",
  topProposalSummary: "A synergistic approach combining gene editing with mass spectrometry",
};

const refreshData: ProfileRefreshCandidateData = {
  recipientName: "Smith",
  newPublicationTitles: [
    "Novel CRISPR applications in cancer therapy",
    "Single-cell analysis of tumor microenvironment",
  ],
  changedFields: ["techniques", "disease_areas"],
};

const recruitmentData: UnclaimedProfileRecruitmentData = {
  recipientName: "Johnson",
  topicArea: "CRISPR-based gene therapy for rare diseases",
  claimUrl: "http://localhost:3000/login?claim=orcid-123",
};

// --- escapeHtml ---

describe("escapeHtml", () => {
  it("escapes HTML special characters", () => {
    expect(escapeHtml('<script>alert("xss")</script>')).toBe(
      "&lt;script&gt;alert(&quot;xss&quot;)&lt;/script&gt;",
    );
  });

  it("escapes ampersands", () => {
    expect(escapeHtml("A & B")).toBe("A &amp; B");
  });

  it("escapes single quotes", () => {
    expect(escapeHtml("it's")).toBe("it&#x27;s");
  });

  it("passes through safe strings unchanged", () => {
    expect(escapeHtml("Hello World")).toBe("Hello World");
  });
});

// --- Match notification template ---

describe("renderMatchNotification", () => {
  /** Verifies the subject line follows the spec format with the matched researcher's name. */
  it("renders correct subject with matched researcher name", () => {
    const result = renderMatchNotification(matchData);
    expect(result.subject).toBe(
      "Mutual interest with Dr. Jones on a collaboration idea",
    );
  });

  it("includes one-line summary in the body", () => {
    const result = renderMatchNotification(matchData);
    expect(result.html).toContain("Combine CRISPR screening with single-cell RNA-seq");
  });

  it("includes collaborator institution and department", () => {
    const result = renderMatchNotification(matchData);
    expect(result.html).toContain("MIT");
    expect(result.html).toContain("Biology");
  });

  /** When emailVisibility is mutual_matches, the email address should be shown. */
  it("shows contact email when visibility is mutual_matches", () => {
    const result = renderMatchNotification(matchData);
    expect(result.html).toContain("jones@mit.edu");
    expect(result.html).toContain("mailto:jones@mit.edu");
  });

  /** When emailVisibility is public_profile, the email address should be shown. */
  it("shows contact email when visibility is public_profile", () => {
    const result = renderMatchNotification({
      ...matchData,
      emailVisibility: "public_profile",
    });
    expect(result.html).toContain("jones@mit.edu");
  });

  /** When emailVisibility is never, the email should show institutional directory message. */
  it("hides contact email when visibility is never", () => {
    const result = renderMatchNotification({
      ...matchData,
      emailVisibility: "never",
    });
    expect(result.html).not.toContain("jones@mit.edu");
    expect(result.html).toContain("institutional directory");
  });

  it("includes link to full proposal", () => {
    const result = renderMatchNotification(matchData);
    expect(result.html).toContain("/proposals/prop-123");
    expect(result.html).toContain("View Full Proposal");
  });

  it("includes settings link in footer for notification management", () => {
    const result = renderMatchNotification(matchData);
    expect(result.html).toContain("/settings");
    expect(result.html).toContain("Manage notification preferences");
  });

  it("omits department when not provided", () => {
    const result = renderMatchNotification({
      ...matchData,
      matchedResearcherDepartment: undefined,
    });
    expect(result.html).toContain("MIT");
    expect(result.html).not.toContain("Biology");
  });

  /** Ensures user-controlled data is HTML-escaped to prevent XSS in emails. */
  it("escapes HTML in user-provided fields", () => {
    const result = renderMatchNotification({
      ...matchData,
      matchedResearcherName: '<img src=x onerror="alert(1)">',
    });
    expect(result.html).not.toContain('<img src=x');
    expect(result.html).toContain("&lt;img");
  });
});

// --- New proposals digest template ---

describe("renderNewProposalsDigest", () => {
  /** Verifies subject includes proposal count per spec. */
  it("renders correct subject with proposal count", () => {
    const result = renderNewProposalsDigest(digestData);
    expect(result.subject).toBe("You have 3 new collaboration suggestions");
  });

  it("uses singular form for count of 1", () => {
    const result = renderNewProposalsDigest({
      ...digestData,
      proposalCount: 1,
    });
    expect(result.subject).toBe("You have 1 new collaboration suggestion");
    expect(result.html).toContain("1 new collaboration suggestion</strong>");
  });

  it("includes top proposal title and summary", () => {
    const result = renderNewProposalsDigest(digestData);
    expect(result.html).toContain("CRISPR meets Proteomics");
    expect(result.html).toContain("gene editing with mass spectrometry");
  });

  it("includes link to swipe queue (app root)", () => {
    const result = renderNewProposalsDigest(digestData);
    expect(result.html).toContain("Review Your Latest Collaboration Ideas");
  });
});

// --- Profile refresh candidate template ---

describe("renderProfileRefreshCandidate", () => {
  /** Verifies subject matches spec wording. */
  it("renders correct subject", () => {
    const result = renderProfileRefreshCandidate(refreshData);
    expect(result.subject).toContain("new publications");
    expect(result.subject).toContain("review your updated profile");
  });

  it("lists new publication titles", () => {
    const result = renderProfileRefreshCandidate(refreshData);
    expect(result.html).toContain("Novel CRISPR applications in cancer therapy");
    expect(result.html).toContain("Single-cell analysis of tumor microenvironment");
  });

  it("shows changed field labels in human-readable form", () => {
    const result = renderProfileRefreshCandidate(refreshData);
    expect(result.html).toContain("Techniques");
    expect(result.html).toContain("Disease Areas");
  });

  /** When more than 5 publications found, excess are summarized with "and N more..." */
  it("truncates publication list at 5 with 'more' indicator", () => {
    const result = renderProfileRefreshCandidate({
      ...refreshData,
      newPublicationTitles: [
        "Pub 1", "Pub 2", "Pub 3", "Pub 4", "Pub 5", "Pub 6", "Pub 7",
      ],
    });
    expect(result.html).toContain("Pub 5");
    expect(result.html).not.toContain("Pub 6");
    expect(result.html).toContain("and 2 more...");
  });

  it("does not show 'more' when 5 or fewer publications", () => {
    const result = renderProfileRefreshCandidate(refreshData);
    expect(result.html).not.toContain("more...");
  });

  it("includes link to profile edit page", () => {
    const result = renderProfileRefreshCandidate(refreshData);
    expect(result.html).toContain("/profile/edit");
    expect(result.html).toContain("Review Updated Profile");
  });
});

// --- Unclaimed profile recruitment template ---

describe("renderUnclaimedProfileRecruitment", () => {
  /** Subject should include the topic area per spec. */
  it("renders correct subject with topic area", () => {
    const result = renderUnclaimedProfileRecruitment(recruitmentData);
    expect(result.subject).toBe(
      "A collaboration opportunity in CRISPR-based gene therapy for rare diseases",
    );
  });

  it("includes topic area in the body", () => {
    const result = renderUnclaimedProfileRecruitment(recruitmentData);
    expect(result.html).toContain("CRISPR-based gene therapy for rare diseases");
  });

  it("mentions a researcher expressed interest without revealing who", () => {
    const result = renderUnclaimedProfileRecruitment(recruitmentData);
    expect(result.html).toContain("A researcher has expressed interest");
  });

  it("includes brief CoPI explanation", () => {
    const result = renderUnclaimedProfileRecruitment(recruitmentData);
    expect(result.html).toContain("AI-powered platform");
    expect(result.html).toContain("complementary expertise");
  });

  it("includes claim URL link", () => {
    const result = renderUnclaimedProfileRecruitment(recruitmentData);
    expect(result.html).toContain("http://localhost:3000/login?claim=orcid-123");
    expect(result.html).toContain("Claim Your Profile");
  });
});

// --- Template dispatcher ---

describe("renderTemplate", () => {
  it("dispatches to match_notification renderer", () => {
    const result = renderTemplate("match_notification", matchData as unknown as Record<string, unknown>);
    expect(result.subject).toContain("Mutual interest");
  });

  it("dispatches to new_proposals_digest renderer", () => {
    const result = renderTemplate("new_proposals_digest", digestData as unknown as Record<string, unknown>);
    expect(result.subject).toContain("collaboration suggestion");
  });

  it("dispatches to profile_refresh_candidate renderer", () => {
    const result = renderTemplate("profile_refresh_candidate", refreshData as unknown as Record<string, unknown>);
    expect(result.subject).toContain("new publications");
  });

  it("dispatches to unclaimed_profile_recruitment renderer", () => {
    const result = renderTemplate("unclaimed_profile_recruitment", recruitmentData as unknown as Record<string, unknown>);
    expect(result.subject).toContain("collaboration opportunity");
  });

  /** Unknown template IDs should throw rather than silently producing empty emails. */
  it("throws on unknown template ID", () => {
    expect(() => renderTemplate("nonexistent_template", {})).toThrow(
      "Unknown email template: nonexistent_template",
    );
  });
});

// --- sendEmail ---

describe("sendEmail", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  /** When AWS credentials are missing, emails should log instead of sending. */
  it("returns devMode result when AWS credentials are not set", async () => {
    delete process.env.AWS_ACCESS_KEY_ID;
    delete process.env.AWS_SECRET_ACCESS_KEY;

    const logSpy = jest.spyOn(console, "log").mockImplementation(() => {});
    const mockClient = {} as SESClient;

    const result = await sendEmail(mockClient, {
      to: "user@example.com",
      subject: "Test",
      html: "<p>Hello</p>",
    });

    expect(result.success).toBe(true);
    expect(result.devMode).toBe(true);
    expect(logSpy).toHaveBeenCalledWith(
      expect.stringContaining("Dev mode"),
    );
    expect(logSpy).toHaveBeenCalledWith(
      expect.stringContaining("user@example.com"),
    );

    logSpy.mockRestore();
  });

  /** When AWS credentials are set, should construct and send a proper SES command. */
  it("sends via SES when AWS credentials are configured", async () => {
    process.env.AWS_ACCESS_KEY_ID = "AKIATEST";
    process.env.AWS_SECRET_ACCESS_KEY = "secret";
    process.env.AWS_REGION = "us-east-1";
    process.env.SES_FROM_EMAIL = "test@copi.science";

    const mockSend = jest.fn().mockResolvedValue({
      MessageId: "ses-msg-abc123",
    });
    const mockClient = { send: mockSend } as unknown as SESClient;

    const result = await sendEmail(mockClient, {
      to: "user@example.com",
      subject: "Test Subject",
      html: "<p>Hello World</p>",
    });

    expect(result.success).toBe(true);
    expect(result.messageId).toBe("ses-msg-abc123");
    expect(result.devMode).toBeUndefined();

    // Verify the SES command was constructed correctly
    expect(mockSend).toHaveBeenCalledTimes(1);
    const command = mockSend.mock.calls[0][0];
    expect(command).toBeInstanceOf(SendEmailCommand);
    expect(command.input.Destination.ToAddresses).toEqual(["user@example.com"]);
    expect(command.input.Message.Subject.Data).toBe("Test Subject");
    expect(command.input.Message.Body.Html.Data).toBe("<p>Hello World</p>");
    expect(command.input.ReplyToAddresses).toEqual(["noreply@copi.science"]);
  });

  /** SES send failures should propagate to the caller for queue retry. */
  it("propagates SES errors for queue retry", async () => {
    process.env.AWS_ACCESS_KEY_ID = "AKIATEST";
    process.env.AWS_SECRET_ACCESS_KEY = "secret";

    const mockSend = jest.fn().mockRejectedValue(
      new Error("SES rate limit exceeded"),
    );
    const mockClient = { send: mockSend } as unknown as SESClient;

    await expect(
      sendEmail(mockClient, {
        to: "user@example.com",
        subject: "Test",
        html: "<p>Hello</p>",
      }),
    ).rejects.toThrow("SES rate limit exceeded");
  });
});

// --- sendTemplatedEmail ---

describe("sendTemplatedEmail", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
    delete process.env.AWS_ACCESS_KEY_ID;
    delete process.env.AWS_SECRET_ACCESS_KEY;
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  /** Integration test: renderTemplate + sendEmail in one call. */
  it("renders template and sends the result", async () => {
    jest.spyOn(console, "log").mockImplementation(() => {});
    const mockClient = {} as SESClient;

    const result = await sendTemplatedEmail(
      mockClient,
      "match_notification",
      "user@example.com",
      matchData as unknown as Record<string, unknown>,
    );

    expect(result.success).toBe(true);
    expect(result.devMode).toBe(true);
  });

  /** Unknown template should propagate the error, not silently succeed. */
  it("throws on unknown template ID", async () => {
    const mockClient = {} as SESClient;

    await expect(
      sendTemplatedEmail(mockClient, "bad_template", "user@example.com", {}),
    ).rejects.toThrow("Unknown email template: bad_template");
  });
});

// --- HTML structure ---

describe("email HTML structure", () => {
  /** All emails should be valid HTML documents with proper doctype and structure. */
  it("wraps content in a proper HTML document", () => {
    const result = renderMatchNotification(matchData);
    expect(result.html).toContain("<!DOCTYPE html>");
    expect(result.html).toContain("<html lang=\"en\">");
    expect(result.html).toContain("</html>");
  });

  it("includes CoPI branding in the header", () => {
    const result = renderMatchNotification(matchData);
    expect(result.html).toContain("CoPI");
  });

  it("includes preheader text for email preview", () => {
    const result = renderMatchNotification(matchData);
    // Preheader is in a hidden span
    expect(result.html).toContain("display:none");
    expect(result.html).toContain("expressed interest");
  });
});
