/**
 * UnclaimedInviteModal — Shown after a user swipes "interested" on a proposal
 * involving a seeded-but-unclaimed researcher.
 *
 * Per specs/notifications.md: "The user who swiped interested is shown:
 * 'Dr. [B] hasn't joined yet. Want to invite them?' with a pre-filled email
 * template they can copy/send directly."
 *
 * Per specs/auth-and-user-management.md: "Show user A: 'Dr. [B] hasn't joined
 * yet. Want to invite them?' with a pre-filled email template they can copy/send"
 *
 * Displays a modal with a pre-filled email template that the user can copy to
 * clipboard or dismiss. The template includes the collaboration context and a
 * link for the unclaimed researcher to claim their profile.
 */

"use client";

import { useCallback, useState } from "react";

export interface InviteModalData {
  collaboratorName: string;
  proposalTitle: string;
  oneLineSummary: string;
  inviterName: string;
  claimUrl: string;
}

interface UnclaimedInviteModalProps {
  data: InviteModalData;
  onClose: () => void;
}

/** Build the pre-filled email subject line. */
export function buildInviteSubject(data: InviteModalData): string {
  return `Collaboration opportunity on CoPI — ${data.proposalTitle}`;
}

/** Build the pre-filled email body text for the user to copy/send. */
export function buildInviteBody(data: InviteModalData): string {
  return `Hi ${data.collaboratorName},

I came across a collaboration opportunity that I think could be really productive for both of us. A platform called CoPI (copi.science) uses AI to identify synergistic research partnerships based on published work, and it proposed a collaboration between us:

"${data.oneLineSummary}"

I'd love to explore this further with you. You can see the full proposal by claiming your profile on CoPI:
${data.claimUrl}

Looking forward to connecting!

Best,
${data.inviterName}`;
}

export function UnclaimedInviteModal({
  data,
  onClose,
}: UnclaimedInviteModalProps) {
  const [copied, setCopied] = useState(false);

  const emailBody = buildInviteBody(data);
  const emailSubject = buildInviteSubject(data);

  const handleCopy = useCallback(async () => {
    const fullText = `Subject: ${emailSubject}\n\n${emailBody}`;
    try {
      await navigator.clipboard.writeText(fullText);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Fallback for environments without clipboard API
      const textarea = document.createElement("textarea");
      textarea.value = fullText;
      textarea.style.position = "fixed";
      textarea.style.opacity = "0";
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand("copy");
      document.body.removeChild(textarea);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  }, [emailBody, emailSubject]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
      data-testid="unclaimed-invite-modal"
    >
      <div className="w-full max-w-lg mx-4 rounded-xl bg-white shadow-xl overflow-hidden">
        {/* Header */}
        <div className="bg-amber-50 border-b border-amber-200 px-6 py-4">
          <h3 className="text-lg font-semibold text-gray-900">
            {data.collaboratorName} hasn&apos;t joined CoPI yet
          </h3>
          <p className="mt-1 text-sm text-gray-600">
            Want to invite them? Copy the message below and send it via email.
          </p>
        </div>

        {/* Email template */}
        <div className="px-6 py-4">
          <div className="mb-2 text-xs font-medium text-gray-500 uppercase tracking-wide">
            Email template
          </div>
          <div className="rounded-lg border border-gray-200 bg-gray-50 p-4">
            <div className="mb-3 text-xs text-gray-500">
              <span className="font-medium">Subject:</span> {emailSubject}
            </div>
            <pre
              className="whitespace-pre-wrap text-sm text-gray-700 leading-relaxed font-sans"
              data-testid="invite-email-body"
            >
              {emailBody}
            </pre>
          </div>
        </div>

        {/* Actions */}
        <div className="flex items-center justify-end gap-3 border-t border-gray-200 px-6 py-4">
          <button
            onClick={onClose}
            className="rounded-md px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-100 transition-colors"
          >
            Close
          </button>
          <button
            onClick={handleCopy}
            className="flex items-center gap-2 rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 transition-colors"
            data-testid="copy-invite-button"
          >
            {copied ? (
              <>
                <svg
                  className="h-4 w-4"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M5 13l4 4L19 7"
                  />
                </svg>
                Copied!
              </>
            ) : (
              <>
                <svg
                  className="h-4 w-4"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M8 5H6a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2v-1M8 5a2 2 0 002 2h2a2 2 0 002-2M8 5a2 2 0 012-2h2a2 2 0 012 2m0 0h2a2 2 0 012 2v3m2 4H10m0 0l3-3m-3 3l3 3"
                  />
                </svg>
                Copy to Clipboard
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
