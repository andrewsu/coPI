/**
 * HMAC-signed unsubscribe tokens for email one-click unsubscribe.
 *
 * Tokens encode { userId, notificationType, issuedAt } and are signed
 * with NEXTAUTH_SECRET via HMAC-SHA256. This avoids needing a database
 * table for token storage — the signature is the proof of authenticity.
 *
 * Token format: base64url(payload).base64url(signature)
 *
 * Notification types map to User model fields:
 *   "all"             → emailNotificationsEnabled = false
 *   "matches"         → notifyMatches = false
 *   "new_proposals"   → notifyNewProposals = false
 *   "profile_refresh" → notifyProfileRefresh = false
 */

import { createHmac } from "crypto";

export type UnsubscribeNotificationType =
  | "all"
  | "matches"
  | "new_proposals"
  | "profile_refresh";

interface TokenPayload {
  userId: string;
  type: UnsubscribeNotificationType;
  iat: number; // issued-at Unix timestamp (seconds)
}

/** Token expiry: 90 days. Generous because unsubscribe links should work
 *  even if a user reads an old email weeks later. */
export const TOKEN_EXPIRY_SECONDS = 90 * 24 * 60 * 60;

function getSecret(): string {
  const secret = process.env.NEXTAUTH_SECRET;
  if (!secret) {
    throw new Error("NEXTAUTH_SECRET is required for unsubscribe tokens");
  }
  return secret;
}

function base64urlEncode(data: string): string {
  return Buffer.from(data, "utf-8")
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

function base64urlDecode(data: string): string {
  const padded = data.replace(/-/g, "+").replace(/_/g, "/");
  return Buffer.from(padded, "base64").toString("utf-8");
}

function sign(payload: string, secret: string): string {
  const hmac = createHmac("sha256", secret);
  hmac.update(payload);
  const sig = hmac.digest("base64");
  return sig.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/**
 * Generates a signed unsubscribe token for a user and notification type.
 */
export function generateUnsubscribeToken(
  userId: string,
  notificationType: UnsubscribeNotificationType,
): string {
  const payload: TokenPayload = {
    userId,
    type: notificationType,
    iat: Math.floor(Date.now() / 1000),
  };
  const payloadStr = base64urlEncode(JSON.stringify(payload));
  const signature = sign(payloadStr, getSecret());
  return `${payloadStr}.${signature}`;
}

/**
 * Verifies and decodes an unsubscribe token.
 *
 * Returns the decoded payload if valid, or null if:
 *   - Token format is invalid
 *   - Signature doesn't match
 *   - Token is expired
 */
export function verifyUnsubscribeToken(
  token: string,
): TokenPayload | null {
  const parts = token.split(".");
  if (parts.length !== 2) return null;

  const [payloadStr, providedSig] = parts;
  const expectedSig = sign(payloadStr, getSecret());

  // Constant-time comparison to prevent timing attacks
  if (!timingSafeEqual(providedSig, expectedSig)) return null;

  try {
    const payload: TokenPayload = JSON.parse(base64urlDecode(payloadStr));

    if (!payload.userId || !payload.type || !payload.iat) return null;

    const validTypes: UnsubscribeNotificationType[] = [
      "all",
      "matches",
      "new_proposals",
      "profile_refresh",
    ];
    if (!validTypes.includes(payload.type)) return null;

    // Check expiry
    const now = Math.floor(Date.now() / 1000);
    if (now - payload.iat > TOKEN_EXPIRY_SECONDS) return null;

    return payload;
  } catch {
    return null;
  }
}

/**
 * Builds the full unsubscribe URL for embedding in emails.
 */
export function buildUnsubscribeUrl(
  userId: string,
  notificationType: UnsubscribeNotificationType,
): string {
  const token = generateUnsubscribeToken(userId, notificationType);
  const appUrl = process.env.NEXTAUTH_URL ?? "http://localhost:3000";
  return `${appUrl}/api/email/unsubscribe?token=${encodeURIComponent(token)}`;
}

/**
 * Maps a notification type to the User model field(s) to update.
 */
export function getUnsubscribeUpdate(
  type: UnsubscribeNotificationType,
): Record<string, boolean> {
  switch (type) {
    case "all":
      return { emailNotificationsEnabled: false };
    case "matches":
      return { notifyMatches: false };
    case "new_proposals":
      return { notifyNewProposals: false };
    case "profile_refresh":
      return { notifyProfileRefresh: false };
  }
}

/**
 * Human-readable label for each notification type.
 */
export function getNotificationTypeLabel(
  type: UnsubscribeNotificationType,
): string {
  switch (type) {
    case "all":
      return "all email notifications";
    case "matches":
      return "match notifications";
    case "new_proposals":
      return "new proposals digest";
    case "profile_refresh":
      return "profile refresh notifications";
  }
}

/** Constant-time string comparison (prevents timing side-channel attacks). */
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let result = 0;
  for (let i = 0; i < a.length; i++) {
    result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return result === 0;
}
