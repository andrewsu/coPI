/**
 * Email service for sending notification emails via AWS SES.
 *
 * Provides template rendering and sending for all CoPI notification types:
 *   - match_notification: immediate mutual match alert
 *   - new_proposals_digest: weekly batch of new proposals
 *   - profile_refresh_candidate: monthly profile update suggestion
 *   - unclaimed_profile_recruitment: invite for seeded researchers
 *
 * HTML emails use inline styles per spec ("Simple HTML emails with inline
 * styles. No template engine needed initially."). Each template function
 * returns { subject, html } for the SES call.
 *
 * When AWS credentials are not configured, emails are logged to console
 * instead of sent — suitable for local development and testing.
 */

import { SendEmailCommand } from "@aws-sdk/client-ses";
import type { SESClient } from "@aws-sdk/client-ses";

// --- Types ---

export interface EmailMessage {
  subject: string;
  html: string;
}

export interface SendEmailOptions {
  to: string;
  subject: string;
  html: string;
}

export interface SendEmailResult {
  success: boolean;
  messageId?: string;
  devMode?: boolean;
}

// --- Template data interfaces ---

export interface MatchNotificationData {
  recipientName: string;
  matchedResearcherName: string;
  matchedResearcherInstitution: string;
  matchedResearcherDepartment?: string;
  oneLineSummary: string;
  contactEmail?: string;
  emailVisibility: "public_profile" | "mutual_matches" | "never";
  proposalId: string;
}

export interface NewProposalsDigestData {
  recipientName: string;
  proposalCount: number;
  topProposalTitle: string;
  topProposalSummary: string;
}

export interface ProfileRefreshCandidateData {
  recipientName: string;
  newPublicationTitles: string[];
  changedFields: string[];
}

export interface UnclaimedProfileRecruitmentData {
  recipientName: string;
  topicArea: string;
  claimUrl: string;
}

export type TemplateData =
  | MatchNotificationData
  | NewProposalsDigestData
  | ProfileRefreshCandidateData
  | UnclaimedProfileRecruitmentData;

export type TemplateId =
  | "match_notification"
  | "new_proposals_digest"
  | "profile_refresh_candidate"
  | "unclaimed_profile_recruitment";

// --- Configuration ---

const FROM_EMAIL =
  process.env.SES_FROM_EMAIL ?? "notifications@copi.science";

function getAppUrl(): string {
  return process.env.NEXTAUTH_URL ?? "http://localhost:3000";
}

// --- Email layout ---

function wrapInLayout(bodyContent: string, preheader: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>CoPI</title>
  <!--[if mso]>
  <style>body{font-family:Arial,sans-serif;}</style>
  <![endif]-->
</head>
<body style="margin:0;padding:0;background-color:#f4f4f7;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
  <!-- Preheader text (hidden preview in inbox) -->
  <span style="display:none;font-size:1px;color:#f4f4f7;line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden;">${escapeHtml(preheader)}</span>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#f4f4f7;">
    <tr>
      <td align="center" style="padding:24px 16px;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:580px;background-color:#ffffff;border-radius:8px;overflow:hidden;">
          <!-- Header -->
          <tr>
            <td style="background-color:#1e40af;padding:20px 32px;">
              <span style="color:#ffffff;font-size:20px;font-weight:700;letter-spacing:0.5px;">CoPI</span>
            </td>
          </tr>
          <!-- Body -->
          <tr>
            <td style="padding:32px;">
              ${bodyContent}
            </td>
          </tr>
          <!-- Footer -->
          <tr>
            <td style="padding:16px 32px;background-color:#f9fafb;border-top:1px solid #e5e7eb;">
              <p style="margin:0;font-size:12px;color:#6b7280;line-height:1.5;">
                You received this email because you have an account on <a href="${escapeHtml(getAppUrl())}" style="color:#1e40af;text-decoration:none;">CoPI</a>.
                <br/>
                <a href="${escapeHtml(getAppUrl())}/settings" style="color:#1e40af;text-decoration:none;">Manage notification preferences</a>
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

// --- Template renderers ---

export function renderMatchNotification(
  data: MatchNotificationData,
): EmailMessage {
  const contactSection =
    data.emailVisibility !== "never" && data.contactEmail
      ? `<p style="margin:16px 0;font-size:15px;color:#111827;line-height:1.6;">
           You can reach them at <a href="mailto:${escapeHtml(data.contactEmail)}" style="color:#1e40af;font-weight:600;">${escapeHtml(data.contactEmail)}</a>.
         </p>`
      : `<p style="margin:16px 0;font-size:14px;color:#6b7280;line-height:1.6;font-style:italic;">
           Dr. ${escapeHtml(data.matchedResearcherName)} prefers not to share their email directly. You may reach them through their institutional directory.
         </p>`;

  const departmentLine = data.matchedResearcherDepartment
    ? `${escapeHtml(data.matchedResearcherDepartment)}, `
    : "";

  const body = `
    <p style="margin:0 0 8px;font-size:15px;color:#111827;line-height:1.6;">
      Hi Dr. ${escapeHtml(data.recipientName)},
    </p>
    <p style="margin:0 0 16px;font-size:15px;color:#111827;line-height:1.6;">
      Great news! Both you and Dr. ${escapeHtml(data.matchedResearcherName)} expressed interest in this collaboration:
    </p>
    <div style="background-color:#eff6ff;border-left:4px solid #1e40af;padding:12px 16px;margin:16px 0;border-radius:0 4px 4px 0;">
      <p style="margin:0;font-size:15px;color:#1e3a5f;line-height:1.5;font-style:italic;">
        &ldquo;${escapeHtml(data.oneLineSummary)}&rdquo;
      </p>
    </div>
    <p style="margin:16px 0 4px;font-size:14px;color:#374151;line-height:1.5;">
      <strong>${escapeHtml(data.matchedResearcherName)}</strong><br/>
      ${departmentLine}${escapeHtml(data.matchedResearcherInstitution)}
    </p>
    ${contactSection}
    <p style="margin:16px 0;font-size:15px;color:#111827;line-height:1.6;">
      We suggest reaching out to start the conversation.
    </p>
    <table role="presentation" cellpadding="0" cellspacing="0" style="margin:24px 0;">
      <tr>
        <td style="background-color:#1e40af;border-radius:6px;">
          <a href="${escapeHtml(getAppUrl())}/proposals/${escapeHtml(data.proposalId)}" style="display:inline-block;padding:12px 24px;color:#ffffff;font-size:15px;font-weight:600;text-decoration:none;">
            View Full Proposal
          </a>
        </td>
      </tr>
    </table>`;

  return {
    subject: `Mutual interest with Dr. ${data.matchedResearcherName} on a collaboration idea`,
    html: wrapInLayout(
      body,
      `You and Dr. ${data.matchedResearcherName} both expressed interest in collaborating.`,
    ),
  };
}

export function renderNewProposalsDigest(
  data: NewProposalsDigestData,
): EmailMessage {
  const body = `
    <p style="margin:0 0 8px;font-size:15px;color:#111827;line-height:1.6;">
      Hi Dr. ${escapeHtml(data.recipientName)},
    </p>
    <p style="margin:0 0 16px;font-size:15px;color:#111827;line-height:1.6;">
      You have <strong>${data.proposalCount} new collaboration suggestion${data.proposalCount === 1 ? "" : "s"}</strong> waiting for your review.
    </p>
    <div style="background-color:#eff6ff;border-left:4px solid #1e40af;padding:12px 16px;margin:16px 0;border-radius:0 4px 4px 0;">
      <p style="margin:0 0 4px;font-size:13px;color:#6b7280;text-transform:uppercase;letter-spacing:0.5px;">
        Top suggestion
      </p>
      <p style="margin:0 0 4px;font-size:15px;color:#1e3a5f;font-weight:600;">
        ${escapeHtml(data.topProposalTitle)}
      </p>
      <p style="margin:0;font-size:14px;color:#374151;line-height:1.5;">
        ${escapeHtml(data.topProposalSummary)}
      </p>
    </div>
    <table role="presentation" cellpadding="0" cellspacing="0" style="margin:24px 0;">
      <tr>
        <td style="background-color:#1e40af;border-radius:6px;">
          <a href="${escapeHtml(getAppUrl())}" style="display:inline-block;padding:12px 24px;color:#ffffff;font-size:15px;font-weight:600;text-decoration:none;">
            Review Your Latest Collaboration Ideas
          </a>
        </td>
      </tr>
    </table>`;

  return {
    subject: `You have ${data.proposalCount} new collaboration suggestion${data.proposalCount === 1 ? "" : "s"}`,
    html: wrapInLayout(
      body,
      `${data.proposalCount} new collaboration suggestions are waiting for you.`,
    ),
  };
}

export function renderProfileRefreshCandidate(
  data: ProfileRefreshCandidateData,
): EmailMessage {
  const pubList = data.newPublicationTitles
    .slice(0, 5)
    .map(
      (title) =>
        `<li style="margin:4px 0;font-size:14px;color:#374151;line-height:1.5;">${escapeHtml(title)}</li>`,
    )
    .join("\n");

  const moreCount = data.newPublicationTitles.length - 5;
  const moreText =
    moreCount > 0
      ? `<li style="margin:4px 0;font-size:14px;color:#6b7280;font-style:italic;">and ${moreCount} more...</li>`
      : "";

  const fieldLabels: Record<string, string> = {
    techniques: "Techniques",
    experimental_models: "Experimental Models",
    disease_areas: "Disease Areas",
    key_targets: "Key Targets",
    keywords: "Keywords",
    grant_titles: "Grant Titles",
  };
  const changedFieldsList = data.changedFields
    .map((f) => fieldLabels[f] ?? f)
    .join(", ");

  const body = `
    <p style="margin:0 0 8px;font-size:15px;color:#111827;line-height:1.6;">
      Hi Dr. ${escapeHtml(data.recipientName)},
    </p>
    <p style="margin:0 0 16px;font-size:15px;color:#111827;line-height:1.6;">
      We found new publications in your ORCID record. Your research profile may need updating based on these publications.
    </p>
    <div style="background-color:#fef3c7;border-left:4px solid #d97706;padding:12px 16px;margin:16px 0;border-radius:0 4px 4px 0;">
      <p style="margin:0 0 8px;font-size:13px;color:#92400e;text-transform:uppercase;letter-spacing:0.5px;">
        New publications found
      </p>
      <ul style="margin:0;padding-left:20px;">
        ${pubList}
        ${moreText}
      </ul>
    </div>
    <p style="margin:16px 0;font-size:14px;color:#374151;line-height:1.5;">
      Updated profile sections: <strong>${escapeHtml(changedFieldsList)}</strong>
    </p>
    <p style="margin:16px 0;font-size:15px;color:#111827;line-height:1.6;">
      Review and accept your updated profile, or dismiss to keep your current one.
    </p>
    <table role="presentation" cellpadding="0" cellspacing="0" style="margin:24px 0;">
      <tr>
        <td style="background-color:#1e40af;border-radius:6px;">
          <a href="${escapeHtml(getAppUrl())}/profile/edit" style="display:inline-block;padding:12px 24px;color:#ffffff;font-size:15px;font-weight:600;text-decoration:none;">
            Review Updated Profile
          </a>
        </td>
      </tr>
    </table>`;

  return {
    subject: "We found new publications \u2014 review your updated profile",
    html: wrapInLayout(
      body,
      "New publications found. Review your updated research profile.",
    ),
  };
}

export function renderUnclaimedProfileRecruitment(
  data: UnclaimedProfileRecruitmentData,
): EmailMessage {
  const body = `
    <p style="margin:0 0 8px;font-size:15px;color:#111827;line-height:1.6;">
      Hi Dr. ${escapeHtml(data.recipientName)},
    </p>
    <p style="margin:0 0 16px;font-size:15px;color:#111827;line-height:1.6;">
      Based on your published research, a potential collaboration has been identified involving
      <strong>${escapeHtml(data.topicArea)}</strong>.
    </p>
    <p style="margin:0 0 16px;font-size:15px;color:#111827;line-height:1.6;">
      A researcher has expressed interest in exploring this with you.
    </p>
    <div style="background-color:#f0fdf4;border-left:4px solid #16a34a;padding:12px 16px;margin:16px 0;border-radius:0 4px 4px 0;">
      <p style="margin:0;font-size:14px;color:#374151;line-height:1.5;">
        <strong>CoPI</strong> is an AI-powered platform that connects researchers
        with complementary expertise for specific, actionable collaboration opportunities.
        Claim your profile to see the full proposal and explore collaboration ideas.
      </p>
    </div>
    <table role="presentation" cellpadding="0" cellspacing="0" style="margin:24px 0;">
      <tr>
        <td style="background-color:#16a34a;border-radius:6px;">
          <a href="${escapeHtml(data.claimUrl)}" style="display:inline-block;padding:12px 24px;color:#ffffff;font-size:15px;font-weight:600;text-decoration:none;">
            Claim Your Profile
          </a>
        </td>
      </tr>
    </table>`;

  return {
    subject: `A collaboration opportunity in ${data.topicArea}`,
    html: wrapInLayout(
      body,
      "A researcher has expressed interest in collaborating with you.",
    ),
  };
}

// --- Template dispatcher ---

const TEMPLATE_RENDERERS: Record<
  TemplateId,
  (data: Record<string, unknown>) => EmailMessage
> = {
  match_notification: (data) =>
    renderMatchNotification(data as unknown as MatchNotificationData),
  new_proposals_digest: (data) =>
    renderNewProposalsDigest(data as unknown as NewProposalsDigestData),
  profile_refresh_candidate: (data) =>
    renderProfileRefreshCandidate(
      data as unknown as ProfileRefreshCandidateData,
    ),
  unclaimed_profile_recruitment: (data) =>
    renderUnclaimedProfileRecruitment(
      data as unknown as UnclaimedProfileRecruitmentData,
    ),
};

/**
 * Renders an email template by ID. Throws if the template ID is unknown.
 */
export function renderTemplate(
  templateId: string,
  data: Record<string, unknown>,
): EmailMessage {
  const renderer = TEMPLATE_RENDERERS[templateId as TemplateId];
  if (!renderer) {
    throw new Error(`Unknown email template: ${templateId}`);
  }
  return renderer(data);
}

// --- Sending ---

/**
 * Sends an email via AWS SES.
 *
 * When SES is not configured (no AWS credentials), logs the email
 * to console and returns { success: true, devMode: true }. This
 * allows local development without AWS setup.
 *
 * @param client - SES client instance (injected for testability)
 * @param options - Recipient, subject, and HTML body
 * @returns Result with success flag and optional SES message ID
 */
export async function sendEmail(
  client: SESClient,
  options: SendEmailOptions,
): Promise<SendEmailResult> {
  // Dev mode: log instead of sending when SES is not configured
  if (!process.env.AWS_ACCESS_KEY_ID || !process.env.AWS_SECRET_ACCESS_KEY) {
    console.log(
      `[Email] Dev mode — would send to: ${options.to}\n` +
        `  Subject: ${options.subject}\n` +
        `  Body length: ${options.html.length} chars`,
    );
    return { success: true, devMode: true };
  }

  const command = new SendEmailCommand({
    Source: FROM_EMAIL,
    Destination: {
      ToAddresses: [options.to],
    },
    ReplyToAddresses: ["noreply@copi.science"],
    Message: {
      Subject: {
        Data: options.subject,
        Charset: "UTF-8",
      },
      Body: {
        Html: {
          Data: options.html,
          Charset: "UTF-8",
        },
      },
    },
  });

  const response = await client.send(command);

  return {
    success: true,
    messageId: response.MessageId,
  };
}

/**
 * High-level function that renders a template and sends the email.
 *
 * This is the main entry point called by the send_email worker handler.
 *
 * @param client - SES client instance
 * @param templateId - One of the supported template IDs
 * @param to - Recipient email address
 * @param data - Template-specific data payload
 * @returns Send result
 */
export async function sendTemplatedEmail(
  client: SESClient,
  templateId: string,
  to: string,
  data: Record<string, unknown>,
): Promise<SendEmailResult> {
  const message = renderTemplate(templateId, data);
  return sendEmail(client, {
    to,
    subject: message.subject,
    html: message.html,
  });
}

// --- Utilities ---

/**
 * Escapes HTML special characters to prevent XSS in email templates.
 */
export function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#x27;");
}
